import type { NeighborWalkData, OutreachEvent } from "./domain";

type Participant = NeighborWalkData["outingParticipants"][number];

export type WalkPhase = "plan" | "invite" | "checkin" | "walk" | "wrap";

export const walkPhases: { key: WalkPhase; label: string }[] = [
  { key: "plan", label: "Plan" },
  { key: "invite", label: "Invite" },
  { key: "checkin", label: "Check in" },
  { key: "walk", label: "Walk" },
  { key: "wrap", label: "Wrap up" },
];

/** Where a walk stands, for the phase rail on its page. Cancelled walks have no phase. */
export function walkPhase(outing: Pick<OutreachEvent, "id" | "status">, participants: readonly Participant[]): WalkPhase | null {
  if (outing.status === "cancelled") return null;
  if (outing.status === "draft" || outing.status === "scheduled") return "plan";
  if (outing.status === "ready") return participants.some((participant) => participant.eventId === outing.id && participant.status === "checked_in") ? "checkin" : "invite";
  if (outing.status === "active") return "walk";
  return "wrap";
}

export function rsvpCounts(participants: readonly Participant[], eventId: string) {
  const mine = participants.filter((participant) => participant.eventId === eventId);
  const count = (status: Participant["status"]) => mine.filter((participant) => participant.status === status).length;
  return { invited: mine.length, going: count("going") + count("checked_in"), here: count("checked_in"), notGoing: count("not_going"), noReply: count("invited") };
}

/** A gathering walk (meal, service day) has no routes: no assignments and no targets. */
export function isCommunityOuting(eventId: string, assignments: readonly { eventId: string; status?: string }[], targets: readonly { eventId: string }[]) {
  return !assignments.some((assignment) => assignment.eventId === eventId)
    && !targets.some((target) => target.eventId === eventId);
}
