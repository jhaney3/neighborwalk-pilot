"use client";
import { calendarDate, formatCalendarDate } from "../lib/calendar";
import { communityConversations, conversationsByDay, type ConversationEntry } from "../lib/conversations";
import { conversationNeedLabels, outcomeMeta, type NeighborWalkData } from "../lib/domain";
import { reviewedEncounter } from "../lib/encounter-history";
import { Badge, ListGroup, ListRow } from "./ui";

function dayLabel(day: string, today: string) {
  if (day === today) return "Today";
  return formatCalendarDate(day, { weekday: "long", month: "short", day: "numeric" });
}

export function ConversationRow({ entry, onOpenPerson }: { entry: ConversationEntry; onOpenPerson?: (personId: string) => void }) {
  const visit = reviewedEncounter(entry.visit);
  const personId = entry.visit.residentId;
  const subtitle = <>
    {[entry.where, entry.volunteerName ? `with ${entry.volunteerName}` : undefined].filter(Boolean).join(", ")}
    {entry.visit.objectiveNote && <span className="conversation-note">{entry.visit.objectiveNote}</span>}
    {entry.visit.needs?.length ? <span className="conversation-needs">{entry.visit.needs.map((need) => <Badge key={need} tone="accent">{conversationNeedLabels[need]}</Badge>)}</span> : null}
  </>;
  const title = entry.personName ?? "Someone";
  const value = visit.outcome === "follow_up" ? <Badge tone="tint">Follow-up</Badge> : visit.outcome === "declined" ? <Badge>{outcomeMeta.declined.label}</Badge> : undefined;
  return personId && onOpenPerson
    ? <ListRow title={title} subtitle={subtitle} value={value} onClick={() => onOpenPerson(personId)} />
    : <ListRow title={title} subtitle={subtitle} value={value} />;
}

/** Every conversation logged away from a door, grouped by day. */
export function ConversationFeed({ data, volunteerId, onOpenPerson }: { data: NeighborWalkData; volunteerId?: string; onOpenPerson?: (personId: string) => void }) {
  const today = calendarDate(new Date(), data.church.timezone);
  const days = conversationsByDay(communityConversations(data, { volunteerId }));
  if (!days.length) return <ListGroup>
    <ListRow title="No conversations yet" subtitle="Tap + to log one from a meal, a service day or anywhere else." />
  </ListGroup>;
  return <div className="conversation-feed">
    {days.map(([day, entries]) => <ListGroup key={day} className="conversation-feed-day" label={dayLabel(day, today)}>
      {entries.map((entry) => <ConversationRow key={entry.visit.id} entry={entry} onOpenPerson={onOpenPerson} />)}
    </ListGroup>)}
  </div>;
}
