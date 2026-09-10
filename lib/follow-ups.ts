import { createId, type FollowUp, type FollowUpActivity } from "./domain";

type NewFollowUp = Pick<FollowUp, "churchId" | "propertyId" | "dueAt">
  & Partial<Pick<FollowUp, "id" | "residentId" | "sourceVisitId" | "assignedTeamId" | "assignedVolunteerId" | "eventId" | "channel" | "note" | "parentFollowUpId">>;

function activity(action: FollowUpActivity["action"], actorId: string, now: string, note?: string, dueAt?: string): FollowUpActivity {
  return { id: createId("activity"), action, actorId, createdAt: now, note, dueAt };
}

export function createFollowUp(input: NewFollowUp, actorId: string, now: string): FollowUp {
  return {
    ...input,
    id: input.id ?? createId("followup"),
    // A person task belongs to its person's owner, not a location's team.
    assignedTeamId: input.residentId ? undefined : input.assignedTeamId,
    assignedVolunteerId: input.assignedVolunteerId ?? actorId,
    acceptance: input.assignedVolunteerId && input.assignedVolunteerId !== actorId ? "pending" : "accepted",
    channel: input.channel ?? "visit",
    status: "scheduled",
    createdAt: now,
    history: [activity("created", actorId, now, input.note, input.dueAt)],
  };
}

type FollowUpChange =
  | { action: "rescheduled"; dueAt: string; note?: string }
  | { action: "completed" | "cancelled"; note?: string };

export function changeFollowUp(task: FollowUp, change: FollowUpChange, actorId: string, now: string): FollowUp {
  if (task.status !== "scheduled") return task;
  const dueAt = change.action === "rescheduled" ? change.dueAt : undefined;
  return {
    ...task,
    ...(change.action === "rescheduled" ? { dueAt: change.dueAt } : { status: change.action }),
    ...(change.action === "completed" ? { completedAt: now, completionNote: change.note } : {}),
    history: [...task.history, activity(change.action, actorId, now, change.note, dueAt)],
  };
}
