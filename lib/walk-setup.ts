import type { NeighborWalkData, OutreachEvent } from "./domain";
import { churchDateTimeToIso } from "./calendar";
import { parcelKey, type SaveTarget, type WalkTargetInput } from "./walk-targets";

export type WalkAreaChoice = { kind: "existing"; territoryId: string } | { kind: "community" };
export type WalkResponsibility = { memberIds?: string[]; volunteerId?: string; teamId?: string };
export type PlannedWalkTarget = { clientId: string; target: Omit<WalkTargetInput, "eventId">; responsibility: WalkResponsibility };
export type WalkSetupPlan = {
  outing: Omit<OutreachEvent, "id" | "churchId">;
  area: WalkAreaChoice;
  invitedMemberIds: string[];
  targets?: PlannedWalkTarget[];
  /** Compatibility for drafts saved before nightly targets existed. */
  responsibility?: WalkResponsibility;
  preserveAssignments?: boolean;
};
export type WalkSetupCheckpoint = { eventId?: string; targetIds?: Record<string, string>; assignmentIds?: Record<string, string> };
type Assignment = NonNullable<NeighborWalkData["assignments"]>[number];
export type WalkSetupCallbacks = {
  saveOuting: (input: Omit<OutreachEvent, "id" | "churchId">, id?: string) => Promise<string>;
  saveRoster: (eventId: string, memberIds: string[]) => Promise<void>;
  saveTarget?: SaveTarget;
  saveAssignment: (input: Omit<Assignment, "id" | "churchId">, id?: string) => Promise<string>;
  saveCrew?: (targetId: string, memberIds: string[]) => Promise<{ assignmentId?: string; teamId?: string }>;
};
export type WalkSaveIntent = "draft" | "ready";
export type WalkDateTimes = { startsAt: string; endsAt: string; error: string };

export function parseWalkDateTimes(start: string, end: string, timezone: string): WalkDateTimes {
  try {
    const startsAt = churchDateTimeToIso(start, timezone);
    const endsAt = churchDateTimeToIso(end, timezone);
    if (Date.parse(endsAt) <= Date.parse(startsAt)) return { startsAt: "", endsAt: "", error: "Choose an end time after the start." };
    return { startsAt, endsAt, error: "" };
  } catch (error) {
    return { startsAt: "", endsAt: "", error: error instanceof Error ? error.message : "Choose valid start and end times." };
  }
}

export function readyPreparationMissing(outing: WalkSetupPlan["outing"]): string[] {
  const missing: string[] = [];
  if (!outing.purpose?.trim()) missing.push("purpose");
  if (!outing.meetingPoint?.trim()) missing.push("meeting point");
  if (!outing.leaderContact?.trim()) missing.push("leader contact");
  return missing;
}

export function targetRosterIssues(targets: PlannedWalkTarget[]): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const item of targets) {
    const name = item.target.name || "Unnamed target";
    for (const parcel of item.target.parcels) {
      const key = parcelKey(parcel);
      if (seen.has(key)) issues.push(`${name} overlaps another target`);
      seen.add(key);
    }
  }
  if (targets.some((item) => item.target.selectionKind === "whole_zone") && targets.length > 1) issues.push("A whole-zone target cannot be combined with smaller targets");
  return [...new Set(issues)];
}

export function targetPlanIssues(targets: PlannedWalkTarget[]): string[] {
  const seenMembers = new Map<string, string>();
  const issues = targets.flatMap((item) => {
    const name = item.target.name || "Unnamed target";
    const responsibilityModes = Number(item.responsibility.memberIds !== undefined)
      + Number(Boolean(item.responsibility.volunteerId)) + Number(Boolean(item.responsibility.teamId));
    const targetIssues = responsibilityModes > 1 ? [`${name} has conflicting crew choices`] : [];
    for (const memberId of item.responsibility.memberIds ?? []) {
      const previous = seenMembers.get(memberId);
      if (previous && previous !== name) targetIssues.push(`One person is assigned to both ${previous} and ${name}`);
      else seenMembers.set(memberId, name);
    }
    if (!item.target.parcels.length) targetIssues.push(`${name} needs a reviewed residential roster`);
    return targetIssues;
  });
  return [...new Set([...issues, ...targetRosterIssues(targets)])];
}

/** Save event → immutable nightly target snapshots → assignments → ready. */
export async function saveWalkSetup(plan: WalkSetupPlan, checkpoint: WalkSetupCheckpoint, callbacks: WalkSetupCallbacks, intent: WalkSaveIntent, onCheckpoint: (checkpoint: WalkSetupCheckpoint) => void = () => undefined): Promise<WalkSetupCheckpoint> {
  const rosterIssues = !plan.preserveAssignments && plan.area.kind === "existing" ? targetRosterIssues(plan.targets ?? []) : [];
  if (rosterIssues.length) throw new Error(rosterIssues.join("; "));
  if (intent === "ready" && plan.invitedMemberIds.length === 0) throw new Error("Invite at least one person before sharing this walk.");
  let saved: WalkSetupCheckpoint = { ...checkpoint, targetIds: { ...checkpoint.targetIds }, assignmentIds: { ...checkpoint.assignmentIds } };
  const publish = () => onCheckpoint(saved);
  const eventId = await callbacks.saveOuting({ ...plan.outing, status: "draft" }, saved.eventId);
  saved = { ...saved, eventId }; publish();
  await callbacks.saveRoster(eventId, plan.invitedMemberIds);

  if (plan.area.kind === "existing") {
    const targets = plan.targets ?? [];
    if (plan.preserveAssignments) {
      for (const item of targets) {
        if (item.responsibility.memberIds === undefined) continue;
        if (!callbacks.saveCrew) throw new Error("Crew saving is unavailable. Keep this draft and try again after reconnecting.");
        const targetId = saved.targetIds?.[item.clientId] ?? item.clientId;
        const crew = await callbacks.saveCrew(targetId, item.responsibility.memberIds);
        if (crew.assignmentId) saved = { ...saved, assignmentIds: { ...saved.assignmentIds, [item.clientId]: crew.assignmentId } };
        publish();
      }
    } else if (targets.length) {
      if (!callbacks.saveTarget) throw new Error("Target saving is unavailable. Keep this draft and try again after reconnecting.");
      for (const item of targets) {
        const targetId = await callbacks.saveTarget({ ...item.target, eventId }, saved.targetIds?.[item.clientId]);
        saved = { ...saved, targetIds: { ...saved.targetIds, [item.clientId]: targetId } }; publish();
        if (item.responsibility.memberIds !== undefined) {
          if (!callbacks.saveCrew) throw new Error("Crew saving is unavailable. Keep this draft and try again after reconnecting.");
          const crew = await callbacks.saveCrew(targetId, item.responsibility.memberIds);
          if (crew.assignmentId) saved = { ...saved, assignmentIds: { ...saved.assignmentIds, [item.clientId]: crew.assignmentId } };
          else if (saved.assignmentIds) {
            const assignmentIds = { ...saved.assignmentIds };
            delete assignmentIds[item.clientId];
            saved = { ...saved, assignmentIds };
          }
          publish();
        } else if (item.responsibility.volunteerId || item.responsibility.teamId) {
          const assignmentId = await callbacks.saveAssignment({ eventId, territoryId: item.target.territoryId, targetId, assignedVolunteerId: item.responsibility.volunteerId, assignedTeamId: item.responsibility.teamId, status: "assigned" }, saved.assignmentIds?.[item.clientId]);
          saved = { ...saved, assignmentIds: { ...saved.assignmentIds, [item.clientId]: assignmentId } }; publish();
        }
      }
    } else if (plan.responsibility) {
      const assignmentId = await callbacks.saveAssignment({ eventId, territoryId: plan.area.territoryId, assignedVolunteerId: plan.responsibility.volunteerId, assignedTeamId: plan.responsibility.teamId, status: "assigned" }, saved.assignmentIds?.legacy);
      saved = { ...saved, assignmentIds: { ...saved.assignmentIds, legacy: assignmentId } }; publish();
    }
  }

  if (intent === "ready") {
    const missing = readyPreparationMissing(plan.outing);
    const issues = plan.area.kind === "community" || plan.preserveAssignments ? [] : targetPlanIssues(plan.targets ?? []);
    if (missing.length || issues.length) throw new Error([...missing.map((item) => `add ${item}`), ...issues].join("; "));
    await callbacks.saveOuting({ ...plan.outing, status: "ready" }, eventId);
  }
  return saved;
}
