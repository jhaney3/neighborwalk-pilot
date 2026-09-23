import { calendarDate } from "./calendar";
import { conversationContextLabels, type NeighborWalkData, type Visit } from "./domain";
import { reviewedEncounter } from "./encounter-history";

export type ConversationEntry = {
  visit: Visit;
  personName?: string;
  volunteerName?: string;
  /** Plain place: the typed place name, or the kind of gathering. */
  where: string;
  day: string;
};

/** Conversations logged away from a door, newest first, excluding ones corrected as entered in error. */
export function communityConversations(data: NeighborWalkData, options: { eventId?: string; volunteerId?: string; limit?: number } = {}): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  for (const original of data.visits) {
    const visit = reviewedEncounter(original);
    if (visit.voided || visit.context === "door") continue;
    if (options.eventId && visit.eventId !== options.eventId) continue;
    if (options.volunteerId && visit.volunteerId !== options.volunteerId) continue;
    entries.push({
      visit: original,
      personName: data.residents.find((person) => person.id === visit.residentId)?.name || undefined,
      volunteerName: data.volunteers.find((volunteer) => volunteer.id === visit.volunteerId)?.name,
      where: original.placeLabel ?? conversationContextLabels[visit.context],
      day: calendarDate(visit.recordedAt, data.church.timezone),
    });
  }
  entries.sort((a, b) => b.visit.recordedAt.localeCompare(a.visit.recordedAt));
  return options.limit ? entries.slice(0, options.limit) : entries;
}

/** Group entries by church-local day, keeping newest days first. */
export function conversationsByDay(entries: ConversationEntry[]) {
  const days = new Map<string, ConversationEntry[]>();
  for (const entry of entries) days.set(entry.day, [...(days.get(entry.day) ?? []), entry]);
  return [...days.entries()];
}
