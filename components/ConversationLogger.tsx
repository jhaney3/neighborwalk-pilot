"use client";
import { MessageCircle, Plus, Search, X } from "lucide-react";
import { useId, useState } from "react";
import { calendarDaysFromNow } from "../lib/calendar";
import { contactRestricted } from "../lib/contact-restrictions";
import { conversationNeedLabels, conversationNeedValues, type ConversationNeed, type NeighborWalkData, type ResidentInput } from "../lib/domain";
import type { EncounterInput } from "../lib/encounters";
import { useAsyncAction } from "../lib/use-async-action";
import { Modal } from "./ui";

type Props = {
  data: NeighborWalkData;
  /** A walk the conversation belongs to, such as the one being walked now. */
  outingId?: string;
  onSave: (input: EncounterInput) => Promise<unknown>;
  onCreatePerson: (input: ResidentInput) => Promise<string>;
};

type Place = NonNullable<EncounterInput["context"]>;
type Happened = "talked" | "prayed" | "follow_up" | "declined";

const places: { value: Place; label: string }[] = [
  { value: "community_meal", label: "Community meal" },
  { value: "service", label: "Service day" },
  { value: "referral", label: "Referral" },
  { value: "other", label: "Somewhere else" },
];
const happenings: { value: Happened; label: string }[] = [
  { value: "talked", label: "Talked" },
  { value: "prayed", label: "Prayed together" },
  { value: "follow_up", label: "Wants a follow-up" },
  { value: "declined", label: "Not interested" },
];

/** Opens the logger from a button, for screens that host their own entry point. */
export function ConversationLauncher(props: Props) {
  const [open, setOpen] = useState(false);
  return <div className="encounter-launcher">
    <button className="button quiet" onClick={() => setOpen(true)}><MessageCircle size={18} aria-hidden="true" /> Log a conversation</button>
    {open && <ConversationLogger {...props} onClose={() => setOpen(false)} />}
  </div>;
}

function Chips<T extends string>({ label, options, selected, onToggle }: { label: string; options: { value: T; label: string }[]; selected: readonly T[]; onToggle: (value: T) => void }) {
  return <div className="chip-group" role="group" aria-label={label}>
    {options.map((option) => <button key={option.value} type="button" className="chip" aria-pressed={selected.includes(option.value)} onClick={() => onToggle(option.value)}>{option.label}</button>)}
  </div>;
}

function localNow() {
  const now = new Date();
  now.setSeconds(0, 0);
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ConversationLogger({ data, outingId, onSave, onCreatePerson, onClose }: Props & { onClose: () => void }) {
  const action = useAsyncAction();
  const searchId = useId();
  const liveWalk = outingId ? data.events.find((event) => event.id === outingId) : data.events.find((event) => event.status === "active");
  const [partOfWalk, setPartOfWalk] = useState(Boolean(outingId));
  const [place, setPlace] = useState<Place>("community_meal");
  const [placeLabel, setPlaceLabel] = useState("");
  const [happened, setHappened] = useState<Happened>("talked");
  const [needs, setNeeds] = useState<ConversationNeed[]>([]);
  const [peopleIds, setPeopleIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [prayerOpen, setPrayerOpen] = useState(false);
  const [prayer, setPrayer] = useState("");
  const [followUpDate, setFollowUpDate] = useState(calendarDaysFromNow(1, data.church.timezone));
  const [whenOpen, setWhenOpen] = useState(false);
  const [when, setWhen] = useState(localNow);

  const people = data.residents.filter((person) => person.status !== "archived" && !person.mergedIntoId);
  const chosen = peopleIds.map((id) => people.find((person) => person.id === id)).filter((person): person is NonNullable<typeof person> => Boolean(person));
  const trimmedQuery = query.trim();
  const matches = trimmedQuery.length < 1 ? [] : people
    .filter((person) => !peopleIds.includes(person.id) && (person.name ?? "").toLowerCase().includes(trimmedQuery.toLowerCase()))
    .slice(0, 5);
  const exactMatch = people.some((person) => (person.name ?? "").trim().toLowerCase() === trimmedQuery.toLowerCase());
  const primary = chosen[0];
  const outcome: EncounterInput["outcome"] = happened === "follow_up" ? "follow_up" : happened === "declined" ? "declined" : "conversation";
  const followUpChannel = !primary || primary.preferredContact === "none" ? "other" : primary.preferredContact;
  const followUpBlocked = outcome === "follow_up" && Boolean(primary) && contactRestricted(data, primary?.id, followUpChannel, primary?.propertyId);
  const owner = primary ? data.volunteers.find((volunteer) => volunteer.id === primary.assignedVolunteerId)?.name : undefined;
  const needsNote = outcome === "follow_up" && !primary && !note.trim();

  const addPerson = (id: string) => { setPeopleIds((current) => [...current, id]); setQuery(""); };
  const createPerson = () => action.run(async () => {
    const id = await onCreatePerson({
      name: trimmedQuery, faithStatus: "not_discussed", discipleshipStage: "new_connection",
      assignedVolunteerId: data.preferences.activeVolunteerId, sharedWithVolunteerIds: [], sharedWithTeamIds: [],
      status: "active", preferredContact: "none", contactPermission: "not_recorded",
    });
    addPerson(id);
  });
  const toggleNeed = (need: ConversationNeed) => setNeeds((current) => current.includes(need) ? current.filter((item) => item !== need) : [...current, need]);

  const save = () => action.run(async () => {
    const shared: EncounterInput = {
      context: place,
      eventId: partOfWalk ? liveWalk?.id : undefined,
      placeLabel: placeLabel.trim() || undefined,
      needs: happened === "prayed" && !needs.includes("prayer") ? [...needs, "prayer"] : needs,
      occurredAt: whenOpen ? new Date(when).toISOString() : undefined,
      objectiveNote: note.trim() || undefined,
      prayerRequest: prayer.trim() || undefined,
      outcome,
    };
    if (!chosen.length) {
      await onSave({ ...shared, followUpDate: outcome === "follow_up" ? followUpDate : undefined });
      return;
    }
    // One record per person keeps each person's privacy rules intact. Only
    // the first person carries the follow-up so a family gets one next step.
    for (const [index, person] of chosen.entries()) {
      const first = index === 0;
      await onSave({ ...shared, residentId: person.id,
        outcome: first || outcome !== "follow_up" ? outcome : "conversation",
        followUpDate: first && outcome === "follow_up" ? followUpDate : undefined });
    }
  }, onClose);

  return <Modal title="Log a conversation" description="Anywhere outside a door: a meal, a service day, a referral." wide onClose={action.busy ? () => undefined : onClose}>
    <form className="conversation-logger" onSubmit={(event) => { event.preventDefault(); if (!needsNote && !followUpBlocked) void save(); }}>
      <fieldset>
        <legend>Where</legend>
        <Chips label="Where" options={places} selected={[place]} onToggle={setPlace} />
        <label className="conversation-field">Place name (optional)<input value={placeLabel} maxLength={120} onChange={(event) => setPlaceLabel(event.target.value)} placeholder="Friday supper at the fellowship hall" /></label>
        {liveWalk && <label className="checkbox-label"><input type="checkbox" checked={partOfWalk} onChange={(event) => setPartOfWalk(event.target.checked)} /> Part of {liveWalk.name}</label>}
      </fieldset>

      <fieldset>
        <legend>Who</legend>
        {chosen.length > 0 && <ul className="person-chips" aria-label="People in this conversation">{chosen.map((person) => <li key={person.id}><span>{person.name || "Someone"}</span><button type="button" aria-label={`Remove ${person.name || "person"}`} onClick={() => setPeopleIds((current) => current.filter((id) => id !== person.id))}><X size={14} aria-hidden="true" /></button></li>)}</ul>}
        <div className="conversation-search">
          <Search size={16} aria-hidden="true" />
          <input id={searchId} type="search" role="combobox" aria-expanded={Boolean(trimmedQuery)} aria-controls={`${searchId}-results`} aria-label="Find or add a person" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={chosen.length ? "Add someone else" : "Find or add a person"} />
        </div>
        {trimmedQuery && <ul className="conversation-results" id={`${searchId}-results`} role="listbox" aria-label="People">
          {matches.map((person) => <li key={person.id} role="option" aria-selected="false"><button type="button" onClick={() => addPerson(person.id)}>{person.name}</button></li>)}
          {!exactMatch && <li role="option" aria-selected="false"><button type="button" disabled={action.busy} onClick={() => void createPerson()}><Plus size={15} aria-hidden="true" /> Add “{trimmedQuery}” as someone new</button></li>}
        </ul>}
        {!chosen.length && <p className="conversation-hint">Leave this empty to log it without a name.</p>}
      </fieldset>

      <fieldset>
        <legend>What happened</legend>
        <Chips label="What happened" options={happenings} selected={[happened]} onToggle={setHappened} />
        <p className="conversation-subhead">They shared a need (optional)</p>
        <Chips label="Needs" options={conversationNeedValues.map((value) => ({ value, label: conversationNeedLabels[value] }))} selected={needs} onToggle={toggleNeed} />
      </fieldset>

      {outcome === "follow_up" && <fieldset>
        <legend>Follow-up</legend>
        <label className="conversation-field">When<input type="date" required value={followUpDate} min={calendarDaysFromNow(0, data.church.timezone)} onChange={(event) => setFollowUpDate(event.target.value)} /></label>
        <p className="conversation-hint">{primary ? `Goes to ${primary.name || "their"}${owner ? `’s owner, ${owner}` : "’s owner"}.` : "You’ll own this follow-up."}</p>
        {followUpBlocked && <p className="inline-notice" role="status">{primary?.name || "This person"} asked not to be contacted this way. Log it as “Talked” instead.</p>}
      </fieldset>}

      <label className="conversation-field">{outcome === "follow_up" && !primary ? "What should happen next?" : "Note (optional)"}<textarea maxLength={data.church.noteCharacterLimit} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <p className="conversation-hint">{primary ? `Saved privately with ${chosen.length > 1 ? "each person" : primary.name || "this person"}.` : "Your team can see this. Leave out private details."}</p>

      {prayerOpen
        ? <label className="conversation-field">Prayer request<textarea maxLength={data.church.noteCharacterLimit} value={prayer} onChange={(event) => setPrayer(event.target.value)} /></label>
        : <button type="button" className="text-button conversation-more" onClick={() => setPrayerOpen(true)}>Add a prayer request</button>}

      {whenOpen
        ? <label className="conversation-field">When it happened<input type="datetime-local" value={when} max={localNow()} onChange={(event) => setWhen(event.target.value)} /></label>
        : <button type="button" className="text-button conversation-more" onClick={() => setWhenOpen(true)}>Happened earlier?</button>}

      {action.error && <p role="alert" className="inline-error">{action.error}</p>}
      <div className="modal-actions"><button type="button" className="button quiet" disabled={action.busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={action.busy || needsNote || followUpBlocked}>{action.busy ? "Saving…" : "Save conversation"}</button></div>
    </form>
  </Modal>;
}
