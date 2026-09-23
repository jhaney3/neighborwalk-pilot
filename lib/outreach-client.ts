import { z } from "zod";
import { APP_SCHEMA_VERSION, neighborWalkDataSchema, type NeighborWalkData } from "./domain";
import { projectOutreachWorkspace } from "./outreach-projection";
import { groupBy } from "./collections";
import { createSeedData } from "./seed";
import { volunteerIdForUser } from "./discipleship";
import type { getSupabaseBrowserClient } from "./supabase";
import type { Json } from "./database.types";
import { versionKey, type OutreachCommand } from "./command-schema";
import { CollectionReadBudget, IncompleteCollectionError, readCompletePages } from "./complete-pages";

type Client = NonNullable<ReturnType<typeof getSupabaseBrowserClient>>;
type Row = Record<string, unknown>;
type PageRow = { id: string; version: number; record: Json };
const rowSchema = z.record(z.string(), z.unknown());
const infoSchema = z.object({
  apiVersion: z.literal(1), church: neighborWalkDataSchema.shape.church,
  revision: z.number().int().nonnegative(), settingsVersion: z.number().int().positive(),
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

export const WORKSPACE_READ_LIMITS = { records: 100_000, bytes: 64 * 1024 * 1024 };
export async function readOutreachPages(client: Client, churchId: string, kind: string, budget?: CollectionReadBudget): Promise<PageRow[]> {
  return readCompletePages(async (after) => {
    const { data, error } = await client.rpc("outreach_read_records", { target_church: churchId, entity_kind: kind, after_id: after ?? "", page_size: 500 });
    // Keep permission errors typed so the caller invalidates offline access.
    if (error) throw apiError(error);
    return { data, error: null };
  }, (row) => {
    if (!row || typeof row.id !== "string" || !row.id || !Number.isSafeInteger(row.version) || row.version < 1
      || !row.record || typeof row.record !== "object" || Array.isArray(row.record) || row.record.church_id !== churchId) {
      throw new IncompleteCollectionError("A church record could not be safely read. The saved copy was not replaced; ask the operator to review the source records.");
    }
    return row.id;
  }, WORKSPACE_READ_LIMITS, budget);
}

const kinds = ["event", "participant", "team", "team_member", "territory", "target", "target_parcel", "target_progress", "parent_progress", "assignment", "property", "visit", "follow_up", "task_activity", "resident", "person_note", "restriction", "audit", "migration_issue"] as const;
type Records = Record<(typeof kinds)[number], PageRow[]>;

export function mapOutreachWorkspace(info: z.infer<typeof infoSchema>, pages: Records, preferences?: NeighborWalkData["preferences"]): NeighborWalkData {
  const rows = (kind: keyof Records) => pages[kind].map((entry) => rowSchema.parse(entry.record));
  const versions: Record<string, number> = { [versionKey("settings", info.church.id)]: info.settingsVersion };
  for (const kind of kinds) for (const r of pages[kind]) versions[versionKey(kind, r.id)] = Number(r.version);
  const assignments = rows("assignment").map((r) => ({ ...common(r), eventId: r.outing_id, territoryId: r.territory_id, targetId: string(r, "target_id"),
    assignedTeamId: string(r, "team_id"), assignedVolunteerId: user(r, "assignee_id"), status: r.status }));
  const members = rows("team_member");
  const activities = rows("task_activity");
  const membersByTeam = groupBy(members, (row) => row.team_id);
  const activitiesByTask = groupBy(activities, (row) => row.task_id);
  const parcelsByTarget = groupBy(rows("target_parcel"), (row) => row.target_id);
  const events = rows("event").map((r) => ({ ...common(r), name: r.name, startsAt: iso(r, "starts_at"), endsAt: iso(r, "ends_at"), status: r.status,
    timezone: r.timezone, purpose: r.purpose, meetingPoint: r.meeting_point, leaderContact: r.leader_contact, guideId: string(r, "guide_id"), debrief: r.debrief }));
  const activeEventId = events.some((event) => event.id === preferences?.activeEventId) ? preferences!.activeEventId
    : String(events.find((event) => ["active", "ready", "scheduled"].includes(String(event.status)))?.id ?? events[0]?.id ?? "");
  const currentAssignments = assignments.filter((a) => a.eventId === activeEventId && !["cancelled", "declined"].includes(String(a.status)));
  const territories = rows("territory").map((r) => ({ ...common(r), eventId: string(r, "legacy_event_id"), name: r.name, color: r.color,
    center: r.longitude == null ? undefined : [r.longitude, r.latitude], kind: r.kind ?? "map", zoom: r.zoom, boundary: r.boundary,
    assignedTeamId: currentAssignments.find((a) => a.territoryId === r.id)?.assignedTeamId }));
  const now = new Date().toISOString();
  const candidate = neighborWalkDataSchema.parse({
    schemaVersion: APP_SCHEMA_VERSION, church: info.church,
    volunteers: info.volunteers.map((v) => { const r = rowSchema.parse(v); return { ...r, email: string(r, "email") }; }),
    events,
    outingParticipants: rows("participant").map((r) => ({ ...common(r), eventId: r.outing_id, volunteerId: r.volunteer_id, status: r.status })),
    territories, assignments,
    walkTargets: rows("target").map((r) => ({ ...common(r), eventId: r.outing_id, territoryId: r.territory_id, name: r.name, color: r.color,
      selectionKind: r.selection_kind, geometry: r.geometry_json, streetSelection: r.street_selection ?? undefined, rosterState: r.roster_state,
      frozenAt: iso(r, "frozen_at"), finishedAt: iso(r, "finished_at"), parcels: (parcelsByTarget.get(r.id) ?? []).map((p) => ({
        countyFips: p.county_fips, gislink: p.gislink, datasetRevision: p.dataset_revision, inclusionSource: p.inclusion_source,
        geometry: p.geometry_json ?? undefined, representativePoint: p.representative_longitude == null ? undefined : [p.representative_longitude, p.representative_latitude],
      })) })),
    targetProgress: rows("target_progress").map((r) => ({ targetId: r.target_id, countyFips: r.county_fips, gislink: r.gislink })),
    parentProgress: rows("parent_progress").map((r) => ({ territoryId: r.territory_id, eventId: string(r, "outing_id"), countyFips: r.county_fips, gislink: r.gislink })),
    coverageVisibility: info.role === "leader" ? "complete" : "assigned_targets_only",
    teams: rows("team").map((r) => ({ ...common(r), name: r.name, eventId: string(r, "legacy_event_id"), status: r.status,
      memberIds: (membersByTeam.get(r.id) ?? []).map((m) => m.volunteer_id),
      territoryIds: currentAssignments.filter((a) => a.assignedTeamId === r.id).map((a) => a.territoryId) })),
    properties: rows("property").map((r) => ({ ...common(r), address: r.address, unit: string(r, "unit"), territoryId: string(r, "territory_id"),
      mergedIntoId: string(r, "merged_into_id"), mergedAt: iso(r, "merged_at"),
      coordinates: r.longitude == null ? undefined : [r.longitude, r.latitude], buildingGeometry: r.building_geometry ?? undefined, parcel: r.parcel_reference ?? undefined,
      currentOutcome: "unvisited", visitCount: 0, source: r.source, createdAt: iso(r, "created_at"), updatedAt: iso(r, "updated_at"), createdByVolunteerId: user(r, "created_by") })),
    visits: rows("visit").map((r) => ({ ...common(r), eventId: string(r, "outing_id"), territoryId: string(r, "territory_id"), targetId: string(r, "target_id"),
      targetParcel: string(r, "target_county_fips") && string(r, "target_gislink") ? { countyFips: string(r, "target_county_fips")!, gislink: string(r, "target_gislink")! } : undefined, propertyId: string(r, "location_id"),
      residentId: string(r, "person_id"), volunteerId: r.actor_key, context: r.context, outcome: r.outcome, objectiveNote: string(r, "objective_note"),
      placeLabel: string(r, "place_label"), needs: Array.isArray(r.needs) && r.needs.length ? r.needs : undefined,
      recordedAt: iso(r, "occurred_at"), deviceId: r.device_id,
      corrections: Array.isArray(r.corrections) ? r.corrections.map((item) => { const correction = rowSchema.parse(item); return { ...correction, createdAt: iso(correction, "createdAt") }; }) : undefined })),
    residents: rows("resident").map((r) => ({ ...common(r), propertyId: string(r, "property_id"), name: string(r, "name"), faithStatus: r.faith_status,
      mergedIntoId: string(r, "merged_into_id"), mergedAt: iso(r, "merged_at"),
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
      history: (activitiesByTask.get(r.id) ?? []).map((a) => ({ id: a.id, action: a.action, actorId: a.actor_key,
        note: string(a, "note"), dueAt: string(a, "due_date"), createdAt: iso(a, "occurred_at") })).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))) })),
    restrictions: rows("restriction").map((r) => ({ ...common(r), residentId: string(r, "person_id"), propertyId: string(r, "location_id"), channel: r.channel,
      originResidentId: string(r, "origin_person_id"), originPropertyId: string(r, "origin_location_id"),
      active: r.active, reason: r.reason, createdAt: iso(r, "created_at"), correctionReason: string(r, "correction_reason"), correctedAt: iso(r, "corrected_at") })),
    audit: rows("audit").map((r) => ({ id: String(r.sequence), action: r.action, entityType: r.entity_type, entityId: r.entity_id,
      actorId: user(r, "actor_id") ?? "system", createdAt: iso(r, "occurred_at"), details: r.details,
      summary: String(r.action).replaceAll(".", " ").replaceAll("_", " ") })).reverse(),
    migrationIssues: rows("migration_issue").map((r) => ({ entityType: r.entity_type, entityId: r.entity_id, issue: r.issue })),
    guide: [], preferences: { ...createSeedData().preferences, ...preferences, activeEventId,
      activeVolunteerId: volunteerIdForUser(info.userId), activeTerritoryId: territories.some((t) => t.id === preferences?.activeTerritoryId)
        ? preferences!.activeTerritoryId : String(territories[0]?.id ?? "") },
    sync: { mode: "connected", pending: [], commands: [], recordVersions: versions, serverRevision: info.revision, lastSyncedAt: now }, updatedAt: now,
  });
  return projectOutreachWorkspace(candidate);
}

export function matchesWorkspaceIdentity(value: unknown, churchId: string, userId: string): boolean {
  const parsed = infoSchema.safeParse(value);
  return parsed.success && parsed.data.church.id === churchId && parsed.data.userId === userId;
}

function workspaceInfo(value: unknown, churchId: string, userId: string) {
  const parsed = infoSchema.safeParse(value);
  if (!parsed.success) throw new IncompleteCollectionError("The church workspace response is incomplete. The saved copy was not replaced.");
  if (parsed.data.church.id !== churchId || parsed.data.userId !== userId) {
    throw new OutreachApiError("The account or church changed during this refresh. Reconnect with the original account.", "42501");
  }
  return parsed.data;
}

async function readWorkspaceCollections(client: Client, churchId: string): Promise<Records> {
  const budget = new CollectionReadBudget(WORKSPACE_READ_LIMITS);
  const pages = {} as Records;
  let next = 0;
  let failed = false;
  // Bound simultaneous API requests rather than opening all fourteen at once.
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (!failed && next < kinds.length) {
      const kind = kinds[next++];
      try { pages[kind] = await readOutreachPages(client, churchId, kind, budget); }
      catch (error) { failed = true; budget.cancel(error); throw error; }
    }
  }));
  return pages;
}

export async function loadOutreachWorkspace(client: Client, churchId: string, userId: string, preferences?: NeighborWalkData["preferences"]) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await client.rpc("outreach_workspace_info", { target_church: churchId });
    if (before.error) throw apiError(before.error);
    const info = workspaceInfo(before.data, churchId, userId);
    const pages = await readWorkspaceCollections(client, churchId);
    const after = await client.rpc("outreach_workspace_info", { target_church: churchId });
    if (after.error) throw apiError(after.error);
    const finalInfo = workspaceInfo(after.data, churchId, userId);
    if (info.revision === finalInfo.revision && info.settingsVersion === finalInfo.settingsVersion && info.role === finalInfo.role) {
      return { data: mapOutreachWorkspace(finalInfo, pages, preferences), info: finalInfo };
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
