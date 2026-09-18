import type { NeighborWalkData } from "./domain";
import { parcelKey, walkTargetSchema, type WalkTargetInput } from "./walk-targets";

export type TargetOwner = { assignedTeamId?: string; assignedVolunteerId?: string };

/** Keeps local/device planning aligned with the server's per-outing parcel exclusivity rule. */
export function assertWalkTargetDoesNotOverlap(data: NeighborWalkData, input: WalkTargetInput, targetId?: string) {
  const selectedParcels = new Set(input.parcels.map(parcelKey));
  for (const sibling of data.walkTargets) {
    if (sibling.id === targetId || sibling.eventId !== input.eventId) continue;
    const assignments = (data.assignments ?? []).filter((assignment) => assignment.targetId === sibling.id);
    if (assignments.length > 0 && assignments.every((assignment) => ["cancelled", "declined"].includes(assignment.status))) continue;
    if (sibling.territoryId === input.territoryId && (input.selectionKind === "whole_zone" || sibling.selectionKind === "whole_zone")) {
      throw new Error("A whole-zone target cannot be combined with another target in the same outing.");
    }
    if (sibling.parcels.some((parcel) => selectedParcels.has(parcelKey(parcel)))) {
      throw new Error("A residential parcel is already included in another target for this outing.");
    }
  }
}

/** The queue commits cancellation and the fresh assignment in one transaction. */
export function replaceWalkTarget(data: NeighborWalkData, assignmentId: string, input: WalkTargetInput, owner: TargetOwner, ids: { targetId: string; assignmentId: string }): NeighborWalkData {
  const previous = data.assignments?.find((assignment) => assignment.id === assignmentId);
  if (!previous?.targetId || !["assigned", "accepted"].includes(previous.status)) throw new Error("Choose an active target assignment to replace.");
  if (previous.eventId !== input.eventId || previous.territoryId !== input.territoryId) throw new Error("Keep the replacement in this outing and parent zone.");
  if (!data.events.some((event) => event.id === input.eventId && ["draft", "scheduled", "ready", "active"].includes(event.status))) throw new Error("This outing is no longer open for replacement targets.");
  if (Number(Boolean(owner.assignedTeamId)) + Number(Boolean(owner.assignedVolunteerId)) !== 1) throw new Error("Choose exactly one team or person for the replacement.");
  if (!input.parcels.length) throw new Error("Review the replacement’s residential properties first.");
  const selectedParcels = new Set(input.parcels.map(parcelKey));
  for (const assignment of data.assignments ?? []) {
    if (assignment.id === previous.id || assignment.eventId !== input.eventId || !["assigned", "accepted"].includes(assignment.status)) continue;
    const sibling = data.walkTargets.find((target) => target.id === assignment.targetId);
    if (assignment.territoryId === input.territoryId && (!assignment.targetId || input.selectionKind === "whole_zone" || sibling?.selectionKind === "whole_zone")) throw new Error("A whole-zone assignment cannot overlap another active target. Cancel or finish that work first.");
    if (sibling?.parcels.some((parcel) => selectedParcels.has(parcelKey(parcel)))) throw new Error("The replacement overlaps another team’s active residential properties. Adjust its map selection first.");
  }
  const target = walkTargetSchema.parse({ ...input, id: ids.targetId, churchId: data.church.id, rosterState: "draft", frozenAt: undefined, finishedAt: undefined });
  return { ...data,
    walkTargets: [...data.walkTargets, target],
    assignments: [...data.assignments!.map((assignment) => assignment.id === previous.id ? { ...assignment, status: "cancelled" as const } : assignment),
      { id: ids.assignmentId, churchId: data.church.id, eventId: input.eventId, territoryId: input.territoryId, targetId: target.id, ...owner, status: "assigned" }],
  };
}

/** Predict server-owned lifecycle timestamps after queueing, never as target edits. */
export function projectWalkTargetLifecycle(data: NeighborWalkData): NeighborWalkData {
  return { ...data, walkTargets: data.walkTargets.map((target) => {
    const outing = data.events.find((event) => event.id === target.eventId);
    const assignments = (data.assignments ?? []).filter((assignment) => assignment.targetId === target.id && assignment.eventId === target.eventId);
    const freeze = target.rosterState === "frozen" || (outing && ["ready", "active", "completed", "archived"].includes(outing.status)) || assignments.some((assignment) => ["accepted", "completed"].includes(assignment.status));
    const finished = assignments.some((assignment) => assignment.status === "completed");
    return { ...target, rosterState: freeze ? "frozen" as const : "draft" as const,
      frozenAt: freeze ? target.frozenAt ?? data.updatedAt : undefined,
      finishedAt: target.finishedAt ?? (finished ? data.updatedAt : undefined) };
  }) };
}
