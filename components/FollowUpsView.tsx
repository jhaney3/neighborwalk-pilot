"use client";

import { CalendarClock, Check, ChevronDown, ClipboardCheck, Mail, MapPin, MessageCircle, Phone, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { calendarDate, calendarDaysFromNow, formatCalendarDate } from "../lib/calendar";
import { dateInputValue, type FollowUp, type FollowUpCompletionInput, type NeighborWalkData } from "../lib/domain";
import { useAsyncAction } from "../lib/use-async-action";
import { activeFollowUpOwner, taskMatchesScope, type FollowUpScope } from "../lib/follow-up-filters";
import { contactRestricted } from "../lib/contact-restrictions";
import { indexCurrentRecords } from "../lib/record-aliases";
import { followUpContactCue, followUpDateBlock, groupFollowUpsByPerson, type FollowUpContactCue } from "../lib/people-follow-ups";
import { EmptyState, Modal, ViewHeading } from "./ui";

export type FollowUpsViewProps = {
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
  embedded?: boolean;
  profileMode?: boolean;
};
type Filter = "open" | "overdue" | "today" | "upcoming" | "completed" | "cancelled";

const scopeLabels: Record<FollowUpScope, string> = {
  mine: "My tasks",
  team: "My group tasks",
  all: "All accessible",
  unowned: "Unowned",
  declined: "Declined",
};

export function FollowUpsView(props: FollowUpsViewProps) {
  const { data, canManage, activeVolunteerId, initialPersonId, onClearPersonFocus } = props;
  const [filter, setFilter] = useState<Filter>("open");
  const [owner, setOwner] = useState<FollowUpScope>(props.initialScope ?? "mine");
  const [query, setQuery] = useState("");
  const today = calendarDate(new Date(), data.church.timezone);
  const people = useMemo(() => indexCurrentRecords(data.residents), [data.residents]);
  const locations = useMemo(() => indexCurrentRecords(data.properties), [data.properties]);
  const tasks = data.followUps.filter((task) => {
    if (props.focusedTaskId) return task.id === props.focusedTaskId;
    if (initialPersonId && (!people.has(initialPersonId) || people.get(task.residentId ?? "")?.id !== people.get(initialPersonId)?.id)) return false;
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
  const groups = groupFollowUpsByPerson(tasks, data);
  const filterLabel = filter[0].toUpperCase() + filter.slice(1);
  return <section className={`${props.embedded ? "followups-view followups-view-embedded" : "content-view followups-view"}${props.profileMode ? " followups-profile-mode" : ""}`}>
    {!props.embedded && <ViewHeading eyebrow="Personal follow-through" title="Follow-ups" description={"A clear next step, a responsible person, and a date. Dates use " + data.church.timezone + "."} />}
    {props.focusedTaskId && <p className="inline-notice">{tasks.length ? "This is the task from your link." : "This task is archived, unavailable to your account, or not yet downloaded."} <button onClick={onClearPersonFocus}>Open my task list</button></p>}
    {initialPersonId && !props.profileMode && <div className="followup-person-focus"><UserRound size={18} /> Tasks for {people.get(initialPersonId)?.name ?? "this person"}<button onClick={onClearPersonFocus}>Show all</button></div>}
    {!props.focusedTaskId && !initialPersonId && canManage && unassigned > 0 && <div className="inline-notice followup-unowned-notice"><span>{unassigned} open tasks have no active owner.</span><button className="button quiet small" onClick={() => { setOwner("unowned"); setFilter("open"); }}>Review unowned</button></div>}
    {!props.focusedTaskId && <div className="list-toolbar followup-toolbar">
      <label className="followup-search-field">Search<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Person, address, or next step" /></label>
      <details className="followup-filter-disclosure">
        <summary>Filters <span>{initialPersonId || props.profileMode ? filterLabel : `${scopeLabels[owner]} · ${filterLabel}`}</span></summary>
        <div className="followup-filter-fields">
          {!props.profileMode && <label>Responsibility<select value={owner} onChange={(e) => setOwner(e.target.value as FollowUpScope)} disabled={Boolean(initialPersonId)}><option value="mine">My tasks</option><option value="team">My group tasks</option><option value="all">All I can access</option>{canManage && <><option value="unowned">Unowned or inactive owner</option><option value="declined">Declined assignments</option></>}</select></label>}
          <label>Status<select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>{(["open", "overdue", "today", "upcoming", "completed", "cancelled"] as const).map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select></label>
        </div>
      </details>
    </div>}
    {groups.length ? <div className="followup-person-groups">{groups.map((group) => <section className="followup-person-group" key={group.key} aria-label={props.profileMode ? group.label : undefined} aria-labelledby={props.profileMode ? undefined : `followup-group-${group.key.replace(":", "-")}`}>
      <header className="followup-person-group-header" hidden={props.profileMode}>
        <span className="followup-person-avatar" aria-hidden="true">{group.person?.name ? group.person.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() : "?"}</span>
        <div><h2 id={`followup-group-${group.key.replace(":", "-")}`}>{group.label}</h2><p><MapPin size={13} /> {group.address ?? "Address not recorded"}</p></div>
        <span>{group.tasks.length} {group.tasks.length === 1 ? "task" : "tasks"}</span>
        {group.person && !props.profileMode && <button className="button quiet small" onClick={() => props.onOpenPerson(group.person!.id)}>View profile</button>}
      </header>
      <div className="followup-list">{group.tasks.map((task) => <TaskCard key={task.id} task={task} grouped {...props} />)}</div>
    </section>)}</div>
      : <EmptyState icon={<ClipboardCheck size={26} />} title="Nothing waiting in this view" copy="Try another filter. Plan a next step from a person’s profile or record a requested return visit during outreach." />}
  </section>;
}

export function TaskCard({ task, grouped = false, ...props }: FollowUpsViewProps & { task: FollowUp; grouped?: boolean }) {
  const { data, canManage, activeVolunteerId, onOpenPerson, onOpenProperty, onAssign, onAccept } = props;
  const [editing, setEditing] = useState<"complete" | "reschedule" | "cancel" | null>(null);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const action = useAsyncAction();
  const person = indexCurrentRecords(data.residents).get(task.residentId ?? "");
  const location = indexCurrentRecords(data.properties).get(task.propertyId ?? "");
  const owner = activeFollowUpOwner(task, data);
  const ownTask = owner?.id === activeVolunteerId;
  const canEdit = canManage || ownTask;
  const restricted = contactRestricted(data, task.residentId, task.channel ?? "visit", task.propertyId);
  const open = task.status === "scheduled" && !restricted;
  const dateBlock = followUpDateBlock(task.dueAt, data.church.timezone);
  const contactCue = followUpContactCue(task, person, location);
  const contactActionRestricted = contactRestricted(data, task.residentId, contactCue.kind, task.propertyId);
  const date = dateBlock.date;
  const overdue = open && date < calendarDate(new Date(), data.church.timezone);
  const today = calendarDate(new Date(), data.church.timezone);
  const statusLabel = task.status === "completed"
    ? "Completed"
    : task.status === "cancelled"
      ? "Cancelled"
      : overdue
        ? "Overdue"
        : date === today
          ? "Today"
          : "Scheduled";
  const acceptanceLabel = owner
    ? task.acceptance === "pending"
      ? "Awaiting acceptance"
      : task.acceptance === "declined"
        ? "Assignment declined"
        : task.acceptance === "accepted"
          ? "Accepted"
          : null
    : null;
  const assignmentHelpId = `task-${task.id}-assignment-help`;
  const moreActionsId = `task-${task.id}-more-actions`;
  const acceptedByActiveOwner = Boolean(owner && task.acceptance === "accepted");
  const canReschedule = open && canEdit && acceptedByActiveOwner;
  const needsOwnerAssignment = Boolean(open && canManage && onAssign && !owner);
  const hasOutcomeActions = Boolean(
    (ownTask && task.acceptance !== "accepted" && onAccept)
    || (ownTask && task.acceptance === "pending" && onAccept)
    || (canEdit && acceptedByActiveOwner),
  );
  const hasMoreActions = Boolean(
    (props.onOpenTask && !props.focusedTaskId)
    || (!grouped && person)
    || location
    || canReschedule
    || (open && canEdit)
    || (open && canManage && onAssign && owner),
  );
  return <article className={`followup-card ${task.status}${overdue ? " overdue" : ""}`}>
    <header className="followup-card-header">
      <div className="followup-date" aria-label={`${statusLabel}, ${formatCalendarDate(date)}`}>
        <span>{statusLabel}</span>
        <div><strong>{dateBlock.day}</strong><small>{dateBlock.month}</small></div>
        <em>{dateBlock.weekday}</em>
      </div>
      <div className={`followup-card-title${grouped ? " context-hidden" : ""}`}>
        <div className="followup-card-owner-row">
          <span className="followup-card-owner" aria-label={`Responsible person: ${owner?.name ?? "Needs an owner"}`}><UserRound size={17} /> {owner?.name ?? "Needs an owner"}</span>
          {acceptanceLabel && <small className={`assignment-state ${task.acceptance}`}>{acceptanceLabel}</small>}
        </div>
        {!grouped && <h2>{person?.name || location?.address || "Personal next step"}</h2>}
      </div>
      <FollowUpContactAction cue={contactCue} personName={person?.name} phone={person?.phone} email={person?.email} locationId={location?.id} restricted={contactActionRestricted} onOpenProperty={onOpenProperty} />
    </header>
    <div className="followup-card-body">
      <section className="followup-brief" aria-label="Follow-up brief">
        <span className="followup-section-label">Next step</span>
        <p>{task.note || "Return visit requested"}</p>
        {task.status === "scheduled" && restricted && <p role="status" className="inline-notice">Do not act on this task. A recorded restriction applies; the server will cancel prohibited next steps when this device shares the change.</p>}
        {task.completionNote && <p className="completion-note"><Check size={13} /> <span><strong>Completed:</strong> {task.completionNote}</span></p>}
        <details className="followup-history">
          <summary>Task history ({task.history.length})</summary>
          {[...task.history].reverse().map((entry) => <div key={entry.id}>
            <strong>{entry.action.replaceAll("_", " ")}</strong>
            <span>{entry.note || (entry.dueAt ? formatCalendarDate(calendarDate(entry.dueAt, data.church.timezone)) : "No note")}</span>
            <small>{new Intl.DateTimeFormat("en-US", { timeZone: data.church.timezone, dateStyle: "medium" }).format(new Date(entry.createdAt))}</small>
          </div>)}
        </details>
      </section>
    </div>
    {action.error && <p className="inline-error followup-card-error" role="alert">{action.error}</p>}
    {(hasMoreActions || open) && <div className={`followup-actions${!open ? " single" : ""}${needsOwnerAssignment ? " needs-owner" : ""}`}>
      {hasMoreActions && <div className={`followup-more-actions${moreActionsOpen ? " open" : ""}`}>
        <button type="button" className="followup-more-actions-toggle" aria-expanded={moreActionsOpen} aria-controls={moreActionsId} onClick={() => setMoreActionsOpen((current) => !current)}>
          More actions <ChevronDown size={15} aria-hidden="true" />
        </button>
        <div id={moreActionsId} className="followup-more-actions-body" aria-hidden={!moreActionsOpen} inert={!moreActionsOpen}>
          <div className="followup-more-actions-body-inner">
            <div>
              {props.onOpenTask && !props.focusedTaskId && <button className="button quiet small" onClick={() => props.onOpenTask!(task.id)}>Open task</button>}
              {person && !grouped && <button className="button quiet small" onClick={() => onOpenPerson(person.id)}><UserRound size={16} /> Person &amp; notes</button>}
              {location && <button className="button quiet small" onClick={() => onOpenProperty(location.id)}><MapPin size={16} /> Location</button>}
              {canReschedule && <button className="button quiet small" disabled={action.busy} onClick={() => setEditing("reschedule")}><CalendarClock size={15} /> Reschedule</button>}
              {open && canEdit && <button className="button quiet small" disabled={action.busy} onClick={() => setEditing("cancel")}>Cancel task</button>}
            </div>
            {open && canManage && onAssign && owner && <FollowUpAssignment task={task} data={data} ownerId={owner.id} busy={action.busy} helpId={assignmentHelpId} personTask={Boolean(person)} onAssign={onAssign} run={action.run} />}
          </div>
        </div>
      </div>}
      {open && canManage && onAssign && !owner && <FollowUpAssignment task={task} data={data} busy={action.busy} helpId={assignmentHelpId} personTask={Boolean(person)} primary onAssign={onAssign} run={action.run} />}
      {open && hasOutcomeActions && <div className="followup-actions-outcome">
        {open && ownTask && task.acceptance !== "accepted" && onAccept && <button className="button primary small" disabled={action.busy} onClick={() => void action.run(() => onAccept(task.id, "accepted"))}>Accept responsibility</button>}
        {open && ownTask && task.acceptance === "pending" && onAccept && <button className="button quiet small" disabled={action.busy} onClick={() => void action.run(() => onAccept(task.id, "declined"))}>Decline</button>}
        {open && canEdit && acceptedByActiveOwner && <button className="button primary small" disabled={action.busy} onClick={() => setEditing("complete")}><Check size={16} /> Complete</button>}
      </div>}
    </div>}
    {editing && <TaskEditor task={task} mode={editing} {...props} onClose={() => setEditing(null)} />}
  </article>;
}

function FollowUpAssignment({ task, data, ownerId = "", busy, helpId, personTask, primary = false, onAssign, run }: {
  task: FollowUp;
  data: NeighborWalkData;
  ownerId?: string;
  busy: boolean;
  helpId: string;
  personTask: boolean;
  primary?: boolean;
  onAssign: NonNullable<FollowUpsViewProps["onAssign"]>;
  run: (action: () => Promise<unknown>, onSuccess?: () => void) => Promise<void>;
}) {
  const showHelp = !primary || personTask;
  return <label className={`followup-reassign${primary ? " followup-assign-primary" : ""}`}>
    <span>{ownerId ? "Reassign task" : "Assign an owner"}</span>
    <select aria-label="Responsible person" aria-describedby={showHelp ? helpId : undefined} value={ownerId} disabled={busy} onChange={(event) => { const id = event.target.value; if (id) void run(() => onAssign(task.id, id)); }}><option value="" disabled>Choose an owner</option>{data.volunteers.filter((volunteer) => volunteer.active).map((volunteer) => <option key={volunteer.id} value={volunteer.id}>{volunteer.name}</option>)}</select>
    {showHelp && <small id={helpId}>{personTask ? "Share the person’s profile or arrange a care handoff before assigning someone new." : "Choose the person responsible for completing this task."}</small>}
  </label>;
}

function FollowUpContactAction({ cue, personName, phone, email, locationId, restricted, onOpenProperty }: {
  cue: FollowUpContactCue;
  personName?: string;
  phone?: string;
  email?: string;
  locationId?: string;
  restricted: boolean;
  onOpenProperty: (id: string) => void;
}) {
  const Icon = cue.kind === "text" ? MessageCircle : cue.kind === "call" ? Phone : cue.kind === "email" ? Mail : MapPin;
  const name = personName || "this person";
  const content = <><Icon size={17} /><span><small>{cue.label}</small>{cue.detail && <strong className={cue.keepDetailTogether ? "nowrap" : undefined} title={cue.detail}>{cue.detail}</strong>}</span></>;
  const unavailable = restricted ? " Contact is restricted." : "";

  if (!restricted && cue.kind === "text" && phone) return <a className="followup-contact-action" href={`sms:${phone}`} aria-label={`Text ${name} at ${cue.detail ?? phone}`}>{content}</a>;
  if (!restricted && cue.kind === "call" && phone) return <a className="followup-contact-action" href={`tel:${phone}`} aria-label={`Call ${name} at ${cue.detail ?? phone}`}>{content}</a>;
  if (!restricted && cue.kind === "email" && email) return <a className="followup-contact-action" href={`mailto:${email}`} aria-label={`Email ${name} at ${email}`}>{content}</a>;
  if (!restricted && cue.kind === "visit" && locationId) return <button type="button" className="followup-contact-action" onClick={() => onOpenProperty(locationId)} aria-label={`Open ${cue.detail ?? "follow-up location"}`}>{content}</button>;

  return <span className={`followup-contact-action unavailable${restricted ? " restricted" : ""}`} aria-label={`${cue.label}${cue.detail ? `: ${cue.detail}` : ""}.${unavailable}`}>{content}</span>;
}

function TaskEditor({ task, mode, data, onComplete, onReschedule, onCancel, onClose }: FollowUpsViewProps & { task: FollowUp; mode: "complete" | "reschedule" | "cancel"; onClose: () => void }) {
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
