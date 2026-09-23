import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { selectAdditiveMigrations } from "./lib/migration-selection.mjs";

// No arbitrary URL or database argument is accepted. The restored database is
// separate from the API-facing local database, and every change is rolled back.
const database = "neighborwalk_rehearsal_20260909";
const directory = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const migrations = selectAdditiveMigrations(readdirSync(directory));
const required = [
  "20260910032223_normalize_outreach_domain.sql",
  "20260912225711_add_walk_targets.sql",
  "20260915024430_add_outing_participants.sql",
  "20260919191901_mobile_account_deletion_requests.sql",
  "20260919214330_flexible_church_invitations.sql",
  "20260922024213_add_apns_push_delivery.sql",
];
const missing = required.filter((name) => !migrations.includes(name));
if (missing.length) throw new Error("The complete additive migration sequence is required; missing " + missing.join(", "));
const [before, after] = readFileSync(new URL("../tests/migration-preservation.sql", import.meta.url), "utf8").split("-- MIGRATIONS HERE");
if (!before || !after) throw new Error("Missing preservation assertions.");
const pushReadiness = readFileSync(new URL("../tests/push-delivery-rehearsal.sql", import.meta.url), "utf8");
const sql = ["begin;", before, ...migrations.map((file) =>
  "select 'migration:" + file + "';\n" + readFileSync(directory + file, "utf8").replace(/^(?:begin|commit);\s*$/gm, "")),
  "select 'stage:preservation-assertions';", after,
  "select 'stage:push-delivery-readiness';", pushReadiness, "rollback;"].join("\n");
try {
  const output = execFileSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", "-h", "127.0.0.1", "-p", "54322", "-U", "postgres", "-d", database, "-Atq"], {
    input: sql, encoding: "utf8", env: { ...process.env, PGPASSWORD: "postgres" }, stdio: ["pipe", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024,
  });
  const report = output.split("\n").find((line) => line.startsWith("{"));
  if (!report) throw new Error("No aggregate report returned.");
  console.log(report);
  console.log("All migration changes rolled back after verification. Original restored records remain unchanged.");
} catch (error) {
  // PostgreSQL row diagnostics can contain real private records. Print only an
  // SQLSTATE and our own stage markers, never stderr, SQL context or record IDs.
  const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr) : "";
  const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout) : "";
  const code = stderr.match(/(?:ERROR|FATAL):\s*([0-9A-Z]{5})\b/)?.[1] ?? "unknown";
  const stage = stdout.split("\n").filter((line) => /^(migration:\d{14}[\w.-]+|stage:(?:push-[\w-]+|preservation-assertions))$/.test(line)).at(-1) ?? "preflight";
  console.error("Rehearsal failed; rolled back. SQLSTATE:", code, "Stage:", stage);
  process.exitCode = 1;
}
