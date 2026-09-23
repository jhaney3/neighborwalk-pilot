"use client";
import { MessageCircle, Plus, UserRound, X } from "lucide-react";
import { useState } from "react";
import { calendarDaysFromNow } from "../lib/calendar";
import { contactRestricted } from "../lib/contact-restrictions";
import type { NeighborWalkData, Resident, ResidentInput } from "../lib/domain";
import type { EncounterInput } from "../lib/encounters";
import { useAsyncAction } from "../lib/use-async-action";
import { Modal } from "./ui";

type EncounterComposerProps = {
  data: NeighborWalkData;
  outingId?: string;
  onSave: (input: EncounterInput) => Promise<unknown>;
  onCreatePerson: (input: ResidentInput) => Promise<string>;
};

export function EncounterComposer({ data, outingId, onSave, onCreatePerson }: EncounterComposerProps) {
  const [open, setOpen] = useState(false);
  return <div className="encounter-launcher"><button className="button quiet" onClick={() => setOpen(true)}><MessageCircle size={18} /> Log a conversation</button>
    {open && <EncounterForm data={data} outingId={outingId} onSave={onSave} onCreatePerson={onCreatePerson} onClose={() => setOpen(false)} />}</div>;
}
export function EncounterForm({ data, outingId, onSave, onCreatePerson, onClose }: EncounterComposerProps & { onClose: () => void }) {
  const [context, setContext] = useState<EncounterInput["context"]>("community_meal");
  const [eventId, setEventId] = useState(outingId ?? "");
  const [personId, setPersonId] = useState("");
  const [personCreatorOpen, setPersonCreatorOpen] = useState(false);
  const [createdPersonName, setCreatedPersonName] = useState("");
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonPhone, setNewPersonPhone] = useState("");
  const [newPersonEmail, setNewPersonEmail] = useState("");
  const [newPersonContact, setNewPersonContact] = useState<Resident["preferredContact"]>("none");
  const [newPersonPermission, setNewPersonPermission] = useState<NonNullable<Resident["contactPermission"]>>("not_recorded");
  const [outcome, setOutcome] = useState<EncounterInput["outcome"]>("conversation");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [note, setNote] = useState("");
  const [date, setDate] = useState(calendarDaysFromNow(data.church.defaultFollowUpDays, data.church.timezone));
  const action = useAsyncAction();
  const personAction = useAsyncAction();
  const person = data.residents.find((resident) => resident.id === personId);
  const followUpChannel = !person || person.preferredContact === "none" ? "other" : person.preferredContact;
  const followUpRestricted = outcome === "follow_up" && Boolean(person)
    && contactRestricted(data, person?.id, followUpChannel, person?.propertyId);
  const showDetails = outcome === "follow_up" || detailsOpen;
  const personContactValid = newPersonContact === "email" ? Boolean(newPersonEmail.trim())
    : ["text", "call"].includes(newPersonContact) ? Boolean(newPersonPhone.trim()) : true;
  const canCreatePerson = Boolean(newPersonName.trim()) && personContactValid;
  const createPerson = () => personAction.run(async () => {
    const name = newPersonName.trim();
    const id = await onCreatePerson({
      name,
      faithStatus: "not_discussed",
      discipleshipStage: "new_connection",
      assignedVolunteerId: data.preferences.activeVolunteerId,
      sharedWithVolunteerIds: [],
      sharedWithTeamIds: [],
      status: "active",
      phone: newPersonPhone.trim() || undefined,
      email: newPersonEmail.trim() || undefined,
      preferredContact: newPersonContact,
      contactPermission: newPersonPermission,
    });
    setPersonId(id);
    setCreatedPersonName(name);
    setPersonCreatorOpen(false);
  });
  return <Modal title="Log a conversation" description="From a meal, service project, referral or anywhere else." wide={personCreatorOpen} onClose={action.busy || personAction.busy ? () => undefined : onClose}>
    <form className="form-stack" onSubmit={(e) => { e.preventDefault(); if (personCreatorOpen) { if (canCreatePerson) void createPerson(); return; } void action.run(() => onSave({ context, eventId: eventId || undefined,
      residentId: showDetails ? personId || undefined : undefined, outcome, objectiveNote: showDetails ? note : undefined, followUpDate: outcome === "follow_up" ? date : undefined }), onClose); }}>
      <label>What happened?<select value={outcome} onChange={(e) => { const value = e.target.value as EncounterInput["outcome"]; setOutcome(value); if (value === "follow_up") setDetailsOpen(true); }}><option value="conversation">Conversation</option><option value="follow_up">Follow-up requested</option><option value="declined">Conversation declined</option></select></label>
      <label>Where did you connect?<select value={context} onChange={(e) => setContext(e.target.value as EncounterInput["context"])}><option value="community_meal">Community meal</option><option value="service">Service project</option><option value="referral">Referral</option><option value="other">Other community setting</option></select></label>
      <label>Walk (optional)<select value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">Not part of a planned walk</option>{data.events.filter((e) => e.status !== "archived" && e.status !== "cancelled").map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      {outcome !== "follow_up" && <button type="button" className="button quiet" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>{detailsOpen ? "Hide optional details" : "Add a person or note"}</button>}
      {showDetails && <div className="encounter-optional-details">
        <div className="encounter-person-heading"><label>Person (optional)<select value={personId} onChange={(e) => { setPersonId(e.target.value); setCreatedPersonName(""); setPersonCreatorOpen(false); }}><option value="">Anonymous — no person record</option>{data.residents.filter((p) => p.status !== "archived").map((p) => <option key={p.id} value={p.id}>{p.name || "Historical unnamed person"}</option>)}</select></label><button type="button" className="button quiet" aria-expanded={personCreatorOpen} onClick={() => { setPersonCreatorOpen((open) => !open); personAction.clearError(); }}>{personCreatorOpen ? <X size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />} {personCreatorOpen ? "Close" : "Create person"}</button></div>
        {personCreatorOpen && <section className="encounter-person-create" aria-label="Create a person">
          <div className="encounter-person-create-title"><UserRound size={18} aria-hidden="true" /><div><strong>New person</strong><small>Create a private profile, then continue this encounter.</small></div></div>
          <label>Name or useful description<input required maxLength={120} value={newPersonName} onChange={(event) => setNewPersonName(event.target.value)} placeholder="First name or a respectful description" /></label>
          <div className="encounter-person-contact-fields"><label>Phone (optional)<input type="tel" autoComplete="off" minLength={3} maxLength={40} value={newPersonPhone} onChange={(event) => setNewPersonPhone(event.target.value)} /></label><label>Email (optional)<input type="email" autoComplete="off" maxLength={254} value={newPersonEmail} onChange={(event) => setNewPersonEmail(event.target.value)} /></label></div>
          <div className="encounter-person-contact-fields"><label>Preferred contact<select value={newPersonContact} onChange={(event) => setNewPersonContact(event.target.value as Resident["preferredContact"])}><option value="none">Not discussed</option><option value="text">Text message</option><option value="call">Phone call</option><option value="email">Email</option></select></label><label>Contact request<select value={newPersonPermission} onChange={(event) => setNewPersonPermission(event.target.value as NonNullable<Resident["contactPermission"]>)}><option value="not_recorded">Not recorded — ask first</option><option value="requested">They requested contact</option><option value="do_not_contact">Do not contact</option></select></label></div>
          {!personContactValid && <p className="inline-error">Enter the phone number or email needed for the preferred contact method.</p>}
          {personAction.error && <p role="alert" className="inline-error">{personAction.error}</p>}
          <div className="encounter-person-create-actions"><button type="button" className="button quiet small" disabled={personAction.busy} onClick={() => { setPersonCreatorOpen(false); personAction.clearError(); }}>Cancel</button><button type="button" className="button primary small" disabled={personAction.busy || !canCreatePerson} onClick={() => void createPerson()}>{personAction.busy ? "Creating…" : "Create & select"}</button></div>
        </section>}
        {createdPersonName && <p className="encounter-person-created" role="status"><UserRound size={16} aria-hidden="true" /><span><strong>{createdPersonName}</strong> was created and selected.</span></p>}
        <p className="inline-notice">{personId ? "This encounter and its note are limited to people who can access the selected profile." : "Anonymous encounters are shared with church members. Leave names, contact details, and private care needs out of this note."}</p>
        <label>{outcome === "follow_up" ? "Requested next step" : "Brief factual note (optional)"}<textarea maxLength={data.church.noteCharacterLimit} required={outcome === "follow_up" && !personId} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {outcome === "follow_up" && <><label>Follow-up date ({data.church.timezone})<input type="date" required value={date} min={calendarDaysFromNow(0, data.church.timezone)} onChange={(e) => setDate(e.target.value)} /></label><p>{personId ? "The person’s care owner receives the next step." : "You are responsible for this next step."} Recorded restrictions still apply.</p>{followUpRestricted && <p className="inline-notice" role="status">The selected person’s {followUpChannel} contact method is restricted. Record the encounter as a conversation if needed, but do not schedule this task.</p>}</>}
      </div>}
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}
      <div className="modal-actions"><button type="button" className="button quiet" disabled={action.busy || personAction.busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={action.busy || personAction.busy || personCreatorOpen || followUpRestricted}>{action.busy ? "Saving…" : "Save conversation"}</button></div>
    </form>
  </Modal>;
}
