import type { NeighborWalkData } from "./domain";

type Assignment = NonNullable<NeighborWalkData["assignments"]>[number];

export type WalkCrewChange = {
  data: NeighborWalkData;
  assignmentId?: string;
  teamId?: string;
};

function sameMembers(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}

function activeTargetAssignment(assignment: Assignment, targetId: string) {
  return assignment.targetId === targetId && ["assigned", "accepted"].includes(assignment.status);
}

/**
 * Rebuild the accountable crew for one nightly target. A one-person crew stays
 * a direct assignment; two or more people use a target-specific group so the
 * existing assignment/access model can remain intact.
 */
export function changeWalkTargetCrew(
  data: NeighborWalkData,
  targetId: string,
  requestedMemberIds: readonly string[],
  ids: { assignmentId: string; teamId: string },
): WalkCrewChange {
  const target = data.walkTargets.find((item) => item.id === targetId);
  if (!target) throw new Error("This nightly target is no longer available.");
  const outing = data.events.find((item) => item.id === target.eventId);
  if (!outing || !["draft", "scheduled", "ready", "active"].includes(outing.status)) {
    throw new Error("Crews can be changed only while a walk is still open.");
  }

  const activeVolunteerIds = new Set(data.volunteers.filter((volunteer) => volunteer.active).map((volunteer) => volunteer.id));
  const memberIds = [...new Set(requestedMemberIds)];
  if (memberIds.some((id) => !activeVolunteerIds.has(id))) throw new Error("Choose only active church members for this crew.");

  const assignments = data.assignments ?? [];
  const current = assignments.find((assignment) => activeTargetAssignment(assignment, targetId));
  const assignedTeam = data.teams.find((team) => team.id === current?.assignedTeamId);
  const teamUsedElsewhere = assignedTeam ? assignments.some((assignment) => assignment.id !== current?.id
    && assignment.assignedTeamId === assignedTeam.id && ["assigned", "accepted"].includes(assignment.status)) : false;
  const targetCrew = assignedTeam?.eventId === target.eventId && !teamUsedElsewhere ? assignedTeam : undefined;

  const finishPreviousCrew = (teams: NeighborWalkData["teams"], nextTeamId?: string) => targetCrew && targetCrew.id !== nextTeamId
    ? teams.map((team) => team.id === targetCrew.id ? { ...team, status: "finished" as const } : team)
    : teams;

  if (memberIds.length === 0) {
    if (!current) return { data };
    const nextAssignments = assignments.map((assignment) => assignment.id === current.id
      ? { ...assignment, status: "cancelled" as const }
      : assignment);
    return {
      data: { ...data, teams: finishPreviousCrew(data.teams), assignments: nextAssignments },
      assignmentId: current.id,
    };
  }

  if (memberIds.length === 1) {
    if (current?.assignedVolunteerId === memberIds[0] && !current.assignedTeamId) return { data, assignmentId: current.id };
    const next: Assignment = current
      ? { ...current, assignedVolunteerId: memberIds[0], assignedTeamId: undefined, status: "assigned" }
      : { id: ids.assignmentId, churchId: data.church.id, eventId: target.eventId, territoryId: target.territoryId,
        targetId, assignedVolunteerId: memberIds[0], status: "assigned" };
    return {
      data: {
        ...data,
        teams: finishPreviousCrew(data.teams),
        assignments: current ? assignments.map((assignment) => assignment.id === current.id ? next : assignment) : [...assignments, next],
      },
      assignmentId: next.id,
    };
  }

  const teamId = targetCrew?.id ?? ids.teamId;
  const nextTeam = targetCrew
    ? { ...targetCrew, name: `${target.name} crew`, memberIds, territoryIds: [...new Set([...targetCrew.territoryIds, target.territoryId])],
      status: outing.status === "active" ? "active" as const : "ready" as const }
    : { id: teamId, churchId: data.church.id, eventId: target.eventId, name: `${target.name} crew`, memberIds,
      territoryIds: [target.territoryId], status: outing.status === "active" ? "active" as const : "ready" as const };
  const unchangedCrew = Boolean(targetCrew && sameMembers(targetCrew.memberIds, memberIds)
    && targetCrew.name === nextTeam.name && targetCrew.status === nextTeam.status);
  const nextTeams = targetCrew
    ? data.teams.map((team) => team.id === targetCrew.id ? nextTeam : team)
    : [...finishPreviousCrew(data.teams, teamId), nextTeam];

  if (current?.assignedTeamId === teamId && !current.assignedVolunteerId) {
    if (unchangedCrew) return { data, assignmentId: current.id, teamId };
    return { data: { ...data, teams: nextTeams }, assignmentId: current.id, teamId };
  }

  const next: Assignment = current
    ? { ...current, assignedTeamId: teamId, assignedVolunteerId: undefined, status: "assigned" }
    : { id: ids.assignmentId, churchId: data.church.id, eventId: target.eventId, territoryId: target.territoryId,
      targetId, assignedTeamId: teamId, status: "assigned" };
  return {
    data: {
      ...data,
      teams: nextTeams,
      assignments: current ? assignments.map((assignment) => assignment.id === current.id ? next : assignment) : [...assignments, next],
    },
    assignmentId: next.id,
    teamId,
  };
}

export function targetCrewMemberIds(data: NeighborWalkData, targetId: string): string[] {
  const assignment = (data.assignments ?? []).find((item) => activeTargetAssignment(item, targetId));
  if (assignment?.assignedVolunteerId) return [assignment.assignedVolunteerId];
  return data.teams.find((team) => team.id === assignment?.assignedTeamId)?.memberIds ?? [];
}
