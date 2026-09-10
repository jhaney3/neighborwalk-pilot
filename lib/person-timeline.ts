import { outcomeMeta, personNoteKindLabels, type NeighborWalkData } from "./domain";
import { formatCalendarDate, calendarDate } from "./calendar";
export type PersonTimelineEntry = { id: string; at: string; title: string; body?: string; actorId?: string; noteId?: string };
/** Only joins records already allowed by RLS. Never joins household encounters
 * by address: a different person's conversation can share the same doorstep. */
export function personTimeline(data: NeighborWalkData, personId: string): PersonTimelineEntry[] {
  if (!data.residents.some((p) => p.id === personId)) return [];
  const notes = data.personNotes.filter((n) => n.residentId === personId).map((n) => ({ id: "note:" + n.id, noteId: n.id, at: n.createdAt, title: personNoteKindLabels[n.kind], body: n.body, actorId: n.authorId }));
  const encounters = data.visits.filter((v) => v.residentId === personId).map((v) => ({ id: "encounter:" + v.id, at: v.recordedAt,
    title: outcomeMeta[v.outcome].label + " · " + (v.context ?? "door").replaceAll("_", " "), body: v.objectiveNote, actorId: v.volunteerId }));
  const tasks = data.followUps.filter((t) => t.residentId === personId).flatMap((t) => t.history.map((h) => ({ id: "task:" + t.id + ":" + h.id, at: h.createdAt,
    title: "Next step " + h.action + (h.dueAt ? " · " + formatCalendarDate(calendarDate(h.dueAt, data.church.timezone)) : ""), body: h.note, actorId: h.actorId })));
  const restrictions = (data.restrictions ?? []).filter((r) => r.residentId === personId).flatMap((r): PersonTimelineEntry[] => [
    { id: "restriction:" + r.id, at: r.createdAt, title: "Restriction recorded · " + r.channel, body: r.reason },
    ...(r.correctedAt ? [{ id: "correction:" + r.id, at: r.correctedAt, title: "Restriction lifted after review · " + r.channel, body: r.correctionReason }] : []),
  ]);
  const changes = data.audit.filter((a) => a.entityId === personId && ["handoff", "resident"].includes(a.entityType)).map((a) => ({ id: "change:" + a.id, at: a.createdAt,
    title: a.entityType === "handoff" ? a.action.replace("handoff.", "Care handoff · ") : a.action === "resident.location_changed" ? "Location changed after review" : "Profile updated",
    body: a.action === "resident.location_changed" && typeof a.details?.reason === "string" ? a.details.reason : undefined, actorId: a.actorId }));
  return [...notes, ...encounters, ...tasks, ...restrictions, ...changes].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}
