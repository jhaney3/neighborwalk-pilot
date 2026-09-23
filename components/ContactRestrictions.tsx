"use client";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { NeighborWalkData } from "../lib/domain";
import type { RestrictionActions, RestrictionInput } from "../lib/contact-restrictions";
import { useAsyncAction } from "../lib/use-async-action";
import { recordFamilyIds } from "../lib/record-aliases";
import { Modal } from "./ui";

export function ContactRestrictions({ data, residentId, propertyId, canManage, actions }: { data: NeighborWalkData; residentId?: string; propertyId?: string; canManage: boolean; actions: RestrictionActions }) {
  const [editing, setEditing] = useState<string | null>(null);
  const family = residentId ? recordFamilyIds(data.residents, residentId) : recordFamilyIds(data.properties, propertyId ?? "");
  const restrictions = (data.restrictions ?? []).filter((r) => residentId ? Boolean(r.residentId && family.has(r.residentId)) : Boolean(r.propertyId && family.has(r.propertyId)));
  const activeCount = restrictions.filter((restriction) => restriction.active).length;
  const title = residentId ? "Contact preferences & restrictions" : "Visit restrictions";
  return <div className="contact-restrictions">
    <button className={`button quiet small${activeCount ? " has-active-restriction" : ""}`} onClick={() => setEditing("manage")}><ShieldCheck size={15} /> {residentId ? "Contact restrictions" : "Visit restrictions"}{activeCount ? ` · ${activeCount} active` : ""}</button>
    {editing === "manage" && <Modal title={title} description={residentId ? "If they asked not to be contacted, record it here. It overrides any follow-ups." : "If they asked us not to come back, record it here."} onClose={() => setEditing(null)}>
      <div className="contact-restrictions-dialog">
        {!activeCount && <p>Nothing recorded.</p>}
        {restrictions.some((r) => r.originResidentId || r.originPropertyId) && <p>Each request stands on its own.</p>}
        <ul>{restrictions.map((r) => <li key={r.id}><strong>{r.channel === "all" ? "All contact" : r.channel} · {r.active ? "Restricted" : "Lifted after review"}</strong><p>{r.reason}</p>{r.correctionReason && <p>Review: {r.correctionReason}</p>}{r.active && canManage && <button className="button quiet small" onClick={() => setEditing(r.id)}>Review correction</button>}</li>)}</ul>
        <button className="button quiet" onClick={() => setEditing("new")}>Record a contact restriction</button>
      </div>
    </Modal>}
    {editing && editing !== "manage" && <RestrictionForm key={editing} data={data} residentId={residentId} propertyId={propertyId} correctionId={editing === "new" ? undefined : editing} actions={actions} onClose={() => setEditing(null)} />}
  </div>;
}
function RestrictionForm({ data, residentId, propertyId, correctionId, actions, onClose }: { data: NeighborWalkData; residentId?: string; propertyId?: string; correctionId?: string; actions: RestrictionActions; onClose: () => void }) {
  const [channel, setChannel] = useState<RestrictionInput["channel"]>(propertyId ? "visit" : "all");
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const action = useAsyncAction();
  return <Modal title={correctionId ? "Review a restriction correction" : "Respect a contact request"} description={correctionId ? "Only a leader can lift this, with a reason." : "Keep it short and factual."} onClose={action.busy ? () => undefined : onClose}>
    <form className="form-stack" onSubmit={(e) => { e.preventDefault(); void action.run(() => correctionId ? actions.lift(correctionId, reason) : actions.add({ residentId, propertyId, channel, reason }), onClose); }}>
      {!correctionId && !propertyId && <label>Stop which contact?<select value={channel} onChange={(e) => setChannel(e.target.value as RestrictionInput["channel"])}><option value="all">All contact</option><option value="visit">Visits</option><option value="call">Phone calls</option><option value="text">Text messages</option><option value="email">Email</option></select></label>}
      <label>{correctionId ? "Reason this may be lifted" : "Their request, in a few words"}<textarea required minLength={3} maxLength={data.church.noteCharacterLimit} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {correctionId && <label className="checkbox-label"><input type="checkbox" required checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I have reviewed the request and authority for this correction.</label>}
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}<div className="modal-actions"><button type="button" className="button quiet" disabled={action.busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={action.busy || Boolean(correctionId && !reviewed)}>{action.busy ? "Saving…" : correctionId ? "Record reviewed correction" : "Record restriction"}</button></div>
    </form>
  </Modal>;
}
