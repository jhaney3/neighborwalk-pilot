"use client";

import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BookOpenText,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Church,
  ClipboardCheck,
  CloudOff,
  Database,
  Download,
  Copy,
  Edit3,
  FileJson,
  History,
  LockKeyhole,
  LogOut,
  Mail,
  Map as MapIcon,
  MapPinned,
  MessageCircle,
  Navigation,
  Plus,
  RefreshCcw,
  Save,
  ShieldCheck,
  Smartphone,
  Star,
  Phone,
  Trash2,
  Upload,
  UserRound,
  Users,
  Wifi,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  dateInputValue,
  createId,
  faithStatusLabels,
  formatPhoneNumber,
  formatDateTime,
  isFollowUpOverdue,
  isSafeWebUrl,
  outcomeMeta,
  type FollowUp,
  type FollowUpCompletionInput,
  type ConversationGuide,
  type ConversationGuideInput,
  type GuideStep,
  type NeighborWalkData,
  type Outcome,
  type Property,
  type Resident,
  type Territory,
  type TeamUpdate,
} from "../lib/domain";
import { makeBlankGuideStep, validGuideInput } from "../lib/conversation-guides";
import { coverageForTerritory, type TerritoryCoverageById } from "../lib/territory-coverage";
import type { WorkspaceMembership } from "../lib/use-neighborwalk";
import { MembersPanel } from "./MembersPanel";
import { ScriptureReader } from "./ScriptureReader";

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
    const residents = new Map<string, Resident[]>();
    for (const resident of data.residents) {
      residents.set(resident.propertyId, [...(residents.get(resident.propertyId) ?? []), resident]);
    }
    for (const propertyResidents of residents.values()) {
      propertyResidents.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    }
    return residents;
  }, [data.residents]);
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
      const normalizedQuery = query.trim().toLowerCase();
      if (!normalizedQuery) return true;
      const relevantResidents = followUp.residentId
        ? data.residents.filter((resident) => resident.id === followUp.residentId)
        : residentMap.get(followUp.propertyId) ?? [];
      const residentText = relevantResidents.flatMap((resident) => [
        resident.name,
        resident.phone,
        resident.email,
        faithStatusLabels[resident.faithStatus],
      ]).filter(Boolean).join(" ");
      const noteText = followUp.residentId ? data.personNotes.filter((note) => note.residentId === followUp.residentId).map((note) => note.body).join(" ") : "";
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
            const personNotes = followUp.residentId ? data.personNotes.filter((note) => note.residentId === followUp.residentId) : [];
            const owner = followUp.residentId ? data.volunteers.find((volunteer) => volunteer.id === residents[0]?.assignedVolunteerId) : undefined;
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

export function GuideView({
  guides,
  favoriteGuideId,
  effectiveGuideId,
  activeTeamId,
  activeTeamName,
  teams,
  teamGuideDefaults,
  canManage,
  allowBuiltInManagement,
  libraryError,
  onSave,
  onDelete,
  onSetFavorite,
  onSetTeamDefault,
}: {
  guides: ConversationGuide[];
  favoriteGuideId?: string;
  effectiveGuideId?: string;
  activeTeamId?: string;
  activeTeamName?: string;
  teams: NeighborWalkData["teams"];
  teamGuideDefaults: Record<string, string>;
  canManage: boolean;
  allowBuiltInManagement: boolean;
  libraryError?: string | null;
  onSave: (input: ConversationGuideInput) => Promise<ConversationGuide>;
  onDelete: (guideId: string) => Promise<void>;
  onSetFavorite: (guideId: string) => Promise<void>;
  onSetTeamDefault: (teamId: string, guideId?: string) => Promise<void>;
}) {
  const [selectedGuideId, setSelectedGuideId] = useState(effectiveGuideId ?? favoriteGuideId ?? guides[0]?.id ?? "");
  const [index, setIndex] = useState(0);
  const [editor, setEditor] = useState<{ guide?: ConversationGuide; scope: ConversationGuide["scope"]; copy?: boolean } | null>(null);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [savingTeamId, setSavingTeamId] = useState<string>();
  const selectedGuide = guides.find((guide) => guide.id === selectedGuideId)
    ?? guides.find((guide) => guide.id === favoriteGuideId)
    ?? guides[0];
  const steps = selectedGuide?.steps ?? [];
  const step = steps[index] ?? steps[0];
  const canUseBuiltInActions = (guide: ConversationGuide) => guide.id !== "legacy_church_guide" || allowBuiltInManagement;
  const canEditSelected = Boolean(selectedGuide && canUseBuiltInActions(selectedGuide) && (selectedGuide.scope === "personal" || canManage));
  const churchGuides = guides.filter((guide) => guide.scope === "church" && canUseBuiltInActions(guide));

  const chooseGuide = (guideId: string) => {
    setSelectedGuideId(guideId);
    setIndex(0);
    setMessage("");
    setMessageError(false);
  };

  const makeFavorite = async (guideId: string) => {
    try {
      await onSetFavorite(guideId);
      setSelectedGuideId(guideId);
      setIndex(0);
      setMessage("Favorite guide saved. A group default can still take priority while you are working with that group.");
      setMessageError(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The favorite guide could not be saved.");
      setMessageError(true);
    }
  };

  const setTeamDefault = async (teamId: string, guideId?: string) => {
    setSavingTeamId(teamId);
    setMessage("");
    setMessageError(false);
    try {
      await onSetTeamDefault(teamId, guideId);
      if (teamId === activeTeamId) {
        setSelectedGuideId(guideId ?? favoriteGuideId ?? churchGuides[0]?.id ?? guides[0]?.id ?? "");
        setIndex(0);
      }
      const team = teams.find((item) => item.id === teamId);
      setMessage(guideId ? `${team?.name ?? "Group"} will open with this church guide.` : `${team?.name ?? "Group"} will use each volunteer’s favorite guide.`);
      setMessageError(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The group default could not be saved.");
      setMessageError(true);
    } finally {
      setSavingTeamId(undefined);
    }
  };

  return (
    <div className="content-view guide-view">
      <ViewHeading
        eyebrow="A steadying hand in the moment"
        title="Conversation guides"
        description="Choose a church method or shape a private guide around your own testimony and scripture."
        aside={<div className="guide-create-actions"><button className="button quiet" onClick={() => setEditor({ scope: "personal" })}><UserRound size={15} /> New personal guide</button>{canManage && <button className="button primary" onClick={() => setEditor({ scope: "church" })}><Plus size={15} /> New church guide</button>}</div>}
      />

      <section className="guide-library" aria-labelledby="guide-library-title">
        <div className="guide-library-heading"><div><p className="eyebrow">Guide shelf</p><h2 id="guide-library-title">Pick the method that fits this conversation.</h2></div><span>{guides.filter((guide) => guide.scope === "church").length} church · {guides.filter((guide) => guide.scope === "personal").length} personal</span></div>
        {guides.length ? <div className="guide-library-list">
          {guides.map((guide) => {
            const favorite = guide.id === favoriteGuideId;
            const selected = guide.id === selectedGuide?.id;
            return <article className={`guide-library-item${selected ? " selected" : ""}`} key={guide.id}>
              <button className="guide-library-choice" onClick={() => chooseGuide(guide.id)} aria-pressed={selected}>
                <span className={`guide-scope-mark ${guide.scope}`}>{guide.scope === "church" ? <Church size={15} /> : <LockKeyhole size={15} />}</span>
                <span><small>{guide.scope === "church" ? "Church guide" : "Only me"}</small><strong>{guide.title}</strong><em>{guide.description || `${guide.steps.length} conversation steps`}</em></span>
              </button>
              {canUseBuiltInActions(guide) && <button className={`guide-favorite-button${favorite ? " active" : ""}`} onClick={() => void makeFavorite(guide.id)} aria-label={favorite ? `${guide.title} is your favorite guide` : `Make ${guide.title} your favorite guide`} aria-pressed={favorite}><Star size={16} fill={favorite ? "currentColor" : "none"} /></button>}
            </article>;
          })}
        </div> : <div className="guide-library-empty"><BookOpenText size={22} /><div><strong>No conversation guides yet</strong><span>Create a private guide for yourself, or ask a leader to publish a church guide.</span></div></div>}
      </section>

      {canManage && <section className="guide-group-defaults" aria-labelledby="guide-group-defaults-title">
        <div className="guide-library-heading"><div><p className="eyebrow">Leader controls</p><h2 id="guide-group-defaults-title">Group defaults</h2></div><span>Optional</span></div>
        <div className="guide-group-warning"><AlertTriangle size={17} /><span><strong>A group default overrides personal favorites.</strong> Members of that group will open the selected church guide at the doorstep, even if they chose another favorite. Choose “Use each volunteer’s favorite” to remove the override.</span></div>
        {teams.length ? <div className="guide-group-default-list">
          {teams.map((team) => <label className="guide-group-default-row" key={team.id}>
            <span><strong>{team.name}</strong><small>{team.memberIds.length} {team.memberIds.length === 1 ? "volunteer" : "volunteers"} · {team.status}</small></span>
            <select value={teamGuideDefaults[team.id] ?? ""} disabled={savingTeamId === team.id || churchGuides.length === 0} onChange={(event) => void setTeamDefault(team.id, event.target.value || undefined)} aria-label={`Default conversation guide for ${team.name}`}>
              <option value="">Use each volunteer’s favorite</option>
              {churchGuides.map((guide) => <option value={guide.id} key={guide.id}>{guide.title}</option>)}
            </select>
          </label>)}
        </div> : <div className="guide-library-empty"><Users size={22} /><div><strong>No groups yet</strong><span>Create a group in Leader view before assigning a default guide.</span></div></div>}
      </section>}

      {activeTeamName && effectiveGuideId && teamGuideDefaults[activeTeamId ?? ""] === effectiveGuideId && <div className="guide-library-message group-default" role="status"><Users size={15} /><span><strong>{activeTeamName} default:</strong> {guides.find((guide) => guide.id === effectiveGuideId)?.title}. This takes priority over your personal favorite while you work with this group.</span></div>}

      {(message || libraryError) && <div className={`guide-library-message${libraryError || messageError ? " error" : ""}`} role={libraryError || messageError ? "alert" : "status"}>{libraryError || messageError ? <AlertTriangle size={15} /> : <Check size={15} />}<span>{libraryError || message}</span></div>}

      {selectedGuide && step ? <>
        <section className="guide-active-heading">
          <div><span className={`guide-scope-label ${selectedGuide.scope}`}>{selectedGuide.scope === "church" ? <Church size={13} /> : <LockKeyhole size={13} />}{selectedGuide.scope === "church" ? "Church guide" : "Private guide"}</span><h2>{selectedGuide.title}</h2><p>{selectedGuide.description || `${steps.length} conversation steps`}</p></div>
          <div className="guide-active-actions">
            {canUseBuiltInActions(selectedGuide) && selectedGuide.id !== favoriteGuideId && <button className="button quiet" onClick={() => void makeFavorite(selectedGuide.id)}><Star size={15} /> Set as favorite</button>}
            {selectedGuide.scope === "church" && <button className="button quiet" onClick={() => setEditor({ guide: selectedGuide, scope: "personal", copy: true })}><Copy size={15} /> Make a private copy</button>}
            {canEditSelected && <button className="button quiet" onClick={() => setEditor({ guide: selectedGuide, scope: selectedGuide.scope })}><Edit3 size={15} /> Edit guide</button>}
          </div>
        </section>
        <div className="guide-layout">
          <div className="guide-step-list" role="tablist" aria-label={`${selectedGuide.title} steps`}>
            {steps.map((item, itemIndex) => (
              <button key={item.id} className={itemIndex === index ? "active" : ""} onClick={() => setIndex(itemIndex)} role="tab" aria-selected={itemIndex === index}>
                <span>{itemIndex + 1}</span><div><small>{item.eyebrow}</small><strong>{item.title}</strong></div><ChevronRight size={16} />
              </button>
            ))}
          </div>
          <article className="guide-card" role="tabpanel">
            <div className="guide-progress"><span style={{ width: `${((index + 1) / steps.length) * 100}%` }} /></div>
            <p className="eyebrow">Step {index + 1} of {steps.length} · {step.eyebrow}</p>
            <h2>{step.title}</h2>
            {step.sampleWords && <blockquote><MessageCircle size={20} /><p>“{step.sampleWords}”</p></blockquote>}
            <ScriptureReader references={step.scriptureReferences} />
            <div className="guide-actions"><button className="button inverted" disabled={index === 0} onClick={() => setIndex((current) => Math.max(0, current - 1))}>Previous</button><button className="button amber" disabled={index === steps.length - 1} onClick={() => setIndex((current) => Math.min(steps.length - 1, current + 1))}>Next step <ArrowRight size={15} /></button></div>
          </article>
        </div>
      </> : <EmptyState icon={<BookOpenText size={25} />} title="Build your first guide" copy="Personal guides stay private. Church guides are published by leaders for everyone." />}

      {editor && <GuideComposer
        guide={editor.guide}
        scope={editor.scope}
        copy={editor.copy}
        onClose={() => setEditor(null)}
        onSave={async (input) => {
          const saved = await onSave(input);
          setSelectedGuideId(saved.id);
          setIndex(0);
          setEditor(null);
          setMessage(saved.scope === "church" ? "Church guide published." : "Private guide saved.");
          setMessageError(false);
        }}
        onDelete={editor.guide && !editor.copy ? async () => {
          await onDelete(editor.guide!.id);
          setEditor(null);
          setIndex(0);
          setMessage("Guide deleted.");
          setMessageError(false);
        } : undefined}
      />}
    </div>
  );
}

function GuideComposer({ guide, scope, copy = false, onClose, onSave, onDelete }: {
  guide?: ConversationGuide;
  scope: ConversationGuide["scope"];
  copy?: boolean;
  onClose: () => void;
  onSave: (input: ConversationGuideInput) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<ConversationGuideInput>(() => ({
    id: copy ? undefined : guide?.id,
    scope,
    title: copy ? `${guide?.title ?? "Guide"} — my version` : guide?.title ?? "",
    description: guide?.description ?? "",
    steps: guide?.steps.map((step) => ({ ...step, id: copy ? createId("guide_step") : step.id })) ?? [makeBlankGuideStep(1)],
  }));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const valid = validGuideInput(draft);

  const updateStep = (index: number, patch: Partial<GuideStep>) => {
    setDraft((current) => ({ ...current, steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step) }));
  };
  const moveStep = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.steps.length) return current;
      const steps = [...current.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...current, steps: steps.map((step, stepIndex) => ({ ...step, order: stepIndex + 1 })) };
    });
  };
  const removeStep = (index: number) => {
    setDraft((current) => ({ ...current, steps: current.steps.filter((_, stepIndex) => stepIndex !== index).map((step, stepIndex) => ({ ...step, order: stepIndex + 1 })) }));
  };

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The guide could not be saved.");
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!onDelete) return;
    setDeleting(true);
    setError("");
    try {
      await onDelete();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The guide could not be deleted.");
      setDeleting(false);
    }
  };

  return <Modal
    wide
    title={copy ? "Make a private copy" : guide ? "Edit conversation guide" : scope === "church" ? "Create a church guide" : "Create a personal guide"}
    description={scope === "church" ? "Everyone in the church can use this guide. Only leaders can change it." : "Only you can see and use this guide."}
    onClose={onClose}
  >
    <div className={`guide-composer-privacy ${scope}`}>
      {scope === "church" ? <Church size={17} /> : <LockKeyhole size={17} />}
      <span><strong>{scope === "church" ? "Church-wide" : "Only me"}</strong>{scope === "church" ? "Published to every volunteer in this church workspace." : "Private to your signed-in account, including across your devices."}</span>
    </div>
    <div className="form-stack guide-composer-meta">
      <label className="form-field"><span>Guide name</span><input maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={scope === "church" ? "Romans Road" : "My testimony and key scriptures"} /></label>
      <label className="form-field"><span>Short description <small>Optional</small></span><textarea maxLength={500} rows={2} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="When this guide is most helpful" /></label>
    </div>
    <div className="guide-composer-heading"><div><p className="eyebrow">Conversation path</p><strong>{draft.steps.length} {draft.steps.length === 1 ? "step" : "steps"}</strong></div><span>Each step needs words, scripture, or both.</span></div>
    <div className="guide-composer-steps">
      {draft.steps.map((step, stepIndex) => <section className="guide-composer-step" key={step.id}>
        <header><span>{stepIndex + 1}</span><strong>{step.title || "Untitled step"}</strong><div><button type="button" disabled={stepIndex === 0} onClick={() => moveStep(stepIndex, -1)} aria-label={`Move step ${stepIndex + 1} up`}><ChevronUp size={15} /></button><button type="button" disabled={stepIndex === draft.steps.length - 1} onClick={() => moveStep(stepIndex, 1)} aria-label={`Move step ${stepIndex + 1} down`}><ChevronDown size={15} /></button><button type="button" disabled={draft.steps.length === 1} onClick={() => removeStep(stepIndex)} aria-label={`Delete step ${stepIndex + 1}`}><Trash2 size={15} /></button></div></header>
        <div className="guide-composer-step-fields">
          <label className="form-field"><span>Stage label</span><input maxLength={80} value={step.eyebrow} onChange={(event) => updateStep(stepIndex, { eyebrow: event.target.value })} placeholder="Share clearly" /></label>
          <label className="form-field"><span>Step title</span><input maxLength={120} value={step.title} onChange={(event) => updateStep(stepIndex, { title: event.target.value })} placeholder="Explain the good news" /></label>
          <label className="form-field full"><span>Words or testimony notes <small>Optional when scripture is added</small></span><textarea maxLength={1600} rows={4} value={step.sampleWords} onChange={(event) => updateStep(stepIndex, { sampleWords: event.target.value })} placeholder="Write the words you want available at the door. This can be a prompt, your testimony, or a transition." /></label>
          <label className="form-field full"><span>Scripture references <small>Separate with commas</small></span><input maxLength={1200} value={step.scriptureReferences.join(", ")} onChange={(event) => updateStep(stepIndex, { scriptureReferences: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="Romans 3:23, Romans 6:23" /></label>
        </div>
      </section>)}
    </div>
    <button className="guide-add-step" type="button" disabled={draft.steps.length >= 24} onClick={() => setDraft((current) => ({ ...current, steps: [...current.steps, makeBlankGuideStep(current.steps.length + 1)] }))}><Plus size={15} /> Add another step</button>
    {error && <div className="guide-library-message error" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}
    {confirmDelete && <div className="guide-delete-confirm"><AlertTriangle size={16} /><span><strong>Delete “{guide?.title}”?</strong>This cannot be undone. Other guides and recorded visits are unaffected.</span></div>}
    <div className="modal-actions split">
      {onDelete ? <button className="button danger" disabled={saving || deleting} onClick={() => confirmDelete ? void remove() : setConfirmDelete(true)}>{confirmDelete ? "Delete guide" : "Delete"}</button> : <span />}
      <div><button className="button quiet" disabled={saving || deleting} onClick={onClose}>Cancel</button><button className="button primary" disabled={!valid || saving || deleting} onClick={() => void save()}><Save size={15} /> {saving ? "Saving…" : scope === "church" ? "Publish guide" : "Save private guide"}</button></div>
    </div>
  </Modal>;
}

export function LeaderView({ data, coverageByTerritory, membership, activeTerritory, onSelectTerritory, onEditTerritory, onStartDrawing, onAddTeam, onUpdateTeam, onDeleteTeam }: {
  data: NeighborWalkData;
  coverageByTerritory: TerritoryCoverageById;
  membership?: WorkspaceMembership | null;
  activeTerritory: Territory;
  onSelectTerritory: (id: string) => void;
  onEditTerritory: (id: string) => void;
  onStartDrawing: () => void;
  onAddTeam: (update: TeamUpdate) => string;
  onUpdateTeam: (teamId: string, update: TeamUpdate) => void;
  onDeleteTeam: (teamId: string) => void;
}) {
  const activeCoverage = coverageByTerritory[activeTerritory.id]
    ?? coverageForTerritory(data, activeTerritory.id);
  const activeProperties = data.properties.filter((property) => property.territoryId === activeTerritory.id);
  const touchedLocations = activeProperties.filter((property) => property.currentOutcome !== "unvisited").length;
  const count = (outcome: Outcome) => activeProperties.filter((property) => property.currentOutcome === outcome).length;
  const scheduledFollowUps = data.followUps.filter((followUp) => followUp.status === "scheduled").length;

  return (
    <div className="content-view leader-view">
      <ViewHeading eyebrow={`${activeTerritory.name} · Coordination`} title="Leader view" description="Plan territories and support volunteers without ranking residents or spiritual outcomes." aside={<button className="button primary" onClick={onStartDrawing}><Plus size={15} /> Draw territory</button>} />
      <div className="leader-metrics">
        <Metric icon={<Navigation size={19} />} label="Residential coverage" value={`${activeCoverage.percent}%`} detail={`${activeCoverage.touched} of ${activeCoverage.total} residential properties touched`} progress={activeCoverage.percent} />
        <Metric icon={<CalendarClock size={19} />} label="Open follow-ups" value={String(scheduledFollowUps)} detail="Scheduled return visits" tone="amber" />
        <Metric icon={<Users size={19} />} label="Active teams" value={String(data.teams.filter((team) => team.status === "active").length)} detail={`${data.volunteers.filter((volunteer) => volunteer.active).length} volunteers available`} tone="blue" />
      </div>

      {membership?.role === "leader" && <MembersPanel membership={membership} teams={data.teams} onAddTeam={onAddTeam} onUpdateTeam={onUpdateTeam} onDeleteTeam={onDeleteTeam} />}

      <section className="leader-section">
        <div className="section-heading"><div><p className="eyebrow">Assignments</p><h2>Territories</h2></div><span>{data.territories.length} total</span></div>
        <div className="territory-grid">
          {data.territories.map((territory) => {
            const coverage = coverageByTerritory[territory.id]
              ?? coverageForTerritory(data, territory.id);
            const team = data.teams.find((item) => item.id === territory.assignedTeamId);
            return (
              <div key={territory.id} className={`territory-card${territory.id === activeTerritory.id ? " active" : ""}`} style={{ "--territory-color": territory.color } as React.CSSProperties}>
                <button className="territory-card-select" onClick={() => onSelectTerritory(territory.id)} aria-label={`Open ${territory.name}`}>
                  <span className="territory-card-map"><MapPinned size={21} /><span>{coverage.percent}%</span></span>
                  <span className="territory-card-copy"><strong>{territory.name}</strong><small>{team?.name ?? "Unassigned"}</small></span>
                  <span className="tiny-progress"><i style={{ width: `${coverage.percent}%` }} /></span>
                  <span className="territory-remaining">{coverage.remaining} residential left</span>
                </button>
                <button className="territory-card-edit" onClick={() => onEditTerritory(territory.id)} aria-label={`Edit ${territory.name}`}><Edit3 size={15} /></button>
              </div>
            );
          })}
        </div>
      </section>

      <div className="leader-panels">
        <section className="leader-section panel">
          <div className="section-heading"><div><p className="eyebrow">Today’s work</p><h2>Coverage by outcome</h2></div><ClipboardCheck size={19} /></div>
          <div className="outcome-bars">
            {(["conversation", "no_answer", "follow_up", "declined", "do_not_visit", "inaccessible"] as Outcome[]).map((outcome) => <div className="outcome-bar" key={outcome}><span>{outcomeMeta[outcome].label}</span><div><i style={{ width: `${Math.max(count(outcome) ? 8 : 0, (count(outcome) / Math.max(1, touchedLocations)) * 100)}%`, background: outcomeMeta[outcome].color }} /></div><strong>{count(outcome)}</strong></div>)}
          </div>
        </section>
        <section className="leader-section panel">
          <div className="section-heading"><div><p className="eyebrow">In the field</p><h2>Volunteer teams</h2></div><Users size={19} /></div>
          <div className="team-list">
            {data.teams.map((team) => {
              const territory = data.territories.find((item) => team.territoryIds.includes(item.id));
              const teamCoverage = territory
                ? coverageByTerritory[territory.id] ?? coverageForTerritory(data, territory.id)
                : null;
              return <div key={team.id}><span className={`team-initial ${team.status}`}>{team.name.replace("Team ", "").charAt(0)}</span><p><strong>{team.name}</strong><small>{territory?.name ?? "No territory"} · {team.memberIds.length} volunteers</small></p><b>{teamCoverage ? `${teamCoverage.touched}/${teamCoverage.total}` : "—"}</b></div>;
            })}
          </div>
        </section>
      </div>

      <section className="leader-section activity-section">
        <div className="section-heading"><div><p className="eyebrow">Accountability</p><h2>Recent activity</h2></div><History size={19} /></div>
        <div className="activity-list">{data.audit.slice(0, 8).map((entry) => <div key={entry.id}><i /><p><strong>{entry.summary}</strong><span>{data.volunteers.find((volunteer) => volunteer.id === entry.actorId)?.name ?? "Volunteer"} · {formatDateTime(entry.createdAt)}</span></p></div>)}</div>
      </section>
      <div className="privacy-banner"><ShieldCheck size={20} /><p><strong>Measure coverage, not people</strong>NeighborWalk reports the work completed and requested next steps. It intentionally avoids “receptiveness scores,” conversion rankings, and volunteer leaderboards.</p></div>
    </div>
  );
}

function Metric({ icon, label, value, detail, progress, tone = "green" }: { icon: React.ReactNode; label: string; value: string; detail: string; progress?: number; tone?: "green" | "amber" | "blue" }) {
  return <article className={`metric-card ${tone}`}><span className="metric-icon">{icon}</span><p>{label}</p><strong>{value}</strong>{progress !== undefined && <div className="metric-progress"><i style={{ width: `${progress}%` }} /></div>}<small>{detail}</small></article>;
}

export function SettingsView({
  data,
  online,
  saving,
  syncing,
  storageError,
  canManage,
  guides,
  favoriteGuideId,
  accountEmail,
  onSignOut,
  onUpdatePassword,
  onUpdateChurch,
  onSetPreference,
  onSetFavoriteGuide,
  onExport,
  onImport,
  onPurge,
  onClearOutreach,
  onSync,
}: {
  data: NeighborWalkData;
  online: boolean;
  saving: boolean;
  syncing: boolean;
  storageError: string | null;
  canManage: boolean;
  guides: ConversationGuide[];
  favoriteGuideId?: string;
  accountEmail?: string;
  onSignOut?: () => Promise<void>;
  onUpdatePassword?: (password: string) => Promise<void>;
  onUpdateChurch: (patch: Partial<NeighborWalkData["church"]>) => void;
  onSetPreference: <K extends keyof NeighborWalkData["preferences"]>(key: K, value: NeighborWalkData["preferences"][K]) => void;
  onSetFavoriteGuide: (guideId: string) => Promise<void>;
  onExport: () => void;
  onImport: (file: File) => Promise<NeighborWalkData>;
  onPurge: () => void;
  onClearOutreach: () => void;
  onSync: () => Promise<boolean>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [churchName, setChurchName] = useState(data.church.name);
  const [timezone, setTimezone] = useState(data.church.timezone);
  const [noteLimit, setNoteLimit] = useState(String(data.church.noteCharacterLimit));
  const [followUpDays, setFollowUpDays] = useState(String(data.church.defaultFollowUpDays));
  const [mapStyleUrl, setMapStyleUrl] = useState(data.preferences.mapStyleUrl);
  const [clearing, setClearing] = useState(false);
  const [clearConfirmation, setClearConfirmation] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
  }, []);

  const requestNotifications = async () => {
    if (!("Notification" in window)) return setMessage("Notifications are not available in this browser.");
    const permission = await Notification.requestPermission();
    onSetPreference("notificationsEnabled", permission === "granted");
    setMessage(permission === "granted" ? "Follow-up notifications are enabled on this device." : "Follow-up notifications remain off on this device.");
  };

  const installApp = async () => {
    const prompt = installPrompt as Event & { prompt?: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };
    if (prompt.prompt) {
      await prompt.prompt();
      setMessage("Install request opened.");
    } else {
      setMessage("Use your browser’s Add to Home Screen command to install NeighborWalk.");
    }
  };

  const saveChurchProfile = () => {
    const name = churchName.trim();
    const zone = timezone.trim();
    if (!name || name.length > 120) return setMessage("Enter a church name between 1 and 120 characters.");
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: zone }).format();
    } catch {
      return setMessage("Enter a valid IANA timezone, such as America/Chicago.");
    }
    onUpdateChurch({ name, timezone: zone });
    setMessage("Church profile saved.");
  };

  const saveRecordLimits = () => {
    const parsedNoteLimit = Number(noteLimit);
    const parsedFollowUpDays = Number(followUpDays);
    if (!Number.isInteger(parsedNoteLimit) || parsedNoteLimit < 80 || parsedNoteLimit > 2000) return setMessage("Note limit must be a whole number from 80 to 2,000.");
    if (!Number.isInteger(parsedFollowUpDays) || parsedFollowUpDays < 1 || parsedFollowUpDays > 90) return setMessage("Follow-up timing must be a whole number from 1 to 90 days.");
    onUpdateChurch({ noteCharacterLimit: parsedNoteLimit, defaultFollowUpDays: parsedFollowUpDays });
    setMessage("Record and follow-up limits saved.");
  };

  const saveMapStyle = () => {
    const value = mapStyleUrl.trim();
    if (!isSafeWebUrl(value)) return setMessage("Enter a secure https map style URL (http is allowed only for localhost development).");
    onSetPreference("mapStyleUrl", new URL(value).toString());
    setMessage("Map style saved. The map will reload when you return to it.");
  };

  const applyDataDrafts = (next: NeighborWalkData) => {
    setChurchName(next.church.name);
    setTimezone(next.church.timezone);
    setNoteLimit(String(next.church.noteCharacterLimit));
    setFollowUpDays(String(next.church.defaultFollowUpDays));
    setMapStyleUrl(next.preferences.mapStyleUrl);
  };

  const saveAccountPassword = async () => {
    if (!onUpdatePassword) return;
    if (newPassword.length < 8) return setMessage("Use a password with at least 8 characters.");
    if (newPassword !== confirmPassword) return setMessage("The passwords do not match.");
    setUpdatingPassword(true);
    try {
      await onUpdatePassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password saved. You can now sign in without requesting an email link.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The password could not be saved.");
    } finally {
      setUpdatingPassword(false);
    }
  };

  return (
    <div className="content-view settings-view">
      <ViewHeading eyebrow="Church and device" title="Settings" description={canManage ? "Set ministry guardrails, prepare offline use, and manage workspace data." : "Manage your account, map, reminders, and this device."} />
      {message && <div className="settings-message" role="status"><Check size={15} />{message}</div>}
      {storageError && <div className="settings-message error" role="alert"><AlertTriangle size={15} />{storageError}</div>}
      <div className="settings-grid">
        {data.sync.mode === "connected" && <SettingsSection icon={<LockKeyhole size={18} />} title="Account and access" description="Your access level is assigned by a church leader.">
          <div className="connection-card connected"><LockKeyhole size={18} /><span><strong>Signed-in church account</strong>{accountEmail || "Authenticated member"} · {canManage ? "Leader access" : "Volunteer access"}</span></div>
          {onUpdatePassword && <details className="account-password"><summary>Set or change password</summary><div><p>Use a password for routine sign-in without waiting for an email.</p><label className="form-field"><span>New password</span><input type="password" minLength={8} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><label className="form-field"><span>Confirm password</span><input type="password" minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label><button className="button quiet" disabled={updatingPassword} onClick={() => void saveAccountPassword()}><Save size={15} /> {updatingPassword ? "Saving…" : "Save password"}</button></div></details>}
          {onSignOut && <button className="button quiet" onClick={() => void onSignOut()}><LogOut size={15} /> Sign out</button>}
        </SettingsSection>}

        <SettingsSection icon={<Star size={18} />} title="Favorite conversation guide" description="This guide opens first at a doorstep unless a leader has chosen a guide for your active group.">
          {guides.length ? <label className="form-field"><span>Default guide</span><select value={favoriteGuideId ?? ""} onChange={async (event) => { if (!event.target.value) return; try { await onSetFavoriteGuide(event.target.value); setMessage("Favorite conversation guide saved."); } catch (error) { setMessage(error instanceof Error ? error.message : "The favorite guide could not be saved."); } }}><option value="" disabled>Choose a favorite guide</option>{guides.map((guide) => <option value={guide.id} key={guide.id}>{guide.title} · {guide.scope === "church" ? "church" : "only me"}</option>)}</select></label> : <div className="data-note"><BookOpenText size={15} /><span>Create a personal guide or ask a leader to publish a church guide first.</span></div>}
          <div className="data-note"><LockKeyhole size={15} /><span>Personal guides stay private to your account. Church guides are shared with this church workspace.</span></div>
        </SettingsSection>

        {(canManage || data.sync.mode === "device_only") && <SettingsSection icon={<Church size={18} />} title="Church profile" description="Shown to volunteers in this workspace.">
          <label className="form-field"><span>Church name</span><input maxLength={120} value={churchName} onChange={(event) => setChurchName(event.target.value)} /></label>
          <label className="form-field"><span>Timezone</span><input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Chicago" /></label>
          <button className="button quiet" onClick={saveChurchProfile}><Save size={15} /> Save church profile</button>
          {data.sync.mode === "device_only" && <>
            <label className="form-field"><span>Preview identity <small>Device-only demo</small></span><select value={data.preferences.activeVolunteerId} onChange={(event) => onSetPreference("activeVolunteerId", event.target.value)}>{data.volunteers.map((volunteer) => <option value={volunteer.id} key={volunteer.id}>{volunteer.name} · {volunteer.role}</option>)}</select></label>
            <div className="data-note"><LockKeyhole size={15} /><span>This selector previews volunteer and leader experiences. A connected deployment must derive roles from the authenticated backend session.</span></div>
          </>}
        </SettingsSection>}

        {(canManage || data.sync.mode === "device_only") && <SettingsSection icon={<Database size={18} />} title="Records and retention" description="Set how long records remain and keep notes concise.">
          <div className="form-row">
            <label className="form-field"><span>Retention period</span><select value={data.church.retentionDays} onChange={(event) => onUpdateChurch({ retentionDays: Number(event.target.value) })}><option value={90}>90 days</option><option value={180}>180 days</option><option value={365}>1 year</option><option value={730}>2 years</option></select></label>
            <label className="form-field"><span>Note limit</span><input type="number" min={80} max={2000} value={noteLimit} onChange={(event) => setNoteLimit(event.target.value)} /></label>
          </div>
          <label className="form-field"><span>Default follow-up timing <small>Days</small></span><input type="number" min={1} max={90} value={followUpDays} onChange={(event) => setFollowUpDays(event.target.value)} /></label>
          <div className="button-row"><button className="button quiet" onClick={saveRecordLimits}><Save size={15} /> Save limits</button><button className="button quiet" onClick={() => { onPurge(); setMessage("The retention policy was applied."); }}><Trash2 size={15} /> Apply retention now</button></div>
        </SettingsSection>}

        <SettingsSection icon={<MapPinned size={18} />} title="Map and field use" description="Map tiles need a connection; saved records do not.">
          <label className="form-field"><span>Map style URL</span><input inputMode="url" value={mapStyleUrl} onChange={(event) => setMapStyleUrl(event.target.value)} /></label>
          <button className="button quiet" onClick={saveMapStyle}><Save size={15} /> Save map style</button>
          <label className="toggle-row"><input type="checkbox" checked={data.preferences.compactMapMarkers} onChange={(event) => onSetPreference("compactMapMarkers", event.target.checked)} /><span><strong>Compact location dots</strong>Use smaller status dots in dense neighborhoods.</span></label>
          <div className="button-row"><button className="button quiet" onClick={requestNotifications}><Bell size={15} /> Enable reminders</button><button className="button quiet" onClick={installApp}><Smartphone size={15} /> Install app</button></div>
        </SettingsSection>

        <SettingsSection icon={<Database size={18} />} title="Data and synchronization" description={data.sync.mode === "connected" ? "Changes save to the church workspace automatically. Manual sync remains available as a fallback." : "This build is device-only until your backend is connected."}>
          <div className={`connection-card ${data.sync.mode}`}>
            {data.sync.mode === "connected" ? <Wifi size={18} /> : <CloudOff size={18} />}
            <span><strong>{data.sync.mode === "connected" ? "Automatic sync on" : "Device-only mode"}</strong>{data.sync.mode === "connected"
              ? syncing
                ? "Updating the shared church workspace now."
                : !online
                  ? `${data.sync.pending.length} change${data.sync.pending.length === 1 ? " is" : "s are"} safely stored on this device until the connection returns.`
                  : data.sync.pending.length > 0
                    ? `${data.sync.pending.length} change${data.sync.pending.length === 1 ? " is" : "s are"} queued for automatic sync.`
                    : "This device is up to date with the church workspace."
              : "Records remain on this device until a workspace is connected."}</span>
          </div>
          {data.sync.lastError && <div className="data-note sync-warning"><AlertTriangle size={15} /><span>{data.sync.lastError}</span></div>}
          {data.sync.mode === "connected" && <button className="button quiet" onClick={async () => setMessage(await onSync() ? "Changes synchronized." : "Changes remain safe on this device; automatic retry is still active.")} disabled={!online || saving || syncing}><RefreshCcw size={15} className={syncing ? "spin" : ""} /> {data.sync.pending.length || data.sync.lastError ? "Retry sync" : "Sync now"}</button>}
          {(canManage || data.sync.mode === "device_only") && <><div className="button-row"><button className="button quiet" onClick={onExport}><Download size={15} /> Export backup</button><button className="button quiet" onClick={() => fileRef.current?.click()}><Upload size={15} /> Import backup</button><input ref={fileRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { const imported = await onImport(file); applyDataDrafts(imported); setMessage("Backup imported and validated."); } catch (error) { setMessage(error instanceof Error ? error.message : "The backup could not be imported."); } finally { event.target.value = ""; } }} /></div>
          <div className="data-note"><FileJson size={15} /><span>Backups contain ministry records in readable JSON. Store them securely and delete old copies.</span></div></>}
        </SettingsSection>
      </div>
      {(canManage || data.sync.mode === "device_only") && <section className="danger-zone"><div><strong>Clear outreach records</strong><span>Delete mapped locations, visits, follow-ups, and person records. Church settings, groups, members, territories, and the guide remain.</span></div><button className="button danger" onClick={() => setClearing(true)}><Trash2 size={15} /> Clear records</button></section>}
      {clearing && <Modal title="Clear outreach records?" description="This removes the shared records listed below. Export a backup first if you may need them later." onClose={() => { setClearing(false); setClearConfirmation(""); }}>
        <div className="clear-data-summary"><div><strong>{data.properties.length}</strong><span>locations</span></div><div><strong>{data.visits.length}</strong><span>visits</span></div><div><strong>{data.followUps.length}</strong><span>follow-ups</span></div><div><strong>{data.residents.length}</strong><span>people</span></div></div>
        <label className="form-field"><span>Type <strong>CLEAR</strong> to confirm</span><input autoComplete="off" value={clearConfirmation} onChange={(event) => setClearConfirmation(event.target.value)} /></label>
        <div className="modal-actions"><button className="button quiet" onClick={() => { setClearing(false); setClearConfirmation(""); }}>Cancel</button><button className="button danger" disabled={clearConfirmation !== "CLEAR"} onClick={() => { onClearOutreach(); setClearing(false); setClearConfirmation(""); setMessage("Outreach records cleared. Automatic sync will update the shared workspace."); }}><Trash2 size={15} /> Permanently clear records</button></div>
      </Modal>}
    </div>
  );
}

function SettingsSection({ icon, title, description, children }: { icon: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return <section className="settings-section"><div className="settings-section-heading"><span>{icon}</span><div><h2>{title}</h2><p>{description}</p></div></div><div className="settings-section-body">{children}</div></section>;
}

export function Modal({ title, description, wide = false, onClose, children }: { title: string; description?: string; wide?: boolean; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`modal-card${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><h2 id="modal-title">{title}</h2>{description && <p>{description}</p>}</div><button className="close-button" onClick={onClose} aria-label="Close dialog">×</button></div>{children}</section></div>;
}

export function ViewHeading({ eyebrow, title, description, aside }: { eyebrow: string; title: string; description: string; aside?: React.ReactNode }) {
  return <div className="view-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{aside}</div>;
}

function EmptyState({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) {
  return <div className="empty-state">{icon}<h2>{title}</h2><p>{copy}</p></div>;
}
