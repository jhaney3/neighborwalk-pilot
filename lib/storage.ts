import { openDB, type IDBPDatabase } from "idb";
import {
  APP_SCHEMA_VERSION,
  createId,
  enforceRetention,
  neighborWalkDataSchema,
  type NeighborWalkData,
} from "./domain";
import { createSeedData } from "./seed";
import { calendarDate } from "./calendar";
import { storageKey } from "./environment";
import { authoredRecovery } from "./device-recovery";
import {
  DEFAULT_MAP_STYLE_URL,
  isOpenFreeMapStyle,
  MAP_STYLE_CONFIGURATION_REVISION,
  MAPTILER_STREETS_URL,
} from "./map-config";

const DB_NAME = storageKey("neighborwalk");
const DB_VERSION = 1;
const STORE = "app_state";
const DATA_KEY = "demo";
export type StorageScope = { userId: string; churchId: string };

export function scopedStorageKey(scope: StorageScope) {
  if (!scope.userId || !scope.churchId) throw new Error("An authenticated account and church are required for local records.");
  return JSON.stringify(["account", scope.userId, scope.churchId]);
}

export class StorageRecoveryError extends Error {
  constructor(public readonly backupKey: string) {
    super("Saved records need recovery. The original data has been preserved; no sample records replaced it. Contact your church leader before clearing browser storage.");
    this.name = "StorageRecoveryError";
  }
}

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
  const storedPreferences = data.preferences && typeof data.preferences === "object"
    ? data.preferences as Record<string, unknown>
    : {};
  const storedMapStyleUrl = typeof storedPreferences.mapStyleUrl === "string"
    ? storedPreferences.mapStyleUrl
    : DEFAULT_MAP_STYLE_URL;
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
  const defaults = createSeedData();
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
  const timezone = data.church && typeof data.church === "object" && "timezone" in data.church && typeof data.church.timezone === "string"
    ? data.church.timezone : defaults.church.timezone;
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
        ? { ...followUp as Record<string, unknown>, dueAt: calendarDate(String((followUp as Record<string, unknown>).dueAt), timezone),
          history: Array.isArray((followUp as Record<string, unknown>).history) ? (followUp as Record<string, unknown>).history : [] }
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
      legacyRecoveryRequired: Boolean((data.sync as Record<string, unknown>).legacyRecoveryRequired
        || (version < 11 && Array.isArray((data.sync as Record<string, unknown>).pending)
          && ((data.sync as Record<string, unknown>).pending as unknown[]).length > 0)),
      pending: Array.isArray((data.sync as Record<string, unknown>).pending)
        ? (data.sync as Record<string, unknown>).pending as unknown[]
        : [],
    } : { mode: "device_only", pending: [] },
    updatedAt: new Date().toISOString(),
  };
}

async function parseStoredData(stored: unknown, key: string): Promise<NeighborWalkData> {
  const database = await getDatabase();
  if (stored && typeof stored === "object" && "schemaVersion" in stored && Number(stored.schemaVersion) < APP_SCHEMA_VERSION) {
    const archiveKey = `pre-upgrade:${key}:${stored.schemaVersion}`;
    if (await database.get(STORE, archiveKey) === undefined) await database.put(STORE, stored, archiveKey);
  }
  try {
    const migratedCandidate = migrateNeighborWalkData(stored);
    const parsed = neighborWalkDataSchema.parse(migratedCandidate);
    // Retention is an explicit reviewed operation, not a side effect of opening
    // a device. This also preserves all queued work during an upgrade.
    return parsed;
  } catch {
    const backupKey = `quarantine:${key}:${Date.now()}`;
    await database.put(STORE, stored, backupKey);
    throw new StorageRecoveryError(backupKey);
  }
}

export async function loadNeighborWalkData(): Promise<NeighborWalkData> {
  const database = await getDatabase();
  const stored = await database.get(STORE, DATA_KEY);
  if (stored) return parseStoredData(stored, DATA_KEY);
  const seeded = createSeedData();
  await database.put(STORE, seeded, DATA_KEY);
  return seeded;
}

export async function loadScopedNeighborWalkData(scope: StorageScope): Promise<NeighborWalkData | null> {
  const database = await getDatabase();
  const key = scopedStorageKey(scope);
  // Bind the former shared cache to its original known owner exactly once,
  // before connection metadata can be changed by a different sign-in.
  let legacyOwner = await database.get(STORE, "legacy_owner");
  if (legacyOwner === undefined) {
    try {
      const cached = JSON.parse(window.localStorage.getItem(storageKey("neighborwalk-supabase-workspace")) ?? "null");
      legacyOwner = cached?.userId && cached?.churchId ? scopedStorageKey(cached) : "unclaimed";
    } catch { legacyOwner = "unclaimed"; }
    await database.put(STORE, legacyOwner, "legacy_owner");
  }
  let stored = await database.get(STORE, key);
  if (!stored && legacyOwner === key) {
    const legacy = await database.get(STORE, "primary");
    if (legacy) {
      const parsed = await parseStoredData(legacy, "primary");
      if (parsed.church.id !== scope.churchId) throw new StorageRecoveryError("primary");
      await database.put(STORE, parsed, key);
      stored = parsed;
    }
  }
  if (!stored) return null;
  const parsed = await parseStoredData(stored, key);
  if (parsed.church.id !== scope.churchId) throw new StorageRecoveryError(key);
  return parsed;
}

export async function saveNeighborWalkData(data: NeighborWalkData, scope?: StorageScope): Promise<void> {
  const parsed = neighborWalkDataSchema.parse(data);
  if (scope && scope.churchId !== parsed.church.id) throw new Error("Local records belong to a different church. Nothing was overwritten.");
  const database = await getDatabase();
  await database.put(STORE, parsed, scope ? scopedStorageKey(scope) : DATA_KEY);
}

export async function archiveWorkspaceRecovery(data: NeighborWalkData, scope: StorageScope, reason: string) {
  if (data.church.id !== scope.churchId) throw new Error("Recovery archive belongs to a different church.");
  const database = await getDatabase();
  const key = `recovery:${scopedStorageKey(scope)}:${createId("archive")}`;
  await database.put(STORE, { data, reason, createdAt: new Date().toISOString(), scope }, key);
  return key;
}

export async function recoveryArchives(scope: StorageScope): Promise<{ key: string; reason: string; createdAt: string }[]> {
  const database = await getDatabase();
  const keys = await database.getAllKeys(STORE);
  const scopeKey = scopedStorageKey(scope);
  const ownsLegacy = await database.get(STORE, "legacy_owner") === scopeKey;
  const entries = await Promise.all(keys.filter((key) => typeof key === "string" && archiveKeyAllowed(key, scopeKey, ownsLegacy)).map(async (key) => {
    const entry = await database.get(STORE, key);
    const raw = !String(key).startsWith("recovery:");
    return { key: String(key), reason: raw ? "Original device copy preserved before migration or schema recovery." : String(entry.reason), createdAt: raw ? "" : String(entry.createdAt) };
  }));
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function exportRecoveryArchive(scope: StorageScope, key: string, mode: "authored" | "workspace" = "authored"): Promise<Blob> {
  const database = await getDatabase();
  const scopeKey = scopedStorageKey(scope);
  if (!archiveKeyAllowed(key, scopeKey, await database.get(STORE, "legacy_owner") === scopeKey)) throw new Error("This archive belongs to a different account or church.");
  const entry = await database.get(STORE, key);
  if (!entry) throw new Error("The archive is no longer available on this device.");
  const payload = key.startsWith("recovery:") ? entry : { data: entry, reason: "Original preserved device copy", scope };
  if (mode === "authored") return new Blob([JSON.stringify(authoredRecovery(payload.data, scope), null, 2)], { type: "application/json" });
  return new Blob([JSON.stringify({ format: "neighborwalk-recovery", formatVersion: 1, ...payload }, null, 2)], { type: "application/json" });
}

function archiveKeyAllowed(key: string, scopeKey: string, ownsLegacy: boolean) {
  return ["recovery:", "pre-upgrade:", "quarantine:"].some((prefix) => key.startsWith(prefix + scopeKey + ":"))
    || ownsLegacy && ["pre-upgrade:primary:", "quarantine:primary:"].some((prefix) => key.startsWith(prefix));
}

export type PendingAdministration = { request: Record<string, unknown>; savedAt: string; scope: StorageScope };
export async function pendingAdministration(scope: StorageScope): Promise<PendingAdministration | null> {
  const database = await getDatabase();
  const entry = await database.get(STORE, "admin-pending:" + scopedStorageKey(scope));
  if (!entry) return null;
  if (entry.scope?.churchId !== scope.churchId || entry.scope?.userId !== scope.userId || entry.request?.churchId !== scope.churchId) throw new Error("Administration recovery belongs to a different account.");
  return entry;
}
export async function preserveAdministration(scope: StorageScope, request: Record<string, unknown>) {
  if (request.churchId !== scope.churchId || typeof request.id !== "string") throw new Error("An account-scoped administration request is required.");
  const existing = await pendingAdministration(scope);
  if (existing && JSON.stringify(existing.request) !== JSON.stringify(request)) throw new Error("Review or retry this account’s previous administration request first.");
  const database = await getDatabase();
  await database.put(STORE, { request, scope, savedAt: existing?.savedAt ?? new Date().toISOString() }, "admin-pending:" + scopedStorageKey(scope));
}
export async function finishAdministration(scope: StorageScope, requestId: string, result: unknown) {
  const database = await getDatabase();
  const transaction = database.transaction(STORE, "readwrite");
  const key = "admin-pending:" + scopedStorageKey(scope);
  const original = await transaction.store.get(key);
  if (!original || original.request.id !== requestId) { await transaction.done; return; }
  await transaction.store.put({ ...original, result, reviewedAt: new Date().toISOString() }, "admin-history:" + scopedStorageKey(scope) + ":" + requestId);
  await transaction.store.delete(key);
  await transaction.done;
}

/** Available even when membership has been revoked: only the signed-in
 * account's authored work, never its old read cache or a whole church export. */
export async function authoredDeviceRecovery(scope: StorageScope) {
  const database = await getDatabase();
  const scopeKey = scopedStorageKey(scope);
  const current = await database.get(STORE, scopeKey);
  const keys = await database.getAllKeys(STORE);
  const authored: ReturnType<typeof authoredRecovery>[] = [];
  let supervisedCopies = 0;
  const add = (data: unknown) => {
    if (!data) return;
    try { authored.push(authoredRecovery(data, scope)); } catch { supervisedCopies++; }
  };
  add(current);
  const ownsLegacy = await database.get(STORE, "legacy_owner") === scopeKey;
  for (const key of keys) {
    if (typeof key !== "string" || !archiveKeyAllowed(key, scopeKey, ownsLegacy)) continue;
    const record = await database.get(STORE, key);
    add(key.startsWith("recovery:") ? record?.data : record);
  }
  const administration = [];
  for (const key of keys) {
    if (typeof key !== "string" || !(key === "admin-pending:" + scopeKey || key.startsWith("admin-history:" + scopeKey + ":"))) continue;
    const record = await database.get(STORE, key);
    if (record?.scope?.userId === scope.userId && record.scope.churchId === scope.churchId && record.request?.churchId === scope.churchId) administration.push(record);
  }
  return { format: "neighborwalk-authored-device-recovery", formatVersion: 1, scope, authored, administration, supervisedCopies,
    notice: "Only this account’s authored transactions and administration journal. No cached church records. Older copies without reliable authorship remain on the device for supervised recovery." };
}

export async function replaceNeighborWalkData(candidate: unknown): Promise<NeighborWalkData> {
  const parsed = neighborWalkDataSchema.parse(migrateNeighborWalkData(candidate));
  const retained = enforceRetention(parsed);
  await saveNeighborWalkData(retained);
  return retained;
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
  // Parsing an upload is not permission to overwrite any local or remote data.
  return neighborWalkDataSchema.parse(migrateNeighborWalkData(candidate));
}
