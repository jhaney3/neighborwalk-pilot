"use client";

import { groupBy } from "../lib/collections";

import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Edit3,
  LockKeyhole,
  Mail,
  MapPin,
  MessageCircle,
  NotebookPen,
  PauseCircle,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserRound,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  dateInputValue,
  discipleshipStageLabels,
  discipleshipStageValues,
  dueDateFromNow,
  faithStatusLabels,
  faithStatusValues,
  formatDateTime,
  formatPhoneNumber,
  personNoteKindLabels,
  type DiscipleshipStage,
  type FollowUp,
  type NeighborWalkData,
  type PersonNoteKind,
  type Resident,
  type ResidentInput,
} from "../lib/domain";
import { Modal, ViewHeading } from "./ui";

type PeopleViewProps = {
  data: NeighborWalkData;
  canManage: boolean;
  activeVolunteerId: string;
  initialSelectedResidentId?: string | null;
  onOpenProperty: (propertyId: string) => void;
  onUpsertResident: (propertyId: string, input: ResidentInput, residentId?: string) => string;
  onDeleteResident: (residentId: string) => void;
  onAddPersonNote: (residentId: string, kind: PersonNoteKind, body: string) => string;
  onDeletePersonNote: (noteId: string) => void;
  onAddPersonFollowUp: (residentId: string, note: string, date: string) => string;
  onOpenFollowUps: (residentId: string) => void;
};

type PersonEditorState = "new" | Resident | null;
type SortMode = "next_step" | "recent" | "name";

function residentInput(resident: Resident, patch: Partial<ResidentInput> = {}): ResidentInput {
  return {
    name: resident.name,
    faithStatus: resident.faithStatus,
    discipleshipStage: resident.discipleshipStage,
    assignedVolunteerId: resident.assignedVolunteerId,
    sharedWithVolunteerIds: resident.sharedWithVolunteerIds,
    sharedWithTeamIds: resident.sharedWithTeamIds,
    status: resident.status,
    phone: resident.phone,
    email: resident.email,
    preferredContact: resident.preferredContact,
    lastContactAt: resident.lastContactAt,
    ...patch,
  };
}

function personInitials(name?: string) {
  if (!name) return "?";
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function dueState(followUp?: FollowUp) {
  if (!followUp || followUp.status !== "scheduled") return "none" as const;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(followUp.dueAt);
  due.setHours(0, 0, 0, 0);
  if (due < today) return "overdue" as const;
  const upcoming = new Date(today);
  upcoming.setDate(upcoming.getDate() + 7);
  return due <= upcoming ? "soon" as const : "later" as const;
}

export function PeopleView({
  data,
  canManage,
  activeVolunteerId,
  initialSelectedResidentId,
  onOpenProperty,
  onUpsertResident,
  onDeleteResident,
  onAddPersonNote,
  onDeletePersonNote,
  onAddPersonFollowUp,
  onOpenFollowUps,
}: PeopleViewProps) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<"all" | DiscipleshipStage>("all");
  const [owner, setOwner] = useState<"all" | "mine">("all");
  const [status, setStatus] = useState<"active" | "paused" | "archived" | "all">("active");
  const [sort, setSort] = useState<SortMode>("next_step");
  const [selectedId, setSelectedId] = useState<string | null>(() => (
    data.residents.find((resident) => resident.id === initialSelectedResidentId)?.id
      ?? data.residents.find((resident) => resident.assignedVolunteerId === activeVolunteerId && resident.status === "active")?.id
      ?? data.residents.find((resident) => resident.status === "active")?.id
      ?? data.residents[0]?.id
      ?? null
  ));
  const [editor, setEditor] = useState<PersonEditorState>(null);

  const volunteers = useMemo(() => new Map(data.volunteers.map((volunteer) => [volunteer.id, volunteer])), [data.volunteers]);
  const properties = useMemo(() => new Map(data.properties.map((property) => [property.id, property])), [data.properties]);
  const notesByResident = useMemo(() => {
    const grouped = groupBy(data.personNotes, (note) => note.residentId);
    for (const notes of grouped.values()) notes.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return grouped;
  }, [data.personNotes]);
  const followUpsByResident = useMemo(() => {
    const grouped = groupBy(data.followUps, (followUp) => followUp.residentId);
    for (const followUps of grouped.values()) followUps.sort((left, right) => left.dueAt.localeCompare(right.dueAt));
    return grouped;
  }, [data.followUps]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return data.residents
      .filter((resident) => status === "all" || resident.status === status)
      .filter((resident) => stage === "all" || resident.discipleshipStage === stage)
      .filter((resident) => owner === "all" || resident.assignedVolunteerId === activeVolunteerId)
      .filter((resident) => {
        if (!normalized) return true;
        const property = properties.get(resident.propertyId);
        const noteText = (notesByResident.get(resident.id) ?? []).map((note) => note.body).join(" ");
        const followUpText = (followUpsByResident.get(resident.id) ?? []).map((followUp) => followUp.note).join(" ");
        return [resident.name, resident.phone, resident.email, followUpText, property?.address, volunteers.get(resident.assignedVolunteerId)?.name, noteText]
          .some((value) => value?.toLowerCase().includes(normalized));
      })
      .sort((left, right) => {
        if (sort === "name") return (left.name ?? "").localeCompare(right.name ?? "");
        if (sort === "recent") return right.updatedAt.localeCompare(left.updatedAt);
        const leftDue = followUpsByResident.get(left.id)?.find((followUp) => followUp.status === "scheduled")?.dueAt ?? "9999";
        const rightDue = followUpsByResident.get(right.id)?.find((followUp) => followUp.status === "scheduled")?.dueAt ?? "9999";
        return leftDue.localeCompare(rightDue) || right.updatedAt.localeCompare(left.updatedAt);
      });
  }, [activeVolunteerId, data.residents, followUpsByResident, notesByResident, owner, properties, query, sort, stage, status, volunteers]);

  const selected = data.residents.find((resident) => resident.id === selectedId);
  const mine = data.residents.filter((resident) => resident.assignedVolunteerId === activeVolunteerId && resident.status === "active").length;
  const due = data.residents.filter((resident) => ["overdue", "soon"].includes(dueState(followUpsByResident.get(resident.id)?.find((followUp) => followUp.status === "scheduled")))).length;

  const saveResident = (propertyId: string, input: ResidentInput) => {
    const editing = editor && editor !== "new" ? editor : undefined;
    const residentId = onUpsertResident(propertyId, input, editing?.id);
    setSelectedId(residentId);
    setEditor(null);
  };

  return (
    <section className="content-view people-view">
      <ViewHeading
        eyebrow="Discipleship, person by person"
        title="People"
        description="Keep ownership clear, remember the whole story, and make the next faithful step visible."
        aside={<div className="people-heading-stats" aria-label="Discipleship overview"><div><UserCheck size={16} /><strong>{mine}</strong><span>mine</span></div><div><CalendarClock size={16} /><strong>{due}</strong><span>need care</span></div></div>}
      />

      <div className="people-toolbar">
        <label className="people-search"><Search size={16} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people, notes, address, or owner" /><span>{filtered.length}</span></label>
        <div className="people-filters">
          <select aria-label="Filter by owner" value={owner} onChange={(event) => setOwner(event.target.value as typeof owner)}><option value="all">Every owner</option><option value="mine">My people</option></select>
          <select aria-label="Filter by stage" value={stage} onChange={(event) => setStage(event.target.value as typeof stage)}><option value="all">Every stage</option>{discipleshipStageValues.map((value) => <option key={value} value={value}>{discipleshipStageLabels[value]}</option>)}</select>
          <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option><option value="all">Any status</option></select>
          <select aria-label="Sort people" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="next_step">Follow-up date</option><option value="recent">Recently updated</option><option value="name">Name</option></select>
        </div>
        <button className="button primary people-new-button" onClick={() => setEditor("new")}><Plus size={15} /> Add person</button>
      </div>

      <div className={`people-workbench${selected ? " has-profile" : ""}`}>
        <section className="people-directory" aria-label="People directory">
          <div className="people-directory-label"><span>{filtered.length} {filtered.length === 1 ? "person" : "people"}</span><small>{owner === "mine" ? "Assigned to you" : canManage ? "All people you may oversee" : "Private and shared with you"}</small></div>
          <div className="people-directory-list">
            {filtered.map((resident) => {
              const property = properties.get(resident.propertyId);
              const ownerRecord = volunteers.get(resident.assignedVolunteerId);
              const latestNote = notesByResident.get(resident.id)?.[0];
              const nextFollowUp = followUpsByResident.get(resident.id)?.find((followUp) => followUp.status === "scheduled");
              const nextStepState = dueState(nextFollowUp);
              return (
                <button className={`person-list-card${selectedId === resident.id ? " active" : ""}`} key={resident.id} onClick={() => setSelectedId(resident.id)}>
                  <span className="person-list-avatar">{personInitials(resident.name)}</span>
                  <span className="person-list-copy">
                    <span><strong>{resident.name || "Name not provided"}</strong><em className={`person-status-dot ${resident.status}`} title={resident.status} /></span>
                    <small>{discipleshipStageLabels[resident.discipleshipStage]}</small>
                    <span className="person-list-meta"><span><UserRound size={11} /> {ownerRecord?.name ?? "Unknown owner"}</span>{property && <span><MapPin size={11} /> {property.address}</span>}</span>
                    {(nextFollowUp?.note || latestNote) && <p>{nextFollowUp?.note ?? latestNote?.body}</p>}
                    {nextFollowUp && <span className={`person-next-date ${nextStepState}`}><Clock3 size={11} /> {nextStepState === "overdue" ? "Overdue · " : ""}{formatDateTime(nextFollowUp.dueAt, { month: "short", day: "numeric" })}</span>}
                  </span>
                  <ChevronRight size={16} />
                </button>
              );
            })}
            {!filtered.length && <div className="people-empty"><Users size={23} /><strong>No people match these filters</strong><span>Try a broader search or add a new person.</span><button className="button quiet small" onClick={() => { setQuery(""); setOwner("all"); setStage("all"); setStatus("all"); }}>Clear filters</button></div>}
          </div>
        </section>

        {selected ? (
          <PersonProfile
            key={selected.id}
            resident={selected}
            data={data}
            canManage={canManage}
            activeVolunteerId={activeVolunteerId}
            onBack={() => setSelectedId(null)}
            onEdit={() => setEditor(selected)}
            onOpenProperty={() => onOpenProperty(selected.propertyId)}
            onChangeStage={(nextStage) => onUpsertResident(selected.propertyId, residentInput(selected, { discipleshipStage: nextStage }), selected.id)}
            onChangeOwner={(assignedVolunteerId) => onUpsertResident(selected.propertyId, residentInput(selected, { assignedVolunteerId }), selected.id)}
            onChangeStatus={(nextStatus) => onUpsertResident(selected.propertyId, residentInput(selected, { status: nextStatus }), selected.id)}
            onAddFollowUp={(note, date) => onAddPersonFollowUp(selected.id, note, date)}
            onOpenFollowUps={() => onOpenFollowUps(selected.id)}
            onAddNote={(kind, body) => onAddPersonNote(selected.id, kind, body)}
            onDeleteNote={onDeletePersonNote}
          />
        ) : <div className="people-profile-empty"><CircleUserRound size={32} /><strong>Select a person</strong><span>Their follow-up plan and complete note history will appear here.</span></div>}
      </div>

      {editor && <Modal title={editor === "new" ? "Add a person" : `Edit ${editor.name || "person"}`} description="Keep only details that help you care for this person well." wide onClose={() => setEditor(null)}><PersonEditor resident={editor === "new" ? undefined : editor} data={data} activeVolunteerId={activeVolunteerId} onCancel={() => setEditor(null)} onSave={saveResident} onDelete={editor !== "new" && (canManage || editor.createdByVolunteerId === activeVolunteerId) ? () => { onDeleteResident(editor.id); setSelectedId(null); setEditor(null); } : undefined} /></Modal>}
    </section>
  );
}

function PersonProfile({ resident, data, canManage, activeVolunteerId, onBack, onEdit, onOpenProperty, onChangeStage, onChangeOwner, onChangeStatus, onAddFollowUp, onOpenFollowUps, onAddNote, onDeleteNote }: {
  resident: Resident;
  data: NeighborWalkData;
  canManage: boolean;
  activeVolunteerId: string;
  onBack: () => void;
  onEdit: () => void;
  onOpenProperty: () => void;
  onChangeStage: (stage: DiscipleshipStage) => void;
  onChangeOwner: (volunteerId: string) => void;
  onChangeStatus: (status: Resident["status"]) => void;
  onAddFollowUp: (note: string, date: string) => void;
  onOpenFollowUps: () => void;
  onAddNote: (kind: PersonNoteKind, body: string) => void;
  onDeleteNote: (noteId: string) => void;
}) {
  const [noteBody, setNoteBody] = useState("");
  const property = data.properties.find((item) => item.id === resident.propertyId);
  const owner = data.volunteers.find((volunteer) => volunteer.id === resident.assignedVolunteerId);
  const timeline = data.personNotes.filter((note) => note.residentId === resident.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const personFollowUps = data.followUps.filter((followUp) => followUp.residentId === resident.id).sort((left, right) => left.dueAt.localeCompare(right.dueAt));
  const openFollowUps = personFollowUps.filter((followUp) => followUp.status === "scheduled");
  const nextFollowUp = openFollowUps[0];
  const nextState = dueState(nextFollowUp);
  const stageIndex = discipleshipStageValues.indexOf(resident.discipleshipStage);
  const noteValid = noteBody.trim().length > 0 && noteBody.length <= data.church.noteCharacterLimit;
  const canEdit = canManage || resident.createdByVolunteerId === activeVolunteerId || resident.assignedVolunteerId === activeVolunteerId;
  const sharedCount = resident.sharedWithTeamIds.length + resident.sharedWithVolunteerIds.length;

  return (
    <article className="person-profile">
      <header className="person-profile-header">
        <button className="person-profile-back" onClick={onBack}><ArrowLeft size={16} /> People</button>
        <div className="person-profile-identity">
          <span className="person-profile-avatar">{personInitials(resident.name)}</span>
          <div><span className={`person-profile-status ${resident.status}`}>{resident.status}</span><h2>{resident.name || "Name not provided"}</h2><p className="person-profile-signals"><span className="person-faith-status">{faithStatusLabels[resident.faithStatus]}</span><span>{discipleshipStageLabels[resident.discipleshipStage]}</span></p><small className="person-privacy-summary"><LockKeyhole size={12} /> {sharedCount ? `Shared with ${sharedCount} additional ${sharedCount === 1 ? "group or person" : "groups or people"}` : "Private to creator and owner"}</small></div>
          {canEdit && <button className="button quiet small" onClick={onEdit}><Edit3 size={14} /> Edit profile</button>}
        </div>
        <div className="person-profile-contact">
          {resident.phone && <a href={`tel:${resident.phone}`}><Phone size={14} /><span><small>{resident.preferredContact === "call" || resident.preferredContact === "text" ? "Preferred" : "Phone"}</small><strong>{formatPhoneNumber(resident.phone)}</strong></span></a>}
          {resident.email && <a href={`mailto:${resident.email}`}><Mail size={14} /><span><small>{resident.preferredContact === "email" ? "Preferred" : "Email"}</small><strong>{resident.email}</strong></span></a>}
          {property && <button onClick={onOpenProperty}><MapPin size={14} /><span><small>Home</small><strong>{property.address}{property.unit ? ` · ${property.unit}` : ""}</strong></span></button>}
        </div>
      </header>

      <section className="discipleship-path" aria-label="Discipleship relationship stage">
        <div><span className="profile-section-label">Relationship path</span><small>Use stages as shared context, never as a score.</small></div>
        <div className="discipleship-path-rail">
          {discipleshipStageValues.map((stage, index) => <button key={stage} disabled={!canEdit} className={`${index < stageIndex ? "passed" : ""}${stage === resident.discipleshipStage ? " current" : ""}`} onClick={() => onChangeStage(stage)} aria-current={stage === resident.discipleshipStage ? "step" : undefined}><span>{index < stageIndex ? <CheckCircle2 size={13} /> : index + 1}</span><small>{discipleshipStageLabels[stage]}</small></button>)}
        </div>
      </section>

      <div className="person-care-grid">
        <section className="care-owner-card">
          <span className="profile-section-label">Discipleship owner</span>
          <div><span className="care-owner-avatar">{personInitials(owner?.name)}</span><div><strong>{owner?.name ?? "Choose an owner"}</strong><small>Responsible for keeping the relationship moving</small></div></div>
          {canEdit && <label><span>Reassign</span><select value={resident.assignedVolunteerId} onChange={(event) => onChangeOwner(event.target.value)}>{data.volunteers.filter((volunteer) => volunteer.active || volunteer.id === resident.assignedVolunteerId).map((volunteer) => <option key={volunteer.id} value={volunteer.id}>{volunteer.name}</option>)}</select></label>}
        </section>
        <section className={`care-next-card ${nextState}`}>
          <div><span className="profile-section-label">Follow-up plan</span>{nextFollowUp && <em><CalendarClock size={12} /> {nextState === "overdue" ? "Overdue · " : ""}{formatDateTime(nextFollowUp.dueAt, { month: "long", day: "numeric" })}</em>}</div>
          {nextFollowUp ? <p>{nextFollowUp.note || "Follow up with this person."}</p> : <p className="care-next-empty">No open follow-up is planned.</p>}
          {openFollowUps.length > 1 && <small>{openFollowUps.length - 1} more open {openFollowUps.length === 2 ? "task" : "tasks"}</small>}
          <div className="care-next-actions">{canEdit && <FollowUpPlanner defaultDays={data.church.defaultFollowUpDays} noteLimit={data.church.noteCharacterLimit} onSave={onAddFollowUp} />}<button onClick={onOpenFollowUps}>Open follow-ups <ChevronRight size={13} /></button></div>
        </section>
      </div>

      <section className="person-notes-section">
        <div className="person-notes-heading"><div><span className="profile-section-label">Notes</span><h3>One clear history</h3></div><span>{timeline.length} {timeline.length === 1 ? "note" : "notes"}</span></div>
        <div className="person-note-composer">
          <div><MessageCircle size={17} /><strong>Add a note</strong><small>Every person note goes here.</small></div>
          <div className="person-note-fields"><textarea rows={3} maxLength={data.church.noteCharacterLimit + 1} value={noteBody} onChange={(event) => setNoteBody(event.target.value)} placeholder="What should you remember for next time?" /></div>
          <div><span className={noteBody.length > data.church.noteCharacterLimit ? "over" : ""}>{data.church.noteCharacterLimit - noteBody.length} characters remaining</span><button className="button primary small" disabled={!noteValid} onClick={() => { onAddNote("general", noteBody); setNoteBody(""); }}><NotebookPen size={14} /> Save note</button></div>
        </div>
        <div className="person-timeline">
          {timeline.map((note) => {
            const author = data.volunteers.find((volunteer) => volunteer.id === note.authorId);
            const canDelete = canManage || note.authorId === activeVolunteerId;
            return <article className={`person-timeline-entry ${note.kind}`} key={note.id}><span className="person-timeline-mark">{note.kind === "milestone" ? <CheckCircle2 size={14} /> : note.kind === "prayer" ? <ShieldCheck size={14} /> : <MessageCircle size={14} />}</span><div><div><span>{personNoteKindLabels[note.kind]}</span><time>{formatDateTime(note.createdAt, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</time></div><p>{note.body}</p><footer><span>{author?.name ?? "Church member"}</span>{canDelete && <button onClick={() => { if (window.confirm("Delete this note? This cannot be undone.")) onDeleteNote(note.id); }} aria-label="Delete note"><Trash2 size={12} /></button>}</footer></div></article>;
          })}
          {!timeline.length && <div className="person-timeline-empty"><NotebookPen size={22} /><strong>No notes yet</strong><span>Add the first note above. It will always remain in this history.</span></div>}
        </div>
      </section>

      <footer className="person-profile-footer">
        <div><PauseCircle size={14} /><span><strong>Tracking status</strong><small>Paused people remain searchable; archived people leave the active list.</small></span></div>
        <select value={resident.status} disabled={!canEdit} onChange={(event) => onChangeStatus(event.target.value as Resident["status"])}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select>
      </footer>
    </article>
  );
}

function FollowUpPlanner({ defaultDays, noteLimit, onSave }: { defaultDays: number; noteLimit: number; onSave: (note: string, date: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState(dateInputValue(dueDateFromNow(defaultDays)));
  const valid = Boolean(note.trim() && dueDate && note.length <= noteLimit);
  if (!editing) return <button onClick={() => setEditing(true)}>Plan follow-up <Plus size={13} /></button>;
  return <div className="next-step-inline-editor">
    <label><span>What needs to happen?</span><input maxLength={noteLimit + 1} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Invite them for coffee" /></label>
    <label><span>Due date</span><input type="date" min={new Date().toISOString().slice(0, 10)} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
    <div><button className="button quiet small" onClick={() => { setNote(""); setDueDate(dateInputValue(dueDateFromNow(defaultDays))); setEditing(false); }}>Cancel</button><button className="button primary small" disabled={!valid} onClick={() => { onSave(note.trim(), dueDate); setNote(""); setEditing(false); }}>Add follow-up</button></div>
  </div>;
}

function PersonEditor({ resident, data, activeVolunteerId, onCancel, onSave, onDelete }: {
  resident?: Resident;
  data: NeighborWalkData;
  activeVolunteerId: string;
  onCancel: () => void;
  onSave: (propertyId: string, input: ResidentInput) => void;
  onDelete?: () => void;
}) {
  const [propertyId, setPropertyId] = useState(resident?.propertyId ?? data.properties[0]?.id ?? "");
  const [name, setName] = useState(resident?.name ?? "");
  const [faithStatus, setFaithStatus] = useState(resident?.faithStatus ?? "not_discussed");
  const [discipleshipStage, setDiscipleshipStage] = useState(resident?.discipleshipStage ?? "new_connection");
  const [assignedVolunteerId, setAssignedVolunteerId] = useState(resident?.assignedVolunteerId ?? activeVolunteerId);
  const [status, setStatus] = useState(resident?.status ?? "active");
  const [phone, setPhone] = useState(resident?.phone ?? "");
  const [email, setEmail] = useState(resident?.email ?? "");
  const [preferredContact, setPreferredContact] = useState(resident?.preferredContact ?? "none");
  const [sharedWithVolunteerIds, setSharedWithVolunteerIds] = useState(resident?.sharedWithVolunteerIds ?? []);
  const [sharedWithTeamIds, setSharedWithTeamIds] = useState(resident?.sharedWithTeamIds ?? []);
  const contactValid = preferredContact === "email" ? Boolean(email.trim()) : preferredContact === "text" || preferredContact === "call" ? Boolean(phone.trim()) : true;
  const canSave = Boolean(propertyId && assignedVolunteerId && contactValid);
  const creatorId = resident?.createdByVolunteerId ?? activeVolunteerId;
  const activeOwner = data.volunteers.find((volunteer) => volunteer.id === activeVolunteerId);
  const shareableVolunteers = data.volunteers.filter((volunteer) => volunteer.active && volunteer.id !== creatorId && volunteer.id !== assignedVolunteerId);
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  return <div className="person-editor-form">
    <div className="person-editor-section"><span>Person & location</span><div className="person-editor-grid"><label className="form-field"><span>Name <small>Only if shared</small></span><input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="First name is enough" /></label><label className="form-field"><span>Home or meeting location</span><select value={propertyId} onChange={(event) => setPropertyId(event.target.value)}><option value="">Choose a saved location</option>{data.properties.slice().sort((left, right) => left.address.localeCompare(right.address)).map((property) => <option key={property.id} value={property.id}>{property.address}{property.unit ? ` · ${property.unit}` : ""}</option>)}</select></label><label className="form-field"><span>Self-described faith</span><select value={faithStatus} onChange={(event) => setFaithStatus(event.target.value as Resident["faithStatus"])}>{faithStatusValues.map((value) => <option value={value} key={value}>{faithStatusLabels[value]}</option>)}</select></label><label className="form-field"><span>Tracking status</span><select value={status} onChange={(event) => setStatus(event.target.value as Resident["status"])}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select></label></div></div>
    <div className="person-editor-section"><span>Discipleship care</span><div className="person-editor-grid">{resident ? <label className="form-field"><span>Discipleship owner</span><select value={assignedVolunteerId} onChange={(event) => setAssignedVolunteerId(event.target.value)}>{data.volunteers.filter((volunteer) => volunteer.active || volunteer.id === assignedVolunteerId).map((volunteer) => <option value={volunteer.id} key={volunteer.id}>{volunteer.name}</option>)}</select></label> : <div className="form-field person-owner-confirmation"><span>Discipleship owner</span><strong><UserCheck size={15} /> {activeOwner?.name ?? "You"}</strong><small>You will own this relationship because you are adding it.</small></div>}<label className="form-field"><span>Relationship stage</span><select value={discipleshipStage} onChange={(event) => setDiscipleshipStage(event.target.value as DiscipleshipStage)}>{discipleshipStageValues.map((value) => <option value={value} key={value}>{discipleshipStageLabels[value]}</option>)}</select></label></div></div>
    <div className="person-editor-section"><span>Contact</span><div className="person-editor-grid"><label className="form-field"><span>Phone <small>Optional</small></span><input inputMode="tel" autoComplete="off" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} /></label><label className="form-field"><span>Email <small>Optional</small></span><input type="email" inputMode="email" autoComplete="off" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label><label className="form-field"><span>Preferred contact</span><select value={preferredContact} onChange={(event) => setPreferredContact(event.target.value as Resident["preferredContact"])}><option value="none">No preference</option><option value="text">Text message</option><option value="call">Phone call</option><option value="email">Email</option></select></label></div></div>
    <details className="person-sharing-section">
      <summary><span><LockKeyhole size={15} /><strong>Sharing</strong></span><small>Private by default</small></summary>
      <p>The person who added this record and its assigned owner always have access. Add others only when they should help with care.</p>
      {data.teams.length > 0 && <fieldset><legend>Share with a group</legend>{data.teams.map((team) => <label key={team.id}><input type="checkbox" checked={sharedWithTeamIds.includes(team.id)} onChange={() => setSharedWithTeamIds((current) => toggle(current, team.id))} /><span>{team.name}</span></label>)}</fieldset>}
      {shareableVolunteers.length > 0 && <fieldset><legend>Share with specific people</legend>{shareableVolunteers.map((volunteer) => <label key={volunteer.id}><input type="checkbox" checked={sharedWithVolunteerIds.includes(volunteer.id)} onChange={() => setSharedWithVolunteerIds((current) => toggle(current, volunteer.id))} /><span>{volunteer.name}</span></label>)}</fieldset>}
    </details>
    {!contactValid && <p className="form-warning">Enter the phone number or email needed for the selected contact method.</p>}
    {!data.properties.length && <p className="form-warning">Add a location from the map before creating a person.</p>}
    <div className="modal-actions split"><div>{onDelete && <button className="button danger" onClick={() => { if (window.confirm("Delete this person, their notes, and their follow-ups? This cannot be undone.")) onDelete(); }}><Trash2 size={14} /> Delete person</button>}</div><div><button className="button quiet" onClick={onCancel}>Cancel</button><button className="button primary" disabled={!canSave} onClick={() => onSave(propertyId, { name: name.trim() || undefined, faithStatus, discipleshipStage, assignedVolunteerId, sharedWithVolunteerIds: sharedWithVolunteerIds.filter((id) => id !== assignedVolunteerId && id !== creatorId), sharedWithTeamIds, status, phone: phone.trim() || undefined, email: email.trim() || undefined, preferredContact, lastContactAt: resident?.lastContactAt })}><UserCheck size={15} /> Save person</button></div></div>
  </div>;
}
