"use client";

import { groupBy } from "../lib/collections";
import { CalendarClock, Check, ClipboardCheck, Mail, Map as MapIcon, MessageCircle, Save, Phone, Trash2, UserRound, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { dateInputValue, faithStatusLabels, formatPhoneNumber, formatDateTime, isFollowUpOverdue, type FollowUp, type FollowUpCompletionInput, type NeighborWalkData, type Property, type Resident } from "../lib/domain";
import { Modal, ViewHeading, EmptyState } from "./ui";

export function FollowUpsView({
  data,
  canManage,
  activeVolunteerId,
  initialPersonId,
  onClearPersonFocus,
  onOpenProperty,
  onOpenPerson,
  onAddPersonNote,
  onComplete,
  onReschedule,
  onCancel,
}: {
  data: NeighborWalkData;
  canManage: boolean;
  activeVolunteerId: string;
  initialPersonId?: string | null;
  onClearPersonFocus: () => void;
  onOpenProperty: (propertyId: string) => void;
  onOpenPerson: (residentId: string) => void;
  onAddPersonNote: (residentId: string, kind: "general", body: string) => string;
  onComplete: (followUpId: string, input: FollowUpCompletionInput) => void;
  onReschedule: (followUpId: string, date: string, note?: string) => void;
  onCancel: (followUpId: string, note?: string) => void;
}) {
  const [filter, setFilter] = useState<"open" | "overdue" | "today" | "upcoming" | "completed" | "cancelled">("open");
  const [query, setQuery] = useState("");
  const focusedPerson = data.residents.find((resident) => resident.id === initialPersonId);
  const propertyMap = useMemo(() => new Map(data.properties.map((property) => [property.id, property])), [data.properties]);
  const teamMap = useMemo(() => new Map(data.teams.map((team) => [team.id, team.name])), [data.teams]);
  const residentMap = useMemo(() => {
    const residents = groupBy(data.residents, (resident) => resident.propertyId);
    for (const propertyResidents of residents.values()) {
      propertyResidents.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    }
    return residents;
  }, [data.residents]);
  const peopleById = useMemo(() => new Map(data.residents.map((person) => [person.id, person])), [data.residents]);
  const notesByPerson = useMemo(() => groupBy(data.personNotes, (note) => note.residentId), [data.personNotes]);
  const volunteersById = useMemo(() => new Map(data.volunteers.map((person) => [person.id, person])), [data.volunteers]);
  const peopleForTask = (task: FollowUp) => {
    const person = task.residentId ? peopleById.get(task.residentId) : undefined;
    return task.residentId ? person ? [person] : [] : residentMap.get(task.propertyId) ?? [];
  };
  const normalizedQuery = query.trim().toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  const tasks = data.followUps
    .filter((followUp) => !initialPersonId || followUp.residentId === initialPersonId)
    .filter((followUp) => {
      const dueDate = followUp.dueAt.slice(0, 10);
      if (filter === "completed") return followUp.status === "completed";
      if (filter === "cancelled") return followUp.status === "cancelled";
      if (followUp.status !== "scheduled") return false;
      if (filter === "overdue") return isFollowUpOverdue(followUp) && dueDate !== today;
      if (filter === "today") return dueDate === today;
      if (filter === "upcoming") return dueDate > today;
      return true;
    })
    .filter((followUp) => {
      const property = propertyMap.get(followUp.propertyId);
      if (!normalizedQuery) return true;
      const relevantResidents = peopleForTask(followUp);
      const residentText = relevantResidents.flatMap((resident) => [
        resident.name,
        resident.phone,
        resident.email,
        faithStatusLabels[resident.faithStatus],
      ]).filter(Boolean).join(" ");
      const noteText = followUp.residentId ? (notesByPerson.get(followUp.residentId) ?? []).map((note) => note.body).join(" ") : "";
      return `${property?.address ?? ""} ${followUp.note ?? ""} ${residentText} ${noteText}`.toLowerCase().includes(normalizedQuery);
    })
    .sort((a, b) => filter === "completed" || filter === "cancelled"
      ? b.createdAt.localeCompare(a.createdAt)
      : a.dueAt.localeCompare(b.dueAt));

  return (
    <div className="content-view followups-view">
      <ViewHeading eyebrow="Care continues" title="Follow-ups" description="Manage return visits and keep every next step clear." aside={<div className="heading-count"><CalendarClock size={18} /><strong>{data.followUps.filter((item) => item.status === "scheduled").length}</strong><span>open</span></div>} />
      {focusedPerson && <div className="followup-person-focus"><UserRound size={15} /><span>Showing tasks for <strong>{focusedPerson.name || "this person"}</strong></span><button onClick={onClearPersonFocus}>Show all follow-ups</button></div>}
      <div className="list-toolbar">
        <div className="segmented-control" aria-label="Follow-up date filter">
          {(["open", "overdue", "today", "upcoming", "completed", "cancelled"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
        </div>
        <input className="search-field" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search address, person, or note" aria-label="Search follow-ups" />
      </div>

      {tasks.length ? (
        <div className="followup-list">
          {tasks.map((followUp) => {
            const property = propertyMap.get(followUp.propertyId);
            if (!property) return null;
            const residents = followUp.residentId
              ? data.residents.filter((resident) => resident.id === followUp.residentId)
              : residentMap.get(property.id) ?? [];
            const personNotes = followUp.residentId ? (notesByPerson.get(followUp.residentId) ?? []) : [];
            const owner = followUp.residentId ? volunteersById.get(residents[0]?.assignedVolunteerId ?? "") : undefined;
            const person = residents[0];
            const canEdit = !followUp.residentId || canManage || person?.createdByVolunteerId === activeVolunteerId || person?.assignedVolunteerId === activeVolunteerId;
            return <FollowUpCard key={followUp.id} followUp={followUp} property={property} residents={residents} personNotes={personNotes} ownerName={owner?.name} canEdit={canEdit} teams={data.teams} teamName={followUp.assignedTeamId ? teamMap.get(followUp.assignedTeamId) : undefined} noteLimit={data.church.noteCharacterLimit} onOpen={() => onOpenProperty(property.id)} onOpenPerson={onOpenPerson} onAddPersonNote={onAddPersonNote} onComplete={(input) => onComplete(followUp.id, input)} onReschedule={(date, note) => onReschedule(followUp.id, date, note)} onCancel={(note) => onCancel(followUp.id, note)} />;
          })}
        </div>
      ) : (
        <EmptyState icon={<ClipboardCheck size={25} />} title="Nothing in this view" copy={filter === "open" ? "New return visits will appear here." : "Try another filter or clear your search."} />
      )}
    </div>
  );
}

function FollowUpCard({ followUp, property, residents, personNotes, ownerName, canEdit, teams, teamName, noteLimit, onOpen, onOpenPerson, onAddPersonNote, onComplete, onReschedule, onCancel }: {
  followUp: FollowUp;
  property: Property;
  residents: Resident[];
  personNotes: NeighborWalkData["personNotes"];
  ownerName?: string;
  canEdit: boolean;
  teams: NeighborWalkData["teams"];
  teamName?: string;
  noteLimit: number;
  onOpen: () => void;
  onOpenPerson: (residentId: string) => void;
  onAddPersonNote: (residentId: string, kind: "general", body: string) => string;
  onComplete: (input: FollowUpCompletionInput) => void;
  onReschedule: (date: string, note?: string) => void;
  onCancel: (note?: string) => void;
}) {
  const [editingDate, setEditingDate] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [date, setDate] = useState(dateInputValue(followUp.dueAt));
  const [rescheduleNote, setRescheduleNote] = useState("");
  const overdue = isFollowUpOverdue(followUp) && followUp.dueAt.slice(0, 10) !== new Date().toISOString().slice(0, 10);
  const validDate = Boolean(date) && date >= new Date().toISOString().slice(0, 10);
  const statusLabel = followUp.status === "completed"
    ? "Completed"
    : followUp.status === "cancelled"
      ? "Cancelled"
      : overdue
        ? "Overdue"
        : followUp.dueAt.slice(0, 10) === new Date().toISOString().slice(0, 10)
          ? "Today"
          : "Scheduled";
  return (
    <article className={`followup-card ${followUp.status}${overdue ? " overdue" : ""}`}>
      <header className="followup-card-header">
        <div className="followup-date" aria-label={`${statusLabel}, ${formatDateTime(followUp.dueAt)}`}>
          <span>{statusLabel}</span>
          <div><strong>{formatDateTime(followUp.dueAt, { day: "numeric" })}</strong><small>{formatDateTime(followUp.dueAt, { month: "short" })}</small></div>
          <em>{formatDateTime(followUp.dueAt, { weekday: "long" })}</em>
        </div>
        <div className="followup-card-title">
          <div className="followup-card-meta"><span>{followUp.residentId ? <UserRound size={13} /> : <Users size={13} />} {followUp.residentId ? `${ownerName || "Person owner"} · private person task` : teamName || "Unassigned location task"}</span></div>
          <h2>{property.address}{property.unit ? ` · ${property.unit}` : ""}</h2>
        </div>
      </header>
      <div className="followup-card-body">
        <section className="followup-brief" aria-label="Follow-up brief">
          <span className="followup-section-label">Follow-up brief</span>
          <p>{followUp.note || "A return visit was requested. No additional note was recorded."}</p>
          {followUp.completionNote && <p className="completion-note"><Check size={13} /> {followUp.completionNote}</p>}
          {followUp.history.length > 1 && <details className="followup-history"><summary>{followUp.history.length} updates</summary>{followUp.history.slice().reverse().map((activity) => <div key={activity.id}><strong>{activity.action.replaceAll("_", " ")}</strong><span>{activity.note || (activity.dueAt ? formatDateTime(activity.dueAt, { month: "short", day: "numeric" }) : "No note")}</span><small>{formatDateTime(activity.createdAt)}</small></div>)}</details>}
        </section>
        <FollowUpPeople residents={residents} personNotes={personNotes} noteLimit={noteLimit} linkedPersonId={followUp.residentId} onOpenPerson={onOpenPerson} onAddPersonNote={onAddPersonNote} />
      </div>
      {followUp.status !== "scheduled" || !canEdit ? (
        <div className="followup-actions single"><button className="button quiet small" onClick={onOpen}><MapIcon size={14} /> View on map</button></div>
      ) : editingDate ? (
        <div className="inline-date-editor">
          <input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(event) => setDate(event.target.value)} aria-label="New follow-up date" />
          <input value={rescheduleNote} maxLength={noteLimit} onChange={(event) => setRescheduleNote(event.target.value)} placeholder="Reason or note (optional)" aria-label="Reschedule note" />
          <button className="button primary small" disabled={!validDate} onClick={() => { onReschedule(date, rescheduleNote); setEditingDate(false); }}><Save size={14} /> Save</button>
          <button className="icon-text-button" onClick={() => setEditingDate(false)}>Cancel</button>
        </div>
      ) : (
        <div className="followup-actions">
          <div className="followup-actions-secondary">
            <button className="button quiet small" onClick={onOpen}><MapIcon size={14} /> View on map</button>
            <button className="button quiet small" onClick={() => setEditingDate(true)}><CalendarClock size={14} /> Reschedule</button>
          </div>
          <div className="followup-actions-outcome">
            <button className="button primary small" onClick={() => setCompleting(true)}><Check size={15} /> Complete follow-up</button>
            <button className="more-danger" onClick={() => {
              const note = window.prompt("Optional cancellation note. Select Cancel to keep the follow-up open.");
              if (note !== null && window.confirm("Cancel this follow-up? The visit record will remain.")) onCancel(note);
            }} aria-label="Cancel follow-up"><Trash2 size={15} /></button>
          </div>
        </div>
      )}
      {completing && <CompleteFollowUpModal followUp={followUp} teams={teams} noteLimit={noteLimit} onClose={() => setCompleting(false)} onSave={(input) => { onComplete(input); setCompleting(false); }} />}
    </article>
  );
}

function FollowUpPeople({ residents, personNotes, noteLimit, linkedPersonId, onOpenPerson, onAddPersonNote }: {
  residents: Resident[];
  personNotes: NeighborWalkData["personNotes"];
  noteLimit: number;
  linkedPersonId?: string;
  onOpenPerson: (residentId: string) => void;
  onAddPersonNote: (residentId: string, kind: "general", body: string) => string;
}) {
  const [noteBody, setNoteBody] = useState("");
  const sortedNotes = [...personNotes].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const noteValid = Boolean(linkedPersonId && noteBody.trim() && noteBody.length <= noteLimit);
  return <section className="followup-people" aria-label="People recorded at this location">
    <div className="followup-people-heading"><span><Users size={14} /> {linkedPersonId ? "Person context" : "People to contact"}</span><strong>{residents.length}</strong></div>
    {residents.length ? <div className="followup-person-list">{residents.map((resident) => {
      const smsNumber = resident.phone?.replace(/[^\d+]/g, "");
      const displayPhone = resident.phone ? formatPhoneNumber(resident.phone) : undefined;
      const canText = Boolean(smsNumber);
      const canEmail = Boolean(resident.email);
      return <article className="followup-person" key={resident.id}>
        <span className="followup-person-avatar" aria-hidden="true">{resident.name?.trim().charAt(0).toUpperCase() || "?"}</span>
        <div className="followup-person-copy">
          <div><strong>{resident.name || "Name not provided"}</strong><span>{faithStatusLabels[resident.faithStatus]}</span></div>
          {!canText && !canEmail ? <small><Phone size={12} /> No phone number or email saved</small> : null}
        </div>
        <div className="followup-contact-actions">
          {canText && <a className={resident.preferredContact === "text" ? "preferred" : undefined} href={`sms:${smsNumber}`} aria-label={`Text ${resident.name || "this person"} at ${displayPhone}`}><MessageCircle size={14} /><span><small>{resident.preferredContact === "text" ? "Preferred text" : "Text"}</small><strong>{displayPhone}</strong></span></a>}
          {canEmail && <a className={resident.preferredContact === "email" ? "preferred" : undefined} href={`mailto:${resident.email}`} aria-label={`Email ${resident.name || "this person"} at ${resident.email}`}><Mail size={14} /><span><small>{resident.preferredContact === "email" ? "Preferred email" : "Email"}</small><strong>{resident.email}</strong></span></a>}
          <button onClick={() => onOpenPerson(resident.id)} aria-label={`Open ${resident.name || "person"} discipleship profile`}><UserRound size={14} /><span><small>Discipleship</small><strong>View profile</strong></span></button>
        </div>
      </article>;
    })}</div> : <p className="followup-people-empty"><Phone size={13} /> No people are recorded at this location.</p>}
    {linkedPersonId && <div className="followup-person-notes">
      <div><strong>Person notes</strong><span>{sortedNotes.length}</span></div>
      {sortedNotes.length ? <div className="followup-note-list">{sortedNotes.slice(0, 3).map((note) => <article key={note.id}><p>{note.body}</p><time>{formatDateTime(note.createdAt, { month: "short", day: "numeric", year: "numeric" })}</time></article>)}</div> : <p>No notes yet.</p>}
      {sortedNotes.length > 3 && <button onClick={() => onOpenPerson(linkedPersonId)}>View all {sortedNotes.length} notes</button>}
      <div className="followup-note-composer"><input value={noteBody} maxLength={noteLimit + 1} onChange={(event) => setNoteBody(event.target.value)} placeholder="Add a note to this person’s history" aria-label="Add person note" /><button className="button quiet small" disabled={!noteValid} onClick={() => { onAddPersonNote(linkedPersonId, "general", noteBody); setNoteBody(""); }}><MessageCircle size={13} /> Save note</button></div>
    </div>}
  </section>;
}

function CompleteFollowUpModal({ followUp, teams, noteLimit, onClose, onSave }: {
  followUp: FollowUp;
  teams: NeighborWalkData["teams"];
  noteLimit: number;
  onClose: () => void;
  onSave: (input: FollowUpCompletionInput) => void;
}) {
  const [completionNote, setCompletionNote] = useState("");
  const [scheduleAnother, setScheduleAnother] = useState(false);
  const [nextDate, setNextDate] = useState("");
  const [nextNote, setNextNote] = useState("");
  const [assignedTeamId, setAssignedTeamId] = useState(followUp.assignedTeamId ?? "");
  const valid = completionNote.length <= noteLimit && nextNote.length <= noteLimit
    && (!scheduleAnother || Boolean(nextDate) && nextDate >= new Date().toISOString().slice(0, 10) && (!followUp.residentId || Boolean(nextNote.trim())));
  return <Modal title="Complete follow-up" description={followUp.residentId ? "Record what happened. Your note will also become part of this person’s history." : "Record the result and schedule the next step if needed."} onClose={onClose}>
    <div className="form-stack">
      <label className="form-field"><span>{followUp.residentId ? "Person note" : "Completion note"} <small>Optional</small></span><textarea rows={3} maxLength={noteLimit + 1} value={completionNote} onChange={(event) => setCompletionNote(event.target.value)} placeholder="Briefly record what happened or what was requested." />{followUp.residentId && <small>Saved in this person’s single note history.</small>}</label>
      <label className={`toggle-row additional-followup-toggle${scheduleAnother ? " active" : ""}`}><input type="checkbox" checked={scheduleAnother} onChange={(event) => setScheduleAnother(event.target.checked)} /><span className="compact-toggle-label">Schedule an additional follow-up</span></label>
      {scheduleAnother && <section className="additional-followup-panel" aria-label="Additional follow-up details">
        <div className="additional-followup-heading">
          <span><CalendarClock size={17} /></span>
          <div><strong>Plan the next task</strong><small>Keep the relationship moving while the details are fresh.</small></div>
        </div>
        <div className="additional-followup-fields">
          <div className="form-field additional-followup-field">
            <label className="additional-followup-label" htmlFor="additional-followup-date"><i>1</i><span><strong>Due date</strong><small>When should this happen?</small></span></label>
            <input id="additional-followup-date" type="date" min={new Date().toISOString().slice(0, 10)} value={nextDate} onChange={(event) => setNextDate(event.target.value)} />
          </div>
          {!followUp.residentId && <div className="form-field additional-followup-field">
            <label className="additional-followup-label" htmlFor="additional-followup-group"><i>2</i><span><strong>Assign group</strong><small>Who should own the next visit?</small></span></label>
            <select id="additional-followup-group" value={assignedTeamId} onChange={(event) => setAssignedTeamId(event.target.value)}><option value="">Unassigned</option>{teams.map((team) => <option value={team.id} key={team.id}>{team.name}</option>)}</select>
          </div>}
          <div className="form-field additional-followup-field full">
            <label className="additional-followup-label" htmlFor="additional-followup-note"><i>{followUp.residentId ? "2" : "3"}</i><span><strong>What needs to happen?</strong><small>{followUp.residentId ? "Required for a person task." : "What should the next volunteer know? Optional."}</small></span></label>
            <textarea id="additional-followup-note" rows={3} maxLength={noteLimit + 1} value={nextNote} onChange={(event) => setNextNote(event.target.value)} placeholder="Example: Bring service times and text before visiting." />
          </div>
        </div>
      </section>}
    </div>
    <div className="modal-actions"><button className="button quiet" onClick={onClose}>Cancel</button><button className="button primary" disabled={!valid} onClick={() => onSave({ completionNote: completionNote.trim() || undefined, nextFollowUp: scheduleAnother ? { dueAt: new Date(`${nextDate}T17:00:00`).toISOString(), note: nextNote.trim() || undefined, assignedTeamId: followUp.residentId ? undefined : assignedTeamId || undefined } : undefined })}><Check size={15} /> Complete follow-up</button></div>
  </Modal>;
}
