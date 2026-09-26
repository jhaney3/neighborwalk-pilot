import { calendarDate, calendarDaysFromNow, formatCalendarDate } from "./calendar";
import type { FollowUp, FollowUpCompletionInput, NeighborWalkData } from "./domain";
import { activeFollowUpOwner } from "./follow-up-filters";

const DAY = 86_400_000;

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY);
}

/** A short due label for mono chips: Today, Yesterday, Tomorrow, a weekday
 * within the week, otherwise a month and day. */
export function relativeDueLabel(dueDate: string, today: string) {
  const days = daysBetween(today, dueDate);
  if (days === 0) return "Today";
  if (days === -1) return "Yesterday";
  if (days === 1) return "Tomorrow";
  if (Math.abs(days) < 7) return formatCalendarDate(dueDate, { weekday: "short" });
  return formatCalendarDate(dueDate, { month: "short", day: "numeric" });
}

export type WhenGroupKey = "overdue" | "today" | "week" | "later";
export type WhenGroup = { key: WhenGroupKey; label: string; tasks: FollowUp[] };

/** Follow-ups grouped by when they are due, never by status or person. */
export function groupFollowUpsByWhen(tasks: readonly FollowUp[], timezone: string, today: string): WhenGroup[] {
  const groups: Record<WhenGroupKey, FollowUp[]> = { overdue: [], today: [], week: [], later: [] };
  for (const task of [...tasks].sort((a, b) => a.dueAt.localeCompare(b.dueAt))) {
    const days = daysBetween(today, calendarDate(task.dueAt, timezone));
    groups[days < 0 ? "overdue" : days === 0 ? "today" : days < 7 ? "week" : "later"].push(task);
  }
  const labels: Record<WhenGroupKey, string> = { overdue: "Overdue", today: "Today", week: "This week", later: "Later" };
  return (Object.keys(groups) as WhenGroupKey[]).filter((key) => groups[key].length).map((key) => ({ key, label: labels[key], tasks: groups[key] }));
}

export type FollowUpList = "mine" | "all" | "open";

/** Mine is yours; All is everything you can see; Open is the leaders' queue of
 * follow-ups without an active owner or declined by their owner. */
export function followUpInList(task: FollowUp, list: FollowUpList, data: NeighborWalkData, actorId: string) {
  if (list === "mine") return task.assignedVolunteerId === actorId && task.acceptance !== "declined";
  if (list === "open") return !activeFollowUpOwner(task, data) || task.acceptance === "declined";
  return true;
}

export type SnoozeChoice = { label: string; date: string };

/** Snooze options: tomorrow, the day of your next walk, and next week. */
export function snoozeChoices(data: NeighborWalkData, actorId: string, now = new Date()): SnoozeChoice[] {
  const timezone = data.church.timezone;
  const today = calendarDate(now, timezone);
  const invited = new Set(data.outingParticipants.filter((participant) => participant.volunteerId === actorId && participant.status !== "not_going").map((participant) => participant.eventId));
  const nextWalk = data.events
    .filter((event) => ["scheduled", "ready"].includes(event.status) && invited.has(event.id))
    .map((event) => calendarDate(event.startsAt, event.timezone ?? timezone))
    .filter((date) => date > today)
    .sort()[0];
  const choices: SnoozeChoice[] = [{ label: "Tomorrow", date: calendarDaysFromNow(1, timezone, now) }];
  if (nextWalk && nextWalk !== choices[0].date) choices.push({ label: "Before the next walk", date: nextWalk });
  choices.push({ label: "Next week", date: calendarDaysFromNow(7, timezone, now) });
  return choices;
}

export type CheckInOutcome = "talked" | "message" | "unreached" | "all_set";

export const checkInOutcomes: { value: CheckInOutcome; label: string; nextByDefault: boolean }[] = [
  { value: "talked", label: "Talked with them", nextByDefault: false },
  { value: "message", label: "Left a message", nextByDefault: true },
  { value: "unreached", label: "Couldn’t reach them", nextByDefault: true },
  { value: "all_set", label: "All set, no more", nextByDefault: false },
];

/** A check-in closes this follow-up; a next step opens a linked one with the
 * same instruction, so the history reads as one thread. */
export function checkInCompletion(task: FollowUp, outcome: CheckInOutcome, nextDate: string | null, note?: string): FollowUpCompletionInput {
  const label = checkInOutcomes.find((item) => item.value === outcome)!.label;
  const completionNote = [label, note?.trim()].filter(Boolean).join(" — ");
  return {
    completionNote,
    nextFollowUp: nextDate && outcome !== "all_set" ? { dueAt: nextDate, note: task.note || "Follow up again", assignedTeamId: task.assignedTeamId } : undefined,
  };
}
