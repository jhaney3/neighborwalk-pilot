import { createId, type NeighborWalkData } from "./domain";
import { outreachCommandSchema, versionKey, type CommandOperation, type QueuedCommand } from "./command-schema";
import { commandCollections, commandFields } from "./outreach-queue";

export type RecoveryChoice = { key: string; operation: number; field?: string; label: string; shared: unknown; queued: unknown; blocked?: string };
export function sharedCommandRecord(data: NeighborWalkData, op: CommandOperation): Record<string, unknown> | undefined {
  if (op.entityType === "settings") return data.church;
  const kind = op.entityType === "handoff" ? "resident" : op.entityType;
  if (!(kind in commandCollections)) return;
  const collection = commandCollections[kind as keyof typeof commandCollections];
  return (data[collection] as { id: string }[] | undefined)?.find((r) => r.id === op.entityId);
}
const settingsFields = ["name", "timezone", "retentionDays", "defaultFollowUpDays", "noteCharacterLimit", "pathwayEnabled"];
export function recoveryChoices(queued: QueuedCommand, remote: NeighborWalkData): RecoveryChoice[] {
  return queued.command.operations.flatMap<RecoveryChoice>((op, index) => {
    const current = sharedCommandRecord(remote, op);
    const label = op.entityType.replaceAll("_", " ") + " · " + op.entityId;
    if (!current || op.operation === "delete" || op.entityType === "handoff" || op.expectedVersion === 0) {
      const blocked = !current && op.expectedVersion > 0 ? "Archived or no longer accessible. This recovery cannot restore it."
        : current && op.expectedVersion === 0 ? "This identifier already exists. Review the shared record; do not create a duplicate." : undefined;
      return [{ key: String(index), operation: index, label, shared: current ?? null, queued: op.operation === "delete" ? "Archive this shared record" : op.record, blocked }];
    }
    const fields = op.entityType === "settings" ? settingsFields : commandFields[op.entityType as keyof typeof commandFields];
    return fields.filter((field) => field !== "history" && JSON.stringify(current[field]) !== JSON.stringify(op.record?.[field])).map((field) => ({
      key: index + ":" + field, operation: index, field, label: label + " · " + field, shared: current[field] ?? null, queued: op.record?.[field] ?? null,
    }));
  });
}

/** Builds a NEW transaction from explicitly chosen changes and the reviewed
 * versions. A newer server edit still conflicts; nothing rebases silently. */
export function prepareReviewedCommand(queued: QueuedCommand, remote: NeighborWalkData, selected: string[]): QueuedCommand {
  if (queued.state !== "needs_review") throw new Error("Only a held change can be resolved here.");
  if (remote.church.id !== queued.command.churchId) throw new Error("The review belongs to a different church.");
  const choices = recoveryChoices(queued, remote);
  const selectedChoices = choices.filter((c) => selected.includes(c.key));
  if (!selectedChoices.length || selectedChoices.some((c) => c.blocked) || selectedChoices.length !== selected.length) throw new Error("Select available changes after reviewing them.");
  const operations: CommandOperation[] = queued.command.operations.flatMap((op, index) => {
    const chosen = selectedChoices.filter((c) => c.operation === index);
    if (!chosen.length) return [];
    const current = sharedCommandRecord(remote, op);
    const record = chosen[0].field ? { ...current, ...Object.fromEntries(chosen.map((c) => [c.field!, op.record?.[c.field!]])) } : op.record;
    return [{ ...op, record, expectedVersion: remote.sync.recordVersions?.[versionKey(op.entityType, op.entityId)] ?? 0 }];
  });
  return { state: "queued", command: outreachCommandSchema.parse(JSON.parse(JSON.stringify({
    ...queued.command, id: createId("command"), createdAt: new Date().toISOString(), operations,
  }))) };
}
