"use client";

import { Check, ChevronLeft, ChevronRight, Ellipsis, FileText, LockKeyhole, MapPin, MessageCircle, MessageSquare, Phone, Plus, Search, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { calendarDate, calendarDaysFromNow, formatCalendarDate } from "../lib/calendar";
import { contactRestricted, type RestrictionActions } from "../lib/contact-restrictions";
import { communityConversations } from "../lib/conversations";
import { formatPhoneNumber, outcomeMeta, type FollowUp, type NeighborWalkData, type PersonNoteKind, type Property, type Resident, type ResidentInput } from "../lib/domain";
import { reviewedEncounter } from "../lib/encounter-history";
import { activeFollowUpOwner } from "../lib/follow-up-filters";
import { relativeDueLabel } from "../lib/follow-up-groups";
import { houseLabel } from "../lib/pin-counts";
import { residentInput } from "../lib/resident-input";
import { indexCurrentRecords, recordFamilyIds } from "../lib/record-aliases";
import { useAsyncAction } from "../lib/use-async-action";
import { selectionTick } from "../mobile/haptics";
import { visitDetailLine } from "./HomeSheet";
import { HistoryList, outcomeWord, type HistoryEntry } from "./OutcomeGrid";
import { ContactBlock } from "./PinSheet";
import { ActionSheet, Sheet, useFocusOnMount } from "./Sheet";
import { SegmentedControl, initials, useConfirm } from "./ui";

export type PeopleViewProps = {
  data: NeighborWalkData;
  canManage: boolean;
  activeVolunteerId: string;
  initialSelectedResidentId?: string | null;
  restrictionActions: RestrictionActions;
  onSelectResident?: (id?: string) => void;
  onOpenProperty: (propertyId: string) => void;
  onOpenFollowUp: (taskId: string) => void;
  onUpsertResident: (propertyId: string | undefined, input: ResidentInput, residentId?: string) => Promise<string>;
  onAddPersonNote: (residentId: string, kind: PersonNoteKind, body: string) => Promise<unknown>;
  onDeletePersonNote: (noteId: string) => Promise<unknown>;
  onAddPersonFollowUp: (residentId: string, note: string, date: string) => Promise<unknown>;
  onHandoff?: (id: string, action: "request" | "accept" | "decline" | "cancel", owner?: string) => Promise<unknown>;
  embedded?: boolean;
  initialAddPerson?: boolean;
  onAddPersonClosed?: () => void;
};

type Filter = "mine" | "everyone" | "due";
const filterLabels: Record<Filter, string> = { mine: "Mine", everyone: "Everyone", due: "Follow-up due" };
const channelWord = { visit: "Visit", call: "Call", text: "Text", email: "Email", other: "Follow-up" } as const;

/** "Yesterday" → "yesterday", but weekdays and dates keep their capitals. */
function dueWords(dueDate: string, today: string) {
  const label = relativeDueLabel(dueDate, today);
  return ["Today", "Yesterday", "Tomorrow"].includes(label) ? label.toLowerCase() : label;
}

function nextOpenFollowUp(data: NeighborWalkData, family: Set<string>) {
  return data.followUps.filter((task) => task.status === "scheduled" && Boolean(task.residentId && family.has(task.residentId))).sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
}

/** People (PE1): search, three chips, the conversations row, then everyone
 * with their street and when they're due. A person opens their page (PE3). */
export function PeopleView(props: PeopleViewProps) {
  const { data, activeVolunteerId, initialSelectedResidentId, onSelectResident, embedded, initialAddPerson, onAddPersonClosed } = props;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("mine");
  const [conversations, setConversations] = useState(false);
  const [adding, setAdding] = useState(Boolean(initialAddPerson));
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(initialSelectedResidentId ?? null);
  const selectedId = onSelectResident ? initialSelectedResidentId : localSelectedId;
  const select = (id: string | null) => onSelectResident ? onSelectResident(id ?? undefined) : setLocalSelectedId(id);
  const timezone = data.church.timezone;
  const today = calendarDate(new Date(), timezone);
  const weekOut = calendarDaysFromNow(7, timezone);
  const people = useMemo(() => indexCurrentRecords(data.residents), [data.residents]);
  const homes = useMemo(() => indexCurrentRecords(data.properties), [data.properties]);
  const away = useMemo(() => communityConversations(data), [data]);
  const closeAdd = () => { setAdding(false); onAddPersonClosed?.(); };

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    return data.residents.filter((person) => !person.mergedIntoId).map((person) => {
      const next = nextOpenFollowUp(data, recordFamilyIds(data.residents, person.id));
      return { person, home: homes.get(person.propertyId ?? ""), next, due: next ? calendarDate(next.dueAt, timezone) : undefined };
    }).filter(({ person, home, due }) => {
      // Archived people leave the lists but can still be found by search.
      if (person.status === "archived" && !needle) return false;
      if (filter === "mine" && person.assignedVolunteerId !== activeVolunteerId) return false;
      if (filter === "due" && !(due && due <= weekOut)) return false;
      if (!needle) return true;
      return [person.name, home?.address].some((value) => value?.toLowerCase().includes(needle)) || Boolean(digits.length >= 3 && person.phone?.replace(/\D/g, "").includes(digits));
    }).sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || (a.person.name ?? "").localeCompare(b.person.name ?? ""));
  }, [activeVolunteerId, data, filter, homes, query, timezone, weekOut]);

  const selected = people.get(selectedId ?? "");
  const className = embedded ? "people-view people-view-embedded" : "content-view people-view";
  const addSheet = adding && <PersonFormSheet data={data} activeVolunteerId={activeVolunteerId} onSave={props.onUpsertResident} onSaved={(id) => { closeAdd(); select(id); }} onClose={closeAdd} />;

  if (selectedId) return <section className={className}>
    {selected ? <PersonPage key={selected.id} {...props} resident={selected} onBack={() => select(null)} />
      : <><div className="screen-top"><button type="button" className="round-button float" aria-label="Back to people" onClick={() => select(null)}><ChevronLeft size={22} aria-hidden="true" /></button></div>
        <p className="inline-notice">This person may be archived, or not shared with you. Reconnect, or ask your leader.</p></>}
  </section>;

  if (conversations) return <section className={`${className} people-conversations`} aria-labelledby="people-conversations-title">
    <div className="screen-top"><button type="button" className="round-button float" aria-label="Back to people" onClick={() => setConversations(false)}><ChevronLeft size={22} aria-hidden="true" /></button></div>
    <h1 className="screen-title" id="people-conversations-title">Conversations</h1>
    <p className="mono-meta screen-kicker">Away from doors · {away.length}</p>
    {away.length ? <HistoryList timezone={timezone} label="Conversations away from doors" entries={away.map((entry) => {
      const visit = reviewedEncounter(entry.visit);
      const personId = entry.visit.residentId;
      return { id: entry.visit.id, at: visit.recordedAt, color: outcomeMeta[visit.outcome].color, title: `${entry.personName ?? "Unnamed"} · ${entry.where}`,
        detail: [visit.outcome === "follow_up" ? "Follow-up" : outcomeWord[visit.outcome as keyof typeof outcomeWord] ?? outcomeMeta[visit.outcome].label, visitDetailLine(visit)].filter(Boolean).join(" · "),
        onOpen: personId && people.has(personId) ? () => { setConversations(false); select(personId); } : undefined };
    })} /> : <p className="home-empty">Tap + to log a conversation from a meal, a service day or anywhere else.</p>}
  </section>;

  return <section className={`${className} people-list`} aria-labelledby="people-title">
    <div className="people-top"><h1 className="tab-title" id="people-title">People</h1><button type="button" className="round-button ink" aria-label="Add person" onClick={() => setAdding(true)}><Plus size={22} aria-hidden="true" /></button></div>
    <label className="search-box"><Search size={18} aria-hidden="true" /><input type="search" aria-label="Search people" enterKeyHint="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, street or phone" /></label>
    <div className="chip-row" role="group" aria-label="Show">
      {(Object.keys(filterLabels) as Filter[]).map((key) => <button key={key} type="button" className="pill-chip" aria-pressed={filter === key} onClick={() => { selectionTick(); setFilter(key); }}>{filterLabels[key]}</button>)}
    </div>
    <div className="grouped-rows">
      <button type="button" className="grouped-row" onClick={() => setConversations(true)}><MessageSquare size={19} aria-hidden="true" /><span className="grouped-row-text"><strong className="wrap">Conversations away from doors</strong></span><span className="mono-meta">{away.length}</span><ChevronRight size={17} aria-hidden="true" /></button>
    </div>
    <div className="list-section-head"><h2 className="mono-meta">{rows.length} {rows.length === 1 ? "person" : "people"}</h2><span className="mono-meta">Due first</span></div>
    {rows.length ? <div className="grouped-rows">{rows.map(({ person, home, due }) => {
      const late = Boolean(due && due < today);
      const line = [home ? houseLabel(home.address, home.unit) : undefined, due ? `due ${dueWords(due, today)}` : undefined, person.status !== "active" ? person.status : undefined].filter(Boolean).join(" · ");
      return <button key={person.id} type="button" className="grouped-row person-row" onClick={() => select(person.id)}>
        <span className="avatar-dot" aria-hidden="true">{initials(person.name || "?").slice(0, 1)}</span>
        <span className="grouped-row-text"><strong>{person.name || "Unnamed"}</strong><small className={late ? "danger" : undefined}>{line || "No home yet"}</small></span>
        <ChevronRight size={17} aria-hidden="true" />
      </button>;
    })}</div> : <p className="home-empty">{query ? "No one matches that search." : filter === "mine" ? "People you meet and care for show up here." : filter === "due" ? "No follow-ups due this week." : "People you meet show up here."}</p>}
    {addSheet}
  </section>;
}

type PageSheet = "menu" | "privacy" | "access" | "owner" | "note" | "edit" | "followup" | { noteId: string } | null;

/** The person page (PE3, PE4): who they are, how to reach them, their open
 * follow-up as the offset card, then one timeline of everything. */
function PersonPage({ resident, data, canManage, activeVolunteerId, restrictionActions, onBack, onOpenProperty, onOpenFollowUp, onUpsertResident, onAddPersonNote, onDeletePersonNote, onAddPersonFollowUp, onHandoff }: PeopleViewProps & { resident: Resident; onBack: () => void }) {
  const [sheet, setSheet] = useState<PageSheet>(null);
  const action = useAsyncAction();
  const timezone = data.church.timezone;
  const today = calendarDate(new Date(), timezone);
  const family = recordFamilyIds(data.residents, resident.id);
  const home = indexCurrentRecords(data.properties).get(resident.propertyId ?? "");
  const owner = data.volunteers.find((volunteer) => volunteer.id === resident.assignedVolunteerId);
  const pendingOwner = data.volunteers.find((volunteer) => volunteer.id === resident.pendingOwnerId);
  const canEdit = canManage || resident.assignedVolunteerId === activeVolunteerId;
  const name = resident.name || "Unnamed";
  const next = nextOpenFollowUp(data, family);
  const met = data.visits.filter((visit) => visit.residentId && family.has(visit.residentId)).map((visit) => visit.recordedAt).sort()[0] ?? resident.createdAt;
  const canText = Boolean(resident.phone) && !contactRestricted(data, resident.id, "text");
  const canCall = Boolean(resident.phone) && !contactRestricted(data, resident.id, "call");
  const noContact = contactRestricted(data, resident.id, "other");
  const entries = personHistory(data, resident.id, (noteId) => setSheet({ noteId }));
  const noteToArchive = sheet && typeof sheet === "object" ? data.personNotes.find((note) => note.id === sheet.noteId) : undefined;

  return <article className="fu-detail person-page" aria-labelledby="person-page-title">
    <div className="screen-top">
      <button type="button" className="round-button float" aria-label="Back to people" onClick={onBack}><ChevronLeft size={22} aria-hidden="true" /></button>
      <button type="button" className="round-button float" aria-label={`Options for ${name}`} onClick={() => setSheet("menu")}><Ellipsis size={20} aria-hidden="true" /></button>
    </div>
    <header className="fu-detail-person">
      <span className="fu-detail-avatar" aria-hidden="true">{initials(name).slice(0, 1)}</span>
      <div><h1 id="person-page-title">{name}</h1><p className="mono-meta">{[home ? houseLabel(home.address, home.unit) : undefined, `Met ${formatCalendarDate(calendarDate(met, timezone), { month: "short", day: "numeric" })}`, resident.status !== "active" ? resident.status : undefined].filter(Boolean).join(" · ")}</p></div>
    </header>

    {(canText || canCall) && <div className="wd-buttons person-reach">
      {canText && <a className="button-outline" href={`sms:${resident.phone}`}><MessageCircle size={17} aria-hidden="true" />Text</a>}
      {canCall && <a className="button-outline" href={`tel:${resident.phone}`}><Phone size={17} aria-hidden="true" />Call</a>}
    </div>}
    {noContact && <p role="status" className="inline-notice">They asked not to be contacted. Only a leader can change this.</p>}

    {resident.pendingOwnerId === activeVolunteerId && onHandoff && <div className="fu-detail-accept">
      <p>{owner?.name ?? "Their owner"} asked you to take over caring for {name}.</p>
      <div className="wd-buttons"><button type="button" className="button-outline" disabled={action.busy} onClick={() => void action.run(() => onHandoff(resident.id, "decline"))}>Decline</button><button type="button" className="button-ink" disabled={action.busy} onClick={() => void action.save(() => onHandoff(resident.id, "accept"))}>Accept</button></div>
    </div>}

    {next && <NextFollowUpCard task={next} data={data} today={today} activeVolunteerId={activeVolunteerId} onOpen={() => onOpenFollowUp(next.id)} />}

    <div className="grouped-rows">
      <button type="button" className="grouped-row" onClick={() => setSheet(canEdit && onHandoff && !pendingOwner ? "owner" : "privacy")}><span className="avatar-dot small" aria-hidden="true">{owner ? initials(owner.name) : "?"}</span><span className="grouped-row-text"><small className="mono-meta">Owner</small><strong>{owner?.name ?? "No owner"}</strong>{pendingOwner && <small>Waiting on {pendingOwner.name} to accept</small>}</span><ChevronRight size={17} aria-hidden="true" /></button>
      {home ? <button type="button" className="grouped-row" onClick={() => onOpenProperty(home.id)}><MapPin size={19} aria-hidden="true" /><span className="grouped-row-text"><small className="mono-meta">Home</small><strong>{home.address}{home.unit ? ` · ${home.unit}` : ""}</strong></span><ChevronRight size={17} aria-hidden="true" /></button>
        : canEdit && <button type="button" className="grouped-row" onClick={() => setSheet("edit")}><MapPin size={19} aria-hidden="true" /><span className="grouped-row-text"><small className="mono-meta">Home</small><strong className="quiet">Choose a home</strong></span><ChevronRight size={17} aria-hidden="true" /></button>}
    </div>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}

    <section className="person-history" aria-labelledby="person-timeline-title">
      <h2 id="person-timeline-title">Timeline</h2>
      <button type="button" className="search-box note-row" onClick={() => setSheet("note")}><FileText size={18} aria-hidden="true" /><span>Add a note</span></button>
      {entries.length ? <HistoryList timezone={timezone} label={`Timeline for ${name}`} entries={entries} /> : <p className="home-empty">Visits, conversations and notes show up here.</p>}
    </section>

    {sheet === "menu" && <ActionSheet title={name} closeLabel="Close" onClose={() => setSheet(null)} actions={[
      ...(canEdit ? [{ label: "Edit person", onSelect: () => setSheet("edit") }] : []),
      { label: "Add a note", onSelect: () => setSheet("note") },
      ...(canEdit && !next && !noContact ? [{ label: "Plan a follow-up", onSelect: () => setSheet("followup") }] : []),
      { label: "Privacy and status", onSelect: () => setSheet("privacy") },
    ]} />}
    {sheet === "privacy" && <PrivacySheet resident={resident} data={data} canManage={canManage} canEdit={canEdit} restrictionActions={restrictionActions} onUpsertResident={onUpsertResident} onHandoff={onHandoff} onAccess={() => setSheet("access")} onOwner={() => setSheet("owner")} onClose={() => setSheet(null)} />}
    {sheet === "access" && <AccessSheet resident={resident} data={data} canEdit={canEdit} onSave={(patch) => onUpsertResident(resident.propertyId, residentInput(resident, patch), resident.id)} onClose={() => setSheet("privacy")} />}
    {sheet === "owner" && <OwnerSheet resident={resident} data={data} onRequest={(id) => onHandoff ? onHandoff(resident.id, "request", id) : Promise.reject(new Error("Hand-offs need a connected church."))} onClose={() => setSheet(null)} />}
    {sheet === "note" && <NoteSheet data={data} resident={resident} onSave={(kind, body) => onAddPersonNote(resident.id, kind, body)} onClose={() => setSheet(null)} />}
    {sheet === "edit" && <PersonFormSheet data={data} resident={resident} activeVolunteerId={activeVolunteerId} onSave={onUpsertResident} onSaved={() => setSheet(null)} onClose={() => setSheet(null)} />}
    {sheet === "followup" && <PlanFollowUpSheet data={data} name={name} onSave={(note, date) => onAddPersonFollowUp(resident.id, note, date)} onClose={() => setSheet(null)} />}
    {noteToArchive && <ActionSheet title={noteToArchive.kind === "prayer" ? "Prayer request" : "Note"} closeLabel="Cancel" onClose={() => setSheet(null)} actions={[
      { label: "Archive note", destructive: true, disabled: !(canManage || noteToArchive.authorId === activeVolunteerId), onSelect: () => { setSheet(null); void action.save(() => onDeletePersonNote(noteToArchive.id)); } },
    ]} />}
  </article>;
}

function NextFollowUpCard({ task, data, today, activeVolunteerId, onOpen }: { task: FollowUp; data: NeighborWalkData; today: string; activeVolunteerId: string; onOpen: () => void }) {
  const due = calendarDate(task.dueAt, data.church.timezone);
  const late = due < today;
  const owner = activeFollowUpOwner(task, data);
  return <button type="button" className="fu-detail-card offset-card porch person-next" onClick={onOpen}>
    <span className={`mono-meta${late ? " danger" : ""}`}>{[`Due ${dueWords(due, today)}`, channelWord[task.channel ?? "visit"], owner ? owner.id === activeVolunteerId ? "You" : owner.name : "No owner"].join(" · ")}</span>
    <span className="fu-detail-note">{task.note || "Visit requested"}</span>
    <span className="mono-meta hedge">Open follow-up ›</span>
  </button>;
}

/** One timeline for a person: notes, visits, conversations and follow-up
 * history, in the shared history component. */
function personHistory(data: NeighborWalkData, residentId: string, onNote: (noteId: string) => void): HistoryEntry[] {
  const family = recordFamilyIds(data.residents, residentId);
  const names = new Map(data.volunteers.map((volunteer) => [volunteer.id, volunteer.name]));
  const quiet = "var(--hairline-strong)";
  const followUpWords: Record<string, string> = { created: "Follow-up created", rescheduled: "Snoozed", completed: "Follow-up done", cancelled: "Follow-up cancelled", accepted: "Follow-up accepted", declined: "Follow-up given back", reassigned: "Follow-up handed off" };
  const limitWords = { all: "All contact", visit: "Don’t visit", call: "Don’t call", text: "Don’t text", email: "Don’t email" } as const;
  const notes = data.personNotes.filter((note) => family.has(note.residentId)).map((note): HistoryEntry => ({
    id: `note:${note.id}`, at: note.createdAt, icon: <FileText size={14} />, title: note.kind === "prayer" ? "Prayer request" : "Note", detail: note.body, onOpen: () => onNote(note.id) }));
  const visits = data.visits.filter((visit) => Boolean(visit.residentId && family.has(visit.residentId))).flatMap((original): HistoryEntry[] => {
    const visit = reviewedEncounter(original);
    if (visit.voided) return [];
    const word = outcomeWord[visit.outcome as keyof typeof outcomeWord] ?? outcomeMeta[visit.outcome].label;
    const door = (visit.context ?? "door") === "door";
    const title = [door && visit.outcome === "conversation" ? `${word} at the door` : word, door ? undefined : original.placeLabel, names.get(original.volunteerId)].filter(Boolean).join(" · ");
    return [{ id: `visit:${original.id}`, at: original.recordedAt, color: outcomeMeta[visit.outcome].color, title, detail: visitDetailLine(visit) }];
  });
  const followUps = data.followUps.filter((task) => Boolean(task.residentId && family.has(task.residentId))).flatMap((task) => task.history.map((entry): HistoryEntry => ({
    id: `task:${task.id}:${entry.id}`, at: entry.createdAt, color: quiet,
    title: `${followUpWords[entry.action] ?? "Follow-up updated"}${entry.action === "rescheduled" && entry.dueAt ? ` to ${formatCalendarDate(calendarDate(entry.dueAt, data.church.timezone), { weekday: "short", day: "numeric" })}` : ""}`,
    detail: entry.action === "created"
      ? [channelWord[task.channel ?? "visit"], entry.dueAt ? `due ${formatCalendarDate(calendarDate(entry.dueAt, data.church.timezone), { month: "short", day: "numeric" })}` : undefined, names.get(entry.actorId)].filter(Boolean).join(" · ")
      : entry.note })));
  const limits = (data.restrictions ?? []).filter((limit) => Boolean(limit.residentId && family.has(limit.residentId))).flatMap((limit): HistoryEntry[] => [
    { id: `limit:${limit.id}`, at: limit.createdAt, color: quiet, title: `${limitWords[limit.channel]} turned on`, detail: limit.reason },
    ...(limit.correctedAt ? [{ id: `limit-off:${limit.id}`, at: limit.correctedAt, color: quiet, title: `${limitWords[limit.channel]} turned off`, detail: limit.correctionReason }] : []),
  ]);
  const handoffs = data.audit.filter((entry) => entry.entityType === "handoff" && family.has(entry.entityId)).map((entry): HistoryEntry => ({
    id: `handoff:${entry.id}`, at: entry.createdAt, color: quiet, title: `Care hand-off ${entry.action.replace("handoff.", "")}`, detail: names.get(entry.actorId) }));
  return [...notes, ...visits, ...followUps, ...limits, ...handoffs].sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

function SheetHead({ id, title, onClose }: { id: string; title: string; onClose: () => void }) {
  return <div className="home-sheet-head"><h2 className="pin-title" id={id}>{title}</h2><button type="button" className="round-line" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button></div>;
}

function whoCanSee(resident: Resident, data: NeighborWalkData) {
  const owner = data.volunteers.find((volunteer) => volunteer.id === resident.assignedVolunteerId)?.name ?? "Their owner";
  const more = resident.sharedWithVolunteerIds.length + resident.sharedWithTeamIds.length;
  return { owner, more };
}

/** Add a note (PE5): Note or Prayer request, and who will see it. */
function NoteSheet({ data, resident, onSave, onClose }: { data: NeighborWalkData; resident: Resident; onSave: (kind: PersonNoteKind, body: string) => Promise<unknown>; onClose: () => void }) {
  const [kind, setKind] = useState<"general" | "prayer">("general");
  const [body, setBody] = useState("");
  const action = useAsyncAction();
  const titleId = useId();
  const field = useFocusOnMount<HTMLTextAreaElement>();
  const { owner, more } = whoCanSee(resident, data);
  const limit = data.church.noteCharacterLimit;
  return <Sheet className="home-sheet form" modal labelledBy={titleId} onDismiss={action.busy ? () => undefined : onClose}>
    <SheetHead id={titleId} title="Add a note" onClose={onClose} />
    <SegmentedControl label="Kind of note" value={kind} onChange={setKind} options={[{ value: "general", label: "Note" }, { value: "prayer", label: "Prayer request" }]} />
    <textarea ref={field} className="note-field" aria-label={kind === "prayer" ? "Prayer request" : "Note"} rows={4} maxLength={limit + 1} value={body} onChange={(event) => setBody(event.target.value)} placeholder={kind === "prayer" ? "What should the church pray for?" : "What should you remember for next time?"} />
    <p className="mono-meta privacy-line"><LockKeyhole size={12} aria-hidden="true" /> {owner} and church leaders{more ? ` and ${more} more` : ""} can see this</p>
    {body.length > limit && <p className="inline-error">Keep it under {limit} characters.</p>}
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save" disabled={action.busy || !body.trim() || body.length > limit} onClick={() => void action.save(() => onSave(kind, body.trim()), onClose)}>{action.busy ? "Saving…" : "Save note"}</button>
  </Sheet>;
}

type LimitChannel = "text" | "call" | "visit";
const limitRows: Array<[LimitChannel, string, string]> = [["text", "Don’t text", "They asked not to be texted"], ["call", "Don’t call", "They asked not to be called"], ["visit", "Don’t visit", "They asked not to be visited"]];

/** Privacy and status (PE6): who can see them, the owner, their status, and
 * contact limits as switches. Only a leader can turn a limit off. */
function PrivacySheet({ resident, data, canManage, canEdit, restrictionActions, onUpsertResident, onHandoff, onAccess, onOwner, onClose }: {
  resident: Resident; data: NeighborWalkData; canManage: boolean; canEdit: boolean; restrictionActions: RestrictionActions;
  onUpsertResident: PeopleViewProps["onUpsertResident"]; onHandoff: PeopleViewProps["onHandoff"]; onAccess: () => void; onOwner: () => void; onClose: () => void;
}) {
  const action = useAsyncAction();
  const titleId = useId();
  const [cancelAsk, setCancelAsk] = useState(false);
  const { owner, more } = whoCanSee(resident, data);
  const name = resident.name || "this person";
  const pendingOwner = data.volunteers.find((volunteer) => volunteer.id === resident.pendingOwnerId);
  const family = recordFamilyIds(data.residents, resident.id);
  const active = (channel: LimitChannel | "all") => (data.restrictions ?? []).find((limit) => limit.active && limit.residentId && family.has(limit.residentId) && limit.channel === channel);
  const blocked = resident.contactPermission === "do_not_contact" || Boolean(active("all"));
  const toggle = (channel: LimitChannel, on: boolean, reason: string) => {
    selectionTick();
    const current = active(channel);
    void action.run(() => on ? restrictionActions.add({ residentId: resident.id, channel, reason }) : current ? restrictionActions.lift(current.id, "Turned off in Privacy and status") : Promise.resolve());
  };
  return <Sheet className="home-sheet form" modal labelledBy={titleId} onDismiss={action.busy ? () => undefined : onClose}>
    <SheetHead id={titleId} title={resident.name || "Privacy and status"} onClose={onClose} />
    <div className="grouped-rows">
      <button type="button" className="grouped-row" disabled={!canEdit} onClick={onAccess}><LockKeyhole size={19} aria-hidden="true" /><span className="grouped-row-text"><strong>Who can see {resident.name || "them"}</strong><small>{owner} (owner) and church leaders{more ? ` + ${more}` : ""}</small></span><ChevronRight size={17} aria-hidden="true" /></button>
      {pendingOwner
        ? <button type="button" className="grouped-row" disabled={!canEdit || !onHandoff} onClick={() => setCancelAsk(true)}><span className="avatar-dot small" aria-hidden="true">{initials(pendingOwner.name)}</span><span className="grouped-row-text"><strong>Waiting on {pendingOwner.name}</strong><small>They need to accept</small></span><ChevronRight size={17} aria-hidden="true" /></button>
        : <button type="button" className="grouped-row" disabled={!canEdit || !onHandoff} onClick={onOwner}><span className="avatar-dot small" aria-hidden="true">{initials(owner)}</span><span className="grouped-row-text"><strong>Change owner</strong></span><ChevronRight size={17} aria-hidden="true" /></button>}
    </div>
    <h3 className="mono-meta sheet-label" id={`${titleId}-status`}>Status</h3>
    <SegmentedControl label={`Status of ${name}`} value={resident.status} onChange={(status) => { if (canEdit) void action.run(() => onUpsertResident(resident.propertyId, residentInput(resident, { status }), resident.id)); }}
      options={[{ value: "active", label: "Active", disabled: !canEdit }, { value: "paused", label: "Paused", disabled: !canEdit }, { value: "archived", label: "Archived", disabled: !canEdit }]} />
    <h3 className="mono-meta sheet-label">Contact limits</h3>
    <div className="grouped-rows">
      {limitRows.map(([channel, label, reason]) => {
        const on = blocked || Boolean(active(channel));
        const locked = blocked || (on && !canManage) || action.busy;
        return <div key={channel} className="grouped-row"><span className="grouped-row-text" id={`${titleId}-${channel}`}><strong>{label}</strong></span><input type="checkbox" role="switch" aria-labelledby={`${titleId}-${channel}`} checked={on} disabled={locked} onChange={(event) => toggle(channel, event.target.checked, reason)} /></div>;
      })}
    </div>
    <p className="list-group-footer">{blocked ? "They asked not to be contacted at all. Only a leader can change this." : "Turning one on hides that way of reaching them everywhere. Only a leader can turn one off."}</p>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    {cancelAsk && pendingOwner && onHandoff && <ActionSheet title={`Stop asking ${pendingOwner.name} to take over?`} onClose={() => setCancelAsk(false)} actions={[
      { label: "Cancel hand-off", destructive: true, onSelect: () => { setCancelAsk(false); void action.save(() => onHandoff(resident.id, "cancel")); } },
    ]} closeLabel="Keep waiting" />}
  </Sheet>;
}

/** Who can see (from PE6): the owner and leaders always; share with others
 * helping care for them. */
function AccessSheet({ resident, data, canEdit, onSave, onClose }: { resident: Resident; data: NeighborWalkData; canEdit: boolean; onSave: (patch: Pick<ResidentInput, "sharedWithVolunteerIds" | "sharedWithTeamIds">) => Promise<unknown>; onClose: () => void }) {
  const [people, setPeople] = useState(resident.sharedWithVolunteerIds);
  const [teams, setTeams] = useState(resident.sharedWithTeamIds);
  const action = useAsyncAction();
  const titleId = useId();
  const { owner } = whoCanSee(resident, data);
  const flip = (list: string[], id: string) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
  const others = data.volunteers.filter((volunteer) => volunteer.active && volunteer.id !== resident.assignedVolunteerId && volunteer.role !== "leader");
  const savedTeams = data.teams;
  return <Sheet className="home-sheet form" modal detent="medium" labelledBy={titleId} onDismiss={action.busy ? () => undefined : onClose}>
    <SheetHead id={titleId} title={`Who can see ${resident.name || "them"}`} onClose={onClose} />
    <p className="sheet-copy">{owner} (owner) and church leaders can always see them. Share only with people helping care for them.</p>
    {others.length > 0 && <><h3 className="mono-meta sheet-label">People</h3><div className="grouped-rows" role="group" aria-label="Share with people">
      {others.map((volunteer) => <button key={volunteer.id} type="button" className="grouped-row" role="checkbox" aria-checked={people.includes(volunteer.id)} disabled={!canEdit} onClick={() => setPeople((list) => flip(list, volunteer.id))}><span className="avatar-dot small" aria-hidden="true">{initials(volunteer.name)}</span><span className="grouped-row-text"><strong>{volunteer.name}</strong></span>{people.includes(volunteer.id) && <Check size={19} className="row-check" aria-hidden="true" />}</button>)}
    </div></>}
    {savedTeams.length > 0 && <><h3 className="mono-meta sheet-label">Teams</h3><div className="grouped-rows" role="group" aria-label="Share with teams">
      {savedTeams.map((team) => <button key={team.id} type="button" className="grouped-row" role="checkbox" aria-checked={teams.includes(team.id)} disabled={!canEdit} onClick={() => setTeams((list) => flip(list, team.id))}><span className="grouped-row-text"><strong>{team.name}</strong><small>{team.memberIds.length} people</small></span>{teams.includes(team.id) && <Check size={19} className="row-check" aria-hidden="true" />}</button>)}
    </div></>}
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    {canEdit && <button type="button" className="walk-save" disabled={action.busy} onClick={() => void action.save(() => onSave({ sharedWithVolunteerIds: people, sharedWithTeamIds: teams }), onClose)}>{action.busy ? "Saving…" : "Save"}</button>}
  </Sheet>;
}

/** Change owner (from PE6): starts a hand-off the new owner must accept. */
function OwnerSheet({ resident, data, onRequest, onClose }: { resident: Resident; data: NeighborWalkData; onRequest: (volunteerId: string) => Promise<unknown>; onClose: () => void }) {
  const action = useAsyncAction();
  const titleId = useId();
  const confirm = useConfirm();
  const choices = data.volunteers.filter((volunteer) => volunteer.active && volunteer.id !== resident.assignedVolunteerId);
  const ask = (volunteerId: string, name: string) => void confirm({ title: `Ask ${name} to take over?`, message: "You stay responsible until they accept. Then the open follow-ups move to them.", confirmLabel: "Send request" })
    .then((yes) => { if (yes) void action.save(() => onRequest(volunteerId), onClose); });
  return <Sheet className="home-sheet form" modal detent="medium" labelledBy={titleId} onDismiss={action.busy ? () => undefined : onClose}>
    <SheetHead id={titleId} title="Change owner" onClose={onClose} />
    <p className="sheet-copy">They’ll need to accept. You stay responsible until they do.</p>
    <div className="grouped-rows">
      {choices.map((volunteer) => <button key={volunteer.id} type="button" className="grouped-row" disabled={action.busy} onClick={() => ask(volunteer.id, volunteer.name)}><span className="avatar-dot small" aria-hidden="true">{initials(volunteer.name)}</span><span className="grouped-row-text"><strong>{volunteer.name}</strong>{volunteer.role === "leader" && <small>Leader</small>}</span><ChevronRight size={17} aria-hidden="true" /></button>)}
    </div>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
  </Sheet>;
}

/** Plan a follow-up from the person's ⋯, when nothing is open. */
function PlanFollowUpSheet({ data, name, onSave, onClose }: { data: NeighborWalkData; name: string; onSave: (note: string, date: string) => Promise<unknown>; onClose: () => void }) {
  const timezone = data.church.timezone;
  const [note, setNote] = useState("");
  const [date, setDate] = useState(calendarDaysFromNow(data.church.defaultFollowUpDays, timezone));
  const action = useAsyncAction();
  const titleId = useId();
  const field = useFocusOnMount<HTMLTextAreaElement>();
  return <Sheet className="home-sheet form" modal labelledBy={titleId} onDismiss={action.busy ? () => undefined : onClose}>
    <SheetHead id={titleId} title="Plan a follow-up" onClose={onClose} />
    <label className="pin-field"><span className="mono-meta">What needs to happen?</span><textarea ref={field} rows={2} maxLength={data.church.noteCharacterLimit} value={note} onChange={(event) => setNote(event.target.value)} placeholder={`Check in with ${name}`} /></label>
    <label className="pin-field"><span className="mono-meta">Due</span><input type="date" min={calendarDate(new Date(), timezone)} value={date} onChange={(event) => setDate(event.target.value)} /></label>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save" disabled={action.busy || !note.trim() || !date} onClick={() => void action.save(() => onSave(note.trim(), date), onClose)}>{action.busy ? "Saving…" : "Add follow-up"}</button>
  </Sheet>;
}

/** Edit person (PE7) and Add person (PE8): name, home, and the same contact
 * block as the door. Also opened from a home's "+ Add" with the home filled in. */
export function PersonFormSheet({ data, resident, initialPropertyId, activeVolunteerId, onSave, onSaved, onClose }: {
  data: NeighborWalkData; resident?: Resident; initialPropertyId?: string; activeVolunteerId: string;
  onSave: (propertyId: string | undefined, input: ResidentInput, residentId?: string) => Promise<string>;
  onSaved: (residentId: string) => void; onClose: () => void;
}) {
  const [name, setName] = useState(resident?.name ?? "");
  const [propertyId, setPropertyId] = useState(resident?.propertyId ?? initialPropertyId ?? "");
  const hadContact = Boolean(resident?.phone) && resident?.preferredContact !== "none";
  const [stayInTouch, setStayInTouch] = useState(resident ? hadContact : true);
  const [phone, setPhone] = useState(resident?.phone ? formatPhoneNumber(resident.phone) : "");
  const [method, setMethod] = useState<"text" | "call">(resident?.preferredContact === "call" ? "call" : "text");
  const [picking, setPicking] = useState(false);
  const action = useAsyncAction();
  const titleId = useId();
  const nameId = useId();
  const home = indexCurrentRecords(data.properties).get(propertyId);
  const hasPhone = stayInTouch && phone.trim().length >= 3;
  const valid = Boolean(name.trim() || hasPhone) && (!stayInTouch || !phone.trim() || phone.trim().length >= 3);
  const save = () => action.save(async () => {
    const contact = { phone: hasPhone ? phone.trim() : undefined, preferredContact: hasPhone ? method : "none" as const };
    const moved = Boolean(resident && (resident.propertyId ?? "") !== propertyId);
    const input: ResidentInput = resident
      ? residentInput(resident, { name: name.trim() || undefined, ...contact, contactPermission: resident.contactPermission === "do_not_contact" ? "do_not_contact" : hasPhone ? "requested" : resident.contactPermission, changeReason: moved ? "Home changed in Edit person" : undefined })
      : { name: name.trim() || undefined, faithStatus: "not_discussed", discipleshipStage: "new_connection", assignedVolunteerId: activeVolunteerId, sharedWithVolunteerIds: [], sharedWithTeamIds: [], status: "active", ...contact, contactPermission: hasPhone ? "requested" : "not_recorded" };
    onSaved(await onSave(propertyId || undefined, input, resident?.id));
  });

  if (picking) return <HomePicker data={data} currentId={propertyId} onPick={(id) => { setPropertyId(id); setPicking(false); }} onClose={() => setPicking(false)} />;
  return <Sheet className="home-sheet form" modal labelledBy={titleId} onDismiss={action.busy ? () => undefined : onClose}>
    <SheetHead id={titleId} title={resident ? `Edit ${resident.name || "person"}` : "New person"} onClose={onClose} />
    <h3 className="mono-meta sheet-label" id={nameId}>Name</h3>
    <input className="sheet-input" aria-labelledby={nameId} value={name} maxLength={120} enterKeyHint="done" autoComplete="off" onChange={(event) => setName(event.target.value)} placeholder="Name, or a short description" />
    <h3 className="mono-meta sheet-label">Home</h3>
    <div className="grouped-rows">
      {home ? <div className="grouped-row"><MapPin size={19} aria-hidden="true" /><span className="grouped-row-text"><strong>{home.address}{home.unit ? ` · ${home.unit}` : ""}</strong></span><button type="button" className="mono-meta hedge row-link" aria-label={`Change home, now ${home.address}`} onClick={() => setPicking(true)}>Change</button></div>
        : <button type="button" className="grouped-row" onClick={() => setPicking(true)}><MapPin size={19} aria-hidden="true" /><span className="grouped-row-text"><strong className="quiet">Choose a home</strong></span><ChevronRight size={17} aria-hidden="true" /></button>}
    </div>
    <ContactBlock stayInTouch={stayInTouch} phone={phone} method={method} onStayInTouch={setStayInTouch} onPhone={setPhone} onMethod={setMethod} />
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save" disabled={action.busy || !valid} onClick={() => void save()}>{action.busy ? "Saving…" : resident ? "Save" : "Add person"}</button>
  </Sheet>;
}

/** Choose a home: pinned homes, searched by street. */
function HomePicker({ data, currentId, onPick, onClose }: { data: NeighborWalkData; currentId: string; onPick: (propertyId: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const titleId = useId();
  const field = useFocusOnMount<HTMLInputElement>();
  const needle = query.trim().toLowerCase();
  const homes = data.properties.filter((property: Property) => !property.mergedIntoId && (!needle || `${property.address} ${property.unit ?? ""}`.toLowerCase().includes(needle)))
    .sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true })).slice(0, 60);
  return <Sheet className="home-sheet form" modal detent="large" labelledBy={titleId} onDismiss={onClose}>
    <SheetHead id={titleId} title="Choose a home" onClose={onClose} />
    <label className="search-box"><Search size={18} aria-hidden="true" /><input ref={field} type="search" aria-label="Search homes" enterKeyHint="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Street or number" /></label>
    <div className="grouped-rows">
      {currentId && <button type="button" className="grouped-row" onClick={() => onPick("")}><span className="grouped-row-text"><strong>No home</strong><small>Met somewhere else</small></span></button>}
      {homes.map((property) => <button key={property.id} type="button" className="grouped-row" aria-pressed={property.id === currentId} onClick={() => onPick(property.id)}><MapPin size={19} aria-hidden="true" /><span className="grouped-row-text"><strong>{property.address}{property.unit ? ` · ${property.unit}` : ""}</strong></span>{property.id === currentId && <Check size={19} className="row-check" aria-hidden="true" />}</button>)}
    </div>
    {!homes.length && <p className="home-empty">No pinned home matches. Drop a pin on the map first.</p>}
  </Sheet>;
}
