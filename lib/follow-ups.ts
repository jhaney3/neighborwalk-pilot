import { createId, type FollowUp, type FollowUpActivity, type NeighborWalkData } from "./domain";

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

export function changeFollowUp(original: FollowUp, change: FollowUpChange, actorId: string, now: string): FollowUp {
  if (original.status !== "scheduled") return original;
  let task = original;
  if (change.action !== "cancelled" && task.acceptance !== "accepted") {
    // Acting on your own follow-up is acceptance; there is no separate step.
    if (task.assignedVolunteerId !== actorId) throw new Error("The responsible person must accept this follow-up before it can be completed or rescheduled.");
    task = { ...task, acceptance: "accepted", history: [...task.history, activity("accepted", actorId, now)] };
  }
  const dueAt = change.action === "rescheduled" ? change.dueAt : undefined;
  return {
    ...task,
    ...(change.action === "rescheduled" ? { dueAt: change.dueAt } : { status: change.action }),
    ...(change.action === "completed" ? { completedAt: now, completionNote: change.note } : {}),
    history: [...task.history, activity(change.action, actorId, now, change.note, dueAt)],
  };
}

export function assignFollowUp(data: NeighborWalkData, id: string, ownerId: string, actorId: string, now: string): NeighborWalkData {
  const task = data.followUps.find((task) => task.id === id);
  if (!task || task.status !== "scheduled") throw new Error("This task is no longer open. Refresh before assigning it.");
  if (!data.volunteers.some((member) => member.id === actorId && member.active && member.role === "leader")) throw new Error("Only a church leader can reassign a task.");
  if (!data.volunteers.some((member) => member.id === ownerId && member.active)) throw new Error("Choose an active church member.");
  if (task.assignedVolunteerId === ownerId) return data;
  const changed = { ...task, assignedVolunteerId: ownerId, acceptance: ownerId === actorId ? "accepted" as const : "pending" as const,
    history: [...task.history, activity("reassigned", actorId, now)] };
  return { ...data, followUps: data.followUps.map((item) => item.id === id ? changed : item) };
}

export function respondToFollowUp(data: NeighborWalkData, id: string, acceptance: "accepted" | "declined", actorId: string, now: string): NeighborWalkData {
  const task = data.followUps.find((task) => task.id === id);
  if (!task || task.status !== "scheduled") throw new Error("This task is no longer open. Refresh before responding.");
  if (task.assignedVolunteerId !== actorId || !data.volunteers.some((member) => member.id === actorId && member.active)) throw new Error("Only its active responsible person can accept or decline this task.");
  if (task.acceptance === acceptance) return data;
  return { ...data, followUps: data.followUps.map((item) => item.id === id ? { ...item, acceptance,
    history: [...item.history, activity(acceptance, actorId, now)] } : item) };
}
