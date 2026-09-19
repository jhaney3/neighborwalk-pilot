import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const format = "neighborwalk-application-database";
export const backupSchemas = ["public", "private", "auth", "storage", "supabase_migrations", "extensions"];
export const allowedExtensions = new Set(["plpgsql", "pgcrypto", "uuid-ossp", "postgis", "pg_stat_statements", "supabase_vault"]);

export async function outsideRepository(path) {
  const absolute = resolve(path);
  const parent = await realpath(dirname(absolute));
  const actual = join(parent, basename(absolute));
  const within = relative(await realpath(repository), actual);
  if (!within || (!within.startsWith(".." + "/") && !isAbsolute(within))) throw new Error("Keep backup files, keys and credentials outside the repository.");
  return actual;
}
export async function privateFile(path, limit = Infinity) {
  const actual = await outsideRepository(path);
  const stat = await lstat(actual);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > limit
    || (process.getuid && stat.uid !== process.getuid())) throw new Error("Expected a private, owner-controlled regular file (mode 600 or stricter).");
  return actual;
}
async function syncFile(path) {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}
export async function createBackupKey(path) {
  const actual = await outsideRepository(path);
  await writeFile(actual, randomBytes(32).toString("hex") + "\n", { mode: 0o600, flag: "wx" });
  await syncFile(actual);
  return actual;
}
export async function readBackupKey(path) {
  const value = (await readFile(await privateFile(path, 128), "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("The backup key must contain exactly 32 random bytes encoded as hexadecimal.");
  return Buffer.from(value, "hex");
}

export function validateSource(value, expected) {
  if (!value || typeof value !== "object" || !expected || value.projectRef !== expected) throw new Error("Source identity must match the explicitly expected project.");
  const { projectRef, host, port, database, user, password } = value;
  if (typeof password !== "string" || !password || password.length > 4096 || password.includes("\0")) throw new Error("A database password is required in the private configuration file.");
  if (projectRef === "local") {
    if (host !== "127.0.0.1" || port !== 54322 || database !== "postgres" || user !== "postgres") throw new Error("Local backup targets only the isolated database at 127.0.0.1:54322/postgres.");
  } else {
    if (!/^[a-z]{20}$/.test(projectRef) || port !== 5432 || database !== "postgres") throw new Error("Use an explicit Supabase project and a direct/session connection on port 5432.");
    const direct = ["db." + projectRef + ".supabase.co", "db." + projectRef + ".supabase.com"].includes(host) && user === "postgres";
    const session = typeof host === "string" && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com$/.test(host) && user === "postgres." + projectRef;
    if (!direct && !session) throw new Error("The database host/user does not match the expected Supabase project.");
  }
  return { projectRef, host, port, database, user, password };
}

export function connectionEnvironment(config, database = config.database, readOnly = true) {
  // Never inherit a different PGHOSTADDR, PGSERVICE, password file or options.
  const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PG")));
  return { ...base, PGHOST: config.host, PGPORT: String(config.port), PGUSER: config.user, PGPASSWORD: config.password,
    PGDATABASE: database, PGSSLMODE: config.projectRef === "local" ? "disable" : "verify-full",
    ...(config.projectRef === "local" ? {} : { PGSSLROOTCERT: "system" }), PGCONNECT_TIMEOUT: "15", PGCLIENTENCODING: "UTF8",
    PGOPTIONS: "-c timezone=UTC -c datestyle=ISO,YMD -c standard_conforming_strings=on -c lock_timeout=5000 -c statement_timeout=300000 -c idle_in_transaction_session_timeout=600000" + (readOnly ? " -c default_transaction_read_only=on" : "") };
}

export async function newBundleDirectory(path) {
  const actual = await outsideRepository(path);
  await mkdir(actual, { mode: 0o700 }); // No recursive creation or overwrites.
  return actual;
}
export function validateManifest(value, expectedSource) {
  if (!expectedSource || !value || value.format !== format || value.version !== 1 || !value.source || value.source.projectRef !== expectedSource
    || !Number.isInteger(value.source.postgresMajor) || value.source.postgresMajor < 17
    || JSON.stringify(value.schemas) !== JSON.stringify(backupSchemas) || !Array.isArray(value.tables) || !value.tables.length
    || !Array.isArray(value.extensions) || value.extensions.some((extension) => !extension || !allowedExtensions.has(extension.name)
      || typeof extension.schema !== "string" || !/^[a-z_][a-z0-9_]*$/.test(extension.schema)
      || typeof extension.version !== "string" || !/^[a-zA-Z0-9_.+-]{1,64}$/.test(extension.version))
    || new Set(value.extensions.map((extension) => extension.name)).size !== value.extensions.length
    || value.tables.some((table) => !table || !backupSchemas.includes(table.schema) || typeof table.name !== "string" || !table.name || table.name.includes("\0")
      || !Number.isSafeInteger(table.rows) || table.rows < 0 || !/^[a-f0-9]{64}$/.test(table.digest))) throw new Error("Unsupported or mismatched database-backup manifest.");
  if (new Set(value.tables.map((table) => JSON.stringify([table.schema, table.name]))).size !== value.tables.length) throw new Error("Duplicate table identities in database-backup manifest.");
  return value;
}
export async function sealDatabase(input, directory, key, details) {
  const manifest = { format, version: 1, ...details };
  validateManifest(manifest, details.source?.projectRef);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(manifest)));
  const digest = createHash("sha256");
  const meter = new Transform({ transform(chunk, encoding, callback) { digest.update(chunk); callback(null, chunk); } });
  const encrypted = join(directory, "database.dump.enc");
  await pipeline(input, cipher, meter, createWriteStream(encrypted, { flags: "wx", mode: 0o600 }));
  await syncFile(encrypted);
  const envelope = { manifest, encryption: { algorithm: "aes-256-gcm", iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), sha256: digest.digest("hex") } };
  // The manifest is the completion marker, written only after the archive is
  // durable. It is authenticated as associated data, not trusted on its own.
  await writeFile(join(directory, "manifest.json"), JSON.stringify(envelope, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await syncFile(join(directory, "manifest.json"));
  await syncFile(directory);
  return manifest;
}

/** Authenticate the entire archive before ANY restore command can see bytes.
 * The temporary plaintext is private and must be removed by the caller. */
export async function openDatabaseBundle(directory, key, expectedSource) {
  const envelope = JSON.parse(await readFile(await privateFile(join(directory, "manifest.json"), 2 * 1024 * 1024), "utf8"));
  const manifest = validateManifest(envelope.manifest, expectedSource);
  const { algorithm, iv, tag, sha256 } = envelope.encryption ?? {};
  if (algorithm !== "aes-256-gcm" || !/^[a-f0-9]{24}$/.test(iv) || !/^[a-f0-9]{32}$/.test(tag) || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Unsupported backup encryption envelope.");
  const encrypted = await privateFile(join(directory, "database.dump.enc"));
  const temporary = await mkdtemp(join(tmpdir(), "neighborwalk-authenticated-restore-"));
  const path = join(temporary, "database.dump");
  const cleanup = async () => { await unlink(path).catch((error) => { if (error.code !== "ENOENT") throw error; }); await rmdir(temporary); };
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
    decipher.setAAD(Buffer.from(JSON.stringify(manifest))); decipher.setAuthTag(Buffer.from(tag, "hex"));
    const digest = createHash("sha256");
    const meter = new Transform({ transform(chunk, encoding, callback) { digest.update(chunk); callback(null, chunk); } });
    await pipeline(createReadStream(encrypted), meter, decipher, createWriteStream(path, { flags: "wx", mode: 0o600 }));
    if (digest.digest("hex") !== sha256) throw new Error("Integrity mismatch");
    return { manifest, path, cleanup };
  } catch {
    await cleanup();
    throw new Error("Backup authentication failed. No restore was attempted; preserve the encrypted original and verify the key and source.");
  }
}
