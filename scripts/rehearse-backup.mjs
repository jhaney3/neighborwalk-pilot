import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// This drill has no remote target or credential override. It captures the local
// sandbox and restores a newly named sibling database, never the app database.
if (process.argv.length !== 2) throw new Error("This local-only drill takes no arguments.");
const directory = await mkdtemp(join(tmpdir(), "neighborwalk-backup-drill-"));
const source = join(directory, "local-source.json");
const key = join(directory, "local-drill.key");
const bundle = join(directory, "bundle");
const operator = fileURLToPath(new URL("./backup-database.mjs", import.meta.url));
const repository = fileURLToPath(new URL("../", import.meta.url));
await writeFile(source, JSON.stringify({ projectRef: "local", host: "127.0.0.1", port: 54322, database: "postgres", user: "postgres", password: "postgres" }), { flag: "wx", mode: 0o600 });
const run = (args) => execFileSync(process.execPath, [operator, ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], cwd: repository, maxBuffer: 1024 * 1024 });
try {
  run(["keygen", "--key-file", key]);
  run(["capture", "--config", source, "--expect-source", "local", "--key-file", key, "--out", bundle]);
  run(["inspect", "--bundle", bundle, "--expect-source", "local", "--key-file", key]);
  const output = run(["restore-local", "--bundle", bundle, "--expect-source", "local", "--key-file", key, "--confirm", "TRUSTED LOCAL RESTORE"]);
  const report = JSON.parse(output.split("\n").find((line) => line.startsWith("{")) ?? "null");
  if (!report || report.result !== "isolated restore verified" || !/^nw_restore_\d{14}_[a-f0-9]{8}$/.test(report.database)) throw new Error("No verified isolated restore result was returned.");
  const suites = ["database-readiness.sql", "administration-readiness.sql", "access-administration.sql", "followup-lifecycle.sql", "reminder-readiness.sql", "duplicate-readiness.sql", "encounter-corrections.sql"];
  for (const suite of suites) execFileSync("psql", ["postgresql://postgres:postgres@127.0.0.1:54322/" + report.database, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", "-f", join(repository, "tests", suite)], { stdio: ["pipe", "pipe", "pipe"] });
  const result = { ...report, permissionAndWorkflowSuites: suites.length, artifacts: directory, sourceWritesPerformed: false };
  await writeFile(join(directory, "verified-report.json"), JSON.stringify(result, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(result));
  console.log("Encrypted local drill files, its separate key, and the isolated restored database are retained. Nothing was written to production.");
} catch (error) {
  // Child SQL errors may contain private values; never print the raw exception.
  const code = error?.stderr ? String(error.stderr).match(/(?:ERROR|FATAL):\s*([A-Z0-9]{5})\b/)?.[1] : undefined;
  const target = error?.stdout ? String(error.stdout).match(/\bnw_restore_\d{14}_[a-f0-9]{8}\b/)?.[0] : undefined;
  console.error("Local backup drill failed; no live database was replaced. Private artifacts retained at " + directory + (code ? ". SQLSTATE: " + code : ""));
  if (target) console.error("Isolated restore target retained: " + target);
  process.exitCode = 1;
}
