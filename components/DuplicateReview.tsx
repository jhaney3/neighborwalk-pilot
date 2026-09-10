"use client";
import { useState } from "react";
import type { AdminInput, DuplicateKind, DuplicatePlan } from "../lib/administration";
import type { NeighborWalkData } from "../lib/domain";
import { volunteerIdForUser } from "../lib/discipleship";

type Props = {
  data: NeighborWalkData; blocked: boolean; error: string | null;
  onPreview: (kind: DuplicateKind, source: string, target: string) => Promise<DuplicatePlan>;
  onRun: (input: AdminInput) => Promise<unknown>;
  onAction: (operation: () => Promise<unknown>, success?: () => void) => Promise<void>;
};

export function DuplicateReview({ data, blocked, error, onPreview, onRun, onAction }: Props) {
  const [kind, setKind] = useState<DuplicateKind>("people");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [plan, setPlan] = useState<DuplicatePlan | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const resetReview = () => { setPlan(null); setReason(""); setConfirmed(false); setConfirmation(""); setMessage(""); };
  const records = kind === "people"
    ? data.residents.filter((r) => !r.mergedIntoId).map((r) => ({ id: r.id, label: r.name || "Historical unnamed person" }))
    : data.properties.filter((r) => !r.mergedIntoId).map((r) => ({ id: r.id, label: r.address + (r.unit ? " · " + r.unit : "") }));
  const phrase = kind === "people" ? "COMBINE SAME PERSON" : "COMBINE SAME LOCATION";
  const stale = Boolean(plan && plan.revision !== data.sync.serverRevision);
  const fields = kind === "people"
    ? ["id", "name", "phone", "email", "preferred_contact", "contact_permission", "status", "assigned_to", "property_id", "shared_user_ids", "shared_team_ids", "legacy_creator_access", ...(data.church.pathwayEnabled ? ["faith_status", "discipleship_stage"] : [])]
    : ["id", "address", "unit", "territory_id", "latitude", "longitude", "source"];
  const value = (record: Record<string, unknown>, field: string) => {
    const raw = record[field];
    if (raw === null || raw === undefined || raw === "") return "Not recorded";
    if (field === "assigned_to" && typeof raw === "string") return data.volunteers.find((v) => v.id === volunteerIdForUser(raw))?.name ?? "Previous or unavailable member";
    if (field === "property_id") return data.properties.find((p) => p.id === raw)?.address ?? String(raw);
    if (field === "territory_id") return data.territories.find((t) => t.id === raw)?.name ?? String(raw);
    if (Array.isArray(raw)) return raw.length ? raw.map((item) => field === "shared_user_ids" && typeof item === "string"
      ? data.volunteers.find((v) => v.id === volunteerIdForUser(item))?.name ?? item
      : data.teams.find((t) => t.id === item)?.name ?? String(item)).join(", ") : "None";
    return String(raw).replaceAll("_", " ");
  };
  return <section className="today-card" aria-labelledby="duplicate-review-title">
    <h2 id="duplicate-review-title">Combine reviewed duplicates</h2>
    <p>Matching details are clues, not proof. Never combine household members, different apartment units, or people who share a phone number. This requires a connected, recently signed-in leader and no pending device work.</p>
    <fieldset className="form-stack" disabled={blocked}>
      <legend>Choose the original and the current record</legend>
      <label>Duplicate kind<select value={kind} onChange={(e) => { setKind(e.target.value as DuplicateKind); setSource(""); setTarget(""); resetReview(); }}><option value="people">People</option><option value="locations">Locations</option></select></label>
      <label>Original to preserve as history<select value={source} onChange={(e) => { setSource(e.target.value); resetReview(); }}><option value="">Choose original record</option>{records.filter((r) => r.id !== target).map((r) => <option key={r.id} value={r.id}>{r.label} · {r.id.slice(-8)}</option>)}</select></label>
      <label>Record to keep current<select value={target} onChange={(e) => { setTarget(e.target.value); resetReview(); }}><option value="">Choose current record</option>{records.filter((r) => r.id !== source).map((r) => <option key={r.id} value={r.id}>{r.label} · {r.id.slice(-8)}</option>)}</select></label>
      <button className="button quiet" disabled={!source || !target || source === target} onClick={() => void onAction(async () => { const preview = await onPreview(kind, source, target); resetReview(); setPlan(preview); })}>Preview exact combination</button>
    </fieldset>
    {plan && <>
      <p>The record on the right keeps its profile or location details. Original values remain in the preserved record; they are not automatically copied over. The strongest contact restrictions win.</p>
      <div className="data-preview-table"><table><caption>Reviewed details — no changes yet</caption><thead><tr><th scope="col">Detail</th><th scope="col">Preserve as history</th><th scope="col">Keep current</th></tr></thead><tbody>{fields.map((field) => <tr key={field}><th scope="row">{field.replaceAll("_", " ")}</th><td>{value(plan.source, field)}</td><td>{value(plan.target, field)}</td></tr>)}</tbody></table></div>
      <p>{plan.effects.tasks.length} open tasks will move; {plan.effects.tasksToCancel.length} open tasks will be cancelled to respect restrictions. {plan.effects.restrictions.length} active restrictions will move and remain independently reviewable. {kind === "locations" ? `${plan.effects.people.length} current people will move to the chosen location.` : `${plan.effects.people.length} previously combined profiles will point to the chosen current profile.`}</p>
      <p>Historical notes, encounters, and resolved tasks keep their original links and dates. Separate open tasks are not automatically deduplicated. Review them afterward. There is no automatic undo; an incorrect combination needs a supervised correction.</p>
      <details><summary>Exact affected record IDs and versions</summary><pre>{JSON.stringify(plan.effects, null, 2)}</pre></details>
      {plan.blockers.length > 0 && <div role="status" className="inline-notice"><strong>Resolve before combining</strong><ul>{plan.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
      {stale && <p role="status" className="inline-notice">The church records changed. Preview and review this combination again.</p>}
      <fieldset className="form-stack" disabled={blocked || stale || Boolean(plan.blockers.length)}>
        <legend>Confirm the reviewed combination</legend>
        <label>Why are these the same person or location?<textarea minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I verified the same identity or dwelling, the current details to keep, sharing, and every affected responsibility and restriction.</label>
        <label>Type {phrase}<input autoComplete="off" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label>
        <button className="button primary" disabled={!confirmed || reason.trim().length < 3 || confirmation !== phrase} onClick={() => void onAction(() => onRun({ action: "duplicate_merge", expectedRevision: plan.revision, kind, sourceId: source, targetId: target, reviewToken: plan.token, reason: reason.trim(), confirmation }), () => { resetReview(); setSource(""); setTarget(""); setMessage("Reviewed duplicates combined. Original history and restrictions were preserved. Review the remaining open tasks separately."); })}>Combine exactly the reviewed records</button>
      </fieldset>
    </>}
    {message && <p role="status" className="inline-notice">{message}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}
