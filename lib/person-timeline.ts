import { outcomeMeta, personNoteKindLabels, type NeighborWalkData } from "./domain";
import { formatCalendarDate, calendarDate } from "./calendar";
import { recordFamilyIds } from "./record-aliases";
import { reviewedEncounter } from "./encounter-history";
export type PersonTimelineEntry = { id: string; at: string; title: string; body?: string; actorId?: string; noteId?: string };
/** Only joins records already allowed by RLS. Never joins household encounters
 * by address: a different person's conversation can share the same doorstep. */
export function personTimeline(data: NeighborWalkData, personId: string): PersonTimelineEntry[] {
  const family = recordFamilyIds(data.residents, personId);
  if (!family.size) return [];
  const notes = data.personNotes.filter((n) => family.has(n.residentId)).map((n) => ({ id: "note:" + n.id, noteId: n.id, at: n.createdAt, title: personNoteKindLabels[n.kind], body: n.body, actorId: n.authorId }));
  const encounters = data.visits.filter((v) => Boolean(v.residentId && family.has(v.residentId))).flatMap((v) => {
    const current = reviewedEncounter(v);
    return [{ id: "encounter:" + v.id, at: v.recordedAt,
      title: (current.voided ? "Entered in error · " : "") + outcomeMeta[current.outcome].label + " · " + current.context.replaceAll("_", " "),
      body: [v.objectiveNote, v.corrections?.length ? "Original: " + outcomeMeta[v.outcome].label + " · " + (v.context ?? "door").replaceAll("_", " ") + ". Original links, notes and date retained." : undefined].filter(Boolean).join("\n") || undefined, actorId: v.volunteerId },
      ...(v.corrections ?? []).map((correction) => ({ id: "encounter-correction:" + v.id + ":" + correction.id, at: correction.createdAt,
        title: "Encounter reviewed · " + (correction.voided ? "entered in error" : outcomeMeta[correction.outcome].label + " · " + correction.context.replaceAll("_", " ")),
        body: correction.reason + " Tasks and restrictions unchanged.", actorId: correction.actorId }))];
  });
  const tasks = data.followUps.filter((t) => Boolean(t.residentId && family.has(t.residentId))).flatMap((t) => t.history.map((h) => ({ id: "task:" + t.id + ":" + h.id, at: h.createdAt,
    title: "Next step " + h.action + (h.dueAt ? " · " + formatCalendarDate(calendarDate(h.dueAt, data.church.timezone)) : ""), body: h.note, actorId: h.actorId })));
  const restrictions = (data.restrictions ?? []).filter((r) => Boolean(r.residentId && family.has(r.residentId))).flatMap((r): PersonTimelineEntry[] => [
    { id: "restriction:" + r.id, at: r.createdAt, title: "Restriction recorded · " + r.channel, body: r.reason },
    ...(r.correctedAt ? [{ id: "correction:" + r.id, at: r.correctedAt, title: "Restriction lifted after review · " + r.channel, body: r.correctionReason }] : []),
  ]);
  const changes = data.audit.filter((a) => family.has(a.entityId) && ["handoff", "resident"].includes(a.entityType)).map((a) => ({ id: "change:" + a.id, at: a.createdAt,
    title: a.entityType === "handoff" ? a.action.replace("handoff.", "Care handoff · ") : a.action === "resident.location_changed" ? "Location changed after review" : a.action === "resident.duplicates_combined" ? "Duplicate profiles combined after review" : "Profile updated",
    body: ["resident.location_changed", "resident.duplicates_combined"].includes(a.action) && typeof a.details?.reason === "string" ? a.details.reason : undefined, actorId: a.actorId }));
  return [...notes, ...encounters, ...tasks, ...restrictions, ...changes].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}
