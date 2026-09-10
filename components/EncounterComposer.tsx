"use client";
import { MessageCircle } from "lucide-react";
import { useState } from "react";
import { calendarDaysFromNow } from "../lib/calendar";
import type { NeighborWalkData } from "../lib/domain";
import type { EncounterInput } from "../lib/encounters";
import { useAsyncAction } from "../lib/use-async-action";
import { Modal } from "./ui";

export function EncounterComposer({ data, outingId, onSave }: { data: NeighborWalkData; outingId?: string; onSave: (input: EncounterInput) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  return <div className="encounter-launcher"><button className="button quiet" onClick={() => setOpen(true)}><MessageCircle size={18} /> Record a community encounter</button>
    {open && <EncounterForm data={data} outingId={outingId} onSave={onSave} onClose={() => setOpen(false)} />}</div>;
}
function EncounterForm({ data, outingId, onSave, onClose }: { data: NeighborWalkData; outingId?: string; onSave: (input: EncounterInput) => Promise<unknown>; onClose: () => void }) {
  const [context, setContext] = useState<EncounterInput["context"]>("community_meal");
  const [eventId, setEventId] = useState(outingId ?? "");
  const [personId, setPersonId] = useState("");
  const [outcome, setOutcome] = useState<EncounterInput["outcome"]>("conversation");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(calendarDaysFromNow(data.church.defaultFollowUpDays, data.church.timezone));
  const action = useAsyncAction();
  return <Modal title="Record a community encounter" description="At a meal, a service project, or through a referral. No address or person record is required." onClose={action.busy ? () => undefined : onClose}>
    <form className="form-stack" onSubmit={(e) => { e.preventDefault(); void action.run(() => onSave({ context, eventId: eventId || undefined,
      residentId: personId || undefined, outcome, objectiveNote: note, followUpDate: outcome === "follow_up" ? date : undefined }), onClose); }}>
      <label>Where did you connect?<select value={context} onChange={(e) => setContext(e.target.value as EncounterInput["context"])}><option value="community_meal">Community meal</option><option value="service">Service project</option><option value="referral">Referral</option><option value="other">Other community setting</option></select></label>
      <label>Outing (optional)<select value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">Not part of an outing</option>{data.events.filter((e) => e.status !== "archived" && e.status !== "cancelled").map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <label>Person (optional)<select value={personId} onChange={(e) => setPersonId(e.target.value)}><option value="">Anonymous — no person record</option>{data.residents.filter((p) => p.status !== "archived").map((p) => <option key={p.id} value={p.id}>{p.name || "Historical unnamed person"}</option>)}</select></label>
      <label>What happened?<select value={outcome} onChange={(e) => setOutcome(e.target.value as EncounterInput["outcome"])}><option value="conversation">Conversation</option><option value="follow_up">Follow-up requested</option><option value="declined">Conversation declined</option></select></label>
      <p className="inline-notice">{personId ? "This encounter and its note are limited to people who can access the selected profile." : "Anonymous encounters are shared with church members. Leave names, contact details, and private care needs out of this note."}</p>
      <label>{outcome === "follow_up" ? "Requested next step" : "Brief factual note (optional)"}<textarea maxLength={data.church.noteCharacterLimit} required={outcome === "follow_up" && !personId} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {outcome === "follow_up" && <><label>Follow-up date ({data.church.timezone})<input type="date" required value={date} min={calendarDaysFromNow(0, data.church.timezone)} onChange={(e) => setDate(e.target.value)} /></label><p>{personId ? "The person’s care owner receives the next step." : "You are responsible for this next step."} Recorded restrictions still apply.</p></>}
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}
      <div className="modal-actions"><button type="button" className="button quiet" disabled={action.busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={action.busy}>{action.busy ? "Saving to device…" : "Save encounter"}</button></div>
    </form>
  </Modal>;
}
