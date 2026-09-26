"use client";

import { Check, ChevronLeft, ChevronRight, Copy, Link2, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { formatCalendarDate, localDateTimeValue } from "../lib/calendar";
import type { NeighborWalkData, OutreachEvent, Territory } from "../lib/domain";
import { parentZoneTouchedParcelKeys } from "../lib/target-coverage";
import { parseWalkDateTimes, readyPreparationMissing, saveWalkSetup, targetPlanIssues, type PlannedWalkTarget, type WalkSaveIntent, type WalkSetupCheckpoint } from "../lib/walk-setup";
import type { SaveTarget, WalkTargetInput } from "../lib/walk-targets";
import { useAsyncAction } from "../lib/use-async-action";
import { InviteRoster } from "./WalkPage";
import { WalkWhenFields, walkDayCards } from "./WalkWhen";
import { selectionTick } from "../mobile/haptics";
import type { NewParentZoneInput } from "./ParentZoneCreator";
import { WalkTargetPlanner, type WalkTargetDraft } from "./WalkTargetPlanner";
import { NewNeighborhoodFlow } from "./NeighborhoodTools";
import { neighborhoodPinLine, neighborhoodPins, shortDate } from "../lib/pin-counts";
import { addLocalMinutes, clockLabel, localMinutesBetween } from "../lib/walk-schedule";
import { randomUuid } from "../lib/platform";
import { LeaderInvitations } from "./LeaderInvitations";
import { Modal } from "./ui";

type Assignment = NonNullable<NeighborWalkData["assignments"]>[number];
type Responsibility = PlannedWalkTarget["responsibility"];

export type WalkSetupWizardProps = {
  data: NeighborWalkData;
  outing?: OutreachEvent;
  /** Open on a step: 0 Where, 1 When, 2 Who. */
  initialStep?: number;
  onClose: () => void;
  onComplete: (eventId: string) => void;
  onSaveOuting: (input: Omit<OutreachEvent, "id" | "churchId">, id?: string) => Promise<string>;
  onSaveTarget: SaveTarget;
  onSaveAssignment: (input: Omit<Assignment, "id" | "churchId">, id?: string) => Promise<string>;
  onSaveRoster: (eventId: string, memberIds: string[]) => Promise<void>;
  onAddZone: (input: NewParentZoneInput) => Promise<string>;
};

// Where first: leaders plan around what is left to cover. See docs/design/decisions.md.
const steps = ["Where", "When", "Who"] as const;

/** All neighborhoods drawn to scale, each labeled with when it was last walked. */
function NeighborhoodMap({ territories, selectedId, walked, disabled, onSelect }: { territories: Territory[]; selectedId?: string; walked: (id: string) => string | undefined; disabled: boolean; onSelect: (id: string) => void }) {
  const shapes = territories.filter((territory) => territory.boundary.length >= 3);
  if (!shapes.length) return null;
  const points = shapes.flatMap((territory) => territory.boundary);
  const lat = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  const scale = Math.cos(lat * Math.PI / 180);
  const xs = points.map(([x]) => x * scale), ys = points.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const width = 320, height = Math.max(120, Math.min(170, Math.round(320 * (maxY - minY) / Math.max(maxX - minX, 1e-6))));
  const pad = 14;
  const fit = Math.min((width - pad * 2) / Math.max(maxX - minX, span * 0.2), (height - pad * 2) / Math.max(maxY - minY, span * 0.2));
  const project = ([x, y]: [number, number]) => [pad + (x * scale - minX) * fit + ((width - pad * 2) - (maxX - minX) * fit) / 2, pad + (maxY - y) * fit + ((height - pad * 2) - (maxY - minY) * fit) / 2];
  return <svg className="walk-zone-map" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    {shapes.map((territory) => {
      const projected = territory.boundary.map(project);
      const date = walked(territory.id);
      const [cx, cy] = projected.reduce(([sx, sy], [x, y]) => [sx + x / projected.length, sy + y / projected.length], [0, 0]);
      const selected = territory.id === selectedId;
      const label = territory.name.split(/\s+/)[0].slice(0, 14);
      const labelWidth = Math.max(label.length, date?.length ?? 0) * 7.4 + 20;
      return <g key={territory.id} className={selected ? "selected" : undefined} onClick={disabled ? undefined : () => onSelect(territory.id)}>
        <path d={`M${projected.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L")}Z`} fill={selected ? territory.color : "transparent"} fillOpacity={selected ? 0.22 : 0} stroke={selected ? "var(--ink-line)" : territory.color} strokeWidth={selected ? 2.5 : 2} strokeDasharray={date ? undefined : "5 4"} strokeLinejoin="round" />
        <rect x={cx - labelWidth / 2} y={cy - (date ? 19 : 11)} width={labelWidth} height={date ? 38 : 22} rx={7} className="walk-zone-label" />
        <text x={cx} y={date ? cy - 5 : cy} textAnchor="middle" dominantBaseline="middle">{label}</text>
        {date && <text x={cx} y={cy + 10} textAnchor="middle" dominantBaseline="middle" className="mono">{date.toUpperCase()}</text>}
      </g>;
    })}
  </svg>;
}

function plannedTarget(draft: WalkTargetDraft, responsibility: Responsibility): PlannedWalkTarget {
  const copy: Partial<WalkTargetDraft> = { ...draft };
  delete copy.clientId;
  delete copy.eventId;
  return { clientId: draft.clientId, target: copy as Omit<WalkTargetInput, "eventId">, responsibility };
}

export function WalkSetupWizard({ data, outing, initialStep = 0, onClose, onComplete, onSaveOuting, onSaveTarget, onSaveAssignment, onSaveRoster, onAddZone }: WalkSetupWizardProps) {
  const outingAssignments = data.assignments?.filter((item) => item.eventId === outing?.id) ?? [];
  const existingAssignments = outingAssignments.filter((item) => !["cancelled", "declined"].includes(item.status));
  const existingTargets = data.walkTargets.filter((target) => {
    if (target.eventId !== outing?.id) return false;
    const targetAssignments = outingAssignments.filter((assignment) => assignment.targetId === target.id);
    return targetAssignments.length === 0 || targetAssignments.some((assignment) => !["cancelled", "declined"].includes(assignment.status));
  });
  const initialTerritoryId = existingAssignments[0]?.territoryId
    ?? existingTargets[0]?.territoryId
    ?? (outing ? "" : data.territories.find((item) => item.kind !== "list")?.id ?? "");
  const timezone = outing?.timezone ?? data.church.timezone;
  const [step, setStep] = useState(initialStep);
  // New walks are named from the place and day until the leader types a name.
  const [customName, setCustomName] = useState(outing?.name);
  // New walks start on the coming Saturday at 9:30 for two hours (BD10).
  const firstDay = walkDayCards(timezone)[0];
  const initialStart = outing ? localDateTimeValue(outing.startsAt, timezone) : `${firstDay}T09:30`;
  const initialEnd = outing ? localDateTimeValue(outing.endsAt, timezone) : `${firstDay}T11:30`;
  const [day, setDay] = useState(initialStart.slice(0, 10));
  const [time, setTime] = useState(initialStart.slice(11, 16));
  const [duration, setDuration] = useState(Math.max(30, localMinutesBetween(initialStart, initialEnd)));
  const start = `${day}T${time}`;
  const end = addLocalMinutes(start, duration);
  const fieldId = useId();
  const selectedTimezone = timezone;
  // New walks start with sensible preparation so leaders only change what differs.
  const previousWalk = outing ? undefined : [...data.events].filter((event) => event.meetingPoint).sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
  const planner = data.volunteers.find((volunteer) => volunteer.id === data.preferences.activeVolunteerId);
  const [purpose, setPurpose] = useState(outing?.purpose ?? (outing ? "" : "Meet our neighbors, listen well, and follow through on what they ask."));
  const [meetingPoint, setMeetingPoint] = useState(outing?.meetingPoint ?? previousWalk?.meetingPoint ?? "");
  const [leaderContact, setLeaderContact] = useState(outing?.leaderContact ?? previousWalk?.leaderContact ?? planner?.name ?? "");
  // Conversation guides are retired from the new UI; an existing assignment is kept.
  const guideId = outing?.guideId ?? "";
  const [community, setCommunity] = useState(Boolean(outing && !initialTerritoryId));
  const [territoryId, setTerritoryId] = useState(initialTerritoryId);
  const [targets, setTargets] = useState<WalkTargetDraft[]>(() => existingTargets.map((item) => ({ ...item, clientId: item.id })));
  const [invitedMemberIds, setInvitedMemberIds] = useState<string[]>(() => data.outingParticipants.filter((participant) => participant.eventId === outing?.id).map((participant) => participant.volunteerId));
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const [copiedFrom, setCopiedFrom] = useState<string>();
  const [inviting, setInviting] = useState(false);
  const checkpoint = useRef<WalkSetupCheckpoint>({
    eventId: outing?.id,
    targetIds: Object.fromEntries(existingTargets.map((item) => [item.id, item.id])),
    assignmentIds: Object.fromEntries(existingAssignments.filter((item) => item.targetId).map((item) => [item.targetId!, item.id])),
  });
  const action = useAsyncAction();
  const locked = Boolean(
    (outing && !["draft", "scheduled"].includes(outing.status))
    || existingTargets.some((target) => target.rosterState === "frozen")
    || existingAssignments.some((assignment) => !assignment.targetId || ["accepted", "completed"].includes(assignment.status)),
  );
  const territory = data.territories.find((item) => item.id === territoryId && item.kind !== "list");
  const activeTerritoryId = territory?.id;
  const mappedTerritories = data.territories.filter((item) => item.kind !== "list");
  const name = customName ?? [community ? "Gathering" : territory?.name ?? "Neighborhood walk", formatCalendarDate(day, { weekday: "short", month: "short", day: "numeric" }).replace(",", "")].join(" · ");
  const setName = (value: string) => setCustomName(value);
  const planned = targets.map((draft) => plannedTarget(draft, {}));
  // Streets with pins from the last 60 days are dashed (PW2).
  const [recentCutoff] = useState(() => new Date(Date.now() - 60 * 86_400_000).toISOString());
  const visitedParcelKeys = useMemo(() => activeTerritoryId ? parentZoneTouchedParcelKeys({ ...data, parentProgress: [], visits: data.visits.filter((visit) => visit.recordedAt >= recentCutoff) }, activeTerritoryId) : new Set<string>(), [activeTerritoryId, data, recentCutoff]);
  const issues = targetPlanIssues(planned);
  const parsedTimes = useMemo(() => parseWalkDateTimes(start, end, selectedTimezone), [start, end, selectedTimezone]);
  const outingInput = parsedTimes.error ? undefined : {
    name: name.trim(),
    startsAt: parsedTimes.startsAt,
    endsAt: parsedTimes.endsAt,
    timezone: selectedTimezone,
    purpose: purpose.trim(),
    meetingPoint: meetingPoint.trim(),
    leaderContact: leaderContact.trim(),
    guideId: guideId || undefined,
    status: "draft" as const,
    debrief: outing?.debrief ?? "",
  };
  const canContinue = step === 0
    ? community || Boolean(territory && (locked || targets.length))
    : step === 1
      ? Boolean(outingInput)
      : true;
  const readyMissing = outingInput ? [...readyPreparationMissing(outingInput), ...(invitedMemberIds.length ? [] : ["at least one invited person"])] : ["valid date and time"];
  const save = (intent: WalkSaveIntent) => {
    if (!outingInput) return;
    void action.save(async () => {
      const result = await saveWalkSetup({
        outing: outingInput,
        area: community ? { kind: "community" } : { kind: "existing", territoryId },
        targets: planned,
        invitedMemberIds,
        preserveAssignments: locked,
      }, checkpoint.current, {
        saveOuting: onSaveOuting,
        saveTarget: onSaveTarget,
        saveAssignment: onSaveAssignment,
        saveRoster: onSaveRoster,
      }, intent, (next) => { checkpoint.current = next; });
      checkpoint.current = result;
      onComplete(result.eventId!);
    });
  };
  const lastWalk = outing ? undefined : [...data.events].filter((event) => !["cancelled", "draft"].includes(event.status)).sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
  const copyLastWalk = () => {
    if (!lastWalk) return;
    const lastTargets = data.walkTargets.filter((target) => target.eventId === lastWalk.id);
    const lastTimezone = lastWalk.timezone ?? data.church.timezone;
    const lastStart = localDateTimeValue(lastWalk.startsAt, lastTimezone);
    setTime(lastStart.slice(11, 16));
    setDuration(Math.max(30, localMinutesBetween(lastStart, localDateTimeValue(lastWalk.endsAt, lastTimezone))));
    setMeetingPoint(lastWalk.meetingPoint ?? "");
    if (lastWalk.purpose) setPurpose(lastWalk.purpose);
    if (lastWalk.leaderContact) setLeaderContact(lastWalk.leaderContact);
    const active = new Set(data.volunteers.filter((volunteer) => volunteer.active).map((volunteer) => volunteer.id));
    setInvitedMemberIds(data.outingParticipants.filter((participant) => participant.eventId === lastWalk.id && active.has(participant.volunteerId)).map((participant) => participant.volunteerId));
    const lastTerritoryId = lastTargets[0]?.territoryId ?? data.assignments?.find((assignment) => assignment.eventId === lastWalk.id)?.territoryId;
    if (!lastTerritoryId) { setCommunity(true); setTargets([]); }
    else {
      setCommunity(false);
      setTerritoryId(lastTerritoryId);
      setTargets(lastTargets.filter((target) => target.territoryId === lastTerritoryId && target.parcels.length).map((target) => ({ clientId: `draft-${randomUuid()}`, eventId: outing?.id ?? "draft-event", territoryId: target.territoryId, name: target.name, color: target.color, selectionKind: target.selectionKind, geometry: target.geometry, streetSelection: target.streetSelection, parcels: target.parcels })));
    }
    setCopiedFrom(lastWalk.name);
  };
  const detailsNeeded = !purpose.trim() || !leaderContact.trim();
  // Step 0 is two screens: pick the neighborhood (PW1), then its streets (PW2).
  const [picking, setPicking] = useState(initialStep === 0 && !targets.length);
  const [drawingZone, setDrawingZone] = useState(false);
  const goBack = () => { if (step === 0 && !picking && !locked) setPicking(true); else if (step > 0) setStep(step - 1); };
  const chooseNeighborhood = (id: string) => { selectionTick(); if (id !== territoryId) { setTerritoryId(id); setTargets([]); } setCommunity(false); setPicking(false); };
  const lastNotes = lastWalk?.debrief?.trim();
  const onFirstScreen = step === 0 && picking;
  const summaryKicker = [community ? "Gathering" : territory?.name, formatCalendarDate(day, { weekday: "short", month: "short", day: "numeric" }).replace(",", ""), clockLabel(time).replace(/ [AP]M$/, "")].filter(Boolean).join(" · ");

  return <><div className="screen-page overlay walk-flow-page" role="dialog" aria-modal="true" aria-labelledby={`${fieldId}-title`} aria-busy={action.busy}>
    <div className="screen-top">
      {onFirstScreen ? <button type="button" className="round-button float" aria-label="Close" disabled={action.busy} onClick={onClose}><X size={19} aria-hidden="true" /></button>
        : <button type="button" className="round-button float" aria-label="Back" disabled={action.busy} onClick={goBack}><ChevronLeft size={22} aria-hidden="true" /></button>}
      <span className="mono-meta">{step + 1} of {steps.length}</span>
      <span className="screen-top-spacer" />
    </div>
    {drawingZone && <NewNeighborhoodFlow data={data} around={territory} onCancel={() => setDrawingZone(false)} onSave={async (input) => {
      const id = await onAddZone({ ...input, kind: "map" });
      setDrawingZone(false);
      chooseNeighborhood(id);
    }} />}

    {step === 0 && picking && <section className="walk-step" aria-labelledby={`${fieldId}-title`}>
      <h1 className="screen-title" id={`${fieldId}-title`}>Where are you walking?</h1>
      {lastWalk && !locked && <button type="button" className="dash-row copy-row" onClick={() => { copyLastWalk(); setPicking(false); }}><Copy size={18} aria-hidden="true" /><span><strong>{copiedFrom ? "Copied last walk" : "Copy last walk"}</strong> · {lastWalk.name}</span></button>}
      <NeighborhoodMap territories={mappedTerritories} selectedId={community ? undefined : territoryId} walked={(id) => { const at = neighborhoodPins(data, id).lastWalkedAt; return at ? shortDate(at, data.church.timezone) : undefined; }} disabled={locked} onSelect={chooseNeighborhood} />
      <div className="grouped-rows" role="radiogroup" aria-label="Neighborhood">
        {mappedTerritories.map((item) => <button type="button" role="radio" key={item.id} data-territory-id={item.id} className="grouped-row" aria-checked={!community && item.id === territoryId} disabled={locked && item.id !== territoryId} onClick={() => chooseNeighborhood(item.id)}>
          <i className="color-bar" style={{ background: item.color }} aria-hidden="true" />
          <span className="grouped-row-text"><strong>{item.name}</strong><small>{neighborhoodPinLine(data, item.id, "Never walked")}</small></span>
          {!community && item.id === territoryId && <span className="check-dot" aria-hidden="true"><Check size={14} /></span>}
        </button>)}
      </div>
      {!locked && <div className="grouped-rows new-zone-row"><button type="button" className="grouped-row" onClick={() => setDrawingZone(true)}>
        <i className="color-bar dashed" aria-hidden="true" />
        <span className="grouped-row-text"><strong>New neighborhood</strong><small>Draw it on the map</small></span>
        <ChevronRight size={17} aria-hidden="true" />
      </button></div>}
      {lastNotes && <div className="last-notes"><p className="mono-meta">Notes from {lastWalk?.name}</p><p>{lastNotes}</p></div>}
      {!locked && <button type="button" className="mono-meta hedge gathering-link" onClick={() => { setCommunity(true); setTargets([]); setPicking(false); setStep(1); }}>It’s a gathering instead</button>}
    </section>}

    {step === 0 && !picking && <section className="walk-step" aria-labelledby={`${fieldId}-title`}>
      <h1 className="screen-title" id={`${fieldId}-title`}>Which streets?</h1>
      {locked ? <div className="last-notes"><p className="mono-meta">Routes are set</p><p>Routes that are already assigned can’t be redrawn.</p></div>
        : territory ? <div className="walk-target-planner-host"><WalkTargetPlanner parentTerritory={territory} eventId={outing?.id ?? "draft-event"} targets={targets} selectedTargetId={selectedTargetId} mapStyleUrl={data.preferences.mapStyleUrl} visitedParcelKeys={visitedParcelKeys} demo={data.sync.mode === "device_only"} onSelectedTargetChange={setSelectedTargetId} onChange={setTargets} /></div>
        : <p className="home-empty">Pick a neighborhood first.</p>}
      <button type="button" className="walk-save" disabled={!canContinue} onClick={() => setStep(1)}>Next · when</button>
    </section>}

    {step === 1 && <section className="walk-step" aria-labelledby={`${fieldId}-title`}>
      <h1 className="screen-title" id={`${fieldId}-title`}>When?</h1>
      <WalkWhenFields timezone={selectedTimezone} day={day} time={time} duration={duration} meetingPoint={meetingPoint} lastMeetingPoint={previousWalk?.meetingPoint} onDay={setDay} onTime={setTime} onDuration={setDuration} onMeetingPoint={setMeetingPoint} />
      {parsedTimes.error && <p className="inline-error" role="alert">{parsedTimes.error}</p>}
      <button type="button" className="walk-save" disabled={!outingInput} onClick={() => setStep(2)}>Next · who</button>
    </section>}

    {step === 2 && <section className="walk-step" aria-labelledby={`${fieldId}-title`}>
      <h1 className="screen-title" id={`${fieldId}-title`}>Who’s coming?</h1>
      <InviteRoster data={data} eventId={outing?.id} selectedIds={invitedMemberIds} onChange={setInvitedMemberIds} search={false} />
      {detailsNeeded && <div className="walk-field"><span className="mono-meta">For volunteers</span>
        <label className="pin-field"><span className="mono-meta">Purpose</span><textarea rows={2} maxLength={1000} value={purpose} onChange={(event) => setPurpose(event.target.value)} /></label>
        <label className="pin-field"><span className="mono-meta">Leader contact</span><input maxLength={254} value={leaderContact} onChange={(event) => setLeaderContact(event.target.value)} /></label>
      </div>}
      <div className="walk-summary offset-card">
        <p className="mono-meta">{summaryKicker}</p>
        <label className="walk-summary-name"><span className="visually-hidden">Walk name</span><input required aria-label="Walk name" value={name} maxLength={160} enterKeyHint="done" onChange={(event) => setName(event.target.value)} /></label>
        <span>{[community ? "No routes" : `${targets.length} ${targets.length === 1 ? "route" : "routes"}`, `${invitedMemberIds.length} invited`].join(" · ")}</span>
      </div>
      {issues.length > 0 && !locked && <ul className="walk-validation-list">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
      {(readyMissing.length > 0 || (!community && !locked && issues.length > 0)) && <p className="walk-ready-note">Still needed to send invites: {[...readyMissing, ...issues].join(", ")}.</p>}
      {action.error && <p className="inline-error" role="alert">{action.error}</p>}
      <div className="flow-actions">
        <button type="button" className="square-button" aria-label="Back" disabled={action.busy} onClick={goBack}><ChevronLeft size={20} aria-hidden="true" /></button>
        <button type="button" className="square-button" aria-label="Invite someone new" disabled={action.busy} onClick={() => setInviting(true)}><Link2 size={19} aria-hidden="true" /></button>
        <button type="button" className="button-outline" disabled={action.busy} onClick={() => save("draft")}>Save draft</button>
        <button type="button" className="button-ink" disabled={action.busy || !name.trim() || readyMissing.length > 0 || (!community && !locked && issues.length > 0)} onClick={() => save("ready")}>Send invites</button>
      </div>
    </section>}
    {step < 2 && action.error && <p className="inline-error" role="alert">{action.error}</p>}
  </div>
  {inviting && <Modal title="Invite someone new" description="They get a one-time link to join your church." onClose={() => setInviting(false)}>
    {data.sync.mode === "connected" ? <LeaderInvitations onChanged={async () => undefined} /> : <p className="walk-help">Sign in to your church to send invitation links. Sample data can’t invite anyone.</p>}
  </Modal>}
  </>;
}
