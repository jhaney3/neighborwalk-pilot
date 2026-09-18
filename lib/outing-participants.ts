import type { NeighborWalkData } from "./domain";

export type OutingParticipant = NeighborWalkData["outingParticipants"][number];
export type OutingResponse = Extract<OutingParticipant["status"], "going" | "not_going">;

const openStatuses = new Set(["draft", "scheduled", "ready", "active"]);

function openOuting(data: NeighborWalkData, eventId: string) {
  const outing = data.events.find((event) => event.id === eventId);
  if (!outing || !openStatuses.has(outing.status)) throw new Error("This walk is no longer open for roster changes.");
  return outing;
}

function activeVolunteerIds(data: NeighborWalkData) {
  return new Set(data.volunteers.filter((volunteer) => volunteer.active).map((volunteer) => volunteer.id));
}

function validateMembers(data: NeighborWalkData, memberIds: readonly string[]) {
  const active = activeVolunteerIds(data);
  const unique = [...new Set(memberIds)];
  if (unique.some((id) => !active.has(id))) throw new Error("Choose only active church members for this walk.");
  return unique;
}

/** The advance roster makes the outing visible without assigning a target. */
export function changeOutingRoster(
  data: NeighborWalkData,
  eventId: string,
  requestedMemberIds: readonly string[],
  participantId: (volunteerId: string) => string,
): NeighborWalkData {
  openOuting(data, eventId);
  const memberIds = validateMembers(data, requestedMemberIds);
  const current = data.outingParticipants.filter((participant) => participant.eventId === eventId);
  const currentByVolunteer = new Map(current.map((participant) => [participant.volunteerId, participant]));
  if (current.some((participant) => participant.status === "checked_in" && !memberIds.includes(participant.volunteerId))) {
    throw new Error("Remove a person from check-in before removing their outing invitation.");
  }
  const unchanged = current.length === memberIds.length && memberIds.every((id) => currentByVolunteer.has(id));
  if (unchanged) return data;

  const retained = data.outingParticipants.filter((participant) => participant.eventId !== eventId);
  const next = memberIds.map((volunteerId) => currentByVolunteer.get(volunteerId) ?? {
    id: participantId(volunteerId),
    churchId: data.church.id,
    eventId,
    volunteerId,
    status: "invited" as const,
  });
  return { ...data, outingParticipants: [...retained, ...next] };
}

/** Check-in is attendance, not an invitation response or a target assignment. */
export function changeOutingCheckIn(
  data: NeighborWalkData,
  eventId: string,
  requestedAttendingIds: readonly string[],
  participantId: (volunteerId: string) => string,
): NeighborWalkData {
  openOuting(data, eventId);
  const attendingIds = validateMembers(data, requestedAttendingIds);
  const attending = new Set(attendingIds);
  const currentByVolunteer = new Map(data.outingParticipants.filter((participant) => participant.eventId === eventId)
    .map((participant) => [participant.volunteerId, participant]));
  const nextForOuting = [...new Set([...currentByVolunteer.keys(), ...attendingIds])].map((volunteerId) => {
    const current = currentByVolunteer.get(volunteerId);
    if (attending.has(volunteerId)) return current ? { ...current, status: "checked_in" as const } : {
      id: participantId(volunteerId), churchId: data.church.id, eventId, volunteerId, status: "checked_in" as const,
    };
    return current?.status === "checked_in" ? { ...current, status: "going" as const } : current!;
  });
  const unchanged = nextForOuting.length === currentByVolunteer.size && nextForOuting.every((next) => {
    const current = currentByVolunteer.get(next.volunteerId);
    return current?.id === next.id && current.status === next.status;
  });
  if (unchanged) return data;
  return { ...data, outingParticipants: [
    ...data.outingParticipants.filter((participant) => participant.eventId !== eventId),
    ...nextForOuting,
  ] };
}

export function respondToOutingInvitation(
  data: NeighborWalkData,
  participantId: string,
  volunteerId: string,
  response: OutingResponse,
): NeighborWalkData {
  const participant = data.outingParticipants.find((item) => item.id === participantId);
  if (!participant || participant.volunteerId !== volunteerId) throw new Error("This walk invitation is not assigned to you.");
  openOuting(data, participant.eventId);
  if (participant.status === "checked_in") throw new Error("A leader has already checked you in for this walk.");
  if (participant.status === response) return data;
  return { ...data, outingParticipants: data.outingParticipants.map((item) => item.id === participantId ? { ...item, status: response } : item) };
}

export function outingParticipant(data: NeighborWalkData, eventId: string, volunteerId: string) {
  return data.outingParticipants.find((participant) => participant.eventId === eventId && participant.volunteerId === volunteerId);
}
