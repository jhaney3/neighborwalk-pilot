import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Deliberately no environment override or remote argument. This test cannot
// accidentally target a hosted church database.
const database = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
for (const name of ["database-readiness.sql", "administration-readiness.sql", "access-administration.sql", "followup-lifecycle.sql", "reminder-readiness.sql", "duplicate-readiness.sql", "encounter-corrections.sql", "session-revocation.sql"]) {
  const file = fileURLToPath(new URL("../tests/" + name, import.meta.url));
  execFileSync("psql", [database, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", file], { stdio: "inherit" });
}
