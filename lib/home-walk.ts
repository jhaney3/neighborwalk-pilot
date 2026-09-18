import type { NeighborWalkData } from "./domain";
import { outingParticipant } from "./outing-participants";

/** Resolve field context from this walk, never from an unrelated saved map. */
export function fieldWalkAssignment(data: NeighborWalkData, outingId: string, volunteerId: string, canManage: boolean, requestedArea?: string | null, requestedTarget?: string | null) {
  const outing = data.events.find((event) => event.id === outingId);
  if (!outing || !["ready", "active"].includes(outing.status)) return undefined;
  const teams = new Set(data.teams.filter((team) => team.memberIds.includes(volunteerId)).map((team) => team.id));
  const checkedIn = outingParticipant(data, outingId, volunteerId)?.status === "checked_in";
  const assignments = (data.assignments ?? []).filter((assignment) => assignment.eventId === outingId
    && (canManage ? ["assigned", "accepted"].includes(assignment.status) : assignment.status === "accepted" || checkedIn && assignment.status === "assigned")
    && (canManage || assignment.assignedVolunteerId === volunteerId || teams.has(assignment.assignedTeamId ?? ""))
    && data.territories.some((area) => area.id === assignment.territoryId)
    && (!assignment.targetId || data.walkTargets.some((target) => target.id === assignment.targetId
      && target.eventId === outingId && target.territoryId === assignment.territoryId && !target.finishedAt))
    && (!requestedArea || assignment.territoryId === requestedArea)
    && (!requestedTarget || assignment.targetId === requestedTarget));
  // A parent-zone URL must not silently pick one of several nightly targets.
  return assignments.length === 1 ? assignments[0] : undefined;
}

export function fieldWalkArea(data: NeighborWalkData, outingId: string, volunteerId: string, canManage: boolean, requestedArea?: string | null, requestedTarget?: string | null) {
  const assignment = fieldWalkAssignment(data, outingId, volunteerId, canManage, requestedArea, requestedTarget);
  return data.territories.find((area) => area.id === assignment?.territoryId);
}

/** Invitations make a walk visible before any day-of target crew exists. */
export function walkInvitations(data: NeighborWalkData, volunteerId: string) {
  return data.outingParticipants.filter((participant) => participant.volunteerId === volunteerId
    && data.events.some((event) => event.id === participant.eventId && ["scheduled", "ready", "active"].includes(event.status)));
}

/** Home is personal: an unrelated church walk must not become my assignment. */
export function homeWalk(data: NeighborWalkData, volunteerId: string, canManage: boolean) {
  const invitations = walkInvitations(data, volunteerId);
  const events = data.events.filter((event) =>
    ["draft", "scheduled", "ready", "active"].includes(event.status)
    && (canManage || invitations.some((participant) => participant.eventId === event.id)))
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || a.startsAt.localeCompare(b.startsAt));
  // Leaders own preparation; invitation responses are personal to volunteers.
  const responseOutings = (canManage ? [] : data.events).filter((event) =>
    ["scheduled", "ready", "active"].includes(event.status)
    && invitations.some((participant) => participant.eventId === event.id))
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || a.startsAt.localeCompare(b.startsAt))
    .map((event) => ({ outing: event, participant: invitations.find((item) => item.eventId === event.id)! }));
  const outing = events[0];
  const myTeamIds = new Set(data.teams.filter((team) => team.memberIds.includes(volunteerId)).map((team) => team.id));
  const assignments = outing ? (data.assignments ?? []).filter((assignment) => assignment.eventId === outing.id
    && (assignment.assignedVolunteerId === volunteerId || myTeamIds.has(assignment.assignedTeamId ?? ""))
    && ["assigned", "accepted"].includes(assignment.status)) : [];
  const participant = outing ? invitations.find((item) => item.eventId === outing.id) : undefined;
  const resumable = outing?.status === "active" && participant?.status === "checked_in" && assignments.length === 1
    && fieldWalkAssignment(data, outing.id, volunteerId, false, assignments[0].territoryId, assignments[0].targetId) ? assignments[0] : undefined;
  return { outing, participant, assignments, resumable, responseOutings };
}
