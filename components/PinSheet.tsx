"use client";

import { AlertOctagon, Ban, CalendarDays, Check, Clock, HousePlus, Pencil } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { calendarDate, calendarDaysFromNow, formatCalendarDate } from "../lib/calendar";
import { contactRestricted } from "../lib/contact-restrictions";
import { conversationNeedLabels, type ConversationNeed, type Coordinates, type NeighborWalkData, type ParcelReference, type Property } from "../lib/domain";
import { reviewedEncounter } from "../lib/encounter-history";
import { homesAtSameSpot, shortAddress, streetOf } from "../lib/pin-counts";
import { OutcomeGrid, outcomeWord, type Recordable } from "./OutcomeGrid";
import { Sheet, useFocusOnMount } from "./Sheet";

/** A pin dropped on the map that nothing has been logged for yet. */
export type PinDraft = {
  key: string;
  coordinates: Coordinates;
  address: string;
  /** Where the address came from, shown under it. */
  source: "parcel" | "geocoder" | "map" | "unknown";
  parcel?: ParcelReference;
  buildingGeometry?: Coordinates[];
};

export type NewPerson = { name: string; stayInTouch: boolean; phone: string; method: "text" | "call" };

/** Everything a pin sheet logs for one visit. */
export type PinVisit = {
  outcome: Recordable;
  residentId?: string;
  newPerson?: NewPerson;
  needs: ConversationNeed[];
  note?: string;
  followUpDate?: string;
};

/** The home a visit is for: one already pinned, or a new pin (or another home at a pin). */
export type PinTarget = { kind: "home"; propertyId: string } | { kind: "new"; draft: PinDraft; address: string; unit?: string };

export type PinSubject = { kind: "new"; draft: PinDraft } | { kind: "home"; property: Property };

const sourceLine: Record<PinDraft["source"], string> = {
  parcel: "From the county parcel",
  geocoder: "From the street address",
  map: "From the map",
  unknown: "Tap the address to fill it in",
};

// "Prayed together" is recorded as the prayer need, as in the conversation logger.
const firstNeeds: { value: ConversationNeed; label: string }[] = [
  { value: "prayer", label: "Prayed together" },
  { value: "food", label: conversationNeedLabels.food },
  { value: "health", label: conversationNeedLabels.health },
  { value: "transport", label: conversationNeedLabels.transport },
];
const moreNeeds: { value: ConversationNeed; label: string }[] = (["housing", "work", "other"] as const).map((value) => ({ value, label: conversationNeedLabels[value] }));

/** The sheet for one pin: the outcome grid first; then, for Talked and Come
 * back, "Anything to add?" while the visit is already saved behind Undo. */
export function PinSheet({ data, subject, initialStage = "choose", onOutcome, onDetails, onDone, onHistory, onClose }: {
  data: NeighborWalkData;
  subject: PinSubject;
  initialStage?: "choose" | "another";
  /** `hold` keeps the save open while details are added. */
  onOutcome: (target: PinTarget, visit: PinVisit, hold: boolean) => void;
  onDetails: (visit: PinVisit) => void;
  onDone: () => void;
  onHistory: (propertyId: string) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<"choose" | "another" | "details">(initialStage);
  const [address, setAddress] = useState(subject.kind === "new" ? subject.draft.address : subject.property.address);
  const [editingAddress, setEditingAddress] = useState(false);
  const [unit, setUnit] = useState("");
  const [unitOpen, setUnitOpen] = useState(false);
  const [saved, setSaved] = useState<{ target: PinTarget; outcome: Recordable } | null>(null);
  const titleId = useId();
  const timezone = data.church.timezone;

  const newTarget = (draft: PinDraft, label = unit): PinTarget => ({ kind: "new", draft, address: address.trim() || draft.address, unit: label.trim() || undefined });
  const target = (): PinTarget => subject.kind === "home" ? { kind: "home", propertyId: subject.property.id } : newTarget(subject.draft);
  const choose = (outcome: Recordable, details: boolean, chosen = target()) => {
    onOutcome(chosen, { outcome, needs: [] }, details);
    if (details) { setSaved({ target: chosen, outcome }); setStage("details"); }
  };

  if (stage === "details" && saved) return <Sheet className="pin-sheet details" modal labelledBy={titleId} onDismiss={onDone}>
    <PinDetails data={data} titleId={titleId} target={saved.target} initialOutcome={saved.outcome} onChange={onDetails} onDone={onDone} />
  </Sheet>;

  if (subject.kind === "home" && stage === "another") {
    const home = subject.property;
    const here = homesAtSameSpot(data.properties, home).length;
    const draft: PinDraft = { key: `another-${home.id}`, coordinates: home.coordinates!, address: home.address, source: "map", parcel: home.parcel };
    return <Sheet className="pin-sheet" labelledBy={titleId} onDismiss={onClose}>
      <p className="mono-meta pin-kicker">{home.address} · {here} {here === 1 ? "home" : "homes"} here</p>
      <h2 className="pin-title" id={titleId}>Another home here</h2>
      <div className="pin-field"><span className="mono-meta" id={`${titleId}-unit`}>Unit or label</span><span className="pin-input"><FocusedInput value={unit} maxLength={60} enterKeyHint="done" onChange={(event) => setUnit(event.target.value)} aria-labelledby={`${titleId}-unit`} aria-describedby={`${titleId}-unit-hint`} /><span className="mono-meta" id={`${titleId}-unit-hint`}>e.g. upstairs, rear</span></span></div>
      <OutcomeGrid disabled={!unit.trim() || !home.coordinates} onChoose={(option) => choose(option.value, option.details, newTarget(draft))} />
      <div className="pin-foot"><button type="button" className="pin-cancel" onClick={onClose}>Cancel</button></div>
    </Sheet>;
  }

  if (subject.kind === "new") {
    const { draft } = subject;
    return <Sheet className="pin-sheet" labelledBy={titleId} onDismiss={onClose}>
      <p className="mono-meta pin-kicker">{address.trim() ? `New pin · ${shortStreetName(address)}` : "New pin"}</p>
      {editingAddress
        ? <div className="pin-address-edit"><FocusedInput id={titleId} aria-label="Street address" value={address} maxLength={240} enterKeyHint="done" onChange={(event) => setAddress(event.target.value)} onBlur={() => setEditingAddress(false)} onKeyDown={(event) => { if (event.key === "Enter") setEditingAddress(false); }} /></div>
        : <h2 className="pin-title" id={titleId}><button type="button" className="pin-address" onClick={() => setEditingAddress(true)} aria-label={`${address || "Address unknown"}. Edit the address`}>{address || "Address unknown"}{unit.trim() ? ` · ${unit.trim()}` : ""}<Pencil size={16} aria-hidden="true" /></button></h2>}
      <p className="pin-source">{sourceLine[address && draft.source === "unknown" ? "map" : draft.source]} · {unitOpen ? "unit" : <button type="button" className="pin-unit-link" onClick={() => setUnitOpen(true)}>add a unit</button>}</p>
      {unitOpen && <div className="pin-field"><span className="pin-input"><FocusedInput aria-label="Unit or label" value={unit} maxLength={60} enterKeyHint="done" placeholder="Apt B" onChange={(event) => setUnit(event.target.value)} /><span className="mono-meta" aria-hidden="true">e.g. upstairs, rear</span></span></div>}
      <OutcomeGrid disabled={!address.trim()} onChoose={(option) => choose(option.value, option.details)} />
      {/* Long-press drops a pin straight to Don't knock; VoiceOver gets the same action here. */}
      <button type="button" className="visually-hidden" disabled={!address.trim()} onClick={() => choose("do_not_visit", false)}>Mark Don’t knock</button>
    </Sheet>;
  }

  const home = subject.property;
  const last = data.visits.filter((visit) => visit.propertyId === home.id).map(reviewedEncounter).filter((visit) => !visit.voided).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
  const lastBy = last ? data.volunteers.find((volunteer) => volunteer.id === last.volunteerId)?.name : undefined;
  const doNotKnock = home.currentOutcome === "do_not_visit";
  return <Sheet className="pin-sheet" labelledBy={titleId} onDismiss={onClose}>
    <p className="mono-meta pin-kicker">{last ? [outcomeWord[last.outcome], formatCalendarDate(calendarDate(last.recordedAt, timezone), { month: "short", day: "numeric" }), lastBy].filter(Boolean).join(" · ") : "Pinned · not logged yet"}</p>
    <h2 className="pin-title" id={titleId}>{home.address}{home.unit ? ` · ${home.unit}` : ""}</h2>
    {doNotKnock
      ? <p className="walk-card-banner"><AlertOctagon size={17} aria-hidden="true" /><span><strong>Don’t knock here</strong>They asked us not to come back. Only a leader can change this.</span></p>
      : <OutcomeGrid onChoose={(option) => choose(option.value, option.details)} />}
    <div className="pin-bar" role="group" aria-label="More for this home">
      {!doNotKnock && <button type="button" onClick={() => choose("do_not_visit", false)}><Ban size={16} aria-hidden="true" />Don’t knock</button>}
      <button type="button" disabled={!home.coordinates} onClick={() => setStage("another")}><HousePlus size={16} aria-hidden="true" />Another home</button>
      <button type="button" onClick={() => onHistory(home.id)}><Clock size={16} aria-hidden="true" />History</button>
    </div>
  </Sheet>;
}

function FocusedInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const ref = useFocusOnMount<HTMLInputElement>();
  return <input ref={ref} {...props} />;
}

function FocusedTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useFocusOnMount<HTMLTextAreaElement>();
  return <textarea ref={ref} {...props} />;
}

function shortStreetName(address: string) {
  return shortAddress(streetOf(address));
}

/** "Anything to add?" The visit is already saved; every change here updates it
 * until Done (or a swipe down) lets it commit. */
export function PinDetails({ data, titleId, target, initialOutcome, onChange, onDone }: {
  data: NeighborWalkData;
  titleId: string;
  target: PinTarget;
  initialOutcome: Recordable;
  onChange: (visit: PinVisit) => void;
  onDone: () => void;
}) {
  const timezone = data.church.timezone;
  const propertyId = target.kind === "home" ? target.propertyId : undefined;
  const address = target.kind === "home" ? data.properties.find((home) => home.id === target.propertyId)?.address ?? "" : target.address;
  const residents = propertyId ? data.residents.filter((resident) => !resident.mergedIntoId && resident.status !== "archived" && resident.propertyId === propertyId) : [];
  const [residentId, setResidentId] = useState("");
  const [name, setName] = useState("");
  const [stayInTouch, setStayInTouch] = useState(true);
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"text" | "call">("text");
  const [needs, setNeeds] = useState<ConversationNeed[]>([]);
  const [showMoreNeeds, setShowMoreNeeds] = useState(false);
  const [followUp, setFollowUp] = useState(initialOutcome === "follow_up");
  // One line: tomorrow, the church's default, a week, then a date picker.
  const dateChoices = [
    { date: calendarDaysFromNow(1, timezone), label: "Tomorrow" },
    { date: calendarDaysFromNow(data.church.defaultFollowUpDays, timezone), label: undefined as string | undefined },
    { date: calendarDaysFromNow(7, timezone), label: "1 wk" },
  ].filter((choice, index, all) => all.findIndex((other) => other.date === choice.date) === index);
  const [followUpDate, setFollowUpDate] = useState(dateChoices[Math.min(1, dateChoices.length - 1)].date);
  const [pickingDate, setPickingDate] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const chosen = residents.find((resident) => resident.id === residentId);
  const owner = chosen ? data.volunteers.find((volunteer) => volunteer.id === chosen.assignedVolunteerId)?.name : undefined;
  const restricted = followUp && contactRestricted(data, residentId || undefined, "visit", propertyId);
  const outcome: Recordable = followUp && !restricted ? "follow_up" : "conversation";
  const noteTooLong = note.length > data.church.noteCharacterLimit;
  const newPerson = !residentId && (name.trim() || (stayInTouch && phone.trim())) ? { name: name.trim(), stayInTouch, phone: phone.trim(), method } : undefined;
  const visit: PinVisit = { outcome, residentId: residentId || undefined, newPerson, needs, note: note.trim() && !noteTooLong ? note.trim() : undefined, followUpDate: outcome === "follow_up" ? followUpDate : undefined };
  const signature = JSON.stringify(visit);
  const changeRef = useRef(onChange);
  useEffect(() => { changeRef.current = onChange; }, [onChange]);
  useEffect(() => { changeRef.current(JSON.parse(signature) as PinVisit); }, [signature]);
  const toggleNeed = (need: ConversationNeed) => setNeeds((current) => current.includes(need) ? current.filter((item) => item !== need) : [...current, need]);
  const dateLabel = (date: string) => formatCalendarDate(date, { weekday: "short", month: "short", day: "numeric" });

  return <div className="pin-details">
    <div className="pin-details-top">
      <span className="pin-saved mono-meta" role="status"><Check size={13} aria-hidden="true" />Saved · {outcomeWord[outcome]}</span>
      <span className="mono-meta">{shortAddress(address)}</span>
    </div>
    <h2 className="pin-title" id={titleId}>Anything to add?</h2>

    <div className="walk-field">
      <span className="mono-meta" id={`${titleId}-name`}>Name</span>
      {residents.length > 0 && <div className="walk-chips" role="group" aria-label="People at this home">
        {residents.map((resident) => <button type="button" key={resident.id} aria-pressed={residentId === resident.id} onClick={() => { setResidentId(residentId === resident.id ? "" : resident.id); setName(""); }}>{resident.name || "Name not shared"}</button>)}
      </div>}
      {!residentId && <input aria-labelledby={`${titleId}-name`} value={name} maxLength={120} autoComplete="off" enterKeyHint="done" onChange={(event) => setName(event.target.value)} placeholder={residents.length ? "Someone new" : "If they shared it"} />}
      {chosen && <p className="walk-field-note">{chosen.phone ? `Saved contact · prefers ${chosen.preferredContact === "none" ? "no contact method" : chosen.preferredContact}` : "No contact saved yet"}{owner ? ` · ${owner}` : ""}</p>}
    </div>

    {!residentId && <ContactBlock stayInTouch={stayInTouch} phone={phone} method={method} onStayInTouch={setStayInTouch} onPhone={setPhone} onMethod={setMethod} />}

    <div className="walk-field">
      <span className="mono-meta" id={`${titleId}-needs`}>What came up</span>
      <div className="walk-chips" role="group" aria-labelledby={`${titleId}-needs`}>
        {[...firstNeeds, ...(showMoreNeeds ? moreNeeds : [])].map((need) => <button type="button" key={need.value} aria-pressed={needs.includes(need.value)} onClick={() => toggleNeed(need.value)}>{need.label}</button>)}
        {!showMoreNeeds && <button type="button" className="icon-chip" aria-label="More topics" onClick={() => setShowMoreNeeds(true)}>+</button>}
      </div>
    </div>

    <div className="walk-comeback offset-card porch">
      <label className="walk-switch-row"><span>Come back?</span><input type="checkbox" role="switch" checked={followUp} onChange={(event) => setFollowUp(event.target.checked)} /></label>
      {followUp && <>
        <div className="walk-date-seg" role="group" aria-label="When">
          {dateChoices.map((choice) => <button type="button" key={choice.date} aria-pressed={!pickingDate && followUpDate === choice.date} aria-label={dateLabel(choice.date)} onClick={() => { setPickingDate(false); setFollowUpDate(choice.date); }}>{choice.label ?? formatCalendarDate(choice.date, { weekday: "short" })}</button>)}
          <button type="button" className="icon" aria-pressed={pickingDate} aria-label="Pick a date" onClick={() => setPickingDate(true)}><CalendarDays size={17} aria-hidden="true" /></button>
        </div>
        {pickingDate && <input type="date" aria-label="Follow-up date" min={calendarDaysFromNow(0, timezone)} value={followUpDate} onChange={(event) => { if (event.target.value) setFollowUpDate(event.target.value); }} />}
        {restricted && <p className="inline-notice" role="status">They asked not to be visited again. This saves as Talked.</p>}
      </>}
    </div>

    {noteOpen
      ? <div className="walk-field"><span className="mono-meta" id={`${titleId}-note`}>Note</span><FocusedTextarea aria-labelledby={`${titleId}-note`} rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder={residentId || newPerson ? "Saved privately with this person." : "A short, factual note. Your team can see it."} />{noteTooLong && <small className="inline-error">Keep it under {data.church.noteCharacterLimit} characters.</small>}</div>
      : <button type="button" className="pin-add-note mono-meta" onClick={() => setNoteOpen(true)}>+ Add a note</button>}

    <button type="button" className="walk-save" onClick={onDone}>Done</button>
  </div>;
}

/** Stay in touch? Yes/No, then the cell phone with Text or Call. The same block
 * is used at the door, in the + logger and on the person forms. */
export function ContactBlock({ stayInTouch, phone, method, onStayInTouch, onPhone, onMethod }: {
  stayInTouch: boolean; phone: string; method: "text" | "call";
  onStayInTouch: (value: boolean) => void; onPhone: (value: string) => void; onMethod: (value: "text" | "call") => void;
}) {
  const id = useId();
  return <div className="walk-contact">
    <div className="walk-contact-row">
      <span className="walk-contact-label" id={`${id}-stay`}>Stay in touch?</span>
      <div className="mini-seg" role="group" aria-labelledby={`${id}-stay`}>
        <button type="button" aria-pressed={stayInTouch} onClick={() => onStayInTouch(true)}>Yes</button>
        <button type="button" aria-pressed={!stayInTouch} onClick={() => onStayInTouch(false)}>No</button>
      </div>
    </div>
    {stayInTouch && <div className="walk-contact-row">
      <label className="walk-phone"><span className="mono-meta">Cell phone</span><input type="tel" inputMode="tel" autoComplete="off" enterKeyHint="done" maxLength={40} value={phone} onChange={(event) => onPhone(event.target.value)} placeholder="(555) 000-0000" /></label>
      <div className="mini-seg" role="group" aria-label="Best way to reach them">
        <button type="button" aria-pressed={method === "text"} onClick={() => onMethod("text")}>Text</button>
        <button type="button" aria-pressed={method === "call"} onClick={() => onMethod("call")}>Call</button>
      </div>
    </div>}
  </div>;
}
