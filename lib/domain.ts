import { z } from "zod";

export const APP_SCHEMA_VERSION = 4;

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
    description: "The resident gave permission for a return visit.",
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
  requireFollowUpConsent: boolean;
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

export type Team = {
  id: string;
  churchId: string;
  eventId: string;
  name: string;
  memberIds: string[];
  territoryIds: string[];
  status: "ready" | "active" | "finished";
};

export type Property = {
  id: string;
  churchId: string;
  territoryId: string;
  address: string;
  unit?: string;
  coordinates: Coordinates;
  buildingGeometry?: Coordinates[];
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
  followUpConsent: boolean;
  recordedAt: string;
  deviceId: string;
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
  createdAt: string;
  completedAt?: string;
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
  entityType: "property" | "visit" | "follow_up" | "territory" | "settings" | "guide" | "data";
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

export function isSafeWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  } catch {
    return false;
  }
}

export const neighborWalkDataSchema: z.ZodType<NeighborWalkData> = z.object({
  schemaVersion: z.literal(APP_SCHEMA_VERSION),
  church: z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(120),
    timezone: z.string().min(1),
    retentionDays: z.number().int().min(30).max(3650),
    defaultFollowUpDays: z.number().int().min(1).max(90),
    requireFollowUpConsent: z.boolean(),
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
    followUpConsent: z.boolean(),
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
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
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
    entityType: z.enum(["property", "visit", "follow_up", "territory", "settings", "guide", "data"]),
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
      entityType: z.enum(["property", "visit", "follow_up", "territory", "settings", "guide", "data"]),
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

export function coverageForTerritory(data: NeighborWalkData, territoryId: string) {
  const properties = data.properties.filter((property) => property.territoryId === territoryId);
  const visited = properties.filter((property) => property.currentOutcome !== "unvisited").length;
  return {
    total: properties.length,
    visited,
    remaining: properties.length - visited,
    percent: properties.length ? Math.round((visited / properties.length) * 100) : 0,
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
  return { ...data, properties, visits: keepVisits, followUps: keepFollowUps, audit: keepAudit };
}
