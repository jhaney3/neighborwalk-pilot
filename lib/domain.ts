import { z } from "zod";

export const APP_SCHEMA_VERSION = 7;

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
export type Role = "leader" | "volunteer";
export type Coordinates = [longitude: number, latitude: number];

export const outcomeMeta: Record<
  Outcome,
  { label: string; short: string; color: string; description: string }
> = {
  unvisited: {
    label: "Not visited",
    short: "Open",
    color: "#ffffff",
    description: "This location has not been visited during the selected event.",
  },
  no_answer: {
    label: "No answer",
    short: "No answer",
    color: "#6b91ad",
    description: "The team attempted a visit but no one answered.",
  },
  conversation: {
    label: "Conversation",
    short: "Talked",
    color: "#4d977e",
    description: "A conversation took place. No return visit was requested.",
  },
  follow_up: {
    label: "Follow-up requested",
    short: "Follow-up",
    color: "#e9a84a",
    description: "A return visit was requested.",
  },
  declined: {
    label: "Politely declined",
    short: "Declined",
    color: "#d2aaa6",
    description: "The resident declined the conversation.",
  },
  do_not_visit: {
    label: "Do not revisit",
    short: "Do not visit",
    color: "#666f6b",
    description: "Future canvassers should skip this location.",
  },
  inaccessible: {
    label: "Inaccessible",
    short: "Inaccessible",
    color: "#9b8c7d",
    description: "The location could not be safely or lawfully approached.",
  },
};

export type Church = {
  id: string;
  name: string;
  timezone: string;
  retentionDays: number;
  defaultFollowUpDays: number;
  noteCharacterLimit: number;
};

export type Volunteer = {
  id: string;
  churchId: string;
  name: string;
  email?: string;
  role: Role;
  active: boolean;
};

export type OutreachEvent = {
  id: string;
  churchId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "active" | "completed";
};

export type Territory = {
  id: string;
  churchId: string;
  eventId: string;
  name: string;
  color: string;
  center: Coordinates;
  zoom: number;
  boundary: Coordinates[];
  assignedTeamId?: string;
};

export type TerritoryUpdate = {
  name: string;
  color: string;
  assignedTeamId?: string;
  boundary?: Coordinates[];
  center?: Coordinates;
};

export type Team = {
  id: string;
  churchId: string;
  eventId: string;
  name: string;
  memberIds: string[];
  territoryIds: string[];
  status: "ready" | "active" | "finished";
};

export type TeamUpdate = Pick<Team, "name" | "memberIds" | "status">;

export type ParcelReference = {
  id?: number;
  countyFips: string;
  gislink: string;
};

export type Property = {
  id: string;
  churchId: string;
  territoryId: string;
  address: string;
  unit?: string;
  coordinates: Coordinates;
  buildingGeometry?: Coordinates[];
  parcel?: ParcelReference;
  currentOutcome: Outcome;
  lastVisitedAt?: string;
  visitCount: number;
  createdAt: string;
  updatedAt: string;
  source: "seed" | "map" | "import";
};

export type Visit = {
  id: string;
  churchId: string;
  eventId: string;
  territoryId: string;
  propertyId: string;
  volunteerId: string;
  outcome: Exclude<Outcome, "unvisited">;
  objectiveNote?: string;
  recordedAt: string;
  deviceId: string;
};

export const faithStatusValues = [
  "not_discussed",
  "christian",
  "exploring",
  "another_faith",
  "no_faith",
  "prefer_not_to_say",
] as const;

export type FaithStatus = (typeof faithStatusValues)[number];
export type ContactPreference = "none" | "text" | "call" | "email";

export const faithStatusLabels: Record<FaithStatus, string> = {
  not_discussed: "Not discussed",
  christian: "Christian",
  exploring: "Exploring or curious",
  another_faith: "Another faith",
  no_faith: "No faith",
  prefer_not_to_say: "Prefers not to say",
};

export type Resident = {
  id: string;
  churchId: string;
  propertyId: string;
  name?: string;
  faithStatus: FaithStatus;
  phone?: string;
  email?: string;
  preferredContact: ContactPreference;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type ResidentInput = Omit<Resident, "id" | "churchId" | "propertyId" | "createdAt" | "updatedAt">;

export type FollowUpActivity = {
  id: string;
  action: "created" | "rescheduled" | "note" | "completed" | "cancelled";
  note?: string;
  dueAt?: string;
  actorId: string;
  createdAt: string;
};

export type FollowUp = {
  id: string;
  churchId: string;
  propertyId: string;
  sourceVisitId: string;
  assignedTeamId?: string;
  dueAt: string;
  status: "scheduled" | "completed" | "cancelled";
  note?: string;
  completionNote?: string;
  parentFollowUpId?: string;
  history: FollowUpActivity[];
  createdAt: string;
  completedAt?: string;
};

export type FollowUpCompletionInput = {
  completionNote?: string;
  nextFollowUp?: {
    dueAt: string;
    note?: string;
    assignedTeamId?: string;
  };
};

export type GuideStep = {
  id: string;
  order: number;
  eyebrow: string;
  title: string;
  coaching: string;
  sampleWords: string;
  reminder: string;
  scriptureReferences: string[];
};

export type AuditEntry = {
  id: string;
  action: string;
  entityType: "property" | "visit" | "follow_up" | "resident" | "team" | "territory" | "settings" | "guide" | "data";
  entityId: string;
  actorId: string;
  createdAt: string;
  summary: string;
};

export type PendingMutation = {
  id: string;
  entityType: AuditEntry["entityType"];
  entityId: string;
  operation: "upsert" | "delete";
  changedAt: string;
};

export type AppPreferences = {
  activeEventId: string;
  activeTerritoryId: string;
  activeVolunteerId: string;
  mapStyleUrl: string;
  mapStyleRevision: number;
  compactMapMarkers: boolean;
  notificationsEnabled: boolean;
  lastView: string;
};

export type SyncState = {
  mode: "device_only" | "connected";
  lastSyncedAt?: string;
  pending: PendingMutation[];
  lastError?: string;
};

export type NeighborWalkData = {
  schemaVersion: number;
  church: Church;
  volunteers: Volunteer[];
  events: OutreachEvent[];
  territories: Territory[];
  teams: Team[];
  properties: Property[];
  visits: Visit[];
  followUps: FollowUp[];
  residents: Resident[];
  guide: GuideStep[];
  audit: AuditEntry[];
  preferences: AppPreferences;
  sync: SyncState;
  updatedAt: string;
};

const coordinatesSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

const outcomeSchema = z.enum(outcomeValues);
const followUpActivitySchema = z.object({
  id: z.string().min(1),
  action: z.enum(["created", "rescheduled", "note", "completed", "cancelled"]),
  note: z.string().max(2000).optional(),
  dueAt: z.string().datetime().optional(),
  actorId: z.string().min(1),
  createdAt: z.string().datetime(),
});

const residentSchema = z.object({
  id: z.string().min(1),
  churchId: z.string().min(1),
  propertyId: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  faithStatus: z.enum(faithStatusValues),
  phone: z.string().min(3).max(40).optional(),
  email: z.string().email().max(254).optional(),
  preferredContact: z.enum(["none", "text", "call", "email"]),
  notes: z.string().max(2000).optional(),
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

export const neighborWalkDataSchema: z.ZodType<NeighborWalkData> = z.object({
  schemaVersion: z.literal(APP_SCHEMA_VERSION),
  church: z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(120),
    timezone: z.string().min(1),
    retentionDays: z.number().int().min(30).max(3650),
    defaultFollowUpDays: z.number().int().min(1).max(90),
    noteCharacterLimit: z.number().int().min(80).max(2000),
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
    status: z.enum(["scheduled", "active", "completed"]),
  })),
  territories: z.array(z.object({
    id: z.string().min(1),
    churchId: z.string().min(1),
    eventId: z.string().min(1),
    name: z.string().min(1).max(120),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    center: coordinatesSchema,
    zoom: z.number().min(1).max(22),
    boundary: z.array(coordinatesSchema).min(3),
    assignedTeamId: z.string().optional(),
  })),
  teams: z.array(z.object({
    id: z.string().min(1),
    churchId: z.string().min(1),
    eventId: z.string().min(1),
    name: z.string().min(1).max(120),
    memberIds: z.array(z.string()),
    territoryIds: z.array(z.string()),
    status: z.enum(["ready", "active", "finished"]),
  })),
  properties: z.array(z.object({
    id: z.string().min(1),
    churchId: z.string().min(1),
    territoryId: z.string().min(1),
    address: z.string().min(1).max(240),
    unit: z.string().max(60).optional(),
    coordinates: coordinatesSchema,
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
    source: z.enum(["seed", "map", "import"]),
  })),
  visits: z.array(z.object({
    id: z.string().min(1),
    churchId: z.string().min(1),
    eventId: z.string().min(1),
    territoryId: z.string().min(1),
    propertyId: z.string().min(1),
    volunteerId: z.string().min(1),
    outcome: outcomeSchema.exclude(["unvisited"]),
    objectiveNote: z.string().max(2000).optional(),
    recordedAt: z.string().datetime(),
    deviceId: z.string().min(1),
  })),
  followUps: z.array(z.object({
    id: z.string().min(1),
    churchId: z.string().min(1),
    propertyId: z.string().min(1),
    sourceVisitId: z.string().min(1),
    assignedTeamId: z.string().optional(),
    dueAt: z.string().datetime(),
    status: z.enum(["scheduled", "completed", "cancelled"]),
    note: z.string().max(2000).optional(),
    completionNote: z.string().max(2000).optional(),
    parentFollowUpId: z.string().optional(),
    history: z.array(followUpActivitySchema),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
  })),
  residents: z.array(residentSchema),
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
    entityType: z.enum(["property", "visit", "follow_up", "resident", "team", "territory", "settings", "guide", "data"]),
    entityId: z.string().min(1),
    actorId: z.string().min(1),
    createdAt: z.string().datetime(),
    summary: z.string().min(1).max(500),
  })),
  preferences: z.object({
    activeEventId: z.string().min(1),
    activeTerritoryId: z.string().min(1),
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
      entityType: z.enum(["property", "visit", "follow_up", "resident", "team", "territory", "settings", "guide", "data"]),
      entityId: z.string().min(1),
      operation: z.enum(["upsert", "delete"]),
      changedAt: z.string().datetime(),
    })),
    lastError: z.string().optional(),
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
  return new Date(iso).toISOString().slice(0, 10);
}

export function dueDateFromNow(days: number): string {
  const date = new Date();
  date.setHours(17, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function formatDateTime(iso: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", options ?? {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function isFollowUpOverdue(followUp: FollowUp, now = new Date()): boolean {
  return followUp.status === "scheduled" && new Date(followUp.dueAt).getTime() < now.getTime();
}

export function visitsForProperty(data: NeighborWalkData, propertyId: string): Visit[] {
  return data.visits
    .filter((visit) => visit.propertyId === propertyId)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

export function residentsForProperty(data: NeighborWalkData, propertyId: string): Resident[] {
  return data.residents
    .filter((resident) => resident.propertyId === propertyId)
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
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
    || territory.eventId !== destination.eventId
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
    visits: data.visits.map((visit) => visit.territoryId === territoryId
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
    data.followUps.filter((followUp) => followUp.status === "scheduled").map((followUp) => followUp.sourceVisitId),
  );
  const keepVisits = data.visits.filter((visit) => {
    if (visit.outcome === "do_not_visit") return true;
    return scheduledSourceVisitIds.has(visit.id) || new Date(visit.recordedAt) >= cutoff;
  });
  const keepVisitIds = new Set(keepVisits.map((visit) => visit.id));
  const keepFollowUps = data.followUps.filter(
    (followUp) => followUp.status === "scheduled" || keepVisitIds.has(followUp.sourceVisitId),
  );
  const keepAudit = data.audit.filter((entry) => new Date(entry.createdAt) >= cutoff);
  const activeFollowUpPropertyIds = new Set(
    keepFollowUps.filter((followUp) => followUp.status === "scheduled").map((followUp) => followUp.propertyId),
  );
  const keepResidents = data.residents.filter(
    (resident) => activeFollowUpPropertyIds.has(resident.propertyId) || new Date(resident.updatedAt) >= cutoff,
  );
  const properties = data.properties.map((property) => {
    const retainedVisits = keepVisits
      .filter((visit) => visit.propertyId === property.id)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    const latest = retainedVisits[0];
    if (!latest) return { ...property, currentOutcome: "unvisited" as const, lastVisitedAt: undefined, visitCount: 0 };
    return {
      ...property,
      currentOutcome: latest.outcome,
      lastVisitedAt: latest.recordedAt,
      visitCount: retainedVisits.length,
    };
  });
  return { ...data, properties, visits: keepVisits, followUps: keepFollowUps, residents: keepResidents, audit: keepAudit };
}
