import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { assertSafeSupabaseUrl, LOCAL_SUPABASE_URL } from "../lib/environment";
import { createSeedData } from "../lib/seed";
import { neighborWalkDataSchema, type NeighborWalkData } from "../lib/domain";
import { personInsertForCreator, volunteerIdForUser, withoutSnapshotDiscipleship } from "../lib/discipleship";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const cli = resolve("node_modules/.bin/supabase");
const runtime = resolve("work/runtime");
const databaseUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const churchId = "00000000-0000-4000-8000-000000000001";
const password = "NeighborWalk-test-123!";
const accounts = [
  { email: "leader@neighborwalk.test", name: "Test Leader", role: "leader" },
  { email: "volunteer@neighborwalk.test", name: "Test Volunteer", role: "volunteer" },
] as const;
mkdirSync(runtime, { recursive: true });

// These commands have no linked-project option and never load production credentials.
const cliEnv = { ...process.env };
delete cliEnv.SUPABASE_ACCESS_TOKEN;
if (process.platform === "linux") cliEnv.DOCKER_HOST = `unix://${runtime}/docker.sock`;

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

async function seed() {
  const settings = localSettings();
  if (sql(`select count(*) from public.workspace_snapshots where church_id = '${churchId}';`) !== "0") {
    console.log("Existing sandbox records preserved.");
    return;
  }
  const admin = createClient(LOCAL_SUPABASE_URL, settings.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const existing = await admin.auth.admin.listUsers();
  if (existing.error) throw existing.error;
  const users = [];
  for (const account of accounts) {
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
  const data = JSON.parse(JSON.stringify(sample, (_key, value) => {
    if (value === oldChurchId) return churchId;
    return typeof value === "string" && oldVolunteers.has(value) ? leader.volunteerId : value;
  })) as NeighborWalkData;
  data.church.name = "NeighborWalk Test Church";
  data.volunteers = users.map((user) => ({ ...sample.volunteers[0], id: user.volunteerId, churchId, name: user.name, email: user.email, role: user.role }));
  for (const team of data.teams) team.memberIds = [...new Set(team.memberIds)];
  data.sync = { mode: "connected", pending: [] };
  data.audit = [];
  data.preferences.activeVolunteerId = leader.volunteerId;
  neighborWalkDataSchema.parse(data);
  const statements = ["begin;", insert("churches", {
    id: churchId, name: data.church.name, created_by: leader.id,
    timezone: data.church.timezone, retention_days: data.church.retentionDays,
    default_follow_up_days: data.church.defaultFollowUpDays, note_character_limit: data.church.noteCharacterLimit,
  })];
  for (const user of users) statements.push(insert("church_memberships", {
    church_id: churchId, user_id: user.id, role: user.role, active: true,
    member_email: user.email, display_name: user.name,
  }));
  statements.push(insert("workspace_snapshots", { church_id: churchId, schema_version: data.schemaVersion, data: withoutSnapshotDiscipleship(data), updated_by: leader.id }));
  for (const person of data.residents) statements.push(insert("discipleship_people", personInsertForCreator(person, churchId, leader.id)));
  for (const note of data.personNotes) statements.push(insert("discipleship_person_notes", {
    id: note.id, church_id: churchId, person_id: note.residentId, author_id: leader.id,
    kind: note.kind, body: note.body, created_at: note.createdAt,
  }));
  for (const task of data.followUps.filter((task) => task.residentId)) statements.push(insert("discipleship_follow_ups", {
    id: task.id, church_id: churchId, person_id: task.residentId, property_id: task.propertyId,
    source_visit_id: task.sourceVisitId, created_by: leader.id, due_at: task.dueAt,
    status: task.status, note: task.note, history: task.history, created_at: task.createdAt,
  }));
  statements.push(insert("conversation_guides", {
    id: "00000000-0000-4000-8000-000000000002", church_id: churchId, scope: "church",
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
  statements.push("commit;");
  sql(statements.join("\n"));
  console.log("Created a fictional church workspace, two test accounts, guides, people, tasks, and synthetic parcels.");
}

async function verify() {
  const settings = localSettings();
  const client = createClient(LOCAL_SUPABASE_URL, settings.ANON_KEY, { auth: { persistSession: false } });
  const login = await client.auth.signInWithPassword({ email: accounts[0].email, password });
  if (login.error) throw login.error;
  const snapshot = await client.from("workspace_snapshots").select("data, revision").eq("church_id", churchId).single();
  if (snapshot.error) throw snapshot.error;
  neighborWalkDataSchema.parse(snapshot.data.data);
  const parcels = await client.rpc("parcels_in_view_v2", { min_lat: 41.88, min_long: -87.81, max_lat: 41.90, max_long: -87.77, result_limit: 5000 });
  if (parcels.error || !parcels.data?.length) throw parcels.error ?? new Error("Synthetic parcels did not load.");
  const revision = snapshot.data.revision;
  const saved = await client.from("workspace_snapshots").update({ data: snapshot.data.data }).eq("church_id", churchId).eq("revision", revision).select("revision").single();
  if (saved.error || saved.data.revision !== revision + 1) throw saved.error ?? new Error("Local save failed.");
  const testPersonId = `sandbox_check_${crypto.randomUUID()}`;
  try {
    const person = personInsertForCreator({ ...createSeedData().residents[0], id: testPersonId, propertyId: snapshot.data.data.properties[0].id }, churchId, login.data.user.id);
    const created = await client.from("discipleship_people").insert(person);
    if (created.error) throw created.error;
    const edited = await client.from("discipleship_people").update({ name: "Updated sandbox check" }).eq("id", testPersonId).select("name").single();
    if (edited.error || edited.data.name !== "Updated sandbox check") throw edited.error ?? new Error("Local edit failed.");
    const volunteer = createClient(LOCAL_SUPABASE_URL, settings.ANON_KEY, { auth: { persistSession: false } });
    const volunteerLogin = await volunteer.auth.signInWithPassword({ email: accounts[1].email, password });
    if (volunteerLogin.error) throw volunteerLogin.error;
    const privateRecord = await volunteer.from("discipleship_people").select("id").eq("id", testPersonId);
    if (privateRecord.error || privateRecord.data.length) throw privateRecord.error ?? new Error("Private person record was visible to another member.");
    await volunteer.auth.signOut();
  } finally {
    const removed = await client.from("discipleship_people").delete().eq("id", testPersonId);
    if (removed.error) console.error("Could not remove the temporary local test person:", removed.error.message);
  }
  const deleted = await client.from("discipleship_people").select("id").eq("id", testPersonId);
  if (deleted.error || deleted.data.length) throw deleted.error ?? new Error("Local deletion failed.");
  await client.auth.signOut();
  const denied = await client.from("workspace_snapshots").select("church_id");
  if (!denied.error && denied.data?.length) throw new Error("Unauthenticated access unexpectedly succeeded.");
  console.log(`Verified local sign-in, schema, ${parcels.data.length} parcels, a persisted save, person creation/edit/deletion, member privacy, and blocked unauthenticated access.`);
}

const command = process.argv[2];
if (command === "start") {
  if (process.platform === "linux") execFileSync("bash", ["scripts/start-rootless-docker.sh"], { stdio: "inherit" });
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
} else if (command === "verify") {
  await verify();
} else if (command === "status") {
  localSettings();
  console.log(`Sandbox API: ${LOCAL_SUPABASE_URL}\nStudio: http://127.0.0.1:54323`);
} else {
  throw new Error("Use sandbox:start, sandbox:stop, sandbox:seed, sandbox:verify, or sandbox:status.");
}
