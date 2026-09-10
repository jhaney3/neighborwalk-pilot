import { z } from "zod";
import { APP_SCHEMA_VERSION, neighborWalkDataSchema, summarizePropertyVisits, type NeighborWalkData } from "./domain";
import { createSeedData } from "./seed";
import { volunteerIdForUser } from "./discipleship";
import type { getSupabaseBrowserClient } from "./supabase";
import type { Json } from "./database.types";
import { versionKey, type OutreachCommand } from "./command-schema";

type Client = NonNullable<ReturnType<typeof getSupabaseBrowserClient>>;
type Row = Record<string, unknown>;
type PageRow = { id: string; version: number; record: Json };
const rowSchema = z.record(z.string(), z.unknown());
const infoSchema = z.object({
  apiVersion: z.literal(1), church: neighborWalkDataSchema.shape.church,
  revision: z.number().int(), settingsVersion: z.number().int(),
  role: z.enum(["leader", "volunteer"]), userId: z.string().uuid(),
  volunteers: z.array(z.unknown()),
});
const string = (row: Row, key: string) => typeof row[key] === "string" ? row[key] as string : undefined;
const iso = (row: Row, key: string) => string(row, key) ? new Date(string(row, key)!).toISOString() : undefined;
const user = (row: Row, key: string) => string(row, key) ? volunteerIdForUser(string(row, key)!) : undefined;
const common = (r: Row) => ({ id: r.id, churchId: r.church_id });

export class OutreachApiError extends Error {
  constructor(message: string, public readonly code?: string) { super(message); this.name = "OutreachApiError"; }
  get needsReview() { return Boolean(this.code && /^(PT409|22|23|42501|PGRST3)/.test(this.code)); }
}
export function apiError(error: { message?: string; code?: string }): OutreachApiError {
  return new OutreachApiError(error.message ?? "The church service could not be reached.", error.code);
}

export async function readOutreachPages(client: Client, churchId: string, kind: string): Promise<PageRow[]> {
  const records: PageRow[] = [];
  let cursor = "";
  for (;;) {
    const { data, error } = await client.rpc("outreach_read_records", { target_church: churchId, entity_kind: kind, after_id: cursor, page_size: 500 });
    if (error) throw apiError(error);
    const page = data ?? [];
    if (!page.length) break;
    const next = page.at(-1)!.id;
    if (next <= cursor || page.some((row) => row.id <= cursor)) throw new Error("The record cursor did not advance. No truncated read was accepted.");
    records.push(...page);
    cursor = next;
    if (page.length < 500) break;
  }
  return records;
}

const kinds = ["event", "team", "team_member", "territory", "assignment", "property", "visit", "follow_up", "task_activity", "resident", "person_note", "restriction", "audit", "migration_issue"] as const;
type Records = Record<(typeof kinds)[number], PageRow[]>;

export function mapOutreachWorkspace(info: z.infer<typeof infoSchema>, pages: Records, preferences?: NeighborWalkData["preferences"]): NeighborWalkData {
  const rows = (kind: keyof Records) => pages[kind].map((entry) => rowSchema.parse(entry.record));
  const versions: Record<string, number> = { [versionKey("settings", info.church.id)]: info.settingsVersion };
  for (const kind of kinds) for (const r of pages[kind]) versions[versionKey(kind, r.id)] = Number(r.version);
  const assignments = rows("assignment").map((r) => ({ ...common(r), eventId: r.outing_id, territoryId: r.territory_id,
    assignedTeamId: string(r, "team_id"), assignedVolunteerId: user(r, "assignee_id"), status: r.status }));
  const members = rows("team_member");
  const activities = rows("task_activity");
  const events = rows("event").map((r) => ({ ...common(r), name: r.name, startsAt: iso(r, "starts_at"), endsAt: iso(r, "ends_at"), status: r.status,
    timezone: r.timezone, purpose: r.purpose, meetingPoint: r.meeting_point, leaderContact: r.leader_contact, guideId: string(r, "guide_id"), debrief: r.debrief }));
  const activeEventId = events.some((event) => event.id === preferences?.activeEventId) ? preferences!.activeEventId
    : String(events.find((event) => ["active", "ready", "scheduled"].includes(String(event.status)))?.id ?? events[0]?.id ?? "");
  const currentAssignments = assignments.filter((a) => a.eventId === activeEventId && !["cancelled", "declined"].includes(String(a.status)));
  const territories = rows("territory").map((r) => ({ ...common(r), eventId: string(r, "legacy_event_id"), name: r.name, color: r.color,
    center: [r.longitude, r.latitude], zoom: r.zoom, boundary: r.boundary,
    assignedTeamId: currentAssignments.find((a) => a.territoryId === r.id)?.assignedTeamId }));
  const now = new Date().toISOString();
  const candidate = neighborWalkDataSchema.parse({
    schemaVersion: APP_SCHEMA_VERSION, church: info.church,
    volunteers: info.volunteers.map((v) => { const r = rowSchema.parse(v); return { ...r, email: string(r, "email") }; }),
    events, territories, assignments,
    teams: rows("team").map((r) => ({ ...common(r), name: r.name, eventId: string(r, "legacy_event_id"), status: r.status,
      memberIds: members.filter((m) => m.team_id === r.id).map((m) => m.volunteer_id),
      territoryIds: currentAssignments.filter((a) => a.assignedTeamId === r.id).map((a) => a.territoryId) })),
    properties: rows("property").map((r) => ({ ...common(r), address: r.address, unit: string(r, "unit"), territoryId: string(r, "territory_id"),
      coordinates: r.longitude == null ? undefined : [r.longitude, r.latitude], buildingGeometry: r.building_geometry ?? undefined, parcel: r.parcel_reference ?? undefined,
      currentOutcome: "unvisited", visitCount: 0, source: r.source, createdAt: iso(r, "created_at"), updatedAt: iso(r, "updated_at"), createdByVolunteerId: user(r, "created_by") })),
    visits: rows("visit").map((r) => ({ ...common(r), eventId: string(r, "outing_id"), territoryId: string(r, "territory_id"), propertyId: string(r, "location_id"),
      residentId: string(r, "person_id"), volunteerId: r.actor_key, context: r.context, outcome: r.outcome, objectiveNote: string(r, "objective_note"),
      recordedAt: iso(r, "occurred_at"), deviceId: r.device_id })),
    residents: rows("resident").map((r) => ({ ...common(r), propertyId: string(r, "property_id"), name: string(r, "name"), faithStatus: r.faith_status,
      discipleshipStage: r.discipleship_stage, assignedVolunteerId: user(r, "assigned_to"), createdByVolunteerId: user(r, "created_by"),
      sharedWithVolunteerIds: z.array(z.string()).parse(r.shared_user_ids).map(volunteerIdForUser), sharedWithTeamIds: r.shared_team_ids,
      status: r.status, phone: string(r, "phone"), email: string(r, "email"), preferredContact: r.preferred_contact, contactPermission: r.contact_permission,
      lastContactAt: iso(r, "last_contact_at"), createdAt: iso(r, "created_at"), updatedAt: iso(r, "updated_at"),
      pendingOwnerId: user(r, "pending_owner_id"), handoffRequestedAt: iso(r, "handoff_requested_at"), legacyCreatorAccess: r.legacy_creator_access })),
    personNotes: rows("person_note").map((r) => ({ ...common(r), residentId: r.person_id, authorId: user(r, "author_id"), kind: r.kind, body: r.body, createdAt: iso(r, "created_at") })),
    followUps: rows("follow_up").map((r) => ({ ...common(r), propertyId: string(r, "location_id"), residentId: string(r, "person_id"), sourceVisitId: string(r, "encounter_id"),
      eventId: string(r, "outing_id"), assignedTeamId: string(r, "team_id"), assignedVolunteerId: user(r, "owner_id"), dueAt: r.due_date,
      status: r.status, acceptance: r.acceptance, channel: r.channel, note: string(r, "note"), completionNote: string(r, "completion_note"),
      parentFollowUpId: string(r, "parent_task_id"), createdAt: iso(r, "created_at"), completedAt: iso(r, "completed_at"),
      history: activities.filter((a) => a.task_id === r.id).map((a) => ({ id: a.id, action: a.action, actorId: a.actor_key,
        note: string(a, "note"), dueAt: string(a, "due_date"), createdAt: iso(a, "occurred_at") })).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))) })),
    restrictions: rows("restriction").map((r) => ({ ...common(r), residentId: string(r, "person_id"), propertyId: string(r, "location_id"), channel: r.channel,
      active: r.active, reason: r.reason, createdAt: iso(r, "created_at"), correctionReason: string(r, "correction_reason") })),
    audit: rows("audit").map((r) => ({ id: String(r.sequence), action: r.action, entityType: r.entity_type, entityId: r.entity_id,
      actorId: user(r, "actor_id") ?? "system", createdAt: iso(r, "occurred_at"), summary: String(r.action).replaceAll(".", " ") })).reverse(),
    migrationIssues: rows("migration_issue").map((r) => ({ entityType: r.entity_type, entityId: r.entity_id, issue: r.issue })),
    guide: [], preferences: { ...createSeedData().preferences, ...preferences, activeEventId,
      activeVolunteerId: volunteerIdForUser(info.userId), activeTerritoryId: territories.some((t) => t.id === preferences?.activeTerritoryId)
        ? preferences!.activeTerritoryId : String(territories[0]?.id ?? "") },
    sync: { mode: "connected", pending: [], commands: [], recordVersions: versions, serverRevision: info.revision, lastSyncedAt: now }, updatedAt: now,
  });
  const restrictedLocations = new Set(candidate.restrictions?.filter((r) => r.active && ["all", "visit"].includes(r.channel)).map((r) => r.propertyId));
  // A corrected restriction must not be resurrected from historical outcomes.
  const summaries = summarizePropertyVisits(candidate.properties, candidate.visits.filter((visit) => visit.outcome !== "do_not_visit"));
  return { ...candidate, properties: summaries.map((p) => ({ ...p, currentOutcome: restrictedLocations.has(p.id) ? "do_not_visit" : p.currentOutcome,
    visitCount: candidate.visits.filter((v) => v.propertyId === p.id).length })) };
}

export async function loadOutreachWorkspace(client: Client, churchId: string, preferences?: NeighborWalkData["preferences"]) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await client.rpc("outreach_workspace_info", { target_church: churchId });
    if (before.error) throw apiError(before.error);
    const info = infoSchema.parse(before.data);
    const pairs = await Promise.all(kinds.map(async (kind) => [kind, await readOutreachPages(client, churchId, kind)] as const));
    const after = await client.rpc("outreach_workspace_info", { target_church: churchId });
    if (after.error) throw apiError(after.error);
    const finalInfo = infoSchema.parse(after.data);
    if (info.revision === finalInfo.revision && info.role === finalInfo.role) {
      return { data: mapOutreachWorkspace(finalInfo, Object.fromEntries(pairs) as Records, preferences), info: finalInfo };
    }
  }
  throw new Error("The church is updating records. Refresh again in a moment; a mixed-version read was not accepted.");
}

const receiptSchema = z.object({ id: z.string(), applied: z.array(z.object({ entityType: z.string(), entityId: z.string(), version: z.number().int() })), warnings: z.array(z.string()) });
export async function submitOutreachCommand(client: Client, command: OutreachCommand) {
  const { data, error } = await client.rpc("outreach_apply_command", { command: command as unknown as Json });
  if (error) throw apiError(error);
  const receipt = receiptSchema.parse(data);
  if (receipt.id !== command.id) throw new Error("The server returned a receipt for different work. The original command is preserved.");
  return receipt;
}
