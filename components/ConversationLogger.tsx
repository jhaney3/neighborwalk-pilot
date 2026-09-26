"use client";
import { Check, MapPin, MessageCircle, Phone, Plus, Search, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { calendarDaysFromNow, formatCalendarDate } from "../lib/calendar";
import { contactRestricted } from "../lib/contact-restrictions";
import { type NeighborWalkData, type Resident, type ResidentInput } from "../lib/domain";
import { reviewedEncounter } from "../lib/encounter-history";
import { residentInput } from "../lib/resident-input";
import type { EncounterInput } from "../lib/encounters";
import { useAsyncAction } from "../lib/use-async-action";
import { isCommunityOuting } from "../lib/walk-phase";
import { selectionTick } from "../mobile/haptics";
import { ContactBlock } from "./PinSheet";
import { ActionSheet, Sheet } from "./Sheet";
import { initials } from "./ui";

type Props = {
  data: NeighborWalkData;
  /** A walk the conversation belongs to, such as the one being walked now. */
  outingId?: string;
  /** Your route on that walk, for "Crockett north · away from a door". */
  routeName?: string;
  onSave: (input: EncounterInput) => Promise<unknown>;
  onCreatePerson: (input: ResidentInput) => Promise<string>;
  /** Saves contact details added for someone already chosen or just added. */
  onUpdatePerson?: (residentId: string, input: ResidentInput) => Promise<unknown>;
};

type Contact = { stayInTouch: boolean; phone: string; method: "text" | "call" };

type Place = NonNullable<EncounterInput["context"]>;
type Happened = "talked" | "prayed" | "follow_up" | "declined";
type Channel = "call" | "text" | "visit";

const places: { value: Place; label: string }[] = [
  { value: "community_meal", label: "Community meal" },
  { value: "service", label: "Service day" },
  { value: "referral", label: "Referral" },
  { value: "other", label: "Somewhere else" },
];
/** Outcome first: Prayed and Not now save in one tap; Talked and Follow up save
 * too, then ask who you met. See docs/design/decisions.md. */
const happenings: { value: Happened; label: string; hint: string; details: boolean }[] = [
  { value: "talked", label: "Talked", hint: "Add details next", details: true },
  { value: "prayed", label: "Prayed", hint: "Together · saves", details: false },
  { value: "follow_up", label: "Follow up", hint: "They asked", details: true },
  { value: "declined", label: "Not now", hint: "Not interested", details: false },
];
const channelLabel: Record<Channel, string> = { call: "Call", text: "Text", visit: "Visit" };

/** Opens the logger from a button, for screens that host their own entry point. */
export function ConversationLauncher(props: Props) {
  const [open, setOpen] = useState(false);
  return <div className="encounter-launcher">
    <button className="button quiet" onClick={() => setOpen(true)}><MessageCircle size={18} aria-hidden="true" /> Log a conversation</button>
    {open && <ConversationLogger {...props} onClose={() => setOpen(false)} />}
  </div>;
}

function localNow() {
  const now = new Date();
  now.setSeconds(0, 0);
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** The + sheet: Where (the live walk when there is one), who, then what
 * happened. Talked and Follow up are saved at once; "Who did you meet?" adds to
 * them until Done. */
export function ConversationLogger({ data, outingId, routeName, onSave, onCreatePerson, onUpdatePerson, onClose }: Props & { onClose: () => void }) {
  const action = useAsyncAction();
  const titleId = useId();
  const searchId = useId();
  const searchInput = useRef<HTMLInputElement>(null);
  const timezone = data.church.timezone;
  const actorId = data.preferences.activeVolunteerId;
  const liveWalk = outingId ? data.events.find((event) => event.id === outingId) : data.events.find((event) => event.status === "active");
  const gathering = liveWalk && isCommunityOuting(liveWalk.id, data.assignments ?? [], data.walkTargets);
  const lastPlace = useMemo(() => data.visits.map(reviewedEncounter)
    .filter((visit) => visit.volunteerId === actorId && visit.context !== "door" && !visit.voided)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0], [actorId, data.visits]);
  // During a door walk the conversation still counts toward it, away from a door.
  const [partOfWalk, setPartOfWalk] = useState(Boolean(liveWalk));
  const [place, setPlace] = useState<Place>(gathering ? "community_meal" : liveWalk ? "other" : lastPlace?.context ?? "community_meal");
  const [placeLabel, setPlaceLabel] = useState(gathering ? liveWalk!.name : liveWalk ? "" : lastPlace?.placeLabel ?? "");
  const [editingWhere, setEditingWhere] = useState(false);
  const [stage, setStage] = useState<"choose" | "details">("choose");
  const [happened, setHappened] = useState<Happened>("talked");
  const [peopleIds, setPeopleIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [stayInTouch, setStayInTouch] = useState(false);
  const [triedDone, setTriedDone] = useState(false);
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"text" | "call">("text");
  const [contacts, setContacts] = useState<Record<string, Contact>>({});
  const [contactFor, setContactFor] = useState<string | null>(null);
  const [prayer, setPrayer] = useState("");
  const [note, setNote] = useState("");
  const [channelChoice, setChannelChoice] = useState<Channel | null>(null);
  const [dueChoice, setDueChoice] = useState(calendarDaysFromNow(data.church.defaultFollowUpDays, timezone));
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [menu, setMenu] = useState<"channel" | "day" | "owner" | null>(null);
  const [pickingDate, setPickingDate] = useState(false);
  const [whenOpen, setWhenOpen] = useState(false);
  const [when, setWhen] = useState(localNow);

  const people = useMemo(() => data.residents.filter((person) => person.status !== "archived" && !person.mergedIntoId), [data.residents]);
  const chosen = peopleIds.map((id) => people.find((person) => person.id === id)).filter((person): person is NonNullable<typeof person> => Boolean(person));
  const recent = useMemo(() => {
    const seen = new Set<string>();
    const fromVisits = [...data.visits].filter((visit) => visit.volunteerId === actorId && visit.residentId)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .flatMap((visit) => {
        const person = people.find((item) => item.id === visit.residentId);
        if (!person?.name || seen.has(person.id)) return [];
        seen.add(person.id);
        return [person];
      });
    // Then the people you care for, most recently contacted first.
    const owned = people.filter((person) => person.name && !seen.has(person.id) && person.assignedVolunteerId === actorId)
      .sort((a, b) => (b.lastContactAt ?? b.updatedAt).localeCompare(a.lastContactAt ?? a.updatedAt));
    return [...fromVisits, ...owned].slice(0, 8);
  }, [actorId, data.visits, people]);
  const trimmedQuery = query.trim();
  const matches = trimmedQuery.length < 1 ? [] : people
    .filter((person) => !peopleIds.includes(person.id) && (person.name ?? "").toLowerCase().includes(trimmedQuery.toLowerCase()))
    .slice(0, 5);
  const exactMatch = people.some((person) => (person.name ?? "").trim().toLowerCase() === trimmedQuery.toLowerCase());
  const primary = chosen[0];
  // Anyone you met without a phone on file can get one here, starting on No.
  // People whose contact details are already saved don't get asked again.
  const contactOf = (person: Resident): Contact => contacts[person.id] ?? { stayInTouch: false, phone: "", method: "text" };
  const reachable = onUpdatePerson ? chosen.filter((person) => !person.phone && person.contactPermission !== "do_not_contact") : [];
  const contactPerson = reachable.find((person) => person.id === contactFor) ?? reachable[0];
  const editContact = (patch: Partial<Contact>) => { if (contactPerson) setContacts((current) => ({ ...current, [contactPerson.id]: { ...contactOf(contactPerson), ...patch } })); };
  const newPerson = !chosen.length && (newName.trim().length > 0 || (stayInTouch && phone.trim().length > 0));
  const followUp = happened === "follow_up";
  const primaryContact = primary && contacts[primary.id];
  const channel: Channel = channelChoice ?? (!chosen.length && stayInTouch && phone.trim() ? method
    : primaryContact ? (primaryContact.stayInTouch && primaryContact.phone.trim() ? primaryContact.method : "visit")
    : primary && primary.preferredContact !== "none" && primary.preferredContact !== "email" ? primary.preferredContact : "visit");
  const followUpBlocked = followUp && Boolean(primary) && contactRestricted(data, primary?.id, channel, primary?.propertyId);
  const personOwner = primary && primary.assignedVolunteerId !== actorId ? data.volunteers.find((volunteer) => volunteer.id === primary.assignedVolunteerId) : undefined;
  const owner = ownerId ?? (personOwner ? personOwner.id : actorId);
  const ownerLabel = owner === actorId ? "Me" : data.volunteers.find((volunteer) => volunteer.id === owner)?.name ?? "Me";
  // A follow-up with no one named needs a line saying what should happen next.
  const askNext = followUp && !primary && !newPerson;
  const needsNote = askNext && !prayer.trim() && !note.trim();
  const whereLabel = liveWalk && partOfWalk && !gathering && place === "other" && !placeLabel.trim()
    ? `${routeName ?? liveWalk.name} · away from a door`
    : placeLabel.trim() || places.find((item) => item.value === place)!.label;
  const dayLabel = (date: string) => formatCalendarDate(date, { weekday: "short" });

  const addPerson = (id: string) => { setPeopleIds((current) => current.includes(id) ? current : [...current, id]); setQuery(""); };
  const togglePerson = (id: string) => { selectionTick(); setPeopleIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); };
  const personInput = (name: string | undefined, contact = false): ResidentInput => {
    const hasPhone = contact && stayInTouch && phone.trim().length >= 3;
    return {
      name, faithStatus: "not_discussed", discipleshipStage: "new_connection",
      assignedVolunteerId: actorId, sharedWithVolunteerIds: [], sharedWithTeamIds: [], status: "active",
      phone: hasPhone ? phone.trim() : undefined, preferredContact: hasPhone ? method : "none",
      contactPermission: hasPhone ? "requested" : "not_recorded",
    };
  };
  const createPerson = () => action.run(async () => { addPerson(await onCreatePerson(personInput(trimmedQuery))); });

  const save = (chosenHappened: Happened) => action.save(async () => {
    const chosenOutcome: EncounterInput["outcome"] = chosenHappened === "follow_up" ? "follow_up" : chosenHappened === "declined" ? "declined" : "conversation";
    const shared: EncounterInput = {
      context: place,
      eventId: partOfWalk ? liveWalk?.id : undefined,
      placeLabel: placeLabel.trim() || undefined,
      needs: chosenHappened === "prayed" ? ["prayer"] : undefined,
      occurredAt: whenOpen ? new Date(when).toISOString() : undefined,
      objectiveNote: note.trim() || undefined,
      prayerRequest: prayer.trim() || undefined,
      outcome: chosenOutcome,
    };
    for (const person of chosen) {
      const edited = contacts[person.id];
      if (!edited || !onUpdatePerson) continue;
      const hasPhone = edited.stayInTouch && edited.phone.trim().length >= 3;
      const phoneValue = hasPhone ? edited.phone.trim() : undefined;
      const preferred = hasPhone ? edited.method : "none";
      if ((person.phone ?? "") === (phoneValue ?? "") && person.preferredContact === preferred) continue;
      await onUpdatePerson(person.id, residentInput(person, { phone: phoneValue, preferredContact: preferred, contactPermission: hasPhone ? "requested" : person.contactPermission }));
    }
    const everyone = chosen.map((person) => person.id);
    if (newPerson) everyone.push(await onCreatePerson(personInput(newName.trim() || undefined, true)));
    const followUpDetails = chosenOutcome === "follow_up" ? { followUpDate: dueChoice, followUpChannel: channel, followUpOwnerId: owner } : {};
    if (!everyone.length) {
      await onSave({ ...shared, ...followUpDetails });
      return;
    }
    // One record per person keeps each person's privacy rules intact. Only
    // the first person carries the follow-up so a family gets one next step.
    for (const [index, residentId] of everyone.entries()) {
      const first = index === 0;
      await onSave({ ...shared, residentId,
        outcome: first || chosenOutcome !== "follow_up" ? chosenOutcome : "conversation",
        ...(first ? followUpDetails : {}) });
    }
  }, onClose);

  const choose = (option: (typeof happenings)[number]) => {
    setHappened(option.value);
    if (option.details) setStage("details");
    else void save(option.value);
  };
  // Done stays tappable; if something is missing it says what instead of greying out.
  const done = () => {
    if (action.busy) return;
    if (needsNote || followUpBlocked) { setTriedDone(true); return; }
    void save(happened);
  };

  if (stage === "details") return <Sheet className="log-sheet-sheet" modal labelledBy={titleId} onDismiss={done}>
    <div className="pin-details">
      <div className="pin-details-top">
        <span className="pin-saved mono-meta" role="status"><Check size={13} aria-hidden="true" />Saved · {followUp ? "Follow up" : "Talked"}</span>
        <span className="mono-meta">{whereLabel.split(" · ")[0]}</span>
      </div>
      <h2 className="pin-title" id={titleId}>{chosen.length ? "Anything to add?" : "Who did you meet?"}</h2>
      {chosen.length ? <>
        <p className="walk-field-note">With {chosen.map((person) => person.name || "someone").join(", ")}</p>
        {contactPerson && <div className="walk-field log-contact">
          {reachable.length > 1 ? <div className="walk-chips" role="group" aria-label="Whose contact">{reachable.map((person) => <button key={person.id} type="button" aria-pressed={person.id === contactPerson.id} onClick={() => { selectionTick(); setContactFor(person.id); }}>{person.name || "Someone"}</button>)}</div>
            : <span className="mono-meta">Contact · {contactPerson.name || "Someone"}</span>}
          <ContactBlock stayInTouch={contactOf(contactPerson).stayInTouch} phone={contactOf(contactPerson).phone} method={contactOf(contactPerson).method}
            onStayInTouch={(value) => editContact({ stayInTouch: value })} onPhone={(value) => editContact({ phone: value })} onMethod={(value) => editContact({ method: value })} />
        </div>}
      </> : <>
        <label className="walk-field"><span className="mono-meta">Name</span><input value={newName} maxLength={120} autoComplete="off" enterKeyHint="done" onChange={(event) => setNewName(event.target.value)} placeholder="If they shared it" /></label>
        <ContactBlock stayInTouch={stayInTouch} phone={phone} method={method} onStayInTouch={setStayInTouch} onPhone={setPhone} onMethod={setMethod} />
      </>}
      <label className="walk-field"><span className="mono-meta">Prayer request · private</span><textarea rows={2} maxLength={data.church.noteCharacterLimit} value={prayer} onChange={(event) => setPrayer(event.target.value)} placeholder="Only if they asked for prayer" /></label>
      <div className="walk-comeback offset-card porch">
        <label className="walk-switch-row"><span>Follow up?</span><input type="checkbox" role="switch" checked={followUp} onChange={(event) => setHappened(event.target.checked ? "follow_up" : "talked")} /></label>
        {followUp && <div className="follow-chips" role="group" aria-label="Follow-up">
          <button type="button" aria-label={`How: ${channelLabel[channel]}. Change`} onClick={() => setMenu("channel")}>{channel === "call" ? <Phone size={15} aria-hidden="true" /> : channel === "text" ? <MessageCircle size={15} aria-hidden="true" /> : <MapPin size={15} aria-hidden="true" />}{channelLabel[channel]}</button>
          <button type="button" aria-label={`When: ${formatCalendarDate(dueChoice, { weekday: "long", month: "long", day: "numeric" })}. Change`} onClick={() => setMenu("day")}>{dayLabel(dueChoice)}</button>
          {personOwner ? <button type="button" aria-label={`Who: ${ownerLabel}. Change`} onClick={() => setMenu("owner")}>{ownerLabel}</button> : <span className="follow-chip-static" aria-label="You follow up">Me</span>}
        </div>}
        {followUp && pickingDate && <input type="date" aria-label="Follow-up date" value={dueChoice} min={calendarDaysFromNow(0, timezone)} onChange={(event) => { if (event.target.value) setDueChoice(event.target.value); }} />}
        {followUpBlocked && <p className="inline-notice" role="status">{primary?.name || "This person"} asked not to be contacted this way. Choose another way or turn this off.</p>}
      </div>
      {askNext && <label className="walk-field"><span className="mono-meta">What should happen next?</span><textarea rows={2} maxLength={data.church.noteCharacterLimit} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Your team can see this. Leave out private details." /></label>}
      {triedDone && needsNote && <p role="alert" className="inline-error">Add their name, a phone, or what should happen next, so someone can follow up.</p>}
      {triedDone && followUpBlocked && <p role="alert" className="inline-error">Choose another way to follow up, or turn Follow up off.</p>}
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}
      <button type="button" className="walk-save" disabled={action.busy} onClick={done}>{action.busy ? "Saving…" : "Done"}</button>
    </div>
    {menu === "channel" && <ActionSheet title="How will you follow up?" onClose={() => setMenu(null)} actions={(["call", "text", "visit"] as const).map((value) => ({ label: channelLabel[value], onSelect: () => { setChannelChoice(value); setMenu(null); } }))} />}
    {menu === "day" && <ActionSheet title="When?" onClose={() => setMenu(null)} actions={[
      { label: "Tomorrow", onSelect: () => { setDueChoice(calendarDaysFromNow(1, timezone)); setPickingDate(false); setMenu(null); } },
      { label: formatCalendarDate(calendarDaysFromNow(data.church.defaultFollowUpDays, timezone), { weekday: "long" }), onSelect: () => { setDueChoice(calendarDaysFromNow(data.church.defaultFollowUpDays, timezone)); setPickingDate(false); setMenu(null); } },
      { label: "In a week", onSelect: () => { setDueChoice(calendarDaysFromNow(7, timezone)); setPickingDate(false); setMenu(null); } },
      { label: "Pick a date", onSelect: () => { setPickingDate(true); setMenu(null); } },
    ]} />}
    {menu === "owner" && personOwner && <ActionSheet title="Who follows up?" onClose={() => setMenu(null)} actions={[
      { label: `${personOwner.name} (their owner)`, onSelect: () => { setOwnerId(personOwner.id); setMenu(null); } },
      { label: "Me", onSelect: () => { setOwnerId(actorId); setMenu(null); } },
    ]} />}
  </Sheet>;

  return <Sheet className="log-sheet-sheet" modal labelledBy={titleId} onDismiss={action.busy ? () => undefined : onClose}>
    <div className="log-sheet">
      <div className="home-sheet-head"><h2 className="pin-title log-title" id={titleId}>Log a conversation</h2><button type="button" className="round-line" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
      <div className="log-where offset-card">
        <div className="log-where-row">
          <MapPin size={20} aria-hidden="true" />
          <div><p className="mono-meta">Where{partOfWalk && liveWalk ? " · live now" : ""}</p><strong>{whereLabel}</strong></div>
          <button type="button" className="mono-meta hedge log-change" aria-expanded={editingWhere} onClick={() => setEditingWhere((current) => !current)}>{editingWhere ? "Done" : "Change"}</button>
        </div>
        {editingWhere && <div className="log-where-editor">
          <div className="walk-chips" role="group" aria-label="Where">{places.map((option) => <button key={option.value} type="button" aria-pressed={place === option.value} onClick={() => { selectionTick(); setPlace(option.value); }}>{option.label}</button>)}</div>
          <label className="walk-field"><span className="mono-meta">Place name (optional)</span><input aria-label="Place name (optional)" value={placeLabel} maxLength={120} enterKeyHint="done" onChange={(event) => setPlaceLabel(event.target.value)} placeholder="Friday supper at the fellowship hall" /></label>
          {liveWalk && <label className="log-part-of"><input type="checkbox" checked={partOfWalk} onChange={(event) => setPartOfWalk(event.target.checked)} /> Part of {liveWalk.name}</label>}
        </div>}
      </div>
      <section className="walk-field" aria-labelledby={`${searchId}-who`}>
        <span className="mono-meta" id={`${searchId}-who`}>Who</span>
        {chosen.length > 0 && <ul className="person-chips" aria-label="People in this conversation">{chosen.map((person) => <li key={person.id}><span>{person.name || "Someone"}</span><button type="button" aria-label={`Remove ${person.name || "person"}`} onClick={() => togglePerson(person.id)}><X size={14} aria-hidden="true" /></button></li>)}</ul>}
        <div className="conversation-search">
          <Search size={16} aria-hidden="true" />
          <input ref={searchInput} id={searchId} type="search" role="combobox" enterKeyHint="search" aria-expanded={Boolean(trimmedQuery)} aria-controls={`${searchId}-results`} aria-label="Find or add a person" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find or add a person" />
        </div>
        {trimmedQuery && <ul className="conversation-results" id={`${searchId}-results`} role="listbox" aria-label="People">
          {matches.map((person) => <li key={person.id} role="option" aria-selected="false"><button type="button" onClick={() => addPerson(person.id)}>{person.name}</button></li>)}
          {!exactMatch && <li role="option" aria-selected="false"><button type="button" disabled={action.busy} onClick={() => void createPerson()}><Plus size={15} aria-hidden="true" /> Add “{trimmedQuery}” as someone new</button></li>}
        </ul>}
        {!trimmedQuery && <div className="log-faces" role="group" aria-label="Recent people">
          <button type="button" className="new" onClick={() => searchInput.current?.focus()}><span aria-hidden="true"><Plus size={20} /></span>New</button>
          {recent.map((person) => <button type="button" key={person.id} aria-pressed={peopleIds.includes(person.id)} onClick={() => togglePerson(person.id)}><span aria-hidden="true">{initials(person.name ?? "?").slice(0, 1)}</span>{(person.name ?? "").split(" ")[0]}</button>)}
        </div>}
      </section>
      <h3 className="log-question">What happened?</h3>
      <div className="walk-outcomes" role="group" aria-label="What happened">
        {happenings.map((option) => <button type="button" key={option.value} className={`walk-outcome${option.value === "talked" ? " primary" : ""}`} disabled={action.busy} onClick={() => choose(option)}>
          <span className="walk-outcome-label">{option.value === "follow_up" || option.value === "declined" ? <i style={{ background: option.value === "follow_up" ? "var(--o-fu)" : "var(--o-dec)" }} aria-hidden="true" /> : null}{option.label}</span><span className="mono-meta">{option.hint}</span>
        </button>)}
      </div>
      {whenOpen
        ? <label className="walk-field"><span className="mono-meta">When it happened</span><input type="datetime-local" aria-label="When it happened" value={when} max={localNow()} onChange={(event) => setWhen(event.target.value)} /></label>
        : <button type="button" className="walk-add-note" onClick={() => setWhenOpen(true)}>Happened earlier?</button>}
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    </div>
  </Sheet>;
}

