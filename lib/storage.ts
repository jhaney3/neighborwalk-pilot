import { openDB, type IDBPDatabase } from "idb";
import {
  APP_SCHEMA_VERSION,
  enforceRetention,
  neighborWalkDataSchema,
  type NeighborWalkData,
} from "./domain";
import { createSeedData } from "./seed";
import {
  isOpenFreeMapStyle,
  MAP_STYLE_CONFIGURATION_REVISION,
  MAPTILER_STREETS_URL,
} from "./map-config";

const DB_NAME = "neighborwalk";
const DB_VERSION = 1;
const STORE = "app_state";
const DATA_KEY = "primary";

let databasePromise: Promise<IDBPDatabase> | null = null;

function withoutLegacyFields(candidate: unknown, keys: string[]): unknown {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
  const next = { ...candidate as Record<string, unknown> };
  for (const key of keys) delete next[key];
  return next;
}

function getDatabase() {
  if (typeof window === "undefined") throw new Error("NeighborWalk storage is available in the browser only.");
  databasePromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    },
  });
  return databasePromise;
}

export function migrateNeighborWalkData(candidate: unknown): unknown {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
  const data = candidate as Record<string, unknown>;
  const version = typeof data.schemaVersion === "number" ? data.schemaVersion : 1;
  const defaults = createSeedData();
  const storedPreferences = data.preferences && typeof data.preferences === "object"
    ? data.preferences as Record<string, unknown>
    : {};
  const storedMapStyleUrl = typeof storedPreferences.mapStyleUrl === "string"
    ? storedPreferences.mapStyleUrl
    : defaults.preferences.mapStyleUrl;
  const storedMapStyleRevision = typeof storedPreferences.mapStyleRevision === "number"
    ? storedPreferences.mapStyleRevision
    : 0;
  const shouldAdoptMapTiler = Boolean(
    MAPTILER_STREETS_URL
    && storedMapStyleRevision < MAP_STYLE_CONFIGURATION_REVISION
    && isOpenFreeMapStyle(storedMapStyleUrl),
  );
  const requiresSchemaMigration = version < APP_SCHEMA_VERSION;
  if (!requiresSchemaMigration && !shouldAdoptMapTiler) return candidate;
  const fallbackVolunteerId = typeof storedPreferences.activeVolunteerId === "string"
    ? storedPreferences.activeVolunteerId
    : Array.isArray(data.volunteers) && data.volunteers[0] && typeof data.volunteers[0] === "object"
      ? String((data.volunteers[0] as Record<string, unknown>).id ?? defaults.preferences.activeVolunteerId)
      : defaults.preferences.activeVolunteerId;
  const storedResidents = Array.isArray(data.residents) ? data.residents : [];
  const migratedResidents = storedResidents.map((candidateResident) => {
    if (!candidateResident || typeof candidateResident !== "object" || Array.isArray(candidateResident)) return candidateResident;
    const resident = withoutLegacyFields(
      candidateResident,
      ["consentToStore", "consentToContact", "consentRecordedAt", "notes", "nextStep", "nextStepDueAt"],
    ) as Record<string, unknown>;
    return version < 9 ? {
      ...resident,
      discipleshipStage: resident.discipleshipStage ?? "new_connection",
      assignedVolunteerId: resident.assignedVolunteerId ?? fallbackVolunteerId,
      createdByVolunteerId: resident.createdByVolunteerId ?? fallbackVolunteerId,
      sharedWithVolunteerIds: Array.isArray(resident.sharedWithVolunteerIds) ? resident.sharedWithVolunteerIds : [],
      sharedWithTeamIds: Array.isArray(resident.sharedWithTeamIds) ? resident.sharedWithTeamIds : [],
      status: resident.status ?? "active",
    } : resident;
  });
  const storedPersonNotes = Array.isArray(data.personNotes) ? data.personNotes : [];
  const storedFollowUps = Array.isArray(data.followUps) ? data.followUps : [];
  const defaultFollowUpDays = data.church && typeof data.church === "object" && !Array.isArray(data.church)
    && typeof (data.church as Record<string, unknown>).defaultFollowUpDays === "number"
    ? Number((data.church as Record<string, unknown>).defaultFollowUpDays)
    : defaults.church.defaultFollowUpDays;
  const migrationTime = new Date();
  const migratedNextStepFollowUps = version < 10 ? storedResidents.flatMap((candidateResident) => {
    if (!candidateResident || typeof candidateResident !== "object" || Array.isArray(candidateResident)) return [];
    const resident = candidateResident as Record<string, unknown>;
    const note = typeof resident.nextStep === "string" ? resident.nextStep.trim() : "";
    const residentId = typeof resident.id === "string" ? resident.id : "";
    const propertyId = typeof resident.propertyId === "string" ? resident.propertyId : "";
    if (!note || !residentId || !propertyId) return [];
    const id = `followup_next_step_${residentId}`;
    if (storedFollowUps.some((candidateFollowUp) => candidateFollowUp && typeof candidateFollowUp === "object" && !Array.isArray(candidateFollowUp)
      && ((candidateFollowUp as Record<string, unknown>).id === id
        || ((candidateFollowUp as Record<string, unknown>).residentId === residentId
          && (candidateFollowUp as Record<string, unknown>).status === "scheduled")))) return [];
    const storedDueAt = typeof resident.nextStepDueAt === "string" && !Number.isNaN(new Date(resident.nextStepDueAt).getTime())
      ? new Date(resident.nextStepDueAt).toISOString()
      : new Date(migrationTime.getTime() + defaultFollowUpDays * 86_400_000).toISOString();
    const createdAt = typeof resident.updatedAt === "string" && !Number.isNaN(new Date(resident.updatedAt).getTime())
      ? new Date(resident.updatedAt).toISOString()
      : migrationTime.toISOString();
    const actorId = typeof resident.assignedVolunteerId === "string"
      ? resident.assignedVolunteerId
      : typeof resident.createdByVolunteerId === "string" ? resident.createdByVolunteerId : fallbackVolunteerId;
    return [{
      id,
      churchId: typeof resident.churchId === "string" ? resident.churchId : defaults.church.id,
      propertyId,
      residentId,
      dueAt: storedDueAt,
      status: "scheduled",
      note,
      history: [{
        id: `activity_migrated_${residentId}`,
        action: "created",
        note,
        dueAt: storedDueAt,
        actorId,
        createdAt,
      }],
      createdAt,
    }];
  }) : [];
  const migratedLegacyNotes = version < 9 ? storedResidents.flatMap((candidateResident) => {
    if (!candidateResident || typeof candidateResident !== "object" || Array.isArray(candidateResident)) return [];
    const resident = candidateResident as Record<string, unknown>;
    const body = typeof resident.notes === "string" ? resident.notes.trim() : "";
    const residentId = typeof resident.id === "string" ? resident.id : "";
    if (!body || !residentId) return [];
    if (storedPersonNotes.some((candidateNote) => candidateNote && typeof candidateNote === "object" && !Array.isArray(candidateNote) && (candidateNote as Record<string, unknown>).id === `person_note_legacy_${residentId}`)) return [];
    return [{
      id: `person_note_legacy_${residentId}`,
      churchId: typeof resident.churchId === "string" ? resident.churchId : defaults.church.id,
      residentId,
      authorId: typeof resident.assignedVolunteerId === "string" ? resident.assignedVolunteerId : fallbackVolunteerId,
      kind: "general",
      body,
      createdAt: typeof resident.createdAt === "string"
        ? resident.createdAt
        : typeof resident.updatedAt === "string" ? resident.updatedAt : new Date().toISOString(),
    }];
  }) : [];
  return {
    ...data,
    schemaVersion: APP_SCHEMA_VERSION,
    church: withoutLegacyFields(data.church, ["requireFollowUpConsent"]),
    residents: migratedResidents,
    personNotes: [...storedPersonNotes, ...migratedLegacyNotes],
    visits: Array.isArray(data.visits)
      ? data.visits.map((visit) => withoutLegacyFields(visit, ["followUpConsent"]))
      : [],
    followUps: [...storedFollowUps, ...migratedNextStepFollowUps]
      .map((followUp) => followUp && typeof followUp === "object"
        ? { ...followUp as Record<string, unknown>, history: Array.isArray((followUp as Record<string, unknown>).history) ? (followUp as Record<string, unknown>).history : [] }
        : followUp),
    preferences: {
      ...defaults.preferences,
      ...storedPreferences,
      mapStyleUrl: shouldAdoptMapTiler ? MAPTILER_STREETS_URL ?? storedMapStyleUrl : storedMapStyleUrl,
      mapStyleRevision: shouldAdoptMapTiler
        ? MAP_STYLE_CONFIGURATION_REVISION
        : storedMapStyleRevision,
    },
    sync: data.sync && typeof data.sync === "object" && !Array.isArray(data.sync) ? {
      ...data.sync as Record<string, unknown>,
      pending: Array.isArray((data.sync as Record<string, unknown>).pending)
        ? (data.sync as Record<string, unknown>).pending as unknown[]
        : [],
    } : { mode: "device_only", pending: [] },
    updatedAt: new Date().toISOString(),
  };
}

export async function loadNeighborWalkData(): Promise<NeighborWalkData> {
  const database = await getDatabase();
  const stored = await database.get(STORE, DATA_KEY);
  if (!stored) {
    const seeded = createSeedData();
    await database.put(STORE, seeded, DATA_KEY);
    return seeded;
  }
  const migratedCandidate = migrateNeighborWalkData(stored);
  const parsed = neighborWalkDataSchema.safeParse(migratedCandidate);
  if (!parsed.success) {
    const backupKey = `invalid_${Date.now()}`;
    await database.put(STORE, stored, backupKey);
    const seeded = createSeedData();
    await database.put(STORE, seeded, DATA_KEY);
    return seeded;
  }
  const retained = enforceRetention(parsed.data);
  await database.put(STORE, retained, DATA_KEY);
  return retained;
}

export async function saveNeighborWalkData(data: NeighborWalkData): Promise<void> {
  const parsed = neighborWalkDataSchema.parse(data);
  const database = await getDatabase();
  await database.put(STORE, parsed, DATA_KEY);
}

export async function replaceNeighborWalkData(candidate: unknown): Promise<NeighborWalkData> {
  const parsed = neighborWalkDataSchema.parse(migrateNeighborWalkData(candidate));
  const retained = enforceRetention(parsed);
  await saveNeighborWalkData(retained);
  return retained;
}

export async function resetNeighborWalkData(): Promise<NeighborWalkData> {
  const database = await getDatabase();
  const seeded = createSeedData();
  await database.put(STORE, seeded, DATA_KEY);
  return seeded;
}

export function exportNeighborWalkData(data: NeighborWalkData): Blob {
  const exportPayload = {
    exportedAt: new Date().toISOString(),
    format: "neighborwalk-backup",
    formatVersion: 1,
    data,
  };
  return new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
}

export async function importNeighborWalkFile(file: File): Promise<NeighborWalkData> {
  if (file.size > 10 * 1024 * 1024) throw new Error("Backup files must be smaller than 10 MB.");
  const text = await file.text();
  const raw = JSON.parse(text) as { data?: unknown; format?: string };
  const candidate = raw?.format === "neighborwalk-backup" ? raw.data : raw;
  return replaceNeighborWalkData(candidate);
}
