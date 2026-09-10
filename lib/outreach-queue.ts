import { createId, neighborWalkDataSchema, type NeighborWalkData, type PendingMutation } from "./domain";
import { calendarDate } from "./calendar";
import { outreachCommandSchema, versionKey, type CommandEntity, type CommandOperation, type QueuedCommand } from "./command-schema";
import type { StorageScope } from "./storage";
import { projectOutreachWorkspace } from "./outreach-projection";

export const commandCollections = {
  event: "events", team: "teams", territory: "territories", assignment: "assignments", property: "properties",
  visit: "visits", resident: "residents", person_note: "personNotes", follow_up: "followUps", restriction: "restrictions",
} as const;
const collections = commandCollections;
type CollectionKind = keyof typeof collections;
export const commandFields: Record<CollectionKind, string[]> = {
  event: ["name", "startsAt", "endsAt", "status", "timezone", "purpose", "meetingPoint", "leaderContact", "guideId", "debrief"],
  team: ["name", "status", "memberIds"], territory: ["name", "kind", "color", "center", "zoom", "boundary"],
  assignment: ["eventId", "territoryId", "assignedTeamId", "assignedVolunteerId", "status"],
  property: ["territoryId", "address", "unit", "coordinates", "buildingGeometry", "parcel", "source"],
  visit: ["eventId", "territoryId", "propertyId", "residentId", "outcome", "context", "objectiveNote", "recordedAt", "deviceId"],
  resident: ["propertyId", "name", "assignedVolunteerId", "sharedWithVolunteerIds", "sharedWithTeamIds", "faithStatus", "discipleshipStage", "status", "phone", "email", "preferredContact", "contactPermission", "lastContactAt"],
  person_note: ["residentId", "kind", "body"],
  follow_up: ["propertyId", "residentId", "sourceVisitId", "eventId", "assignedTeamId", "assignedVolunteerId", "dueAt", "status", "channel", "acceptance", "note", "completionNote", "parentFollowUpId", "history"],
  restriction: ["residentId", "propertyId", "channel", "active", "reason", "correctionReason"],
};
const fields = commandFields;
type EntityRecord = { id: string } & Record<string, unknown>;
const records = (data: NeighborWalkData, kind: CollectionKind) => (data[collections[kind]] ?? []) as EntityRecord[];
const comparable = (kind: CollectionKind, record: EntityRecord) => Object.fromEntries(fields[kind].map((key) => [key, record[key]]));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Mirror the server's person-move effect on still-open tasks. Historical
 * encounters, resolved tasks and location restrictions stay at their originals.
 * This projection predicts versions; it never rewrites an immutable command. */
function movedPersonTasks(before: NeighborWalkData, people: NeighborWalkData["residents"]) {
  const original = new Map(before.residents.map((person) => [person.id, person]));
  const destinations = new Map(people.filter((person) => original.has(person.id)
    && original.get(person.id)!.propertyId !== person.propertyId).map((person) => [person.id, person.propertyId]));
  return new Map(before.followUps.filter((task) => task.status === "scheduled" && task.residentId && destinations.has(task.residentId))
    .map((task) => [task.id, destinations.get(task.residentId!)]));
}

export function commandPending(commands: QueuedCommand[]): PendingMutation[] {
  return commands.flatMap(({ command }) => command.operations.map((op, index) => ({
    id: `${command.id}:${index}`, entityType: op.entityType, entityId: op.entityId,
    operation: op.operation, changedAt: command.createdAt, destinationTerritoryId: op.destinationTerritoryId,
  })));
}

export function stageWorkspaceChange(previous: NeighborWalkData, next: NeighborWalkData, scope: StorageScope, extraOperations: CommandOperation[] = [], reasons: Record<string, string> = {}): NeighborWalkData {
  if (previous.sync.legacyRecoveryRequired) throw new Error("Export and review this device’s legacy pending work before making more changes. Nothing was discarded.");
  if (previous.church.id !== scope.churchId || next.church.id !== scope.churchId) throw new Error("The change belongs to a different church.");
  const versions = { ...previous.sync.recordVersions };
  const movedTasks = movedPersonTasks(previous, next.residents);
  if (movedTasks.size) {
    next = { ...next, followUps: next.followUps.map((task) => movedTasks.has(task.id) ? { ...task, propertyId: movedTasks.get(task.id) } : task) };
    for (const id of movedTasks.keys()) versions[versionKey("follow_up", id)] = (versions[versionKey("follow_up", id)] ?? 0) + 1;
  }
  const operations: CommandOperation[] = [...extraOperations];
  const archivedPeople = new Set(previous.residents.filter((p) => !next.residents.some((n) => n.id === p.id)).map((p) => p.id));
  const appendedMutations = next.sync.pending.filter((m) => !previous.sync.pending.some((p) => p.id === m.id));
  const newRestrictionVisit = next.visits.some((v) => v.outcome === "do_not_visit" && !previous.visits.some((p) => p.id === v.id));
  for (const kind of Object.keys(collections) as CollectionKind[]) {
    const oldRecords = new Map(records(previous, kind).map((r) => [r.id, r]));
    const nextRecords = new Map(records(next, kind).map((r) => [r.id, r]));
    for (const [id, record] of nextRecords) {
      const original = oldRecords.get(id);
      // The server moves the task during the preceding resident operation.
      // Do not emit a second task relink for that automatic side effect.
      const old = kind === "follow_up" && original && movedTasks.has(id) ? { ...original, propertyId: movedTasks.get(id) } : original;
      if (old && same(comparable(kind, old), comparable(kind, record))) continue;
      // Restriction side effects are applied by the server across all owners.
      if (kind === "follow_up" && newRestrictionVisit && old && record.status === "cancelled") continue;
      const payload = { ...record };
      if (kind === "follow_up") {
        payload.dueAt = calendarDate(String(record.dueAt), next.church.timezone);
        if (!old && !payload.assignedVolunteerId) payload.assignedVolunteerId = next.residents.find((p) => p.id === record.residentId)?.assignedVolunteerId ?? next.preferences.activeVolunteerId;
      }
      operations.push({ entityType: kind, entityId: id, operation: "upsert", expectedVersion: versions[versionKey(kind, id)] ?? 0, record: payload });
    }
    for (const [id, record] of oldRecords) if (!nextRecords.has(id)) {
      if ((kind === "person_note" || kind === "follow_up") && archivedPeople.has(String(record.residentId))) continue;
      operations.push({ entityType: kind, entityId: id, operation: "delete", expectedVersion: versions[versionKey(kind, id)] ?? 0,
        destinationTerritoryId: appendedMutations.find((m) => m.entityType === kind && m.entityId === id)?.destinationTerritoryId });
    }
  }
  if (!same(previous.church, next.church)) operations.push({ entityType: "settings", entityId: next.church.id, operation: "upsert",
    expectedVersion: versions[versionKey("settings", next.church.id)] ?? 0, record: next.church });
  if (!operations.length) return { ...next, sync: previous.sync };
  const order: Partial<Record<CommandEntity, number>> = { event: 0, team: 1, territory: 2, property: 3, resident: 4, visit: 5, person_note: 6, follow_up: 7, assignment: 8, restriction: 9 };
  operations.sort((a, b) => (a.operation === "delete" ? 100 - (order[a.entityType] ?? 10) : order[a.entityType] ?? 10)
    - (b.operation === "delete" ? 100 - (order[b.entityType] ?? 10) : order[b.entityType] ?? 10));
  // JSON cloning freezes the exact wire payload. A retry never re-reads edited
  // UI state under an old command ID, and undefined values cannot hash differently.
  const command = outreachCommandSchema.parse(JSON.parse(JSON.stringify({ schemaVersion: 1, id: createId("command"), ...scope,
    createdAt: new Date().toISOString(), operations: operations.map((op) => ({ ...op, reason: reasons[versionKey(op.entityType, op.entityId)] ?? op.reason })) })));
  for (const op of command.operations) versions[versionKey(op.entityType, op.entityId)] = op.expectedVersion + 1;
  const commands: QueuedCommand[] = [...(previous.sync.commands ?? []), { command, state: "queued" }];
  return neighborWalkDataSchema.parse({ ...next, sync: { ...next.sync, commands, pending: commandPending(commands), recordVersions: versions } });
}

export function reconcileOutreachWorkspace(remote: NeighborWalkData, local: NeighborWalkData): NeighborWalkData {
  if (remote.church.id !== local.church.id) throw new Error("Cannot combine different churches.");
  if (local.sync.legacyRecoveryRequired) return { ...local, sync: { ...local.sync, lastError: "Legacy pending work needs a reviewed recovery. Export it before continuing." } };
  const commands = local.sync.commands ?? [];
  const pendingRestrictedLocations = new Set<string>();
  let result = { ...remote, preferences: { ...local.preferences, activeVolunteerId: remote.preferences.activeVolunteerId },
    sync: { ...remote.sync, commands, pending: commandPending(commands), warnings: local.sync.warnings,
      lastError: commands.find((q) => q.state === "needs_review")?.error, recordVersions: { ...remote.sync.recordVersions } } };
  for (const queued of commands) {
    // Later commands may depend on the rejected command. Do not display them
    // as applied while the first unresolved transaction is held for review.
    if (queued.state === "needs_review") break;
    for (const op of queued.command.operations) {
      if (op.entityType === "visit" && op.record?.outcome === "do_not_visit" && typeof op.record.propertyId === "string") pendingRestrictedLocations.add(op.record.propertyId);
      if (op.entityType === "settings") {
        result = { ...result, church: op.record as NeighborWalkData["church"] };
      } else if (op.entityType in collections) {
        const key = collections[op.entityType as CollectionKind];
        const current = (result[key] ?? []) as EntityRecord[];
        const record = op.record as EntityRecord | undefined;
        if (op.entityType === "resident" && record && op.operation === "upsert") {
          const movedTasks = movedPersonTasks(result, [record as NeighborWalkData["residents"][number]]);
          result = { ...result, followUps: result.followUps.map((task) => movedTasks.has(task.id) ? { ...task, propertyId: movedTasks.get(task.id) } : task) };
          for (const id of movedTasks.keys()) result.sync.recordVersions[versionKey("follow_up", id)] = (result.sync.recordVersions[versionKey("follow_up", id)] ?? 0) + 1;
        }
        result = { ...result, [key]: op.operation === "delete" ? current.filter((r) => r.id !== op.entityId)
          : [...current.filter((r) => r.id !== op.entityId), record] };
      }
      result.sync.recordVersions[versionKey(op.entityType, op.entityId)] = op.expectedVersion + 1;
    }
  }
  return projectOutreachWorkspace(neighborWalkDataSchema.parse(result), pendingRestrictedLocations);
}

/** Serializes local mutations and server receipts against the latest committed
 * device state. The UI callback runs only after IndexedDB confirms the write. */
export class DurableWorkspaceStore {
  private queue: Promise<void> = Promise.resolve();
  constructor(private current: NeighborWalkData, private readonly persist: (data: NeighborWalkData) => Promise<void>, private readonly publish: (data: NeighborWalkData) => void) {}
  get snapshot() { return this.current; }
  async update(change: (data: NeighborWalkData) => NeighborWalkData | Promise<NeighborWalkData>): Promise<NeighborWalkData> {
    const task = this.queue.catch(() => undefined).then(async () => {
      const next = neighborWalkDataSchema.parse(await change(this.current));
      await this.persist(next);
      this.current = next;
      this.publish(next);
      return next;
    });
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }
  async settled() { await this.queue; }
}
