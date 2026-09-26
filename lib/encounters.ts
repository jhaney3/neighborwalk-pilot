import { conversationNeedValues, createId, dueDateFromNow, type ConversationNeed, type NeighborWalkData, type Outcome } from "./domain";
import { calendarDate, requireCalendarDate } from "./calendar";
import { changeFollowUp, createFollowUp } from "./follow-ups";
import { propertyInTarget } from "./target-coverage";

export type EncounterInput = {
  propertyId?: string;
  eventId?: string;
  targetId?: string;
  context?: NonNullable<NeighborWalkData["visits"][number]["context"]>;
  outcome: Exclude<Outcome, "unvisited">;
  objectiveNote?: string;
  followUpDate?: string;
  assignedTeamId?: string;
  residentId?: string;
  /** Community details: where it happened and what was shared. */
  placeLabel?: string;
  needs?: ConversationNeed[];
  /** When it happened, if logged later. Defaults to now. */
  occurredAt?: string;
  /** Saved as a private prayer note on a linked person, or with the shared note when anonymous. */
  prayerRequest?: string;
  /** How and by whom a follow-up happens, when the logger chose them. */
  followUpChannel?: "visit" | "call" | "text" | "other";
  followUpOwnerId?: string;
};

/** Anonymous community encounters are real encounters, not fake households or
 * people. Person-linked notes remain in the permission-protected profile. */
export function recordEncounter(current: NeighborWalkData, input: EncounterInput, actorId: string, deviceId: string, now = new Date()): NeighborWalkData {
  const property = input.propertyId ? current.properties.find((p) => p.id === input.propertyId) : undefined;
  const person = input.residentId ? current.residents.find((p) => p.id === input.residentId) : undefined;
  const context = input.context ?? (property ? "door" : "other");
  if (input.propertyId && !property) throw new Error("This location is no longer available. Refresh before recording the encounter.");
  if (input.residentId && !person) throw new Error("This person is no longer available to your account.");
  if (person && property && person.propertyId !== property.id) throw new Error("The selected person is not linked to this location.");
  if (input.eventId && !current.events.some((e) => e.id === input.eventId)) throw new Error("Choose an available outing.");
  if (!property && (context === "door" || ["no_answer", "do_not_visit", "inaccessible"].includes(input.outcome))) throw new Error("A doorstep outcome needs a location. Use the person’s contact preferences for a no-contact request.");
  const prayer = input.prayerRequest?.trim() || undefined;
  const note = [input.objectiveNote?.trim(), !person && prayer ? `Prayer: ${prayer}` : undefined].filter(Boolean).join("\n") || undefined;
  if (note && note.length > current.church.noteCharacterLimit) throw new Error("Shorten the note to the church’s character limit.");
  if (prayer && prayer.length > current.church.noteCharacterLimit) throw new Error("Shorten the prayer request to the church’s character limit.");
  const placeLabel = input.placeLabel?.trim() || undefined;
  if (placeLabel && context === "door") throw new Error("A doorstep visit uses its home, not a place name.");
  if (placeLabel && placeLabel.length > 120) throw new Error("Shorten the place name to 120 characters.");
  const needs = [...new Set(input.needs ?? [])].sort();
  if (needs.some((need) => !(conversationNeedValues as readonly string[]).includes(need))) throw new Error("Choose needs from the list.");
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now;
  if (!Number.isFinite(occurredAt.getTime())) throw new Error("Choose when the conversation happened.");
  if (occurredAt.getTime() > now.getTime() + 60_000) throw new Error("Choose a time that has already happened.");
  if (input.outcome === "follow_up" && !person && !property && !note) throw new Error("Add a useful next-step description or select a person. Do not include private care details in an anonymous shared encounter.");
  const due = input.followUpDate ? requireCalendarDate(input.followUpDate) : dueDateFromNow(current.church.defaultFollowUpDays, current.church.timezone);
  if (input.outcome === "follow_up" && due < calendarDate(now, current.church.timezone)) throw new Error("Choose today or a future date in the church’s timezone.");
  const timestamp = now.toISOString();
  const visitId = createId("visit");
  const target = input.targetId ? current.walkTargets.find((candidate) => candidate.id === input.targetId) : undefined;
  if (input.targetId && (!target || target.eventId !== input.eventId || (property?.territoryId && target.territoryId !== property.territoryId))) throw new Error("Choose a target from this outing and parent zone.");
  if (target) {
    if (!property || !propertyInTarget(property, target)) throw new Error("Choose a residential property in this target’s reviewed roster.");
    const teams = new Set(current.teams.filter((team) => team.memberIds.includes(actorId)).map((team) => team.id));
    if (target.finishedAt || !(current.assignments ?? []).some((assignment) => assignment.targetId === target.id && assignment.eventId === target.eventId && assignment.status === "accepted"
      && (assignment.assignedVolunteerId === actorId || teams.has(assignment.assignedTeamId ?? "")))) throw new Error("Accept your target assignment before recording a visit.");
  }
  const visit: NeighborWalkData["visits"][number] = { id: visitId, churchId: current.church.id, eventId: input.eventId, territoryId: property?.territoryId ?? target?.territoryId, targetId: target?.id,
    targetParcel: target && property?.parcel ? { countyFips: property.parcel.countyFips, gislink: property.parcel.gislink } : undefined,
    propertyId: property?.id, residentId: person?.id, context, volunteerId: actorId, outcome: input.outcome,
    objectiveNote: person ? undefined : note, placeLabel, needs: needs.length ? needs : undefined, recordedAt: occurredAt.toISOString(), deviceId };
  let tasks = current.followUps;
  if (input.outcome === "follow_up") tasks = [...tasks, createFollowUp({ id: createId("followup"), churchId: current.church.id,
    propertyId: person?.propertyId ?? property?.id, residentId: person?.id, sourceVisitId: visitId, eventId: input.eventId, assignedTeamId: input.assignedTeamId,
    assignedVolunteerId: input.followUpOwnerId ?? person?.assignedVolunteerId ?? actorId, dueAt: due, note,
    channel: input.followUpChannel ?? (property ? "visit" : person?.preferredContact === "none" || !person ? "other" : person.preferredContact),
  }, actorId, timestamp)];
  if (input.outcome === "do_not_visit") tasks = tasks.map((t) => t.propertyId === property?.id && t.status === "scheduled"
    ? changeFollowUp(t, { action: "cancelled", note: "Location marked do not revisit." }, actorId, timestamp) : t);
  const conversationNote = person && note && input.outcome !== "follow_up" ? [{ id: createId("person_note"), churchId: current.church.id,
    residentId: person.id, authorId: actorId, kind: "conversation" as const, body: note, createdAt: timestamp }] : [];
  const prayerNote = person && prayer ? [{ id: createId("person_note"), churchId: current.church.id,
    residentId: person.id, authorId: actorId, kind: "prayer" as const, body: prayer, createdAt: timestamp }] : [];
  const notes = [...prayerNote, ...conversationNote, ...current.personNotes];
  return { ...current, visits: [visit, ...current.visits], personNotes: notes, followUps: tasks,
    properties: current.properties.map((p) => p.id === property?.id ? { ...p, currentOutcome: p.currentOutcome === "do_not_visit" ? "do_not_visit" : input.outcome,
      lastVisitedAt: timestamp, visitCount: p.visitCount + 1, updatedAt: timestamp } : p) };
}
