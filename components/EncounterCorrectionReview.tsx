"use client";
import { useMemo, useState } from "react";
import type { AdminInput } from "../lib/administration";
import { outcomeMeta, outcomeValues, type NeighborWalkData, type Visit } from "../lib/domain";
import { reviewedEncounter } from "../lib/encounter-history";
import { versionKey } from "../lib/command-schema";

type Props = {
  data: NeighborWalkData; blocked: boolean; error: string | null;
  onRun: (input: AdminInput) => Promise<unknown>;
  onAction: (operation: () => Promise<unknown>, success?: () => void) => Promise<void>;
};
const contexts = ["door", "community_meal", "service", "referral", "other"] as const;

export function EncounterCorrectionReview({ data, blocked, error, onRun, onAction }: Props) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [review, setReview] = useState<{ original: Visit; version: number; revision: number } | null>(null);
  const [outcome, setOutcome] = useState<Visit["outcome"]>("conversation");
  const [context, setContext] = useState<NonNullable<Visit["context"]>>("other");
  const [voided, setVoided] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const people = useMemo(() => new Map(data.residents.map((person) => [person.id, person.name])), [data.residents]);
  const locations = useMemo(() => new Map(data.properties.map((location) => [location.id, location.address + (location.unit ? " · " + location.unit : "")])), [data.properties]);
  const label = (visit: Visit) => [visit.recordedAt.slice(0, 10), people.get(visit.residentId ?? "") || locations.get(visit.propertyId ?? "") || "Anonymous community encounter", outcomeMeta[reviewedEncounter(visit).outcome].label, visit.id].join(" · ");
  const matches = data.visits.filter((visit) => label(visit).toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const current = review ? reviewedEncounter(review.original) : undefined;
  const stale = Boolean(review && (review.revision !== data.sync.serverRevision || review.version !== data.sync.recordVersions?.[versionKey("visit", review.original.id)]));
  const changed = current && (current.outcome !== outcome || current.context !== context || current.voided !== voided);
  const reset = () => { setReview(null); setReason(""); setConfirmed(false); setMessage(""); };
  const preview = () => {
    const original = data.visits.find((visit) => visit.id === selectedId);
    const version = data.sync.recordVersions?.[versionKey("visit", selectedId)];
    if (!original || !version || data.sync.serverRevision === undefined) return;
    reset();
    const effective = reviewedEncounter(original);
    setReview({ original: JSON.parse(JSON.stringify(original)) as Visit, version, revision: data.sync.serverRevision });
    setOutcome(effective.outcome); setContext(effective.context); setVoided(effective.voided);
  };
  return <section className="today-card" aria-labelledby="encounter-correction-title">
    <h2 id="encounter-correction-title">Correct an encounter after review</h2>
    <p>Keep the original and append a factual correction, or mark a duplicate/mistaken entry as entered in error. This needs a connected, recently signed-in leader and no pending device work.</p>
    <fieldset className="form-stack" disabled={blocked}>
      <legend>Find the encounter</legend>
      <label>Search encounter date, person, address or ID<input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setSelectedId(""); reset(); }} /></label>
      <label>Encounter to review<select value={selectedId} onChange={(e) => { setSelectedId(e.target.value); reset(); }}><option value="">Choose encounter</option>{matches.slice(0, 100).map((visit) => <option key={visit.id} value={visit.id}>{label(visit)}</option>)}</select></label>
      <p>{matches.length > 100 ? "Showing the 100 most recent matches. Refine the search to find older records." : `${matches.length} matching encounters.`}</p>
      <button className="button quiet" disabled={!selectedId} onClick={preview}>Review original encounter</button>
    </fieldset>
    {review && current && <>
      <dl><div><dt>Original encounter</dt><dd>{label(review.original)}</dd></div><div><dt>Originally recorded</dt><dd>{outcomeMeta[review.original.outcome].label} · {(review.original.context ?? "door").replaceAll("_", " ")} · {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: data.church.timezone }).format(new Date(review.original.recordedAt))}</dd></div><div><dt>Original note (retained)</dt><dd>{review.original.objectiveNote || "No shared note. Protected person notes are separate."}</dd></div></dl>
      {(review.original.corrections ?? []).map((correction) => <p key={correction.id}>Previous review: {correction.reason} · {correction.voided ? "Entered in error" : outcomeMeta[correction.outcome].label}</p>)}
      <p>{data.followUps.filter((task) => task.sourceVisitId === review.original.id).length} linked tasks remain unchanged. Changing to “Follow-up requested” does not create a task; create an owned next step separately. Entered-in-error encounters remain in history but do not count toward current activity or last contact.</p>
      <p>People, location, outing, original note and date cannot be reassigned here. For a wrong link, mark this entry in error and record the correct encounter separately. Contact restrictions must be recorded or lifted in contact preferences; this review never changes them.</p>
      {stale && <p role="status" className="inline-notice">Records changed. Review the original encounter again before saving.</p>}
      <fieldset className="form-stack" disabled={blocked || stale}>
        <legend>Append the factual correction</legend>
        <label>Reviewed outcome<select value={outcome} onChange={(e) => { setOutcome(e.target.value as Visit["outcome"]); setConfirmed(false); }}>{outcomeValues.filter((value) => value !== "unvisited" && (value !== "do_not_visit" || current.outcome === "do_not_visit") && (review.original.propertyId || !["no_answer", "do_not_visit", "inaccessible"].includes(value))).map((value) => <option key={value} value={value}>{outcomeMeta[value].label}</option>)}</select></label>
        <label>Reviewed context<select value={context} onChange={(e) => { setContext(e.target.value as NonNullable<Visit["context"]>); setConfirmed(false); }}>{contexts.filter((value) => value !== "door" || review.original.propertyId).map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <label className="checkbox-label"><input type="checkbox" checked={voided} onChange={(e) => { setVoided(e.target.checked); setConfirmed(false); }} /> Entered in error — preserve history, exclude from activity and last-contact summaries</label>
        <label>Factual reason for this correction<textarea minLength={3} maxLength={500} value={reason} onChange={(e) => { setReason(e.target.value); setConfirmed(false); }} /></label>
        <p>{review.original.residentId ? "This reason follows the original person's access permissions." : "Anonymous encounter history is shared with church members. Do not put names, contact information or private care needs in this reason."}</p>
        <label className="checkbox-label"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I reviewed the original and will handle tasks and contact restrictions separately. Their current responsibilities and restrictions must remain unchanged.</label>
        <button className="button primary" disabled={!changed || !confirmed || reason.trim().length < 3} onClick={() => void onAction(() => onRun({ action: "encounter_correct", expectedRevision: review.revision, encounterId: review.original.id, expectedVersion: review.version,
          outcome, context, voided, reason: reason.trim(), confirmation: "KEEP ORIGINAL AND RESPONSIBILITIES" }), () => { reset(); setSelectedId(""); setMessage("Correction recorded. Original history, task responsibilities and contact restrictions were preserved."); })}>Save reviewed correction</button>
      </fieldset>
    </>}
    {message && <p role="status" className="inline-notice">{message}</p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}
