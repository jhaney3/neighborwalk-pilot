"use client";

import { groupBy } from "../lib/collections";
import { personTimeline } from "../lib/person-timeline";
import { lastRecordedContact } from "../lib/encounter-history";
import { indexCurrentRecords, recordFamilyIds } from "../lib/record-aliases";
import { ContactRestrictions } from "./ContactRestrictions";
import { contactRestricted, type RestrictionActions } from "../lib/contact-restrictions";
import { useAsyncAction } from "../lib/use-async-action";
import { calendarDate, calendarDaysFromNow, formatCalendarDate } from "../lib/calendar";
import { navigateTabs } from "../lib/tab-navigation";

import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Edit3,
  Info,
  LockKeyhole,
  Mail,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  NotebookPen,
  PauseCircle,
  Phone,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  discipleshipStageLabels,
  discipleshipStageValues,
  faithStatusLabels,
  faithStatusValues,
  outcomeValues,
  personNoteKindLabels,
  formatPhoneNumber,
  type DiscipleshipStage,
  type FollowUp,
  type NeighborWalkData,
  type PersonNoteKind,
  type Resident,
  type ResidentInput,
} from "../lib/domain";
import { MapCanvas } from "./MapCanvas";
import { Modal, useConfirm } from "./ui";
import { avatarTone } from "./visuals";

export type PeopleViewProps = {
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
  embedded?: boolean;
  renderPersonFollowUps?: (residentId: string) => ReactNode;
  initialAddPerson?: boolean;
  onAddPersonClosed?: () => void;
};

type PersonEditorState = "new" | Resident | null;
type SortMode = "next_step" | "recent" | "name";
type ProfilePanel = "followups" | "activity" | "details";

const profilePanels: ProfilePanel[] = ["followups", "activity", "details"];

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
  embedded,
  renderPersonFollowUps,
  initialAddPerson,
  onAddPersonClosed,
}: PeopleViewProps) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<"all" | DiscipleshipStage>("all");
  const [owner, setOwner] = useState<"all" | "mine">("all");
  const [status, setStatus] = useState<"active" | "paused" | "archived" | "all">("active");
  const [sort, setSort] = useState<SortMode>("next_step");
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(initialSelectedResidentId ?? null);
  const selectedId = onSelectResident ? initialSelectedResidentId : localSelectedId;
  const setSelectedId = (id: string | null) => onSelectResident ? onSelectResident(id ?? undefined) : setLocalSelectedId(id);
  const [editor, setEditor] = useState<PersonEditorState>(initialAddPerson ? "new" : null);

  const closeEditor = () => {
    setEditor(null);
    onAddPersonClosed?.();
  };

  const volunteers = useMemo(() => new Map(data.volunteers.map((volunteer) => [volunteer.id, volunteer])), [data.volunteers]);
  const properties = useMemo(() => indexCurrentRecords(data.properties), [data.properties]);
  const people = useMemo(() => indexCurrentRecords(data.residents), [data.residents]);
  const notesByResident = useMemo(() => {
    const grouped = groupBy(data.personNotes, (note) => people.get(note.residentId)?.id);
    for (const notes of grouped.values()) notes.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return grouped;
  }, [data.personNotes, people]);
  const followUpsByResident = useMemo(() => {
    const grouped = groupBy(data.followUps, (followUp) => people.get(followUp.residentId ?? "")?.id);
    for (const followUps of grouped.values()) followUps.sort((left, right) => left.dueAt.localeCompare(right.dueAt));
    return grouped;
  }, [data.followUps, people]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return data.residents
      .filter((resident) => !resident.mergedIntoId)
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

  const selected = people.get(selectedId ?? "");
  const filterCount = Number(owner !== "all") + Number(stage !== "all") + Number(status !== "active") + Number(sort !== "next_step");

  const saveResident = async (propertyId: string | undefined, input: ResidentInput) => {
    const editing = editor && editor !== "new" ? editor : undefined;
    const residentId = await onUpsertResident(propertyId, input, editing?.id);
    setSelectedId(residentId);
    closeEditor();
  };

  return (
    <section className={`${embedded ? "people-view people-view-embedded" : "content-view people-view"}${selectedId ? " has-selected-person" : ""}`}>

      <div className="people-toolbar">
        <div className="people-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search people" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people" /></div>
        <details className="people-filter-disclosure"><summary><SlidersHorizontal size={15} aria-hidden="true" /> Filter &amp; sort{filterCount > 0 && <span>{filterCount}</span>}</summary><div className="people-filters">
          <label>Owner<select aria-label="Filter by owner" value={owner} onChange={(event) => setOwner(event.target.value as typeof owner)}><option value="all">Every owner</option><option value="mine">My people</option></select></label>
          {data.church.pathwayEnabled && <label>Relationship stage<select aria-label="Filter by stage" value={stage} onChange={(event) => setStage(event.target.value as typeof stage)}><option value="all">Every stage</option>{discipleshipStageValues.map((value) => <option key={value} value={value}>{discipleshipStageLabels[value]}</option>)}</select></label>}
          <label>Status<select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option><option value="all">Any status</option></select></label>
          <label>Sort by<select aria-label="Sort people" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="next_step">Follow-up date</option><option value="recent">Recently updated</option><option value="name">Name</option></select></label>
        </div></details>
        {!embedded && <button className="button primary people-new-button" onClick={() => setEditor("new")}><Plus size={15} /> Add person</button>}
      </div>

      <div className={`people-workbench${selectedId ? " has-profile" : ""}`}>
        <section className="people-directory" aria-label="People directory">
          <div className="people-directory-label"><span>{filtered.length} {filtered.length === 1 ? "person" : "people"}</span><small>{owner === "mine" ? "Assigned to you" : "All accessible"}</small></div>
          <div className="people-directory-list">
            {filtered.map((resident) => {
              const property = properties.get(resident.propertyId ?? "");
              const ownerRecord = volunteers.get(resident.assignedVolunteerId);
              const nextFollowUp = followUpsByResident.get(resident.id)?.find((followUp) => followUp.status === "scheduled");
              const nextStepState = dueState(nextFollowUp, data.church.timezone);
              const isSelected = selected?.id === resident.id;
              return (
                <button aria-pressed={isSelected} className={`person-list-card${isSelected ? " active" : ""}`} key={resident.id} onClick={() => setSelectedId(resident.id)}>
                  <span className={`person-list-avatar avatar ${avatarTone(resident.id)}`} aria-hidden="true">{personInitials(resident.name)}</span>
                  <span className="person-list-copy">
                    <span className="person-list-heading"><span><strong>{resident.name || "Name not provided"}</strong>{resident.status !== "active" && <em className={`person-status-dot ${resident.status}`} title={resident.status} aria-label={resident.status} />}</span>{nextFollowUp && <span className={`person-next-date ${nextStepState}`}><Clock3 size={11} /> {nextStepState === "overdue" ? "Overdue · " : ""}{formatCalendarDate(calendarDate(nextFollowUp.dueAt, data.church.timezone), { month: "short", day: "numeric" })}</span>}</span>
                    <span className="person-list-address"><MapPin size={12} /> {property?.address ?? "No address provided"}</span>
                    {isSelected && <span className="person-list-selected-detail"><span><UserRound size={12} /> {ownerRecord?.name ?? "Unknown owner"}</span><p>{nextFollowUp?.note || "No open follow-up planned."}</p></span>}
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
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
            followUps={renderPersonFollowUps?.(selected.id)}
          />
        ) : <div className="people-profile-empty" role={selectedId ? "status" : undefined}><CircleUserRound size={32} /><strong>{selectedId ? "This person is unavailable" : "Select a person"}</strong><span>{selectedId ? "They may be archived or shared with someone else. Reconnect, or ask your leader." : "Their follow-ups and notes will show here."}</span>{selectedId && <button className="button quiet" onClick={() => setSelectedId(null)}>Back to people</button>}</div>}
      </div>

      {editor && <Modal title={editor === "new" ? "Add a person" : `Edit ${editor.name || "person"}`} description="Only what helps you care for them well." wide onClose={closeEditor}><PersonEditor resident={editor === "new" ? undefined : editor} data={data} activeVolunteerId={activeVolunteerId} onCancel={closeEditor} onSave={saveResident} onDelete={editor !== "new" && (canManage || editor.assignedVolunteerId === activeVolunteerId) ? async () => { await onDeleteResident(editor.id); setSelectedId(null); closeEditor(); } : undefined} /></Modal>}
    </section>
  );
}

function PersonProfile({ resident, data, canManage, activeVolunteerId, onBack, onEdit, onOpenProperty, onChangeStage, onChangeOwner, onHandoffResponse, onChangeStatus, onAddFollowUp, onOpenFollowUps, onAddNote, onDeleteNote, restrictionActions, followUps }: {
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
  followUps?: ReactNode;
}) {
  const confirm = useConfirm();
  const [noteBody, setNoteBody] = useState("");
  const [noteKind, setNoteKind] = useState<PersonNoteKind>("general");
  const [panel, setPanel] = useState<ProfilePanel>("followups");
  const tabsId = useId();
  const followUpsTab = useRef<HTMLButtonElement>(null);
  const action = useAsyncAction();
  const handoffQueued = data.sync.commands?.some((q) => q.command.operations.some((op) => op.entityType === "handoff" && op.entityId === resident.id));
  const followUpChannel = resident.preferredContact === "none" ? "other" : resident.preferredContact;
  const noContact = contactRestricted(data, resident.id, "other");
  const followUpRestricted = contactRestricted(data, resident.id, followUpChannel, resident.propertyId);
  const property = indexCurrentRecords(data.properties).get(resident.propertyId ?? "");
  const owner = data.volunteers.find((volunteer) => volunteer.id === resident.assignedVolunteerId);
  const pendingOwner = data.volunteers.find((volunteer) => volunteer.id === resident.pendingOwnerId);
  const isHandoffRecipient = resident.pendingOwnerId === activeVolunteerId;
  const timeline = personTimeline(data, resident.id);
  const lastContact = lastRecordedContact(data, resident.id);
  const family = recordFamilyIds(data.residents, resident.id);
  const originalProfiles = data.residents.filter((person) => person.id !== resident.id && family.has(person.id));
  const personFollowUps = data.followUps.filter((followUp) => Boolean(followUp.residentId && family.has(followUp.residentId))).sort((left, right) => left.dueAt.localeCompare(right.dueAt));
  const openFollowUps = personFollowUps.filter((followUp) => followUp.status === "scheduled");
  const nextFollowUp = openFollowUps[0];
  const nextState = dueState(nextFollowUp, data.church.timezone);
  const stageIndex = discipleshipStageValues.indexOf(resident.discipleshipStage);
  const noteValid = noteBody.trim().length > 0 && noteBody.length <= data.church.noteCharacterLimit;
  const canEdit = canManage || resident.assignedVolunteerId === activeVolunteerId;
  const sharedCount = resident.sharedWithTeamIds.length + resident.sharedWithVolunteerIds.length;
  const accessSummary = sharedCount
    ? `Shared with ${sharedCount} more ${sharedCount === 1 ? "person or team" : "people or teams"}`
    : "Visible to their owner and church leaders";
  const lastContactDate = lastContact
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: data.church.timezone }).format(new Date(lastContact.at))
    : null;
  const selectPanel = (index: number) => {
    const nextPanel = profilePanels[index];
    if (nextPanel) setPanel(nextPanel);
  };
  const showFollowUps = () => {
    setPanel("followups");
    window.requestAnimationFrame(() => {
      const tab = followUpsTab.current;
      if (!tab) return;
      tab.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      tab.focus({ preventScroll: true });
    });
  };

  return (
    <article className="person-profile">
      <header className="person-profile-header">
        <button className="person-profile-back" onClick={onBack}><ArrowLeft size={16} /> People</button>
        <div className="person-profile-identity">
          <span className={`person-profile-avatar avatar ${avatarTone(resident.id)}`} aria-hidden="true">{personInitials(resident.name)}</span>
          <div className="person-profile-heading-copy"><div className="person-profile-heading-line"><h2>{resident.name || "Name not provided"}</h2>{resident.status !== "active" && <span className={`person-profile-status ${resident.status}`}>{resident.status === "paused" ? "Paused" : "Archived"}</span>}</div><small className="person-privacy-summary"><LockKeyhole size={12} /> {accessSummary}</small></div>
          {canEdit && <button className="button quiet small person-profile-edit" aria-label="Edit profile" onClick={onEdit}><Edit3 size={14} /><span>Edit profile</span></button>}
        </div>
        <div className="person-profile-contact">
          {!contactRestricted(data, resident.id, "call") && resident.phone && <a href={`tel:${resident.phone}`}><Phone size={14} /><span><small>{resident.preferredContact === "call" ? "Preferred" : "Phone"}</small><strong>{formatPhoneNumber(resident.phone)}</strong></span></a>}
          {!contactRestricted(data, resident.id, "email") && resident.email && <a href={`mailto:${resident.email}`}><Mail size={14} /><span><small>{resident.preferredContact === "email" ? "Preferred" : "Email"}</small><strong>{resident.email}</strong></span></a>}
          {property && <button onClick={onOpenProperty}><MapPin size={14} /><span><small>Home</small><strong>{property.address}{property.unit ? ` · ${property.unit}` : ""}</strong></span></button>}
        </div>
      </header>

      {followUpRestricted && <p role="status" className="inline-notice person-safety-notice">{noContact ? "Don’t contact. No new follow-ups." : `They asked not to be contacted by ${followUpChannel}.`} Only a leader can change this.</p>}
      <p className="person-last-contact"><Info size={15} aria-hidden="true" /><span>{lastContactDate ? `Last contact ${lastContactDate}` : "No contact yet"}</span>{resident.legacyCreatorAccess && <small><LockKeyhole size={13} aria-hidden="true" /> Whoever added them can still see this profile</small>}</p>
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}

      <div className="person-care-grid">
        <section className={`care-next-card ${nextState}`}>
          {nextFollowUp ? <button type="button" className="care-next-summary" onClick={showFollowUps} aria-label={`Open follow-ups for ${resident.name || "this person"}`}>
            <span className="care-next-heading"><span className="profile-section-label">Next step</span><em><CalendarClock size={12} /> {nextState === "overdue" ? "Overdue · " : ""}{formatCalendarDate(calendarDate(nextFollowUp.dueAt, data.church.timezone), { month: "long", day: "numeric" })}</em></span>
            <span className="care-next-copy">{nextFollowUp.note || "Follow up with this person."}</span>
            {openFollowUps.length > 1 && <span className="care-next-count">{openFollowUps.length - 1} more open {openFollowUps.length === 2 ? "task" : "tasks"}</span>}
            <span className="care-next-disclosure">View follow-ups <ChevronRight size={14} aria-hidden="true" /></span>
          </button> : <><div><span className="profile-section-label">Next step</span></div><p className="care-next-empty">Nothing planned.</p></>}
          <div className="care-next-actions">{canEdit && !followUpRestricted && <FollowUpPlanner timezone={data.church.timezone} defaultDays={data.church.defaultFollowUpDays} noteLimit={data.church.noteCharacterLimit} onSave={onAddFollowUp} />}{!followUps && <button onClick={onOpenFollowUps}>Open follow-ups <ChevronRight size={13} /></button>}</div>
        </section>
        <section className="care-owner-card">
          <span className="profile-section-label">Owner</span>
          <div className="care-owner-identity"><span className="care-owner-avatar" aria-hidden="true">{personInitials(owner?.name)}</span><div><strong>{owner?.name ?? "Choose an owner"}</strong></div></div>
          {resident.pendingOwnerId ? <div className="handoff-panel">
            <div className="handoff-panel-heading"><span><Clock3 size={15} /></span><div><strong>{isHandoffRecipient ? "Handoff requested" : `Waiting on ${pendingOwner?.name ?? "recipient"}`}</strong><small>{isHandoffRecipient ? "You’ve been asked to take over." : "Waiting for them to accept."}</small></div></div>
            <p>{owner?.name ?? "Current owner"} remains responsible until {isHandoffRecipient ? "you accept" : "the handoff is accepted"}.</p>
            {onHandoffResponse && (isHandoffRecipient
              ? <div className="handoff-panel-actions"><button disabled={action.busy || handoffQueued} className="button primary small" onClick={() => void action.run(() => onHandoffResponse("accept"))}>Accept</button><button disabled={action.busy || handoffQueued} className="button quiet small" onClick={() => void action.run(() => onHandoffResponse("decline"))}>Decline</button></div>
              : canEdit && <div className="handoff-panel-actions"><button className="button quiet small" disabled={action.busy || handoffQueued} onClick={() => void action.run(() => onHandoffResponse("cancel"))}>Cancel request</button></div>)}</div>
            : canEdit && <details className="care-owner-handoff"><summary>Change owner</summary><label><span>Hand off to</span><select value="" disabled={action.busy || handoffQueued} onChange={(event) => { const id = event.target.value; if (id) void confirm({ title: "Ask them to take over?", message: "You stay responsible until they accept. Then your open follow-ups move to them.", confirmLabel: "Send request" }).then((confirmed) => { if (confirmed) void action.run(() => onChangeOwner(id)); }); }}><option value="">Choose a recipient</option>{data.volunteers.filter((v) => v.active && v.id !== resident.assignedVolunteerId).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label></details>}
          {handoffQueued && <p role="status">Handoff saved. It will send when you’re back online.</p>}
        </section>
      </div>

      <div className="person-profile-tabs" role="tablist" tabIndex={-1} aria-label="Profile sections" onKeyDown={(event) => navigateTabs(event, selectPanel)}>
        <button ref={followUpsTab} id={`${tabsId}-followups-tab`} type="button" role="tab" aria-controls={`${tabsId}-followups-panel`} aria-selected={panel === "followups"} tabIndex={panel === "followups" ? 0 : -1} onClick={() => setPanel("followups")}>Follow-ups{openFollowUps.length > 0 && <span>{openFollowUps.length}</span>}</button>
        <button id={`${tabsId}-activity-tab`} type="button" role="tab" aria-controls={`${tabsId}-activity-panel`} aria-selected={panel === "activity"} tabIndex={panel === "activity" ? 0 : -1} onClick={() => setPanel("activity")}>Activity<span>{timeline.length}</span></button>
        <button id={`${tabsId}-details-tab`} type="button" role="tab" aria-controls={`${tabsId}-details-panel`} aria-selected={panel === "details"} tabIndex={panel === "details" ? 0 : -1} onClick={() => setPanel("details")}>Details</button>
      </div>

      <section id={`${tabsId}-followups-panel`} role="tabpanel" aria-labelledby={`${tabsId}-followups-tab`} className="person-profile-panel person-profile-followups" hidden={panel !== "followups"}>
        <div className="person-profile-followups-heading"><div><h3>Follow-ups</h3></div></div>
        {followUps ?? <div className="person-tab-empty"><CalendarClock size={22} /><p>See every follow-up for this person.</p><button className="button quiet small" onClick={onOpenFollowUps}>Open follow-ups</button></div>}
      </section>

      <section id={`${tabsId}-activity-panel`} role="tabpanel" aria-labelledby={`${tabsId}-activity-tab`} className="person-profile-panel person-notes-section" hidden={panel !== "activity"}>
        <div className="person-notes-heading"><div><h3>Activity</h3></div><span>{timeline.length}</span></div>
        <div className="person-note-composer">
          <div><MessageCircle size={17} /><strong>Add a note</strong><small>Notes stay with this person.</small></div>
          <label>Note kind<select disabled={action.busy} value={noteKind} onChange={(event) => setNoteKind(event.target.value as PersonNoteKind)}>{Object.entries(personNoteKindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
          <div className="person-note-fields"><textarea aria-label="Care note" disabled={action.busy} rows={3} maxLength={data.church.noteCharacterLimit + 1} value={noteBody} onChange={(event) => setNoteBody(event.target.value)} placeholder="What should you remember for next time?" /></div>
          <div><span className={noteBody.length > data.church.noteCharacterLimit ? "over" : ""}>{data.church.noteCharacterLimit - noteBody.length} characters remaining</span><button className="button primary small" disabled={!noteValid || action.busy} onClick={() => void action.run(() => onAddNote(noteKind, noteBody), () => setNoteBody(""))}><NotebookPen size={14} /> Save note</button></div>
        </div>
        <div className="person-timeline">
          {timeline.map((note) => {
            const author = data.volunteers.find((volunteer) => volunteer.id === note.actorId);
            const canDelete = Boolean(note.noteId) && (canManage || note.actorId === activeVolunteerId);
            return <article className="person-timeline-entry general" key={note.id}><span className="person-timeline-mark"><MessageCircle size={14} /></span><div><div><span>{note.title}</span><time>{new Intl.DateTimeFormat("en-US", { timeZone: data.church.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(note.at))}</time></div>{note.body && <p>{note.body}</p>}<footer><span>{author?.name ?? "Church record"}</span>{canDelete && <button onClick={() => { void confirm({ title: "Archive this note?", message: "It leaves the profile but stays in the church record.", confirmLabel: "Archive", destructive: true }).then((confirmed) => { if (confirmed) void action.run(() => onDeleteNote(note.noteId!)); }); }} aria-label="Archive note"><Trash2 size={12} /></button>}</footer></div></article>;
          })}
          {!timeline.length && <div className="person-timeline-empty"><NotebookPen size={22} /><strong>No activity yet</strong><span>Add the first note above.</span></div>}
        </div>
      </section>

      <section id={`${tabsId}-details-panel`} role="tabpanel" aria-labelledby={`${tabsId}-details-tab`} className="person-profile-panel person-profile-details" hidden={panel !== "details"}>
        {data.church.pathwayEnabled && <section className="discipleship-path" aria-label="Discipleship relationship stage">
          <div><span className="profile-section-label">Relationship path</span><small>Shared context, never a score.</small></div>
          <div className="discipleship-path-rail">
            {discipleshipStageValues.map((stage, index) => <button key={stage} disabled={!canEdit} className={`${index < stageIndex ? "passed" : ""}${stage === resident.discipleshipStage ? " current" : ""}`} onClick={() => void action.run(() => onChangeStage(stage))} aria-current={stage === resident.discipleshipStage ? "step" : undefined}><span>{index < stageIndex ? <CheckCircle2 size={13} /> : index + 1}</span><small>{discipleshipStageLabels[stage]}</small></button>)}
          </div>
        </section>}
        <section className="person-access-card"><span className="profile-section-label">Profile access</span><div><LockKeyhole size={16} aria-hidden="true" /><strong>{accessSummary}</strong></div><p>{resident.legacyCreatorAccess ? "Historical creator access remains until an accepted care handoff." : "Explicit sharing can be reviewed and changed in Edit profile."}</p></section>
        {originalProfiles.length > 0 && <details className="today-card person-original-profiles"><summary>Preserved original profiles ({originalProfiles.length})</summary><p>Details from records that were combined into this one. Their history appears below.</p>{originalProfiles.map((original) => <section key={original.id}><h3>{original.name || "Historical unnamed person"}</h3><dl><div><dt>Original record</dt><dd>{original.id}</dd></div><div><dt>Historical phone</dt><dd>{original.phone || "Not recorded"}</dd></div><div><dt>Historical email</dt><dd>{original.email || "Not recorded"}</dd></div><div><dt>Combined after review</dt><dd>{original.mergedAt ? new Date(original.mergedAt).toLocaleDateString() : "See audit history"}</dd></div>{data.church.pathwayEnabled && <><div><dt>Historical faith context</dt><dd>{faithStatusLabels[original.faithStatus]}</dd></div><div><dt>Historical pathway</dt><dd>{discipleshipStageLabels[original.discipleshipStage]}</dd></div></>}</dl></section>)}</details>}
        <footer className="person-profile-footer">
          <div><PauseCircle size={14} /><span><strong>Status</strong><small>Paused people still show in search. Archived people don’t.</small></span></div>
          <div className="person-profile-footer-actions"><select aria-label="Status" value={resident.status} disabled={!canEdit} onChange={(event) => { const status = event.target.value as Resident["status"]; void action.run(() => onChangeStatus(status)); }}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select><ContactRestrictions data={data} residentId={resident.id} canManage={canManage} actions={restrictionActions} /></div>
        </footer>
      </section>
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
  const confirm = useConfirm();
  const propertySelectId = useId();
  const [propertyId, setPropertyId] = useState(resident?.propertyId ?? "");
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [reviewedMove, setReviewedMove] = useState(false);
  const [moveReason, setMoveReason] = useState("");
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
  const moving = Boolean(resident && (resident.propertyId ?? "") !== propertyId);
  const movingTasks = resident ? data.followUps.filter((task) => task.residentId === resident.id && task.status === "scheduled").length : 0;
  return <><form className="person-editor-form form-stack" aria-busy={action.busy} onSubmit={(event) => {
    event.preventDefault();
    if (moving && (!reviewedMove || moveReason.trim().length < 3)) return;
    void action.run(() => onSave(propertyId || undefined, { name: name.trim() || undefined, faithStatus, discipleshipStage, assignedVolunteerId,
      sharedWithVolunteerIds: sharedWithVolunteerIds.filter((id) => id !== assignedVolunteerId), sharedWithTeamIds, status, phone: phone.trim() || undefined,
      email: email.trim() || undefined, preferredContact, contactPermission, lastContactAt: resident?.lastContactAt, changeReason: moving ? moveReason.trim() : undefined }));
  }}>
    <div className="person-editor-grid">
      <label>Name<input value={name} required={!resident} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="First name, or a kind description" /></label>
      <div className="person-location-field"><label htmlFor={propertySelectId}>Home or place to meet (optional)</label><div className="person-location-control"><select id={propertySelectId} value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setReviewedMove(false); }}><option value="">No address provided</option>{data.properties.filter((p) => !p.mergedIntoId).map((p) => <option key={p.id} value={p.id}>{p.address}{p.unit ? " · " + p.unit : ""}</option>)}</select><button type="button" className="person-location-map-button" aria-label="Choose a location on the map" title="Choose a location on the map" onClick={() => setLocationPickerOpen(true)}><MapIcon size={19} aria-hidden="true" /></button></div></div>
      <label>Phone (optional)<input type="tel" autoComplete="off" value={phone} maxLength={40} minLength={3} onChange={(e) => setPhone(e.target.value)} /></label>
      <label>Email (optional)<input type="email" autoComplete="off" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Preferred contact<select value={preferredContact} onChange={(e) => setPreferredContact(e.target.value as Resident["preferredContact"])}><option value="none">Not discussed</option><option value="call">Phone call</option><option value="text">Text message</option><option value="email">Email</option></select></label>
      <label>Contact request<select value={contactPermission} disabled={resident?.contactPermission === "do_not_contact"} onChange={(e) => setContactPermission(e.target.value as NonNullable<Resident["contactPermission"]>)}><option value="not_recorded">Not asked yet</option><option value="requested">They asked us to reach out</option><option value="do_not_contact">Do not contact</option></select></label>
      <label>Status<select value={status} onChange={(e) => setStatus(e.target.value as Resident["status"])}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select></label>
      {data.church.pathwayEnabled && <><label>Faith, in their words (optional)<select value={faithStatus} onChange={(e) => setFaithStatus(e.target.value as Resident["faithStatus"])}>{faithStatusValues.map((v) => <option key={v} value={v}>{faithStatusLabels[v]}</option>)}</select></label><label>Relationship stage<select value={discipleshipStage} onChange={(e) => setDiscipleshipStage(e.target.value as DiscipleshipStage)}>{discipleshipStageValues.map((v) => <option key={v} value={v}>{discipleshipStageLabels[v]}</option>)}</select></label></>}
    </div>
    {moving && <section className="inline-notice"><h3>Confirm the new location</h3><p>{movingTasks} open next {movingTasks === 1 ? "step follows" : "steps follow"} the person to the selected location. Historical encounters and completed or cancelled tasks keep their original location. Location-specific restrictions stay with the original location; person-specific restrictions stay with the person.</p><label>Why is it changing?<textarea required minLength={3} maxLength={500} value={moveReason} onChange={(event) => setMoveReason(event.target.value)} placeholder="For example: they gave us a new address." /></label><label><input type="checkbox" required checked={reviewedMove} onChange={(event) => setReviewedMove(event.target.checked)} /> I have reviewed this location change and its open next steps.</label></section>}
    <p><strong>Owner:</strong> {data.volunteers.find((v) => v.id === assignedVolunteerId)?.name ?? "You"}. Ownership changes through an accepted care handoff.</p>
    <details className="person-sharing-section"><summary>Who can see this profile?</summary>
      <p>Their owner and church leaders can see it. Share only with people helping care for them.</p>
      <fieldset><legend>Specific people</legend>{data.volunteers.filter((v) => v.active && v.id !== assignedVolunteerId).map((v) => <label key={v.id}><input type="checkbox" checked={sharedWithVolunteerIds.includes(v.id)} onChange={() => setSharedWithVolunteerIds((ids) => toggle(ids, v.id))} /> {v.name}</label>)}</fieldset>
      {!!data.teams.length && <fieldset><legend>Groups</legend>{data.teams.map((t) => <label key={t.id}><input type="checkbox" checked={sharedWithTeamIds.includes(t.id)} onChange={() => setSharedWithTeamIds((ids) => toggle(ids, t.id))} /> {t.name}</label>)}</fieldset>}
    </details>
    {!contactValid && <p className="inline-error">Add a phone number or email for that contact method.</p>}
    {action.error && <p className="inline-error" role="alert">{action.error}</p>}
    <div className="modal-actions split"><div>{onDelete && <button type="button" className="button danger" disabled={action.busy} onClick={() => { void confirm({ title: "Archive this person?", message: "Their open follow-ups are cancelled. Their history stays in the church record.", confirmLabel: "Archive", destructive: true }).then((confirmed) => { if (confirmed) void action.run(onDelete); }); }}>Archive person</button>}</div><div><button type="button" className="button quiet" disabled={action.busy} onClick={onCancel}>Cancel</button><button className="button primary" disabled={action.busy || !contactValid || (moving && (!reviewedMove || moveReason.trim().length < 3))}>{action.busy ? "Saving…" : "Save person"}</button></div></div>
  </form>{locationPickerOpen && <PersonLocationPicker data={data} propertyId={propertyId} onClose={() => setLocationPickerOpen(false)} onSelect={(id) => { setPropertyId(id); setReviewedMove(false); setLocationPickerOpen(false); }} />}</>;
}

function PersonLocationPicker({ data, propertyId, onClose, onSelect }: {
  data: NeighborWalkData;
  propertyId: string;
  onClose: () => void;
  onSelect: (propertyId: string) => void;
}) {
  const mappedProperties = useMemo(() => data.properties.filter((property) => !property.mergedIntoId && property.coordinates && property.territoryId), [data.properties]);
  const territories = useMemo(() => data.territories.filter((territory) => territory.kind !== "list" && territory.center && territory.boundary.length >= 3 && mappedProperties.some((property) => property.territoryId === territory.id)), [data.territories, mappedProperties]);
  const currentProperty = mappedProperties.find((property) => property.id === propertyId);
  const initialTerritoryId = currentProperty?.territoryId && territories.some((territory) => territory.id === currentProperty.territoryId)
    ? currentProperty.territoryId
    : territories.some((territory) => territory.id === data.preferences.activeTerritoryId)
      ? data.preferences.activeTerritoryId
      : territories[0]?.id ?? "";
  const [territoryId, setTerritoryId] = useState(initialTerritoryId);
  const [selectedPropertyId, setSelectedPropertyId] = useState(currentProperty?.territoryId === initialTerritoryId ? currentProperty.id : "");
  const territory = territories.find((candidate) => candidate.id === territoryId);
  const territoryProperties = mappedProperties.filter((property) => property.territoryId === territoryId);
  const selectedProperty = mappedProperties.find((property) => property.id === selectedPropertyId);

  return <Modal title="Choose a location" description="Pick a saved home or place on the map." wide onClose={onClose}>
    <div className="person-location-picker">
      {territories.length > 1 && <label>Map area<select value={territoryId} onChange={(event) => { setTerritoryId(event.target.value); setSelectedPropertyId(""); }}>{territories.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>}
      {territory ? <div className="person-location-map"><MapCanvas territory={territory} properties={territoryProperties} selectedPropertyId={selectedPropertyId || null} visibleOutcomes={new Set(outcomeValues)} searchTarget={null} addMode={false} drawMode={false} drawShape="polygon" draftBoundary={[]} compactMarkers={data.preferences.compactMapMarkers} mapStyleUrl={data.preferences.mapStyleUrl} onSelectProperty={setSelectedPropertyId} onAddIntent={() => undefined} onAssociatePropertiesWithParcel={() => undefined} onDrawShapeChange={() => undefined} onDraftBoundaryChange={() => undefined} onViewportChange={() => undefined} /></div> : <div className="person-location-map-empty"><MapIcon size={28} aria-hidden="true" /><strong>No places on the map yet</strong><span>Add one on the map first, or choose an address from the list.</span></div>}
      <div className="person-location-selection" aria-live="polite"><MapPin size={18} aria-hidden="true" /><span>{selectedProperty ? <><strong>{selectedProperty.address}</strong>{selectedProperty.unit && <small>{selectedProperty.unit}</small>}</> : <><strong>Select a marker</strong><small>Tap the place that belongs with this person.</small></>}</span></div>
      <div className="modal-actions"><button type="button" className="button quiet" onClick={onClose}>Cancel</button><button type="button" className="button primary" disabled={!selectedProperty} onClick={() => selectedProperty && onSelect(selectedProperty.id)}>Use this place</button></div>
    </div>
  </Modal>;
}
