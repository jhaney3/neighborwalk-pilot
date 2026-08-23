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
  return {
    ...data,
    schemaVersion: APP_SCHEMA_VERSION,
    church: withoutLegacyFields(data.church, ["requireFollowUpConsent"]),
    residents: Array.isArray(data.residents)
      ? data.residents.map((resident) => withoutLegacyFields(resident, ["consentToStore", "consentToContact", "consentRecordedAt"]))
      : [],
    visits: Array.isArray(data.visits)
      ? data.visits.map((visit) => withoutLegacyFields(visit, ["followUpConsent"]))
      : [],
    followUps: Array.isArray(data.followUps)
      ? data.followUps.map((followUp) => followUp && typeof followUp === "object"
        ? { ...followUp as Record<string, unknown>, history: Array.isArray((followUp as Record<string, unknown>).history) ? (followUp as Record<string, unknown>).history : [] }
        : followUp)
      : [],
    preferences: {
      ...defaults.preferences,
      ...storedPreferences,
      mapStyleUrl: shouldAdoptMapTiler ? MAPTILER_STREETS_URL ?? storedMapStyleUrl : storedMapStyleUrl,
      mapStyleRevision: shouldAdoptMapTiler
        ? MAP_STYLE_CONFIGURATION_REVISION
        : storedMapStyleRevision,
    },
    sync: data.sync && typeof data.sync === "object" ? data.sync : { mode: "device_only", pending: [] },
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
