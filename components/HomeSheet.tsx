"use client";

import { ChevronRight, Ellipsis, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { calendarDate, calendarDaysFromNow, formatCalendarDate } from "../lib/calendar";
import { conversationNeedLabels, outcomeMeta, type NeighborWalkData, type Property } from "../lib/domain";
import { reviewedEncounter } from "../lib/encounter-history";
import { useAsyncAction } from "../lib/use-async-action";
import { HistoryList, OutcomeGrid, outcomeWord } from "./OutcomeGrid";
import { PinDetails, type PinTarget, type PinVisit } from "./PinSheet";
import { ActionSheet, Sheet } from "./Sheet";
import { initials, useConfirm } from "./ui";

/** "due Sat", "due tomorrow", "due yesterday": close dates by name, far ones by date. */
export function dueLabel(dueAt: string, timezone: string) {
  const due = calendarDate(dueAt, timezone);
  const today = calendarDaysFromNow(0, timezone);
  if (due === today) return "due today";
  if (due === calendarDaysFromNow(1, timezone)) return "due tomorrow";
  if (due === calendarDaysFromNow(-1, timezone)) return "due yesterday";
  if (due < today) return `overdue since ${formatCalendarDate(due, { month: "short", day: "numeric" })}`;
  if (due <= calendarDaysFromNow(6, timezone)) return `due ${formatCalendarDate(due, { weekday: "short" })}`;
  return `due ${formatCalendarDate(due, { month: "short", day: "numeric" })}`;
}

/** Needs and a note, as one quiet line: "Prayed together · health". */
export function visitDetailLine(visit: { needs?: string[]; objectiveNote?: string }) {
  const needs = (visit.needs ?? []).map((need, index) => {
    const label = need === "prayer" ? "Prayed together" : conversationNeedLabels[need as keyof typeof conversationNeedLabels] ?? need;
    return index ? label.toLowerCase() : label;
  });
  return [...needs, visit.objectiveNote].filter(Boolean).join(" · ") || undefined;
}

type Stage = "home" | "menu" | "edit" | "details";

/** One scrolling sheet per home, no tabs: its open follow-up, Log a visit, the
 * people who live here and its history. ⋯ swaps the sheet for a short menu. */
export function HomeSheet({ data, property, canManage, activeVolunteerId, focusHistory = false, onOutcome, onDetails, onDone, onOpenFollowUp, onOpenPerson, onAddPerson, onAnotherHome, onMovePin, onUpdateProperty, onDeleteProperty, onClose }: {
  data: NeighborWalkData;
  property: Property;
  canManage: boolean;
  activeVolunteerId: string;
  focusHistory?: boolean;
  onOutcome: (target: PinTarget, visit: PinVisit, hold: boolean) => void;
  onDetails: (visit: PinVisit) => void;
  onDone: () => void;
  onOpenFollowUp: (followUpId: string) => void;
  onOpenPerson: (personId: string) => void;
  onAddPerson: (propertyId: string) => void;
  onAnotherHome: (propertyId: string) => void;
  onMovePin: (propertyId: string) => void;
  onUpdateProperty: (propertyId: string, patch: Pick<Property, "address" | "unit">) => Promise<unknown>;
  onDeleteProperty: (propertyId: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<Stage>("home");
  const [saved, setSaved] = useState<PinVisit["outcome"]>("conversation");
  const titleId = useId();
  const historyRef = useRef<HTMLDivElement>(null);
  const timezone = data.church.timezone;
  const address = `${property.address}${property.unit ? ` · ${property.unit}` : ""}`;
  useEffect(() => {
    if (focusHistory) historyRef.current?.scrollIntoView({ block: "start" });
  }, [focusHistory]);

  if (stage === "details") return <Sheet className="pin-sheet details" modal labelledBy={titleId} onDismiss={onDone}>
    <PinDetails data={data} titleId={titleId} target={{ kind: "home", propertyId: property.id }} initialOutcome={saved} onChange={onDetails} onDone={onDone} />
  </Sheet>;
  if (stage === "menu") return <ActionSheet title={address} closeLabel="Close" onClose={() => setStage("home")} actions={[
    { label: "Edit home", onSelect: () => setStage("edit") },
    { label: "Another home here", onSelect: () => onAnotherHome(property.id), disabled: !property.coordinates },
    { label: "Move pin", onSelect: () => onMovePin(property.id), disabled: !property.coordinates },
  ]} />;
  if (stage === "edit") return <EditHome data={data} property={property} canManage={canManage} activeVolunteerId={activeVolunteerId} onMovePin={() => onMovePin(property.id)} onSave={async (patch) => { await onUpdateProperty(property.id, patch); setStage("home"); }} onDelete={async () => { await onDeleteProperty(property.id); onClose(); }} onClose={() => setStage("home")} />;

  const followUp = data.followUps.filter((task) => task.propertyId === property.id && task.status === "scheduled").sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  const followUpOwner = followUp?.assignedVolunteerId ? data.volunteers.find((volunteer) => volunteer.id === followUp.assignedVolunteerId)?.name : undefined;
  const visits = data.visits.filter((visit) => visit.propertyId === property.id).map(reviewedEncounter).filter((visit) => !visit.voided).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const people = data.residents.filter((resident) => !resident.mergedIntoId && resident.status !== "archived" && resident.propertyId === property.id);
  const volunteer = (id: string) => data.volunteers.find((item) => item.id === id)?.name;
  const summary = visits.length ? `${visits.length} ${visits.length === 1 ? "visit" : "visits"} · last ${formatCalendarDate(calendarDate(visits[0].recordedAt, timezone), { month: "short", day: "numeric" })}` : "Pinned · no visits yet";
  const doNotKnock = property.currentOutcome === "do_not_visit";

  return <Sheet className="home-sheet" detent={focusHistory ? "large" : "medium"} labelledBy={titleId} onDismiss={onClose}>
    <div className="home-sheet-head">
      <div><p className="mono-meta pin-kicker">{summary}</p><h2 className="pin-title" id={titleId}>{address}</h2></div>
      <button type="button" className="round-line" aria-label={`Options for ${address}`} onClick={() => setStage("menu")}><Ellipsis size={18} aria-hidden="true" /></button>
    </div>
    {followUp && <button type="button" className="home-follow-up offset-card porch" onClick={() => onOpenFollowUp(followUp.id)}>
      <span className="mono-meta danger">{["Come back", dueLabel(followUp.dueAt, timezone), followUpOwner].filter(Boolean).join(" · ")}</span>
      <strong>{followUp.note || "Visit again"}</strong>
      <span className="mono-meta hedge">Open follow-up ›</span>
    </button>}
    {doNotKnock
      ? <p className="walk-card-banner"><span><strong>Don’t knock here</strong>They asked us not to come back. Only a leader can change this.</span></p>
      : <>
        <p className="mono-meta home-sheet-label">Log a visit</p>
        <OutcomeGrid onChoose={(option) => { onOutcome({ kind: "home", propertyId: property.id }, { outcome: option.value, needs: [] }, option.details); if (option.details) { setSaved(option.value); setStage("details"); } }} />
      </>}
    <div className="home-section-head"><h3>People here</h3><button type="button" className="mono-meta hedge" onClick={() => onAddPerson(property.id)}>+ Add</button></div>
    {people.length ? <div className="grouped-rows">{people.map((person) => {
      const owner = volunteer(person.assignedVolunteerId);
      const reach = person.phone && person.preferredContact !== "none" ? `Prefers ${person.preferredContact}` : "No contact yet";
      return <button type="button" key={person.id} className="grouped-row" onClick={() => onOpenPerson(person.id)}>
        <span className="avatar-dot" aria-hidden="true">{person.name ? initials(person.name).slice(0, 1) : "?"}</span>
        <span className="grouped-row-text"><strong>{person.name || "Name not shared"}</strong><small>{[reach, owner ? `owner ${owner}` : undefined].filter(Boolean).join(" · ")}</small></span>
        <ChevronRight size={17} aria-hidden="true" />
      </button>;
    })}</div> : <p className="home-empty">No one yet. Add someone when they share their name.</p>}
    <div className="home-section-head" ref={historyRef}><h3>History</h3></div>
    {visits.length ? <HistoryList timezone={timezone} label={`History for ${address}`} entries={visits.map((visit) => ({
      id: visit.id, at: visit.recordedAt, color: outcomeMeta[visit.outcome].color,
      title: [outcomeWord[visit.outcome], volunteer(visit.volunteerId)].filter(Boolean).join(" · "),
      detail: visitDetailLine(visit),
    }))} /> : <p className="home-empty">No visits yet.</p>}
  </Sheet>;
}

function EditHome({ data, property, canManage, activeVolunteerId, onMovePin, onSave, onDelete, onClose }: {
  data: NeighborWalkData; property: Property; canManage: boolean; activeVolunteerId: string;
  onMovePin: () => void; onSave: (patch: Pick<Property, "address" | "unit">) => Promise<unknown>; onDelete: () => Promise<unknown>; onClose: () => void;
}) {
  const [address, setAddress] = useState(property.address);
  const [unit, setUnit] = useState(property.unit ?? "");
  const action = useAsyncAction();
  const confirm = useConfirm();
  const titleId = useId();
  // Only a mistaken pin can go: no visits, people or Don't knock, and only by a
  // leader or whoever dropped it that day.
  const droppedToday = property.createdByVolunteerId === activeVolunteerId && calendarDate(property.createdAt, data.church.timezone) === calendarDaysFromNow(0, data.church.timezone);
  const unused = property.visitCount === 0 && property.currentOutcome !== "do_not_visit" && !data.residents.some((resident) => resident.propertyId === property.id);
  const mayDelete = canManage || droppedToday;
  const canDelete = unused && mayDelete;
  return <Sheet className="home-sheet form" modal labelledBy={titleId} onDismiss={action.busy ? () => undefined : onClose}>
    <div className="home-sheet-head"><h2 className="pin-title" id={titleId}>Edit home</h2><button type="button" className="round-line" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
    <label className="pin-field"><span className="mono-meta">Street address</span><input value={address} maxLength={240} enterKeyHint="done" onChange={(event) => setAddress(event.target.value)} /></label>
    <label className="pin-field"><span className="mono-meta">Unit or label</span><input value={unit} maxLength={60} enterKeyHint="done" placeholder="Optional · e.g. Apt B" onChange={(event) => setUnit(event.target.value)} /></label>
    <div className="grouped-rows">
      <button type="button" className="grouped-row" disabled={!property.coordinates || action.busy} onClick={onMovePin}><span className="grouped-row-text"><strong>Move pin</strong><small>Drag it onto the right house</small></span><ChevronRight size={17} aria-hidden="true" /></button>
      {mayDelete && <button type="button" className="grouped-row danger" disabled={action.busy || !canDelete} onClick={() => void confirm({ title: `Delete ${property.address}?`, message: "Use this only for a pin dropped by mistake.", confirmLabel: "Delete home", destructive: true }).then((yes) => { if (yes) void action.save(onDelete); })}><span className="grouped-row-text"><strong>Delete home</strong><small>{canDelete ? "Only if it was pinned by mistake" : "It has visits or people, so it stays"}</small></span></button>}
    </div>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save" disabled={action.busy || address.trim().length < 3} onClick={() => void action.save(() => onSave({ address, unit }))}>{action.busy ? "Saving…" : "Save"}</button>
  </Sheet>;
}
