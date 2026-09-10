import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Deliberately no environment override or remote argument. This test cannot
// accidentally target a hosted church database.
const database = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const file = fileURLToPath(new URL("../tests/database-readiness.sql", import.meta.url));
execFileSync("psql", [database, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", file], { stdio: "inherit" });
