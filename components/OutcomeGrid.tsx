"use client";

import { formatCalendarDate, calendarDate } from "../lib/calendar";
import { outcomeMeta, type Outcome } from "../lib/domain";

export type Recordable = Exclude<Outcome, "unvisited">;

/** Outcome first, details after: No answer and Not now save in one tap; Talked
 * and Come back save too, then ask "Anything to add?". */
export const gridOutcomes: { value: Recordable; label: string; hint: string; details: boolean }[] = [
  { value: "conversation", label: "Talked", hint: "Add details next", details: true },
  { value: "no_answer", label: "No answer", hint: "Saves now", details: false },
  { value: "follow_up", label: "Come back", hint: "Follow-up", details: true },
  { value: "declined", label: "Not now", hint: "Not interested", details: false },
];

/** The words walkers use for each outcome in lists and history. */
export const outcomeWord: Record<Recordable, string> = {
  conversation: "Talked", no_answer: "No answer", follow_up: "Come back", declined: "Not now", do_not_visit: "Don’t knock", inaccessible: "Couldn’t reach",
};

export function OutcomeGrid({ onChoose, disabled = false, label = "What happened?" }: { onChoose: (option: (typeof gridOutcomes)[number]) => void; disabled?: boolean; label?: string }) {
  return <div className="walk-outcomes" role="group" aria-label={label}>
    {gridOutcomes.map((option) => <button key={option.value} type="button" className={`walk-outcome${option.value === "conversation" ? " primary" : ""}`} data-outcome={option.value} disabled={disabled} onClick={() => onChoose(option)}>
      <span className="walk-outcome-label">{option.value !== "conversation" && <i style={{ background: outcomeMeta[option.value].color }} aria-hidden="true" />}{option.label}</span>
      <span className="mono-meta">{option.hint}</span>
    </button>)}
  </div>;
}

export type HistoryEntry = { id: string; at: string; color?: string; icon?: React.ReactNode; title: string; detail?: string; onOpen?: () => void };

/** History everywhere: date over time in mono on the left, the entry on the
 * right with its outcome dot. `time` shows only the time, for tonight's lists. */
export function HistoryList({ entries, timezone, stamp = "date", label }: { entries: HistoryEntry[]; timezone: string; stamp?: "date" | "time"; label?: string }) {
  const time = (iso: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(iso));
  return <ol className="history-list" aria-label={label}>
    {entries.map((entry) => {
      const body = <>
        <time className="mono-meta" dateTime={entry.at}>{stamp === "date" ? <>{formatCalendarDate(calendarDate(entry.at, timezone), { month: "short", day: "numeric" })}<br />{time(entry.at)}</> : time(entry.at)}</time>
        <span className="history-entry">
          <span className="history-title">{entry.icon ? <span className="history-icon" aria-hidden="true">{entry.icon}</span> : entry.color && <i style={{ background: entry.color }} aria-hidden="true" />}{entry.title}</span>
          {entry.detail && <span className="history-detail">{entry.detail}</span>}
        </span>
      </>;
      return <li key={entry.id} className={entry.onOpen ? "opens" : undefined}>{entry.onOpen ? <button type="button" onClick={entry.onOpen}>{body}</button> : body}</li>;
    })}
  </ol>;
}
