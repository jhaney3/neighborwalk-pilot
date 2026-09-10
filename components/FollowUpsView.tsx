"use client";

import { CalendarClock, Check, ClipboardCheck, MapPin, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { calendarDate, calendarDaysFromNow, formatCalendarDate } from "../lib/calendar";
import { dateInputValue, type FollowUp, type FollowUpCompletionInput, type NeighborWalkData } from "../lib/domain";
import { useAsyncAction } from "../lib/use-async-action";
import { taskMatchesScope, type FollowUpScope } from "../lib/follow-up-filters";
import { contactRestricted } from "../lib/contact-restrictions";
import { EmptyState, Modal, ViewHeading } from "./ui";

type Props = {
  data: NeighborWalkData; canManage: boolean; activeVolunteerId: string;
  initialPersonId?: string | null; onClearPersonFocus: () => void;
  focusedTaskId?: string; initialScope?: FollowUpScope;
  onOpenTask?: (id: string) => void;
  onOpenProperty: (id: string) => void; onOpenPerson: (id: string) => void;
  onAddPersonNote: (id: string, kind: "general", body: string) => Promise<unknown>;
  onComplete: (id: string, input: FollowUpCompletionInput) => Promise<unknown>;
  onReschedule: (id: string, date: string, note?: string) => Promise<unknown>;
  onCancel: (id: string, note?: string) => Promise<unknown>;
  onAssign?: (id: string, volunteerId: string) => Promise<unknown>;
  onAccept?: (id: string, acceptance: "accepted" | "declined") => Promise<unknown>;
};
type Filter = "open" | "overdue" | "today" | "upcoming" | "completed" | "cancelled";

export function FollowUpsView(props: Props) {
  const { data, canManage, activeVolunteerId, initialPersonId, onClearPersonFocus } = props;
  const [filter, setFilter] = useState<Filter>("open");
  const [owner, setOwner] = useState<FollowUpScope>(props.initialScope ?? "mine");
  const [query, setQuery] = useState("");
  const today = calendarDate(new Date(), data.church.timezone);
  const people = useMemo(() => new Map(data.residents.map((p) => [p.id, p])), [data.residents]);
  const locations = useMemo(() => new Map(data.properties.map((p) => [p.id, p])), [data.properties]);
  const tasks = data.followUps.filter((task) => {
    if (props.focusedTaskId) return task.id === props.focusedTaskId;
    if (initialPersonId && task.residentId !== initialPersonId) return false;
    if (!initialPersonId && !taskMatchesScope(task, owner, data, activeVolunteerId)) return false;
    const date = calendarDate(task.dueAt, data.church.timezone);
    if (["completed", "cancelled"].includes(filter)) { if (task.status !== filter) return false; }
    else {
      if (task.status !== "scheduled") return false;
      if (filter === "overdue" && date >= today) return false;
      if (filter === "today" && date !== today) return false;
      if (filter === "upcoming" && date <= today) return false;
    }
    return [people.get(task.residentId ?? "")?.name, locations.get(task.propertyId ?? "")?.address, task.note]
      .join(" ").toLowerCase().includes(query.trim().toLowerCase());
  }).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const unassigned = data.followUps.filter((t) => t.status === "scheduled" && taskMatchesScope(t, "unowned", data, activeVolunteerId)).length;
  return <section className="content-view followups-view">
    <ViewHeading eyebrow="Personal follow-through" title="Follow-ups" description={"A clear next step, a responsible person, and a date. Dates use " + data.church.timezone + "."} />
    {props.focusedTaskId && <p className="inline-notice">{tasks.length ? "This is the task from your link." : "This task is archived, unavailable to your account, or not yet downloaded."} <button onClick={onClearPersonFocus}>Open my task list</button></p>}
    {initialPersonId && <div className="followup-person-focus"><UserRound size={18} /> Tasks for {people.get(initialPersonId)?.name ?? "this person"}<button onClick={onClearPersonFocus}>Show all</button></div>}
    {!props.focusedTaskId && canManage && unassigned > 0 && <p className="inline-notice">{unassigned} open tasks have no active owner. <button onClick={() => { setOwner("unowned"); setFilter("open"); }}>Review unowned</button></p>}
    {!props.focusedTaskId && <div className="list-toolbar">
      <label>Responsibility<select value={owner} onChange={(e) => setOwner(e.target.value as FollowUpScope)} disabled={Boolean(initialPersonId)}><option value="mine">My tasks</option><option value="team">My group tasks</option><option value="all">All I can access</option>{canManage && <><option value="unowned">Unowned or inactive owner</option><option value="declined">Declined assignments</option></>}</select></label>
      <label>Status<select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>{(["open", "overdue", "today", "upcoming", "completed", "cancelled"] as const).map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
      <label>Search<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Person, address, or next step" /></label>
    </div>}
    {tasks.length ? <div className="followup-list">{tasks.map((task) => <TaskCard key={task.id} task={task} {...props} />)}</div>
      : <EmptyState icon={<ClipboardCheck size={26} />} title="Nothing waiting in this view" copy="Try another filter. Plan a next step from a person’s profile or record a requested return visit during outreach." />}
  </section>;
}

function TaskCard({ task, ...props }: Props & { task: FollowUp }) {
  const { data, canManage, activeVolunteerId, onOpenPerson, onOpenProperty, onAssign, onAccept } = props;
  const [editing, setEditing] = useState<"complete" | "reschedule" | "cancel" | null>(null);
  const action = useAsyncAction();
  const person = data.residents.find((p) => p.id === task.residentId);
  const location = data.properties.find((p) => p.id === task.propertyId);
  const owner = data.volunteers.find((v) => v.id === task.assignedVolunteerId);
  const ownTask = task.assignedVolunteerId === activeVolunteerId;
  const canEdit = canManage || ownTask;
  const restricted = contactRestricted(data, task.residentId, task.channel ?? "visit", task.propertyId);
  const open = task.status === "scheduled" && !restricted;
  const date = calendarDate(task.dueAt, data.church.timezone);
  const overdue = open && date < calendarDate(new Date(), data.church.timezone);
  return <article className={"followup-card" + (overdue ? " overdue" : "")}>
    <div className="followup-main">
      <div className="followup-heading"><h2>{person?.name || location?.address || "Personal next step"}</h2><span className="status-badge">{task.status}</span></div>
      <p>{task.note || "Return visit requested"}</p>
      {task.status === "scheduled" && restricted && <p role="status" className="inline-notice">Do not act on this task. A recorded restriction applies; the server will cancel prohibited next steps when this device shares the change.</p>}
      <p className="task-meta"><CalendarClock size={16} /> {overdue ? "Overdue · " : ""}{formatCalendarDate(date)} · {task.channel ?? "visit"}</p>
      <p className="task-meta"><UserRound size={16} /> {owner?.name ?? "Needs an owner"}{task.acceptance === "pending" ? " · Awaiting acceptance" : task.acceptance === "declined" ? " · Assignment declined" : ""}</p>
      {task.completionNote && <p><strong>Completed:</strong> {task.completionNote}</p>}
      <div className="care-next-actions">
        {props.onOpenTask && !props.focusedTaskId && <button className="button quiet small" onClick={() => props.onOpenTask!(task.id)}>Open task</button>}
        {person && <button className="button quiet small" onClick={() => onOpenPerson(person.id)}><UserRound size={16} /> Person &amp; notes</button>}
        {location && <button className="button quiet small" onClick={() => onOpenProperty(location.id)}><MapPin size={16} /> Location</button>}
        {open && ownTask && task.acceptance !== "accepted" && onAccept && <button className="button primary small" disabled={action.busy} onClick={() => void action.run(() => onAccept(task.id, "accepted"))}>Accept responsibility</button>}
        {open && ownTask && task.acceptance === "pending" && onAccept && <button className="button quiet small" disabled={action.busy} onClick={() => void action.run(() => onAccept(task.id, "declined"))}>Decline</button>}
        {open && canEdit && task.acceptance === "accepted" && <><button className="button primary small" disabled={action.busy} onClick={() => setEditing("complete")}><Check size={16} /> Complete</button><button className="button quiet small" disabled={action.busy} onClick={() => setEditing("reschedule")}>Reschedule</button></>}
        {open && canEdit && <button className="button quiet small" disabled={action.busy} onClick={() => setEditing("cancel")}>Cancel task</button>}
      </div>
      {open && canManage && onAssign && <label>Responsible person<select value={task.assignedVolunteerId ?? ""} disabled={action.busy} onChange={(e) => { const id = e.target.value; if (id) void action.run(() => onAssign(task.id, id)); }}><option value="" disabled>Choose an owner</option>{data.volunteers.filter((v) => v.active).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select><small>For a person-linked task, share the person’s profile or arrange a care handoff first.</small></label>}
      {action.error && <p className="inline-error" role="alert">{action.error}</p>}
      <details><summary>Task history ({task.history.length})</summary><ol className="task-history">{task.history.map((entry) => <li key={entry.id}><strong>{entry.action}</strong> · {data.volunteers.find((v) => v.id === entry.actorId)?.name ?? "Previous member"} · {new Intl.DateTimeFormat("en-US", { timeZone: data.church.timezone, dateStyle: "medium" }).format(new Date(entry.createdAt))}{entry.note && <p>{entry.note}</p>}</li>)}</ol></details>
    </div>
    {editing && <TaskEditor task={task} mode={editing} {...props} onClose={() => setEditing(null)} />}
  </article>;
}

function TaskEditor({ task, mode, data, onComplete, onReschedule, onCancel, onClose }: Props & { task: FollowUp; mode: "complete" | "reschedule" | "cancel"; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [date, setDate] = useState(dateInputValue(task.dueAt));
  const [another, setAnother] = useState(false);
  const [nextNote, setNextNote] = useState("");
  const [nextDate, setNextDate] = useState(calendarDaysFromNow(data.church.defaultFollowUpDays, data.church.timezone));
  const action = useAsyncAction();
  return <Modal title={mode === "complete" ? "Complete this next step" : mode === "reschedule" ? "Reschedule follow-up" : "Cancel follow-up"} description="Keep notes brief, factual, and useful for the person responsible. Your form stays open if saving fails." onClose={action.busy ? () => undefined : onClose}>
    <form className="form-stack" onSubmit={(e) => {
      e.preventDefault();
      void action.run(() => mode === "complete" ? onComplete(task.id, { completionNote: note.trim() || undefined,
        nextFollowUp: another ? { dueAt: nextDate, note: nextNote.trim(), assignedTeamId: task.assignedTeamId } : undefined })
        : mode === "reschedule" ? onReschedule(task.id, date, note.trim() || undefined) : onCancel(task.id, note.trim() || undefined), onClose);
    }}>
      {mode === "reschedule" && <label>New date<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>}
      <label>{mode === "complete" ? "What happened? (optional)" : mode === "cancel" ? "Reason for cancelling" : "Reason (optional)"}<textarea required={mode === "cancel"} value={note} maxLength={data.church.noteCharacterLimit} onChange={(e) => setNote(e.target.value)} rows={3} /></label>
      {mode === "complete" && <><label className="checkbox-label"><input type="checkbox" checked={another} onChange={(e) => setAnother(e.target.checked)} /> Plan another next step</label>{another && <><label>Next step<input required value={nextNote} maxLength={data.church.noteCharacterLimit} onChange={(e) => setNextNote(e.target.value)} /></label><label>Next date<input type="date" required value={nextDate} onChange={(e) => setNextDate(e.target.value)} /></label></>}</>}
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}
      <div className="modal-actions"><button type="button" className="button quiet" disabled={action.busy} onClick={onClose}>Keep editing later</button><button className="button primary" disabled={action.busy}>{action.busy ? "Saving to device…" : mode === "complete" ? "Complete follow-up" : "Save change"}</button></div>
    </form>
  </Modal>;
}
