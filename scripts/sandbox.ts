import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { assertSafeSupabaseUrl, LOCAL_SUPABASE_URL } from "../lib/environment";
import { createSeedData } from "../lib/seed";
import { neighborWalkDataSchema, type NeighborWalkData } from "../lib/domain";
import { volunteerIdForUser } from "../lib/discipleship";
import { calendarDate } from "../lib/calendar";
import type { CommandOperation } from "../lib/command-schema";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const cli = resolve("node_modules/.bin/supabase");
const runtime = resolve("work/runtime");
const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const churchId = process.argv[2] === "seed-check" ? "00000000-0000-4000-8000-000000000099" : "00000000-0000-4000-8000-000000000001";
const password = "NeighborWalk-test-123!";
const accounts = [
  { email: "leader@neighborwalk.test", name: "Test Leader", role: "leader" },
  { email: "volunteer@neighborwalk.test", name: "Test Volunteer", role: "volunteer" },
] as const;
mkdirSync(runtime, { recursive: true });

// These commands have no linked-project option and never load production credentials.
const cliEnv = { ...process.env };
delete cliEnv.SUPABASE_ACCESS_TOKEN;
if (!cliEnv.DOCKER_HOST && existsSync(resolve(runtime, "docker.sock"))) cliEnv.DOCKER_HOST = `unix://${runtime}/docker.sock`;

function runCli(args: string[]) {
  return execFileSync(cli, args, { env: cliEnv, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
}

function localSettings() {
  const settings = JSON.parse(runCli(["status", "-o", "json"])) as Record<string, string>;
  assertSafeSupabaseUrl(settings.API_URL, false);
  if (settings.API_URL !== LOCAL_SUPABASE_URL || !settings.SERVICE_ROLE_KEY || !settings.ANON_KEY) {
    throw new Error("The local sandbox is not ready. Run npm run sandbox:start.");
  }
  return settings;
}

function sql(statement: string) {
  return execFileSync("psql", [databaseUrl, "-X", "-v", "ON_ERROR_STOP=1", "-Atq"], {
    input: statement, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

function literal(value: unknown) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

function insert(table: string, row: Record<string, unknown>) {
  const columns = Object.keys(row).join(", ");
  return `insert into public.${table} (${columns}) select ${columns} from jsonb_populate_record(null::public.${table}, ${literal(row)}) on conflict do nothing;`;
}

function configureApp(settings: Record<string, string>) {
  const path = ".env.local";
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: settings.PUBLISHABLE_KEY || settings.ANON_KEY,
  };
  let next = existing;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    next = pattern.test(next) ? next.replace(pattern, line) : `${next.trimEnd()}\n${line}\n`;
  }
  writeFileSync(path, next, { mode: 0o600 });
}

async function seed(rehearsal = false) {
  const settings = localSettings();
  if (sql(`select count(*) from public.outreach_outings where church_id = '${churchId}';`) !== "0") {
    if (rehearsal) throw new Error("The seed-rehearsal church must be empty. Nothing was changed.");
    console.log("Existing sandbox records preserved.");
    return;
  }
  const admin = createClient(LOCAL_SUPABASE_URL, settings.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const existing = rehearsal ? { data: { users: [] }, error: null } : await admin.auth.admin.listUsers();
  if (existing.error) throw existing.error;
  const users = [];
  for (const account of accounts) {
    if (rehearsal) {
      const id = account.role === "leader" ? "00000000-0000-4000-8000-000000000091" : "00000000-0000-4000-8000-000000000092";
      users.push({ ...account, email: "rehearsal-" + account.email, id, volunteerId: volunteerIdForUser(id) });
      continue;
    }
    let user = existing.data.users.find((candidate) => candidate.email === account.email);
    if (!user) {
      const created = await admin.auth.admin.createUser({ email: account.email, password, email_confirm: true, user_metadata: { full_name: account.name } });
      if (created.error) throw created.error;
      user = created.data.user;
    }
    users.push({ ...account, id: user.id, volunteerId: volunteerIdForUser(user.id) });
  }
  const leader = users[0];
  const sample = createSeedData();
  const oldChurchId = sample.church.id;
  const oldVolunteers = new Set(sample.volunteers.map((volunteer) => volunteer.id));
  const sampleIds = new Set([...sample.events, ...sample.teams, ...sample.territories, ...sample.properties, ...sample.residents,
    ...sample.visits, ...sample.personNotes, ...sample.followUps, ...(sample.assignments ?? [])].map((record) => record.id));
  const data = JSON.parse(JSON.stringify(sample, (_key, value) => {
    if (value === oldChurchId) return churchId;
    if (rehearsal && typeof value === "string" && sampleIds.has(value)) return "rehearsal_" + value;
    return typeof value === "string" && oldVolunteers.has(value) ? leader.volunteerId : value;
  })) as NeighborWalkData;
  data.church.name = "NeighborWalk Test Church";
  data.volunteers = users.map((user) => ({ ...sample.volunteers[0], id: user.volunteerId, churchId, name: user.name, email: user.email, role: user.role }));
  for (const team of data.teams) team.memberIds = [...new Set(team.memberIds)];
  data.sync = { mode: "connected", pending: [] };
  data.audit = [];
  data.preferences.activeVolunteerId = leader.volunteerId;
  neighborWalkDataSchema.parse(data);
  const statements = ["begin;"];
  // Dedicated synthetic identities exist only inside the rollback transaction.
  // No real account or existing sandbox membership is touched.
  if (rehearsal) for (const user of users) statements.push(`insert into auth.users(id,email,aud,role,is_anonymous) values('${user.id}','${user.email}','authenticated','authenticated',false);`);
  statements.push(insert("churches", {
    id: churchId, name: data.church.name, created_by: leader.id,
    timezone: data.church.timezone, retention_days: data.church.retentionDays,
    default_follow_up_days: data.church.defaultFollowUpDays, note_character_limit: data.church.noteCharacterLimit,
  }));
  for (const user of users) statements.push(insert("church_memberships", {
    church_id: churchId, user_id: user.id, role: user.role, active: true,
    member_email: user.email, display_name: user.name,
  }));
  const operations: CommandOperation[] = [];
  const add = (entityType: CommandOperation["entityType"], records: { id: string }[]) => {
    for (const record of records) operations.push({ entityType, entityId: record.id, operation: "upsert", expectedVersion: 0, record });
  };
  add("event", data.events.map((e) => ({ ...e, status: "draft" })));
  add("team", data.teams);
  add("territory", data.territories);
  add("property", data.properties);
  add("resident", data.residents.map((p) => ({ ...p, name: p.name || "Fictional sample person" })));
  // Demo walk routes are device-only fixtures; the sandbox seeds plain
  // assignments and visits so no record references a route it never created.
  add("visit", data.visits.map((v) => ({ ...v, targetId: undefined, targetParcel: undefined, objectiveNote: v.residentId ? undefined : v.objectiveNote })));
  add("person_note", data.personNotes);
  add("follow_up", data.followUps.map((t) => ({ ...t, dueAt: calendarDate(t.dueAt, data.church.timezone) })));
  add("assignment", (data.assignments ?? [])
    .filter((a, index, all) => all.findIndex((other) => other.eventId === a.eventId && other.territoryId === a.territoryId) === index)
    .map((a) => ({ ...a, targetId: undefined, status: "assigned" })));
  // A short-lived synthetic session is local-only and removed in the same
  // transaction after seeding; do not weaken production authorization for fixtures.
  const seedSessionId = crypto.randomUUID();
  statements.push(`insert into auth.sessions(id,user_id,not_after) values('${seedSessionId}','${leader.id}',now()+interval '5 minutes');`);
  statements.push(`select set_config('request.jwt.claims',${literal({ sub: leader.id, session_id: seedSessionId, role: "authenticated", is_anonymous: false })}::text,true);`, "set local role authenticated;");
  for (let offset = 0; offset < operations.length; offset += 60) statements.push(`select public.outreach_apply_command(${literal({
    id: "fictional-seed-" + offset, schemaVersion: 1, churchId, userId: leader.id, createdAt: new Date().toISOString(), operations: operations.slice(offset, offset + 60),
  })});`);
  statements.push("reset role;");
  statements.push(insert("conversation_guides", {
    id: rehearsal ? "00000000-0000-4000-8000-000000000098" : "00000000-0000-4000-8000-000000000002", church_id: churchId, scope: "church",
    title: "Test conversation guide", description: "Fictional practice workspace", steps: data.guide,
    sort_order: 0, created_by: leader.id, updated_by: leader.id,
  }));
  // Synthetic rectangles exercise parcel loading without copying real addresses or geometry.
  for (const [index, property] of data.properties.entries()) {
    if (!property.coordinates) continue;
    const [lng, lat] = property.coordinates;
    statements.push(`insert into public.parcels (county_fips, gislink, situs_address, property_class, land_use, is_residential, geometry)
      values ('17031', 'sandbox-${index}', ${literal(property.address)} #>> '{}', 'Synthetic test parcel', 'Test fixture', true,
      extensions.st_multi(extensions.st_makeenvelope(${lng - 0.00015}, ${lat - 0.00012}, ${lng + 0.00015}, ${lat + 0.00012}, 4326))) on conflict do nothing;`);
  }
  statements.push(`delete from auth.sessions where id='${seedSessionId}' and user_id='${leader.id}';`);
  statements.push(rehearsal ? "rollback;" : "commit;");
  sql(statements.join("\n"));
  console.log(rehearsal ? "PASS: fresh normalized fixture seed. All church records rolled back; existing sandbox records preserved."
    : "Created a fictional church workspace, two test accounts, guides, people, tasks, and synthetic parcels.");
}

async function verify() {
  const settings = localSettings();
  const client = createClient(LOCAL_SUPABASE_URL, settings.ANON_KEY, { auth: { persistSession: false } });
  const login = await client.auth.signInWithPassword({ email: accounts[0].email, password });
  if (login.error) throw login.error;
  const info = await client.rpc("outreach_workspace_info", { target_church: churchId });
  if (info.error || info.data?.apiVersion !== 1) throw info.error ?? new Error("Normalized workspace API did not load.");
  const parcels = await client.rpc("parcels_in_view_v2", { min_lat: 41.88, min_long: -87.81, max_lat: 41.90, max_long: -87.77, result_limit: 5000 });
  if (parcels.error || !parcels.data?.length) throw parcels.error ?? new Error("Synthetic parcels did not load.");
  const deniedLegacyWrite = await client.from("workspace_snapshots").update({ schema_version: 11 }).eq("church_id", churchId);
  if (!deniedLegacyWrite.error) throw new Error("Legacy whole-workspace writes were not revoked.");
  const testPersonId = `sandbox_check_${crypto.randomUUID()}`;
  let version = 0;
  const apply = async (operation: "upsert" | "delete", record?: Record<string, unknown>) => {
    const command = { schemaVersion: 1, id: crypto.randomUUID(), churchId, userId: login.data.user.id, createdAt: new Date().toISOString(),
      operations: [{ entityType: "resident", entityId: testPersonId, operation, expectedVersion: version, record }] };
    const result = await client.rpc("outreach_apply_command", { command });
    if (result.error) throw result.error;
    const retry = await client.rpc("outreach_apply_command", { command });
    if (retry.error || JSON.stringify(retry.data) !== JSON.stringify(result.data)) throw retry.error ?? new Error("Idempotent retry returned a different receipt.");
    version += 1;
  };
  try {
    await apply("upsert", { name: "Fictional sandbox check", preferredContact: "none" });
    await apply("upsert", { name: "Updated sandbox check", preferredContact: "none" });
    const edited = await client.from("discipleship_people").select("name,property_id").eq("id", testPersonId).single();
    if (edited.error || edited.data.name !== "Updated sandbox check" || edited.data.property_id !== null) throw edited.error ?? new Error("Address-optional persisted edit failed.");
    const volunteer = createClient(LOCAL_SUPABASE_URL, settings.ANON_KEY, { auth: { persistSession: false } });
    const volunteerLogin = await volunteer.auth.signInWithPassword({ email: accounts[1].email, password });
    if (volunteerLogin.error) throw volunteerLogin.error;
    const privateRecord = await volunteer.from("discipleship_people").select("id").eq("id", testPersonId);
    if (privateRecord.error || privateRecord.data.length) throw privateRecord.error ?? new Error("Private person record was visible to another member.");
    await volunteer.auth.signOut();
  } finally {
    if (version) await apply("delete");
  }
  const deleted = await client.from("discipleship_people").select("id").eq("id", testPersonId);
  if (deleted.error || deleted.data.length) throw deleted.error ?? new Error("Local deletion failed.");
  await client.auth.signOut();
  const denied = await client.from("workspace_snapshots").select("church_id");
  if (!denied.error && denied.data?.length) throw new Error("Unauthenticated access unexpectedly succeeded.");
  console.log(`Verified local sign-in, normalized API, ${parcels.data.length} parcels, transactional person creation/edit/archive, idempotent receipts, member privacy and revoked legacy writes.`);
}

const command = process.argv[2];
if (command === "start") {
  if (process.platform === "linux" && !process.env.CI) {
    execFileSync("bash", ["scripts/start-rootless-docker.sh"], { stdio: "inherit" });
    cliEnv.DOCKER_HOST = `unix://${runtime}/docker.sock`;
  }
  console.log("Starting the isolated Supabase services. First startup downloads container images.");
  const log = openSync(resolve(runtime, "supabase-start.log"), "a");
  try {
    execFileSync(cli, ["start", "-x", "realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor"], { env: cliEnv, stdio: ["ignore", log, log] });
  } finally { closeSync(log); }
  const settings = localSettings();
  configureApp(settings);
  await seed();
  console.log("Sandbox ready. Refresh http://localhost:3000 after starting npm run dev.");
  console.log(`Test sign-in: ${accounts[0].email} / ${password}`);
} else if (command === "stop") {
  runCli(["stop"]);
  console.log("Sandbox stopped. Its data is retained.");
} else if (command === "seed") {
  await seed();
} else if (command === "seed-check") {
  await seed(true);
} else if (command === "verify") {
  await verify();
} else if (command === "status") {
  localSettings();
  console.log(`Sandbox API: ${LOCAL_SUPABASE_URL}\nStudio: http://127.0.0.1:54323`);
} else {
  throw new Error("Use sandbox:start, sandbox:stop, sandbox:seed, sandbox:verify, or sandbox:status.");
}
