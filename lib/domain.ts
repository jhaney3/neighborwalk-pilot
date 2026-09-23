import { z } from "zod";
import { queuedCommandSchema } from "./command-schema";
import { recordFamilyIds } from "./record-aliases";
import { calendarDate, calendarDaysFromNow, DEFAULT_CHURCH_TIMEZONE, formatCalendarDate } from "./calendar";
import { walkTargetSchema } from "./walk-targets";

export const APP_SCHEMA_VERSION = 13;

export const outcomeValues = [
  "unvisited",
  "no_answer",
  "conversation",
  "follow_up",
  "declined",
  "do_not_visit",
  "inaccessible",
] as const;

export type Outcome = (typeof outcomeValues)[number];
export type Role = Volunteer["role"];
export type Coordinates = [longitude: number, latitude: number];

export const outcomeMeta: Record<
  Outcome,
  { label: string; short: string; color: string; description: string }
> = {
  unvisited: {
    label: "Not knocked yet",
    short: "Not yet",
    color: "#ffffff",
    description: "No one has knocked here yet.",
  },
  no_answer: {
    label: "No answer",
    short: "No answer",
    color: "#6b91ad",
    description: "No one came to the door.",
  },
  conversation: {
    label: "Talked",
    short: "Talked",
    color: "#4d977e",
    description: "You had a conversation. No one needs to come back.",
  },
  follow_up: {
    label: "Follow-up",
    short: "Follow-up",
    color: "#e9a84a",
    description: "They’d like someone to come back or be in touch.",
  },
  declined: {
    label: "Not interested",
    short: "Not interested",
    color: "#d2aaa6",
    description: "They didn’t want to talk.",
  },
  do_not_visit: {
    label: "Don’t knock",
    short: "Don’t knock",
    color: "#666f6b",
    description: "They asked us not to come back.",
  },
  inaccessible: {
    label: "Couldn’t reach",
    short: "Couldn’t reach",
    color: "#9b8c7d",
    description: "The door couldn’t be reached safely.",
  },
};

// Runtime validation is the source of truth for persisted record types.
export type Church = NeighborWalkData["church"];

export type Volunteer = NeighborWalkData["volunteers"][number];

export type OutreachEvent = NeighborWalkData["events"][number];

export type Territory = NeighborWalkData["territories"][number];

export type TerritoryUpdate = {
  name: string;
  color: string;
  assignedTeamId?: string;
  boundary?: Coordinates[];
  center?: Coordinates;
  kind?: "map" | "list";
};

export type Team = NeighborWalkData["teams"][number];

export type TeamUpdate = Pick<Team, "name" | "memberIds" | "status">;

export type ParcelReference = NonNullable<Property["parcel"]>;

export type Property = NeighborWalkData["properties"][number];

export type Visit = NeighborWalkData["visits"][number];

export const faithStatusValues = [
  "not_discussed",
  "christian",
  "exploring",
  "another_faith",
  "no_faith",
  "prefer_not_to_say",
] as const;

export type FaithStatus = (typeof faithStatusValues)[number];
export type ContactPreference = Resident["preferredContact"];

export const discipleshipStageValues = [
  "new_connection",
  "building_relationship",
  "exploring_faith",
  "following_jesus",
  "growing",
  "multiplying",
] as const;

export type DiscipleshipStage = (typeof discipleshipStageValues)[number];
export type ResidentStatus = Resident["status"];
export type PersonNoteKind = PersonNote["kind"];

export const discipleshipStageLabels: Record<DiscipleshipStage, string> = {
  new_connection: "New connection",
  building_relationship: "Building relationship",
  exploring_faith: "Exploring faith",
  following_jesus: "Following Jesus",
  growing: "Growing",
  multiplying: "Helping others grow",
};

export const personNoteKindLabels: Record<PersonNoteKind, string> = {
  conversation: "Conversation",
  prayer: "Prayer",
  milestone: "Milestone",
  general: "General note",
};

export const faithStatusLabels: Record<FaithStatus, string> = {
  not_discussed: "Not discussed",
  christian: "Christian",
  exploring: "Exploring or curious",
  another_faith: "Another faith",
  no_faith: "No faith",
  prefer_not_to_say: "Prefers not to say",
};

export type Resident = NeighborWalkData["residents"][number];

export type ResidentInput = Omit<Resident, "id" | "churchId" | "propertyId" | "createdByVolunteerId" | "createdAt" | "updatedAt"> & { changeReason?: string };

export type PersonNote = NeighborWalkData["personNotes"][number];

export type FollowUpActivity = FollowUp["history"][number];

export type FollowUp = NeighborWalkData["followUps"][number];

export type FollowUpCompletionInput = {
  completionNote?: string;
  nextFollowUp?: {
    dueAt: string;
    note?: string;
    assignedTeamId?: string;
  };
};

export type GuideStep = NeighborWalkData["guide"][number];

export type ConversationGuideScope = "church" | "personal";

export type ConversationGuide = {
  id: string;
  churchId: string;
  scope: ConversationGuideScope;
  ownerUserId?: string;
  title: string;
  description: string;
  steps: GuideStep[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  version?: number;
};

export type ConversationGuideInput = Pick<
  ConversationGuide,
  "scope" | "title" | "description" | "steps"
> & { id?: string; expectedVersion?: number };

export type AuditEntry = NeighborWalkData["audit"][number];

export type PendingMutation = SyncState["pending"][number];

export type AppPreferences = NeighborWalkData["preferences"];

export type SyncState = NeighborWalkData["sync"];

export type NeighborWalkData = z.infer<typeof neighborWalkDataSchema>;

const coordinatesSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

const outcomeSchema = z.enum(outcomeValues);
const followUpActivitySchema = z.object({
  id: z.string().min(1),
  action: z.enum(["created", "rescheduled", "note", "completed", "cancelled", "reassigned", "accepted", "declined"]),
  note: z.string().max(2000).optional(),
  dueAt: z.union([z.string().date(), z.string().datetime()]).optional(),
  actorId: z.string().min(1),
  createdAt: z.string().datetime(),
});

const residentSchema = z.object({
  id: z.string().min(1),
  mergedIntoId: z.string().min(1).optional(),
  mergedAt: z.string().datetime().optional(),
  churchId: z.string().min(1),
  propertyId: z.string().min(1).optional(),
  name: z.string().min(1).max(120).optional(),
  faithStatus: z.enum(faithStatusValues),
  discipleshipStage: z.enum(discipleshipStageValues),
  assignedVolunteerId: z.string().min(1),
  pendingOwnerId: z.string().optional(),
  handoffRequestedAt: z.string().datetime().optional(),
  legacyCreatorAccess: z.boolean().optional(),
  contactPermission: z.enum(["not_recorded", "requested", "do_not_contact"]).optional(),
  createdByVolunteerId: z.string().min(1),
  sharedWithVolunteerIds: z.array(z.string().min(1)).max(250),
  sharedWithTeamIds: z.array(z.string().min(1)).max(100),
  status: z.enum(["active", "paused", "archived"]),
  phone: z.string().min(3).max(40).optional(),
  email: z.string().email().max(254).optional(),
  preferredContact: z.enum(["none", "text", "call", "email"]),
  lastContactAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).superRefine((resident, context) => {
  if (resident.preferredContact === "email" && !resident.email) {
    context.addIssue({ code: "custom", path: ["email"], message: "Email is required for email contact." });
  }
  if (["text", "call"].includes(resident.preferredContact) && !resident.phone) {
    context.addIssue({ code: "custom", path: ["phone"], message: "A phone number is required for text or call contact." });
  }
});

export function isSafeWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  } catch {
    return false;
  }
}

export function formatPhoneNumber(value: string): string {
  const trimmed = value.trim();
  const extensionMatch = trimmed.match(/\s*(?:ext\.?|x)\s*(\d+)$/i);
  const extension = extensionMatch?.[1];
  const base = extensionMatch ? trimmed.slice(0, extensionMatch.index).trim() : trimmed;
  const digits = base.replace(/\D/g, "");
  const suffix = extension ? ` ext. ${extension}` : "";

  if (digits.length === 7) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}${suffix}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}${suffix}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}${suffix}`;
  }

  return trimmed;
}

export const neighborWalkDataSchema = z.object({
  schemaVersion: z.literal(APP_SCHEMA_VERSION),
  church: z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(120),
    timezone: z.string().min(1),
    retentionDays: z.number().int().min(30).max(3650),
    defaultFollowUpDays: z.number().int().min(1).max(90),
    noteCharacterLimit: z.number().int().min(80).max(2000),
    pathwayEnabled: z.boolean().optional(),
  }),
  volunteers: z.array(z.object({
    id: z.string().min(1),
    churchId: z.string().min(1),
    name: z.string().min(1).max(120),
    email: z.string().email().optional(),
    role: z.enum(["leader", "volunteer"]),
    active: z.boolean(),
  })),
  events: z.array(z.object({
    id: z.string().min(1),
    churchId: z.string().min(1),
    name: z.string().min(1).max(160),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    status: z.enum(["draft", "scheduled", "ready", "active", "completed", "cancelled", "archived"]),
    timezone: z.string().optional(),
    purpose: z.string().max(1000).optional(),
    meetingPoint: z.string().max(300).optional(),
    leaderContact: z.string().max(254).optional(),
    guideId: z.string().optional(),
    debrief: z.string().max(2000).optional(),
  })),
  outingParticipants: z.array(z.object({
    id: z.string().min(1).max(240),
    churchId: z.string().min(1),
    eventId: z.string().min(1),
    volunteerId: z.string().min(1),
    status: z.enum(["invited", "going", "not_going", "checked_in"]),
  })),
  territories: z.array(z.object({
    id: z.string().min(1),
    churchId: z.string().min(1),
    eventId: z.string().optional(),
    name: z.string().min(1).max(120),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    center: coordinatesSchema.optional(),
    kind: z.enum(["map", "list"]).optional(),
    zoom: z.number().min(1).max(22),
    boundary: z.array(coordinatesSchema),
    assignedTeamId: z.string().optional(),
  }).refine((area) => area.kind === "list" ? !area.center && area.boundary.length === 0 : Boolean(area.center) && area.boundary.length >= 3, "A mapped area needs a center and boundary; an address list has neither.")),
  teams: z.array(z.object({
    id: z.string().min(1),
    churchId: z.string().min(1),
    eventId: z.string().optional(),
    name: z.string().min(1).max(120),
    memberIds: z.array(z.string()),
    territoryIds: z.array(z.string()),
    status: z.enum(["ready", "active", "finished"]),
  })),
  properties: z.array(z.object({
    id: z.string().min(1),
    mergedIntoId: z.string().min(1).optional(),
    mergedAt: z.string().datetime().optional(),
    churchId: z.string().min(1),
    territoryId: z.string().optional(),
    address: z.string().min(1).max(240),
    unit: z.string().max(60).optional(),
    coordinates: coordinatesSchema.optional(),
    buildingGeometry: z.array(coordinatesSchema).optional(),
    parcel: z.object({
      id: z.number().int().positive().optional(),
      countyFips: z.string().regex(/^[0-9]{5}$/),
      gislink: z.string().min(1).max(120),
    }).optional(),
    currentOutcome: outcomeSchema,
    lastVisitedAt: z.string().datetime().optional(),
    visitCount: z.number().int().min(0),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    source: z.enum(["seed", "map", "import", "manual"]),
    createdByVolunteerId: z.string().optional(),
  })),
  visits: z.array(z.object({
    id: z.string().min(1),
    churchId: z.string().min(1),
    eventId: z.string().optional(),
    territoryId: z.string().optional(),
    targetId: z.string().optional(),
    targetParcel: z.object({ countyFips: z.string().regex(/^[0-9]{5}$/), gislink: z.string().min(1).max(120) }).optional(),
    propertyId: z.string().optional(),
    residentId: z.string().optional(),
    context: z.enum(["door", "community_meal", "service", "referral", "other"]).optional(),
    volunteerId: z.string().min(1),
    outcome: outcomeSchema.exclude(["unvisited"]),
    objectiveNote: z.string().max(2000).optional(),
    recordedAt: z.string().datetime(),
    deviceId: z.string().min(1),
    corrections: z.array(z.object({
      id: z.string().min(1), actorId: z.string().min(1), createdAt: z.string().datetime(), reason: z.string().min(3).max(500),
      outcome: outcomeSchema.exclude(["unvisited"]), context: z.enum(["door", "community_meal", "service", "referral", "other"]), voided: z.boolean(),
    })).max(100).optional(),
  })),
  followUps: z.array(z.object({
    id: z.string().min(1),
    churchId: z.string().min(1),
    propertyId: z.string().optional(),
    residentId: z.string().min(1).optional(),
    sourceVisitId: z.string().min(1).optional(),
    assignedTeamId: z.string().optional(),
    assignedVolunteerId: z.string().optional(),
    eventId: z.string().optional(),
    acceptance: z.enum(["pending", "accepted", "declined"]).optional(),
    channel: z.enum(["visit", "call", "text", "email", "other"]).optional(),
    dueAt: z.union([z.string().date(), z.string().datetime()]),
    status: z.enum(["scheduled", "completed", "cancelled"]),
    note: z.string().max(2000).optional(),
    completionNote: z.string().max(2000).optional(),
    parentFollowUpId: z.string().optional(),
    history: z.array(followUpActivitySchema),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
  })),
  residents: z.array(residentSchema),
  assignments: z.array(z.object({
    id: z.string(), churchId: z.string(), eventId: z.string(), territoryId: z.string(),
    targetId: z.string().optional(),
    assignedTeamId: z.string().optional(), assignedVolunteerId: z.string().optional(),
    status: z.enum(["assigned", "accepted", "completed", "declined", "cancelled"]),
  })).optional(),
  walkTargets: z.array(walkTargetSchema),
  targetProgress: z.array(z.object({ targetId: z.string().min(1), countyFips: z.string().regex(/^[0-9]{5}$/), gislink: z.string().min(1).max(120) })),
  parentProgress: z.array(z.object({ territoryId: z.string().min(1), eventId: z.string().min(1).optional(), countyFips: z.string().regex(/^[0-9]{5}$/), gislink: z.string().min(1).max(120) })),
  coverageVisibility: z.enum(["complete", "assigned_targets_only"]),
  restrictions: z.array(z.object({
    id: z.string(), churchId: z.string(), residentId: z.string().optional(), propertyId: z.string().optional(),
    originResidentId: z.string().optional(), originPropertyId: z.string().optional(),
    channel: z.enum(["all", "visit", "call", "text", "email"]), active: z.boolean(), reason: z.string(),
    createdAt: z.string().datetime(), correctionReason: z.string().optional(), correctedAt: z.string().datetime().optional(),
  })).optional(),
  migrationIssues: z.array(z.object({ entityType: z.string(), entityId: z.string(), issue: z.string() })).optional(),
  personNotes: z.array(z.object({
    id: z.string().min(1),
    churchId: z.string().min(1),
    residentId: z.string().min(1),
    authorId: z.string().min(1),
    kind: z.enum(["conversation", "prayer", "milestone", "general"]),
    body: z.string().min(1).max(2000),
    createdAt: z.string().datetime(),
  })),
  guide: z.array(z.object({
    id: z.string().min(1),
    order: z.number().int().min(1),
    eyebrow: z.string().min(1).max(80),
    title: z.string().min(1).max(120),
    coaching: z.string().min(1).max(800),
    sampleWords: z.string().min(1).max(1600),
    reminder: z.string().min(1).max(800),
    scriptureReferences: z.array(z.string().max(100)).max(12),
  })),
  audit: z.array(z.object({
    id: z.string().min(1),
    action: z.string().min(1),
    entityType: z.enum(["event", "participant", "assignment", "restriction", "handoff", "property", "visit", "follow_up", "person_follow_up", "resident", "person_note", "team", "territory", "target", "settings", "guide", "data"]),
    entityId: z.string().min(1),
    actorId: z.string().min(1),
    createdAt: z.string().datetime(),
    summary: z.string().min(1).max(500),
    details: z.object({ beforeRole: z.string().optional(), beforeActive: z.boolean().optional(), role: z.string().optional(), active: z.boolean().optional(), reason: z.string().max(500).optional() }).optional(),
  })),
  preferences: z.object({
    activeEventId: z.string(),
    activeTerritoryId: z.string(),
    activeVolunteerId: z.string().min(1),
    mapStyleUrl: z.string().url().refine(isSafeWebUrl, "Map style must use https (or localhost during development)"),
    mapStyleRevision: z.number().int().nonnegative(),
    compactMapMarkers: z.boolean(),
    notificationsEnabled: z.boolean(),
    lastView: z.string(),
  }),
  sync: z.object({
    mode: z.enum(["device_only", "connected"]),
    lastSyncedAt: z.string().datetime().optional(),
    pending: z.array(z.object({
      id: z.string().min(1),
      entityType: z.enum(["event", "participant", "assignment", "restriction", "handoff", "property", "visit", "follow_up", "person_follow_up", "resident", "person_note", "team", "territory", "target", "settings", "guide", "data"]),
      entityId: z.string().min(1),
      operation: z.enum(["upsert", "delete"]),
      changedAt: z.string().datetime(),
      destinationTerritoryId: z.string().min(1).optional(),
    })),
    lastError: z.string().optional(),
    commands: z.array(queuedCommandSchema).optional(),
    recordVersions: z.record(z.string(), z.number().int().nonnegative()).optional(),
    serverRevision: z.number().int().nonnegative().optional(),
    warnings: z.array(z.string()).optional(),
    legacyRecoveryRequired: z.boolean().optional(),
  }),
  updatedAt: z.string().datetime(),
});

export function createId(prefix: string): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replaceAll("-", "").slice(0, 14)
    : Math.random().toString(36).slice(2, 16);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

export function dateInputValue(iso?: string): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(iso).toISOString().slice(0, 10);
}

export function dueDateFromNow(days: number, timezone = DEFAULT_CHURCH_TIMEZONE): string {
  return calendarDaysFromNow(days, timezone);
}

export function formatDateTime(iso: string, options?: Intl.DateTimeFormatOptions): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatCalendarDate(iso, options ? { month: options.month, day: options.day, year: options.year } : undefined);
  return new Intl.DateTimeFormat("en-US", options ?? {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function isFollowUpOverdue(followUp: FollowUp, now = new Date(), timezone = DEFAULT_CHURCH_TIMEZONE): boolean {
  return followUp.status === "scheduled" && calendarDate(followUp.dueAt, timezone) < calendarDate(now, timezone);
}

export function visitsForProperty(data: NeighborWalkData, propertyId: string): Visit[] {
  const family = recordFamilyIds(data.properties, propertyId);
  return data.visits
    .filter((visit) => Boolean(visit.propertyId && family.has(visit.propertyId)))
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

export function centerForBoundary(boundary: Coordinates[]): Coordinates {
  if (!boundary.length) return [0, 0];
  return [
    boundary.reduce((sum, point) => sum + point[0], 0) / boundary.length,
    boundary.reduce((sum, point) => sum + point[1], 0) / boundary.length,
  ];
}

export function updateTerritoryRecord(
  data: NeighborWalkData,
  territoryId: string,
  update: TerritoryUpdate,
): NeighborWalkData {
  const territory = data.territories.find((item) => item.id === territoryId);
  if (!territory) return data;

  const assignedTeamId = update.assignedTeamId || undefined;
  return {
    ...data,
    territories: data.territories.map((item) => item.id === territoryId
      ? {
        ...item,
        name: update.name.trim(),
        color: update.color,
        kind: update.boundary ? "map" as const : update.kind ?? item.kind,
        assignedTeamId,
        boundary: update.boundary ?? item.boundary,
        center: update.center ?? item.center,
      }
      : item),
    teams: data.teams.map((team) => {
      const withoutTerritory = team.territoryIds.filter((id) => id !== territoryId);
      return team.id === assignedTeamId
        ? { ...team, territoryIds: [...withoutTerritory, territoryId] }
        : { ...team, territoryIds: withoutTerritory };
    }),
  };
}

export function deleteTerritoryRecord(
  data: NeighborWalkData,
  territoryId: string,
  destinationTerritoryId: string,
): NeighborWalkData {
  const territory = data.territories.find((item) => item.id === territoryId);
  const destination = data.territories.find((item) => item.id === destinationTerritoryId);
  if (
    !territory
    || !destination
    || territory.id === destination.id
    || (data.sync.mode !== "connected" && territory.eventId !== destination.eventId)
    || data.territories.length <= 1
  ) return data;

  return {
    ...data,
    territories: data.territories.filter((item) => item.id !== territoryId),
    teams: data.teams.map((team) => ({
      ...team,
      territoryIds: team.territoryIds.filter((id) => id !== territoryId),
    })),
    properties: data.properties.map((property) => property.territoryId === territoryId
      ? { ...property, territoryId: destination.id }
      : property),
    visits: data.sync.mode === "connected" ? data.visits : data.visits.map((visit) => visit.territoryId === territoryId
      ? { ...visit, territoryId: destination.id }
      : visit),
    preferences: {
      ...data.preferences,
      activeTerritoryId: data.preferences.activeTerritoryId === territoryId
        ? destination.id
        : data.preferences.activeTerritoryId,
    },
  };
}

export function deleteTeamRecord(data: NeighborWalkData, teamId: string): NeighborWalkData {
  if (!data.teams.some((team) => team.id === teamId)) return data;
  return {
    ...data,
    teams: data.teams.filter((team) => team.id !== teamId),
    territories: data.territories.map((territory) => territory.assignedTeamId === teamId
      ? { ...territory, assignedTeamId: undefined }
      : territory),
    followUps: data.followUps.map((followUp) => followUp.assignedTeamId === teamId
      ? { ...followUp, assignedTeamId: undefined }
      : followUp),
  };
}

export function enforceRetention(data: NeighborWalkData, now = new Date()): NeighborWalkData {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - data.church.retentionDays);
  const scheduledSourceVisitIds = new Set(
    data.followUps.filter((followUp) => followUp.status === "scheduled").flatMap((followUp) => followUp.sourceVisitId ? [followUp.sourceVisitId] : []),
  );
  const keepVisits = data.visits.filter((visit) => {
    if (visit.outcome === "do_not_visit") return true;
    return scheduledSourceVisitIds.has(visit.id) || new Date(visit.recordedAt) >= cutoff;
  });
  const keepVisitIds = new Set(keepVisits.map((visit) => visit.id));
  const keepFollowUps = data.followUps.filter(
    (followUp) => followUp.status === "scheduled"
      || Boolean(followUp.sourceVisitId && keepVisitIds.has(followUp.sourceVisitId))
      || new Date(followUp.history[followUp.history.length - 1]?.createdAt ?? followUp.createdAt) >= cutoff,
  );
  const keepAudit = data.audit.filter((entry) => new Date(entry.createdAt) >= cutoff);
  const activeFollowUpResidentIds = new Set(
    keepFollowUps.flatMap((followUp) => followUp.residentId ? [followUp.residentId] : []),
  );
  const keepResidents = data.residents.filter(
    (resident) => resident.status !== "archived"
      || activeFollowUpResidentIds.has(resident.id)
      || new Date(resident.updatedAt) >= cutoff,
  );
  const keptResidentIds = new Set(keepResidents.map((resident) => resident.id));
  const keepPersonNotes = data.personNotes.filter((note) => keptResidentIds.has(note.residentId));
  const finalFollowUps = keepFollowUps.filter((followUp) => !followUp.residentId || keptResidentIds.has(followUp.residentId));
  const properties = summarizePropertyVisits(data.properties, keepVisits);
  return {
    ...data,
    properties,
    visits: keepVisits,
    followUps: finalFollowUps,
    residents: keepResidents,
    personNotes: keepPersonNotes,
    audit: keepAudit,
  };
}

/** Rebuild location outcomes without scanning and sorting every visit per property. */
export function summarizePropertyVisits(properties: Property[], visits: Visit[]): Property[] {
  const summaries = new Map<string, { latest: Visit; count: number }>();
  // Until restriction corrections have their own authorized command, ordinary
  // visits and retention must never lift a recorded do-not-visit request.
  const restrictedIds = new Set(properties.filter((property) => property.currentOutcome === "do_not_visit").map((property) => property.id));
  for (const visit of visits) {
    if (!visit.propertyId) continue;
    if (visit.outcome === "do_not_visit") restrictedIds.add(visit.propertyId);
    const summary = summaries.get(visit.propertyId);
    if (!summary) summaries.set(visit.propertyId, { latest: visit, count: 1 });
    else {
      summary.count += 1;
      if (visit.recordedAt > summary.latest.recordedAt) summary.latest = visit;
    }
  }
  return properties.map((property) => {
    const summary = summaries.get(property.id);
    return {
      ...property,
      currentOutcome: restrictedIds.has(property.id) ? "do_not_visit" : summary?.latest.outcome ?? "unvisited",
      lastVisitedAt: summary?.latest.recordedAt,
      visitCount: summary?.count ?? 0,
    };
  });
}
