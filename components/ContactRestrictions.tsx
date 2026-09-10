"use client";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { NeighborWalkData } from "../lib/domain";
import type { RestrictionActions, RestrictionInput } from "../lib/contact-restrictions";
import { useAsyncAction } from "../lib/use-async-action";
import { Modal } from "./ui";

export function ContactRestrictions({ data, residentId, propertyId, canManage, actions }: { data: NeighborWalkData; residentId?: string; propertyId?: string; canManage: boolean; actions: RestrictionActions }) {
  const [editing, setEditing] = useState<string | null>(null);
  const restrictions = (data.restrictions ?? []).filter((r) => residentId ? r.residentId === residentId : r.propertyId === propertyId);
  return <section className="contact-restrictions today-card"><h3><ShieldCheck size={19} /> {residentId ? "Contact preferences & restrictions" : "Visit restrictions"}</h3>
    <p>{residentId ? "Pausing care tracking does not mean do not contact. Record the neighbor’s request here; restrictions take priority over scheduled tasks." : "Respect a no-visit request even when a phone has older task data. Restrictions remain separate from visit history."}</p>
    {!restrictions.some((r) => r.active) && <p>No active restriction is recorded here. That is not permission to contact someone.</p>}
    <ul>{restrictions.map((r) => <li key={r.id}><strong>{r.channel === "all" ? "All contact" : r.channel} · {r.active ? "Restricted" : "Lifted after review"}</strong><p>{r.reason}</p>{r.correctionReason && <p>Review: {r.correctionReason}</p>}{r.active && canManage && <button className="button quiet small" onClick={() => setEditing(r.id)}>Review correction</button>}</li>)}</ul>
    <button className="button quiet" onClick={() => setEditing("new")}>Record a contact restriction</button>
    {editing && <RestrictionForm key={editing} data={data} residentId={residentId} propertyId={propertyId} correctionId={editing === "new" ? undefined : editing} actions={actions} onClose={() => setEditing(null)} />}
  </section>;
}
function RestrictionForm({ data, residentId, propertyId, correctionId, actions, onClose }: { data: NeighborWalkData; residentId?: string; propertyId?: string; correctionId?: string; actions: RestrictionActions; onClose: () => void }) {
  const [channel, setChannel] = useState<RestrictionInput["channel"]>(propertyId ? "visit" : "all");
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const action = useAsyncAction();
  return <Modal title={correctionId ? "Review a restriction correction" : "Respect a contact request"} description={correctionId ? "Only a leader can lift a restriction. A recorded reason is required; previously cancelled tasks will not reopen." : "Keep the reason minimal and factual. This is an instruction to stop the selected contact, not a judgment about a person."} onClose={action.busy ? () => undefined : onClose}>
    <form className="form-stack" onSubmit={(e) => { e.preventDefault(); void action.run(() => correctionId ? actions.lift(correctionId, reason) : actions.add({ residentId, propertyId, channel, reason }), onClose); }}>
      {!correctionId && !propertyId && <label>Stop which contact?<select value={channel} onChange={(e) => setChannel(e.target.value as RestrictionInput["channel"])}><option value="all">All contact</option><option value="visit">Visits</option><option value="call">Phone calls</option><option value="text">Text messages</option><option value="email">Email</option></select></label>}
      <label>{correctionId ? "Reason this may be lifted" : "Neighbor’s request or factual reason"}<textarea required minLength={3} maxLength={data.church.noteCharacterLimit} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {correctionId && <label className="checkbox-label"><input type="checkbox" required checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I have reviewed the request and authority for this correction.</label>}
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}<div className="modal-actions"><button type="button" className="button quiet" disabled={action.busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={action.busy || Boolean(correctionId && !reviewed)}>{action.busy ? "Saving to device…" : correctionId ? "Record reviewed correction" : "Record restriction"}</button></div>
    </form>
  </Modal>;
}
