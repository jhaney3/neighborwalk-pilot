"use client";

import { groupBy } from "../lib/collections";
import { personTimeline } from "../lib/person-timeline";
import { ContactRestrictions } from "./ContactRestrictions";
import { contactRestricted, type RestrictionActions } from "../lib/contact-restrictions";
import { useAsyncAction } from "../lib/use-async-action";
import { calendarDate, calendarDaysFromNow, formatCalendarDate } from "../lib/calendar";

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
  Trash2,
  UserCheck,
  UserRound,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  discipleshipStageLabels,
  discipleshipStageValues,
  faithStatusLabels,
  faithStatusValues,
  formatPhoneNumber,
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
  restrictionActions: RestrictionActions;
  onSelectResident?: (id?: string) => void;
  onOpenProperty: (propertyId: string) => void;
  onUpsertResident: (propertyId: string | undefined, input: ResidentInput, residentId?: string) => Promise<string>;
  onDeleteResident: (residentId: string) => Promise<unknown>;
  onAddPersonNote: (residentId: string, kind: PersonNoteKind, body: string) => Promise<unknown>;
  onDeletePersonNote: (noteId: string) => Promise<unknown>;
  onAddPersonFollowUp: (residentId: string, note: string, date: string) => Promise<unknown>;
  onOpenFollowUps: (residentId: string) => void;
  onHandoff?: (id: string, action: "request" | "accept" | "decline" | "cancel", owner?: string) => Promise<unknown>;
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

function dueState(followUp: FollowUp | undefined, timezone: string) {
  if (!followUp || followUp.status !== "scheduled") return "none" as const;
  const today = calendarDate(new Date(), timezone);
  const due = calendarDate(followUp.dueAt, timezone);
  if (due < today) return "overdue" as const;
  const upcoming = calendarDaysFromNow(7, timezone);
  return due <= upcoming ? "soon" as const : "later" as const;
}

export function PeopleView({
  data,
  canManage,
  activeVolunteerId,
  initialSelectedResidentId,
  onSelectResident,
  onOpenProperty,
  onUpsertResident,
  onDeleteResident,
  onAddPersonNote,
  onDeletePersonNote,
  onAddPersonFollowUp,
  onOpenFollowUps,
  onHandoff,
  restrictionActions,
}: PeopleViewProps) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<"all" | DiscipleshipStage>("all");
  const [owner, setOwner] = useState<"all" | "mine">("all");
  const [status, setStatus] = useState<"active" | "paused" | "archived" | "all">("active");
  const [sort, setSort] = useState<SortMode>("next_step");
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(initialSelectedResidentId ?? null);
  const selectedId = onSelectResident ? initialSelectedResidentId : localSelectedId;
  const setSelectedId = (id: string | null) => onSelectResident ? onSelectResident(id ?? undefined) : setLocalSelectedId(id);
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
        const property = properties.get(resident.propertyId ?? "");
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
  const due = data.residents.filter((resident) => ["overdue", "soon"].includes(dueState(followUpsByResident.get(resident.id)?.find((followUp) => followUp.status === "scheduled"), data.church.timezone))).length;

  const saveResident = async (propertyId: string | undefined, input: ResidentInput) => {
    const editing = editor && editor !== "new" ? editor : undefined;
    const residentId = await onUpsertResident(propertyId, input, editing?.id);
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
          {data.church.pathwayEnabled && <select aria-label="Filter by stage" value={stage} onChange={(event) => setStage(event.target.value as typeof stage)}><option value="all">Every stage</option>{discipleshipStageValues.map((value) => <option key={value} value={value}>{discipleshipStageLabels[value]}</option>)}</select>}
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
              const property = properties.get(resident.propertyId ?? "");
              const ownerRecord = volunteers.get(resident.assignedVolunteerId);
              const latestNote = notesByResident.get(resident.id)?.[0];
              const nextFollowUp = followUpsByResident.get(resident.id)?.find((followUp) => followUp.status === "scheduled");
              const nextStepState = dueState(nextFollowUp, data.church.timezone);
              return (
                <button className={`person-list-card${selectedId === resident.id ? " active" : ""}`} key={resident.id} onClick={() => setSelectedId(resident.id)}>
                  <span className="person-list-avatar">{personInitials(resident.name)}</span>
                  <span className="person-list-copy">
                    <span><strong>{resident.name || "Name not provided"}</strong><em className={`person-status-dot ${resident.status}`} title={resident.status} /></span>
                    {data.church.pathwayEnabled && <small>{discipleshipStageLabels[resident.discipleshipStage]}</small>}
                    <span className="person-list-meta"><span><UserRound size={11} /> {ownerRecord?.name ?? "Unknown owner"}</span>{property && <span><MapPin size={11} /> {property.address}</span>}</span>
                    {(nextFollowUp?.note || latestNote) && <p>{nextFollowUp?.note ?? latestNote?.body}</p>}
                    {nextFollowUp && <span className={`person-next-date ${nextStepState}`}><Clock3 size={11} /> {nextStepState === "overdue" ? "Overdue · " : ""}{formatCalendarDate(calendarDate(nextFollowUp.dueAt, data.church.timezone), { month: "short", day: "numeric" })}</span>}
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
            onOpenProperty={() => { if (selected.propertyId) onOpenProperty(selected.propertyId); }}
            onChangeStage={(nextStage) => onUpsertResident(selected.propertyId, residentInput(selected, { discipleshipStage: nextStage }), selected.id)}
            onChangeOwner={(assignedVolunteerId) => onHandoff ? onHandoff(selected.id, "request", assignedVolunteerId) : Promise.reject(new Error("Care handoffs require a connected workspace."))}
            onHandoffResponse={onHandoff ? (response) => onHandoff(selected.id, response) : undefined}
            onChangeStatus={(nextStatus) => onUpsertResident(selected.propertyId, residentInput(selected, { status: nextStatus }), selected.id)}
            onAddFollowUp={(note, date) => onAddPersonFollowUp(selected.id, note, date)}
            onOpenFollowUps={() => onOpenFollowUps(selected.id)}
            onAddNote={(kind, body) => onAddPersonNote(selected.id, kind, body)}
            onDeleteNote={onDeletePersonNote}
            restrictionActions={restrictionActions}
          />
        ) : <div className="people-profile-empty"><CircleUserRound size={32} /><strong>Select a person</strong><span>Their follow-up plan and complete note history will appear here.</span></div>}
      </div>

      {editor && <Modal title={editor === "new" ? "Add a person" : `Edit ${editor.name || "person"}`} description="Keep only details that help you care for this person well." wide onClose={() => setEditor(null)}><PersonEditor resident={editor === "new" ? undefined : editor} data={data} activeVolunteerId={activeVolunteerId} onCancel={() => setEditor(null)} onSave={saveResident} onDelete={editor !== "new" && (canManage || editor.assignedVolunteerId === activeVolunteerId) ? async () => { await onDeleteResident(editor.id); setSelectedId(null); setEditor(null); } : undefined} /></Modal>}
    </section>
  );
}

function PersonProfile({ resident, data, canManage, activeVolunteerId, onBack, onEdit, onOpenProperty, onChangeStage, onChangeOwner, onHandoffResponse, onChangeStatus, onAddFollowUp, onOpenFollowUps, onAddNote, onDeleteNote, restrictionActions }: {
  resident: Resident;
  data: NeighborWalkData;
  canManage: boolean;
  activeVolunteerId: string;
  onBack: () => void;
  onEdit: () => void;
  onOpenProperty: () => void;
  onChangeStage: (stage: DiscipleshipStage) => Promise<unknown>;
  onChangeOwner: (volunteerId: string) => Promise<unknown>;
  onHandoffResponse?: (action: "accept" | "decline" | "cancel") => Promise<unknown>;
  onChangeStatus: (status: Resident["status"]) => Promise<unknown>;
  onAddFollowUp: (note: string, date: string) => Promise<unknown>;
  onOpenFollowUps: () => void;
  onAddNote: (kind: PersonNoteKind, body: string) => Promise<unknown>;
  onDeleteNote: (noteId: string) => Promise<unknown>;
  restrictionActions: RestrictionActions;
}) {
  const [noteBody, setNoteBody] = useState("");
  const action = useAsyncAction();
  const handoffQueued = data.sync.commands?.some((q) => q.command.operations.some((op) => op.entityType === "handoff" && op.entityId === resident.id));
  const noContact = resident.contactPermission === "do_not_contact" || data.restrictions?.some((r) => r.active && r.residentId === resident.id && r.channel === "all");
  const property = data.properties.find((item) => item.id === resident.propertyId);
  const owner = data.volunteers.find((volunteer) => volunteer.id === resident.assignedVolunteerId);
  const timeline = personTimeline(data, resident.id);
  const personFollowUps = data.followUps.filter((followUp) => followUp.residentId === resident.id).sort((left, right) => left.dueAt.localeCompare(right.dueAt));
  const openFollowUps = personFollowUps.filter((followUp) => followUp.status === "scheduled");
  const nextFollowUp = openFollowUps[0];
  const nextState = dueState(nextFollowUp, data.church.timezone);
  const stageIndex = discipleshipStageValues.indexOf(resident.discipleshipStage);
  const noteValid = noteBody.trim().length > 0 && noteBody.length <= data.church.noteCharacterLimit;
  const canEdit = canManage || resident.assignedVolunteerId === activeVolunteerId;
  const sharedCount = resident.sharedWithTeamIds.length + resident.sharedWithVolunteerIds.length;

  return (
    <article className="person-profile">
      <header className="person-profile-header">
        <button className="person-profile-back" onClick={onBack}><ArrowLeft size={16} /> People</button>
        <div className="person-profile-identity">
          <span className="person-profile-avatar">{personInitials(resident.name)}</span>
          <div><span className={`person-profile-status ${resident.status}`}>{resident.status}</span><h2>{resident.name || "Name not provided"}</h2>{data.church.pathwayEnabled && <p className="person-profile-signals"><span className="person-faith-status">{faithStatusLabels[resident.faithStatus]}</span><span>{discipleshipStageLabels[resident.discipleshipStage]}</span></p>}<small className="person-privacy-summary"><LockKeyhole size={12} /> {sharedCount ? `Shared with ${sharedCount} additional ${sharedCount === 1 ? "group or person" : "groups or people"}` : "Visible to the responsible owner and church leaders"}</small></div>
          {canEdit && <button className="button quiet small" onClick={onEdit}><Edit3 size={14} /> Edit profile</button>}
        </div>
        <div className="person-profile-contact">
          {!contactRestricted(data, resident.id, "call") && resident.phone && <a href={`tel:${resident.phone}`}><Phone size={14} /><span><small>{resident.preferredContact === "call" ? "Preferred" : "Phone"}</small><strong>{formatPhoneNumber(resident.phone)}</strong></span></a>}
          {!contactRestricted(data, resident.id, "email") && resident.email && <a href={`mailto:${resident.email}`}><Mail size={14} /><span><small>{resident.preferredContact === "email" ? "Preferred" : "Email"}</small><strong>{resident.email}</strong></span></a>}
          {property && <button onClick={onOpenProperty}><MapPin size={14} /><span><small>Home</small><strong>{property.address}{property.unit ? ` · ${property.unit}` : ""}</strong></span></button>}
        </div>
      </header>

      {noContact && <p role="status" className="inline-notice">Do not contact. No new follow-ups should be scheduled. Only a leader can lift the recorded restriction with a reason.</p>}
      {resident.legacyCreatorAccess && <p className="inline-notice">Historical creator access is preserved until an accepted care handoff. Explicit sharing is listed in Edit profile.</p>}
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}
      {data.church.pathwayEnabled && <section className="discipleship-path" aria-label="Discipleship relationship stage">
        <div><span className="profile-section-label">Relationship path</span><small>Use stages as shared context, never as a score.</small></div>
        <div className="discipleship-path-rail">
          {discipleshipStageValues.map((stage, index) => <button key={stage} disabled={!canEdit} className={`${index < stageIndex ? "passed" : ""}${stage === resident.discipleshipStage ? " current" : ""}`} onClick={() => void action.run(() => onChangeStage(stage))} aria-current={stage === resident.discipleshipStage ? "step" : undefined}><span>{index < stageIndex ? <CheckCircle2 size={13} /> : index + 1}</span><small>{discipleshipStageLabels[stage]}</small></button>)}
        </div>
      </section>}

      <div className="person-care-grid">
        <section className="care-owner-card">
          <span className="profile-section-label">Responsible person</span>
          <div><span className="care-owner-avatar">{personInitials(owner?.name)}</span><div><strong>{owner?.name ?? "Choose an owner"}</strong><small>Responsible for keeping the relationship moving</small></div></div>
          {resident.pendingOwnerId ? <div className="handoff-panel"><p>Handoff waiting for {data.volunteers.find((v) => v.id === resident.pendingOwnerId)?.name ?? "the recipient"}. The current owner remains responsible until acceptance.</p>
            {onHandoffResponse && (resident.pendingOwnerId === activeVolunteerId
              ? <><button disabled={action.busy || handoffQueued} className="button primary small" onClick={() => void action.run(() => onHandoffResponse("accept"))}>Accept care &amp; open tasks</button><button disabled={action.busy || handoffQueued} className="button quiet small" onClick={() => void action.run(() => onHandoffResponse("decline"))}>Decline</button></>
              : canEdit && <button disabled={action.busy || handoffQueued} onClick={() => void action.run(() => onHandoffResponse("cancel"))}>Cancel request</button>)}</div>
            : canEdit && <label><span>Request care handoff</span><select value="" disabled={action.busy || handoffQueued} onChange={(event) => { const id = event.target.value; if (id && window.confirm("Invite this person to take responsibility? They will see the profile to review the request. You remain responsible until they accept. Acceptance transfers your open tasks and removes historical creator-only access.")) void action.run(() => onChangeOwner(id)); }}><option value="">Choose a recipient</option>{data.volunteers.filter((v) => v.active && v.id !== resident.assignedVolunteerId).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>}
          {handoffQueued && <p role="status">Handoff change saved on this device; waiting for the church to confirm.</p>}
        </section>
        <section className={`care-next-card ${nextState}`}>
          <div><span className="profile-section-label">Follow-up plan</span>{nextFollowUp && <em><CalendarClock size={12} /> {nextState === "overdue" ? "Overdue · " : ""}{formatCalendarDate(calendarDate(nextFollowUp.dueAt, data.church.timezone), { month: "long", day: "numeric" })}</em>}</div>
          {nextFollowUp ? <p>{nextFollowUp.note || "Follow up with this person."}</p> : <p className="care-next-empty">No open follow-up is planned.</p>}
          {openFollowUps.length > 1 && <small>{openFollowUps.length - 1} more open {openFollowUps.length === 2 ? "task" : "tasks"}</small>}
          <div className="care-next-actions">{canEdit && !noContact && <FollowUpPlanner timezone={data.church.timezone} defaultDays={data.church.defaultFollowUpDays} noteLimit={data.church.noteCharacterLimit} onSave={onAddFollowUp} />}<button onClick={onOpenFollowUps}>Open follow-ups <ChevronRight size={13} /></button></div>
        </section>
      </div>

      <ContactRestrictions data={data} residentId={resident.id} canManage={canManage} actions={restrictionActions} />
      <section className="person-notes-section">
        <div className="person-notes-heading"><div><span className="profile-section-label">Notes</span><h3>One clear history</h3></div><span>{timeline.length} activity entries</span></div>
        <div className="person-note-composer">
          <div><MessageCircle size={17} /><strong>Add a note</strong><small>Every person note goes here.</small></div>
          <div className="person-note-fields"><textarea aria-label="Care note" rows={3} maxLength={data.church.noteCharacterLimit + 1} value={noteBody} onChange={(event) => setNoteBody(event.target.value)} placeholder="What should you remember for next time?" /></div>
          <div><span className={noteBody.length > data.church.noteCharacterLimit ? "over" : ""}>{data.church.noteCharacterLimit - noteBody.length} characters remaining</span><button className="button primary small" disabled={!noteValid || action.busy} onClick={() => void action.run(() => onAddNote("general", noteBody), () => setNoteBody(""))}><NotebookPen size={14} /> Save note</button></div>
        </div>
        <div className="person-timeline">
          {timeline.map((note) => {
            const author = data.volunteers.find((volunteer) => volunteer.id === note.actorId);
            const canDelete = Boolean(note.noteId) && (canManage || note.actorId === activeVolunteerId);
            return <article className="person-timeline-entry general" key={note.id}><span className="person-timeline-mark"><MessageCircle size={14} /></span><div><div><span>{note.title}</span><time>{new Intl.DateTimeFormat("en-US", { timeZone: data.church.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(note.at))}</time></div>{note.body && <p>{note.body}</p>}<footer><span>{author?.name ?? "Church record"}</span>{canDelete && <button onClick={() => { if (window.confirm("Archive this note from the active profile? Its audit entry remains.")) void action.run(() => onDeleteNote(note.noteId!)); }} aria-label="Archive note"><Trash2 size={12} /></button>}</footer></div></article>;
          })}
          {!timeline.length && <div className="person-timeline-empty"><NotebookPen size={22} /><strong>No activity yet</strong><span>Add the first note above. Notes follow your church’s retention and archival policy.</span></div>}
        </div>
      </section>

      <footer className="person-profile-footer">
        <div><PauseCircle size={14} /><span><strong>Tracking status</strong><small>Paused people remain searchable; archived people leave the active list.</small></span></div>
        <select value={resident.status} disabled={!canEdit} onChange={(event) => { const status = event.target.value as Resident["status"]; void action.run(() => onChangeStatus(status)); }}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select>
      </footer>
    </article>
  );
}

function FollowUpPlanner({ defaultDays, noteLimit, timezone, onSave }: { timezone: string; defaultDays: number; noteLimit: number; onSave: (note: string, date: string) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const action = useAsyncAction();
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState(calendarDaysFromNow(defaultDays, timezone));
  const valid = Boolean(note.trim() && dueDate && note.length <= noteLimit);
  if (!editing) return <button onClick={() => setEditing(true)}>Plan follow-up <Plus size={13} /></button>;
  return <div className="next-step-inline-editor">
    <label><span>What needs to happen?</span><input maxLength={noteLimit + 1} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Invite them for coffee" /></label>
    <label><span>Due date</span><input type="date" min={calendarDate(new Date(), timezone)} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
    <div><button className="button quiet small" onClick={() => { setNote(""); setDueDate(calendarDaysFromNow(defaultDays, timezone)); setEditing(false); }}>Cancel</button><button className="button primary small" disabled={!valid || action.busy} onClick={() => void action.run(() => onSave(note.trim(), dueDate), () => { setNote(""); setEditing(false); })}>Add follow-up</button></div>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
  </div>;
}

function PersonEditor({ resident, data, activeVolunteerId, onCancel, onSave, onDelete }: {
  resident?: Resident; data: NeighborWalkData; activeVolunteerId: string; onCancel: () => void;
  onSave: (propertyId: string | undefined, input: ResidentInput) => Promise<unknown>; onDelete?: () => Promise<unknown>;
}) {
  const [propertyId, setPropertyId] = useState(resident?.propertyId ?? "");
  const [name, setName] = useState(resident?.name ?? "");
  const [faithStatus, setFaithStatus] = useState(resident?.faithStatus ?? "not_discussed");
  const [discipleshipStage, setDiscipleshipStage] = useState(resident?.discipleshipStage ?? "new_connection");
  const assignedVolunteerId = resident?.assignedVolunteerId ?? activeVolunteerId;
  const [status, setStatus] = useState(resident?.status ?? "active");
  const [phone, setPhone] = useState(resident?.phone ?? "");
  const [email, setEmail] = useState(resident?.email ?? "");
  const [preferredContact, setPreferredContact] = useState(resident?.preferredContact ?? "none");
  const [contactPermission, setContactPermission] = useState(resident?.contactPermission ?? "not_recorded");
  const [sharedWithVolunteerIds, setSharedWithVolunteerIds] = useState(resident?.sharedWithVolunteerIds ?? []);
  const [sharedWithTeamIds, setSharedWithTeamIds] = useState(resident?.sharedWithTeamIds ?? []);
  const action = useAsyncAction();
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  const contactValid = preferredContact === "email" ? Boolean(email.trim()) : ["text", "call"].includes(preferredContact) ? Boolean(phone.trim()) : true;
  return <form className="person-editor-form form-stack" aria-busy={action.busy} onSubmit={(event) => {
    event.preventDefault();
    void action.run(() => onSave(propertyId || undefined, { name: name.trim() || undefined, faithStatus, discipleshipStage, assignedVolunteerId,
      sharedWithVolunteerIds: sharedWithVolunteerIds.filter((id) => id !== assignedVolunteerId), sharedWithTeamIds, status, phone: phone.trim() || undefined,
      email: email.trim() || undefined, preferredContact, contactPermission, lastContactAt: resident?.lastContactAt }));
  }}>
    <div className="person-editor-grid">
      <label>Name or useful identifying description<input value={name} required={!resident} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="First name or a respectful description" /></label>
      <label>Home or meeting location (optional)<select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}><option value="">No address provided</option>{data.properties.map((p) => <option key={p.id} value={p.id}>{p.address}{p.unit ? " · " + p.unit : ""}</option>)}</select></label>
      <label>Phone (optional)<input type="tel" autoComplete="off" value={phone} maxLength={40} minLength={3} onChange={(e) => setPhone(e.target.value)} /></label>
      <label>Email (optional)<input type="email" autoComplete="off" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Preferred contact<select value={preferredContact} onChange={(e) => setPreferredContact(e.target.value as Resident["preferredContact"])}><option value="none">Not discussed</option><option value="call">Phone call</option><option value="text">Text message</option><option value="email">Email</option></select></label>
      <label>Contact request<select value={contactPermission} disabled={resident?.contactPermission === "do_not_contact"} onChange={(e) => setContactPermission(e.target.value as NonNullable<Resident["contactPermission"]>)}><option value="not_recorded">Not recorded — ask before contacting</option><option value="requested">The neighbor requested contact</option><option value="do_not_contact">Do not contact</option></select></label>
      <label>Tracking status<select value={status} onChange={(e) => setStatus(e.target.value as Resident["status"])}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select></label>
      {data.church.pathwayEnabled && <><label>Self-described faith (optional)<select value={faithStatus} onChange={(e) => setFaithStatus(e.target.value as Resident["faithStatus"])}>{faithStatusValues.map((v) => <option key={v} value={v}>{faithStatusLabels[v]}</option>)}</select></label><label>Relationship stage<select value={discipleshipStage} onChange={(e) => setDiscipleshipStage(e.target.value as DiscipleshipStage)}>{discipleshipStageValues.map((v) => <option key={v} value={v}>{discipleshipStageLabels[v]}</option>)}</select></label></>}
    </div>
    <p><strong>Responsible person:</strong> {data.volunteers.find((v) => v.id === assignedVolunteerId)?.name ?? "You"}. Ownership changes through an accepted care handoff.</p>
    <details className="person-sharing-section"><summary>Who can see this profile?</summary>
      <p>The responsible person and church leaders can see it. Share only with people helping with care. Historical creator access, if present, is shown on the profile and ends at an accepted handoff.</p>
      <fieldset><legend>Specific people</legend>{data.volunteers.filter((v) => v.active && v.id !== assignedVolunteerId).map((v) => <label key={v.id}><input type="checkbox" checked={sharedWithVolunteerIds.includes(v.id)} onChange={() => setSharedWithVolunteerIds((ids) => toggle(ids, v.id))} /> {v.name}</label>)}</fieldset>
      {!!data.teams.length && <fieldset><legend>Groups</legend>{data.teams.map((t) => <label key={t.id}><input type="checkbox" checked={sharedWithTeamIds.includes(t.id)} onChange={() => setSharedWithTeamIds((ids) => toggle(ids, t.id))} /> {t.name}</label>)}</fieldset>}
    </details>
    {!contactValid && <p className="inline-error">Enter the phone number or email for the selected contact method.</p>}
    {action.error && <p className="inline-error" role="alert">{action.error}</p>}
    <div className="modal-actions split"><div>{onDelete && <button type="button" className="button danger" disabled={action.busy} onClick={() => { if (window.confirm("Archive this person and their care records? Open tasks will be cancelled. The server preserves history and restrictions; this is not permanent erasure.")) void action.run(onDelete); }}>Archive person &amp; care records</button>}</div><div><button type="button" className="button quiet" disabled={action.busy} onClick={onCancel}>Cancel</button><button className="button primary" disabled={action.busy || !contactValid}>{action.busy ? "Saving to device…" : "Save person"}</button></div></div>
  </form>;
}
