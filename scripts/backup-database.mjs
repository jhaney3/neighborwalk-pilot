import { randomBytes } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { backupSchemas, connectionEnvironment, createBackupKey, newBundleDirectory, openDatabaseBundle, privateFile, readBackupKey, sealDatabase, validateSource } from "./lib/backup-files.mjs";
import { BackupSql, compareDatabaseManifest, databaseArchive, runPostgres, snapshotMetadata, sqlIdentifier, sqlLiteral } from "./lib/backup-postgres.mjs";

const usage = `NeighborWalk operator recovery (Node 22; PostgreSQL clients 17+)
  keygen --key-file /private/path/backup.key
  capture --config /private/path/source.json --expect-source PROJECT_REF --key-file /private/path/backup.key --out /private/path/NEW_DIRECTORY
  inspect --bundle /private/path/BUNDLE --expect-source PROJECT_REF --key-file /private/path/backup.key
  restore-local --bundle /private/path/BUNDLE --expect-source PROJECT_REF --key-file /private/path/backup.key --confirm "TRUSTED LOCAL RESTORE"

Capture is read-only. No source password is printed or passed in process arguments.
Restore only creates a new nw_restore_* database on 127.0.0.1:54322; it never
overwrites an existing database and never targets a hosted project.
Only restore bundles from a trusted operator/source: SQL archives execute code.
Provider configuration, encryption root keys, storage object files, cluster
roles and managed backup/PITR are separate operational responsibilities.`;
const local = { projectRef: "local", host: "127.0.0.1", port: 54322, database: "postgres", user: "postgres", password: "postgres" };
// Supabase's isolated development image supplies this local-only superuser.
// It is never selectable as a hosted source or accepted from CLI arguments.
const localRestore = { ...local, user: "supabase_admin" };

function argumentsFor(argv) {
  const [command, ...parts] = argv;
  const allowed = { keygen: ["key-file"], capture: ["config", "expect-source", "key-file", "out"], inspect: ["bundle", "expect-source", "key-file"], "restore-local": ["bundle", "expect-source", "key-file", "confirm"] };
  if (!command || command === "--help") return null;
  if (!Object.hasOwn(allowed, command) || parts.length % 2) throw new Error("Unsupported arguments. Use --help.");
  const options = {};
  for (let index = 0; index < parts.length; index += 2) {
    const key = parts[index].replace(/^--/, "");
    if (!parts[index].startsWith("--") || !allowed[command].includes(key) || Object.hasOwn(options, key) || !parts[index + 1]) throw new Error("Unsupported or repeated option. Use --help.");
    options[key] = parts[index + 1];
  }
  if (allowed[command].some((key) => !options[key])) throw new Error("Missing required options. Use --help.");
  return { command, options };
}

async function capture(options) {
  const config = validateSource(JSON.parse(await readFile(await privateFile(options.config, 16 * 1024), "utf8")), options["expect-source"]);
  const key = await readBackupKey(options["key-file"]);
  let session;
  try {
    const directory = await newBundleDirectory(options.out);
    session = new BackupSql(config);
    console.log("Capturing one read-only database snapshot. No record contents will be printed.");
    const metadata = await snapshotMetadata(session);
    const details = { source: { projectRef: config.projectRef, database: metadata.database, postgresMajor: metadata.postgresMajor, capturedAt: metadata.capturedAt },
      schemas: backupSchemas, tables: metadata.tables, extensions: metadata.extensions,
      exclusions: ["cluster roles and passwords", "provider/JWT/encryption root keys", "storage object files", "platform settings, functions, domains and schedules", "schemas outside the declared scope"] };
    await sealDatabase(databaseArchive(config, metadata.snapshot), directory, key, details);
    console.log(JSON.stringify({ result: "encrypted application database captured", directory, tables: metadata.tables.length,
      records: metadata.tables.reduce((sum, table) => sum + table.rows, 0), restoreVerified: false }));
  } finally { key.fill(0); await session?.close(); }
}

async function authenticatedBundle(options) {
  const key = await readBackupKey(options["key-file"]);
  try { return await openDatabaseBundle(options.bundle, key, options["expect-source"]); }
  finally { key.fill(0); }
}

async function inspect(options) {
  const opened = await authenticatedBundle(options);
  try {
    await runPostgres("pg_restore", ["--list", opened.path], connectionEnvironment(local));
    console.log(JSON.stringify({ result: "authenticated readable archive", source: opened.manifest.source.projectRef, tables: opened.manifest.tables.length,
      records: opened.manifest.tables.reduce((sum, table) => sum + table.rows, 0), restoreVerified: false, exclusions: opened.manifest.exclusions }));
  } finally { await opened.cleanup(); }
}

async function restoreLocal(options) {
  if (options.confirm !== "TRUSTED LOCAL RESTORE") throw new Error("Explicit trusted-source confirmation is required. Restoring SQL executes source-controlled code.");
  const opened = await authenticatedBundle(options);
  let database; let session;
  try {
    const catalog = await runPostgres("pg_restore", ["--list", opened.path], connectionEnvironment(local));
    const prerequisites = new BackupSql(localRestore);
    try {
      const checked = await prerequisites.query("select jsonb_build_object('major',current_setting('server_version_num')::int/10000,'superuser',(select rolsuper from pg_roles where rolname=current_user))");
      if (checked.major !== opened.manifest.source.postgresMajor || !checked.superuser) throw new Error("The isolated restore requires a matching PostgreSQL major version and the local Supabase development administrator.");
    } finally { await prerequisites.close(); }
    database = "nw_restore_" + new Date().toISOString().replace(/\D/g, "").slice(0, 14) + "_" + randomBytes(4).toString("hex");
    if (!/^nw_restore_\d{14}_[a-f0-9]{8}$/.test(database)) throw new Error("Invalid isolated restore name.");
    await runPostgres("createdb", ["--no-password", "--template=template0", "--owner=postgres", database], connectionEnvironment(localRestore, "postgres", false));
    console.log("Created isolated local restore database: " + database);
    session = new BackupSql(localRestore, database, false);
    const extensionSql = [];
    for (const extension of opened.manifest.extensions) {
      if (extension.name === "plpgsql") continue;
      extensionSql.push("create schema if not exists " + sqlIdentifier(extension.schema));
      extensionSql.push("create extension " + sqlIdentifier(extension.name) + " with schema " + sqlIdentifier(extension.schema) + " version " + sqlLiteral(extension.version));
    }
    await session.query("begin; " + extensionSql.join("; ") + "; commit; select 'true'::json");
    // Schema-selected pg_dump archives omit extension definitions. PostGIS
    // configuration data contains custom SRIDs, not the extension's built-ins:
    // retain the matching extension's reference rows before restoring additions.
    const listPath = join(dirname(opened.path), "restore-list.txt");
    const existingSchemas = new Set(["public", ...opened.manifest.extensions.filter((extension) => extension.name !== "plpgsql").map((extension) => extension.schema)]);
    const selected = catalog.split("\n").filter((line) => {
      const schema = line.match(/^\d+; \d+ \d+ SCHEMA - (\S+) /)?.[1];
      return !schema || !existingSchemas.has(schema);
    }).join("\n");
    await writeFile(listPath, selected, { flag: "wx", mode: 0o600 });
    try { await runPostgres("pg_restore", ["--no-password", "--exit-on-error", "--single-transaction", "--use-list=" + listPath, "--dbname=" + database, opened.path], connectionEnvironment(localRestore, database, false)); }
    finally { await unlink(listPath); }
    const restored = await snapshotMetadata(session);
    const differences = compareDatabaseManifest(opened.manifest, restored);
    if (differences.length) throw new Error("Restore verification differs in " + differences.length + " table/schema/extension checks. The isolated database remains quarantined; no live records changed.");
    console.log(JSON.stringify({ result: "isolated restore verified", database, tables: restored.tables.length,
      records: restored.tables.reduce((sum, table) => sum + table.rows, 0), exactRowDigests: true, columnAndRlsPolicies: true,
      applicationSignInVerified: false, providerConfigurationVerified: false }));
  } catch (error) {
    if (database) console.error("Restore target retained for private investigation: " + database + ". It is not connected to the app or any sender.");
    throw error;
  } finally { await session?.close(); await opened.cleanup(); }
}

try {
  const parsed = argumentsFor(process.argv.slice(2));
  if (!parsed) console.log(usage);
  else if (parsed.command === "keygen") console.log("New private key created: " + await createBackupKey(parsed.options["key-file"]) + ". Store a protected copy separately from backups; it will not be printed.");
  else if (parsed.command === "capture") await capture(parsed.options);
  else if (parsed.command === "inspect") await inspect(parsed.options);
  else await restoreLocal(parsed.options);
} catch (error) {
  // Never log a raw PostgreSQL error, a credential object, or a dumped record.
  console.error(error instanceof SyntaxError ? "A private configuration or manifest is not valid JSON." : error instanceof Error ? error.message : "Recovery operation failed.");
  process.exitCode = 1;
}
