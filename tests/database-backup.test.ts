import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { backupSchemas, connectionEnvironment, createBackupKey, newBundleDirectory, openDatabaseBundle, outsideRepository, privateFile, readBackupKey, sealDatabase, validateManifest, validateSource } from "../scripts/lib/backup-files.mjs";
import { compareDatabaseManifest, sqlIdentifier, sqlLiteral } from "../scripts/lib/backup-postgres.mjs";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function temporary() { const path = await mkdtemp(join(tmpdir(), "neighborwalk-backup-test-")); directories.push(path); return path; }
const local = { projectRef: "local", host: "127.0.0.1", port: 54322, database: "postgres", user: "postgres", password: "fictional-password" };
const details = { source: { projectRef: "local", postgresMajor: 17 }, schemas: backupSchemas, extensions: [],
  tables: [{ schema: "public", name: "churches", rows: 1, digest: "a".repeat(64) }] };

describe("operator backup isolation and authenticated files", () => {
  it("quotes source-controlled identifiers and literals without changing statement boundaries", () => {
    expect(sqlIdentifier('a"; drop table example; --')).toBe('"a""; drop table example; --"');
    expect(sqlLiteral("a'; drop table example; --")).toBe("'a''; drop table example; --'");
  });
  it("rejects equal-count restores with changed bytes, columns, policies or unexpected tables", () => {
    const expected = { ...details, tables: [{ ...details.tables[0], columns: [], policies: [], rls: true }] };
    const actual = { postgresMajor: 17, extensions: [], tables: structuredClone(expected.tables) };
    expect(compareDatabaseManifest(expected, actual)).toEqual([]);
    for (const change of [{ digest: "b".repeat(64) }, { columns: ["changed"] }, { policies: ["changed"] }, { rls: false }]) {
      expect(compareDatabaseManifest(expected, { ...actual, tables: [{ ...actual.tables[0], ...change }] })).toEqual(["public.churches"]);
    }
    expect(compareDatabaseManifest(expected, { ...actual, tables: [...actual.tables, { ...actual.tables[0], name: "unexpected" }] })).toEqual(["public.unexpected"]);
  });
  it("requires the exact source, project-specific host/user, TLS and session connection", () => {
    expect(validateSource(local, "local")).toEqual(local);
    expect(() => validateSource({ ...local, port: 5432 }, "local")).toThrow();
    expect(() => validateSource({ ...local, host: "localhost" }, "local")).toThrow();
    const projectRef = "abcdefghijklmnopqrst";
    const remote = { ...local, projectRef, host: "aws-0-us-east-1.pooler.supabase.com", port: 5432, user: "postgres." + projectRef };
    expect(validateSource(remote, projectRef)).toEqual(remote);
    expect(connectionEnvironment(remote).PGSSLMODE).toBe("verify-full");
    expect(connectionEnvironment(remote).PGOPTIONS).toContain("default_transaction_read_only=on");
    expect(() => validateSource(remote, "another-project")).toThrow();
    expect(() => validateSource({ ...remote, port: 6543 }, projectRef)).toThrow();
    expect(() => validateSource({ ...remote, user: "postgres.other" }, projectRef)).toThrow();
    expect(() => validateSource({ ...remote, host: "supabase.com.attacker.test" }, projectRef)).toThrow();
  });
  it("keeps backup artifacts outside the repository and refuses overwrites and symlinks", async () => {
    await expect(outsideRepository(join(process.cwd(), "private-dump.enc"))).rejects.toThrow("outside the repository");
    const directory = await temporary(); const keyPath = join(directory, "backup.key");
    await createBackupKey(keyPath);
    expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
    expect((await readBackupKey(keyPath)).length).toBe(32);
    await expect(createBackupKey(keyPath)).rejects.toThrow();
    await symlink(keyPath, join(directory, "linked.key"));
    await expect(readBackupKey(join(directory, "linked.key"))).rejects.toThrow();
    await chmod(keyPath, 0o644);
    await expect(privateFile(keyPath)).rejects.toThrow("private");
  });
  it("encrypts, authenticates and restores exact bytes without leaving plaintext in the bundle", async () => {
    const directory = await temporary(); const bundle = await newBundleDirectory(join(directory, "bundle"));
    const key = randomBytes(32); const payload = Buffer.from("Fictional private care notes and identity bytes");
    await sealDatabase(Readable.from([payload]), bundle, key, details);
    expect((await stat(bundle)).mode & 0o777).toBe(0o700);
    expect((await readFile(join(bundle, "database.dump.enc"))).includes(payload)).toBe(false);
    const opened = await openDatabaseBundle(bundle, key, "local");
    try { expect(await readFile(opened.path)).toEqual(payload); expect((await stat(opened.path)).mode & 0o777).toBe(0o600); }
    finally { await opened.cleanup(); }
    await expect(stat(opened.path)).rejects.toThrow();
    await expect(newBundleDirectory(bundle)).rejects.toThrow();
  });
  it("refuses a wrong key, changed ciphertext, changed manifest or different church project before restore", async () => {
    const directory = await temporary(); const bundle = await newBundleDirectory(join(directory, "bundle")); const key = randomBytes(32);
    await sealDatabase(Readable.from([Buffer.from("Fictional database dump")]), bundle, key, details);
    await expect(openDatabaseBundle(bundle, randomBytes(32), "local")).rejects.toThrow("authentication failed");
    await expect(openDatabaseBundle(bundle, key, "other")).rejects.toThrow("mismatched");
    const manifestPath = join(bundle, "manifest.json"); const original = await readFile(manifestPath, "utf8");
    const changed = JSON.parse(original); changed.manifest.tables[0].rows = 2;
    await writeFile(manifestPath, JSON.stringify(changed));
    await expect(openDatabaseBundle(bundle, key, "local")).rejects.toThrow("authentication failed");
    await writeFile(manifestPath, original);
    const encrypted = await readFile(join(bundle, "database.dump.enc")); encrypted[0] ^= 1;
    await writeFile(join(bundle, "database.dump.enc"), encrypted);
    await expect(openDatabaseBundle(bundle, key, "local")).rejects.toThrow("authentication failed");
  });
  it("never writes a completed manifest if the database producer fails", async () => {
    const directory = await temporary(); const bundle = await newBundleDirectory(join(directory, "bundle"));
    const broken = Readable.from((async function* () { yield Buffer.from("partial fictional dump"); throw new Error("Fictional producer failure"); })());
    await expect(sealDatabase(broken, bundle, randomBytes(32), details)).rejects.toThrow();
    await expect(stat(join(bundle, "manifest.json"))).rejects.toThrow();
  });
  it("does not accept absent, incomplete or future manifests", () => {
    for (const manifest of [null, {}, { ...details, format: "neighborwalk-application-database", version: 2 }, { ...details, format: "neighborwalk-application-database", version: 1, tables: [null] }]) {
      expect(() => validateManifest(manifest, "local")).toThrow();
    }
    const valid = { ...details, format: "neighborwalk-application-database", version: 1 };
    for (const extensions of [[null], [{ name: "unreviewed", schema: "public", version: "1" }], [{ name: "postgis", schema: "public", version: null }]]) {
      expect(() => validateManifest({ ...valid, extensions }, "local")).toThrow();
    }
    expect(() => validateManifest({ ...valid, tables: [details.tables[0], details.tables[0]] }, "local")).toThrow("Duplicate");
  });
});
