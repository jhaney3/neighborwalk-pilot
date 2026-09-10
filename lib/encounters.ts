import { createId, dueDateFromNow, type NeighborWalkData, type Outcome } from "./domain";
import { calendarDate, requireCalendarDate } from "./calendar";
import { changeFollowUp, createFollowUp } from "./follow-ups";

export type EncounterInput = {
  propertyId?: string;
  eventId?: string;
  context?: NonNullable<NeighborWalkData["visits"][number]["context"]>;
  outcome: Exclude<Outcome, "unvisited">;
  objectiveNote?: string;
  followUpDate?: string;
  assignedTeamId?: string;
  residentId?: string;
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
  const note = input.objectiveNote?.trim() || undefined;
  if (note && note.length > current.church.noteCharacterLimit) throw new Error("Shorten the note to the church’s character limit.");
  if (input.outcome === "follow_up" && !person && !property && !note) throw new Error("Add a useful next-step description or select a person. Do not include private care details in an anonymous shared encounter.");
  const due = input.followUpDate ? requireCalendarDate(input.followUpDate) : dueDateFromNow(current.church.defaultFollowUpDays, current.church.timezone);
  if (input.outcome === "follow_up" && due < calendarDate(now, current.church.timezone)) throw new Error("Choose today or a future date in the church’s timezone.");
  const timestamp = now.toISOString();
  const visitId = createId("visit");
  const visit: NeighborWalkData["visits"][number] = { id: visitId, churchId: current.church.id, eventId: input.eventId, territoryId: property?.territoryId,
    propertyId: property?.id, residentId: person?.id, context, volunteerId: actorId, outcome: input.outcome,
    objectiveNote: person ? undefined : note, recordedAt: timestamp, deviceId };
  let tasks = current.followUps;
  if (input.outcome === "follow_up") tasks = [...tasks, createFollowUp({ id: createId("followup"), churchId: current.church.id,
    propertyId: person?.propertyId ?? property?.id, residentId: person?.id, sourceVisitId: visitId, eventId: input.eventId, assignedTeamId: input.assignedTeamId,
    assignedVolunteerId: person?.assignedVolunteerId ?? actorId, dueAt: due, note,
    channel: property ? "visit" : person?.preferredContact === "none" || !person ? "other" : person.preferredContact,
  }, actorId, timestamp)];
  if (input.outcome === "do_not_visit") tasks = tasks.map((t) => t.propertyId === property?.id && t.status === "scheduled"
    ? changeFollowUp(t, { action: "cancelled", note: "Location marked do not revisit." }, actorId, timestamp) : t);
  const notes = person && note && input.outcome !== "follow_up" ? [{ id: createId("person_note"), churchId: current.church.id,
    residentId: person.id, authorId: actorId, kind: "conversation" as const, body: note, createdAt: timestamp }, ...current.personNotes] : current.personNotes;
  return { ...current, visits: [visit, ...current.visits], personNotes: notes, followUps: tasks,
    properties: current.properties.map((p) => p.id === property?.id ? { ...p, currentOutcome: p.currentOutcome === "do_not_visit" ? "do_not_visit" : input.outcome,
      lastVisitedAt: timestamp, visitCount: p.visitCount + 1, updatedAt: timestamp } : p) };
}
