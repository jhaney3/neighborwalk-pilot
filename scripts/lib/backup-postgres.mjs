import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { allowedExtensions, backupSchemas, connectionEnvironment } from "./backup-files.mjs";

export const sqlIdentifier = (value) => '"' + String(value).replaceAll('"', '""') + '"';
export const sqlLiteral = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const schemas = backupSchemas.map(sqlLiteral).join(",");

/** An explicit connection, with one read-only snapshot kept alive for the
 * manifest and pg_dump. Raw SQL diagnostics never reach logs or the console. */
export class BackupSql {
  constructor(config, database = config.database, readOnly = true) {
    this.pending = null; this.closed = false; this.buffer = ""; this.sqlstate = "unknown";
    this.child = spawn("psql", ["-X", "-q", "-A", "-t", "--no-password", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"], {
      env: connectionEnvironment(config, database, readOnly), stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      if (this.buffer.length > 2 * 1024 * 1024) { this.fail("Database metadata exceeded the safety limit."); return; }
      let newline;
      while ((newline = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, newline).trim(); this.buffer = this.buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const result = JSON.parse(line);
          if (!this.pending) { this.fail("Unexpected database response."); return; }
          const request = this.pending; this.pending = null; request.resolve(result);
        } catch { this.fail("Database metadata could not be validated."); return; }
      }
    });
    this.child.stderr.on("data", (chunk) => { this.sqlstate = String(chunk).match(/(?:ERROR|FATAL):\s*([A-Z0-9]{5})\b/)?.[1] ?? this.sqlstate; });
    this.child.on("error", () => this.fail("The required PostgreSQL client could not start."));
    this.child.on("close", () => { this.closed = true; if (this.pending) this.fail("Database operation stopped. SQLSTATE: " + this.sqlstate); });
    this.child.stdin.on("error", () => this.fail("Database connection closed before the operation finished."));
  }
  fail(message) {
    const pending = this.pending; this.pending = null; this.closed = true;
    pending?.reject(new Error(message)); this.child.kill("SIGTERM");
  }
  query(sql) {
    if (this.closed || this.pending) return Promise.reject(new Error("Database session is unavailable or busy."));
    return new Promise((resolve, reject) => { this.pending = { resolve, reject }; this.child.stdin.write(sql + ";\n"); });
  }
  async close() {
    if (!this.closed && !this.pending) await this.query("rollback; select 'true'::json").catch(() => undefined);
    this.child.stdin.end(); this.child.kill("SIGTERM"); this.closed = true;
  }
}

const catalogSql = `select jsonb_build_object(
 'snapshot',pg_export_snapshot(),'database',current_database(),'postgresMajor',current_setting('server_version_num')::int/10000,
 'capturedAt',to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'largeObjects',(select count(*) from pg_largeobject_metadata),
 'extensions',(select jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) order by e.extname)
  from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
 'tables',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
  'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
    'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,
    'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid),
    'roles',(select jsonb_agg(case when r=0 then 'public' else pg_get_userbyid(r) end order by r) from unnest(p.polroles) r)) order by p.polname),'[]'::jsonb)
    from pg_policy p where p.polrelid=c.oid)) order by n.nspname,c.relname)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in (${schemas}) and c.relkind in ('r','p'))
)`;

export async function snapshotMetadata(session) {
  const metadata = await session.query("begin isolation level repeatable read read only; set local search_path=pg_catalog; " + catalogSql);
  if (!metadata || metadata.postgresMajor < 17 || !/^[A-Fa-f0-9-]+$/.test(metadata.snapshot)
    || !Array.isArray(metadata.tables) || !metadata.tables.length || !Array.isArray(metadata.extensions)) throw new Error("The database snapshot does not meet the recovery requirements.");
  if (metadata.largeObjects !== 0) throw new Error("This database uses large objects outside the application backup scope. Arrange a complete operator-reviewed backup first.");
  if (metadata.extensions.some((extension) => !allowedExtensions.has(extension.name))) throw new Error("An extension outside the reviewed recovery scope needs an operator-specific restore plan.");
  if (metadata.extensions.some((extension) => extension.name === "supabase_vault")) {
    const vault = await session.query("select jsonb_build_object('secrets',count(*)) from vault.secrets");
    if (vault.secrets) throw new Error("Vault secrets require a separate encrypted-root-key recovery plan. No incomplete application backup was accepted.");
  }
  for (const table of metadata.tables) {
    const relation = sqlIdentifier(table.schema) + "." + sqlIdentifier(table.name);
    const result = await session.query("select jsonb_build_object('rows',count(*),'digest',encode(sha256(convert_to(coalesce(string_agg(h,'' order by h),''),'UTF8')),'hex')) from (select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h from " + relation + " t) hashes");
    Object.assign(table, result);
  }
  return metadata;
}

export function databaseArchive(config, snapshot) {
  const output = new PassThrough();
  const child = spawn("pg_dump", ["--format=custom", "--no-password", "--no-publications", "--no-subscriptions", "--lock-wait-timeout=5000",
    "--snapshot=" + snapshot, ...backupSchemas.map((schema) => "--schema=" + schema)], { env: connectionEnvironment(config), stdio: ["ignore", "pipe", "pipe"] });
  let warnings = false;
  child.stderr.on("data", () => { warnings = true; });
  child.stdout.pipe(output, { end: false });
  child.on("error", () => output.destroy(new Error("The pg_dump client could not start.")));
  child.on("close", (code) => {
    if (code !== 0 || warnings) output.destroy(new Error("The database archive did not complete cleanly. No completed backup was accepted."));
    else output.end();
  });
  output.on("close", () => child.kill("SIGTERM"));
  return output;
}

export function runPostgres(program, args, environment, maximumOutput = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { env: environment, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = []; let size = 0; let diagnostic = false;
    child.stdout.on("data", (chunk) => { size += chunk.length; if (size > maximumOutput) child.kill("SIGTERM"); else chunks.push(chunk); });
    child.stderr.on("data", () => { diagnostic = true; });
    child.on("error", () => reject(new Error("Required PostgreSQL executable could not start.")));
    child.on("close", (code) => code === 0 && size <= maximumOutput && !diagnostic
      ? resolve(Buffer.concat(chunks).toString("utf8")) : reject(new Error(program + " did not complete cleanly. Private SQL diagnostics were not printed.")));
  });
}

export function compareDatabaseManifest(expected, actual) {
  const differences = [];
  if (expected.source.postgresMajor !== actual.postgresMajor) differences.push("PostgreSQL major version");
  if (JSON.stringify(expected.extensions) !== JSON.stringify(actual.extensions)) differences.push("Extension names, schemas or versions");
  const restored = new Map(actual.tables.map((table) => [table.schema + "." + table.name, table]));
  for (const table of expected.tables) {
    const key = table.schema + "." + table.name;
    if (JSON.stringify(table) !== JSON.stringify(restored.get(key))) differences.push(key);
    restored.delete(key);
  }
  differences.push(...restored.keys());
  return differences;
}
