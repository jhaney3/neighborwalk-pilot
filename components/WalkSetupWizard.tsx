"use client";
/* eslint-disable jsx-a11y/label-has-associated-control -- controls are nested in visible labels */

import { CalendarDays, Check, ChevronLeft, ChevronRight, MapPin, Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { calendarDaysFromNow, localDateTimeValue } from "../lib/calendar";
import type { ConversationGuide, NeighborWalkData, OutreachEvent, Territory } from "../lib/domain";
import { snapshotParcelFeatureCollection } from "../lib/target-parcels";
import { parentZoneTouchedParcelKeys } from "../lib/target-coverage";
import { parseWalkDateTimes, readyPreparationMissing, saveWalkSetup, targetPlanIssues, type PlannedWalkTarget, type WalkSaveIntent, type WalkSetupCheckpoint } from "../lib/walk-setup";
import type { SaveTarget, WalkTargetInput } from "../lib/walk-targets";
import { useAsyncAction } from "../lib/use-async-action";
import { OutingInvitationRoster } from "./OutingInvitationRoster";
import { ParentZoneCreator, type NewParentZoneInput } from "./ParentZoneCreator";
import { WalkTargetPlanner, type PlanningMapData, type WalkTargetDraft } from "./WalkTargetPlanner";
import { Modal } from "./ui";

type Assignment = NonNullable<NeighborWalkData["assignments"]>[number];
type Responsibility = PlannedWalkTarget["responsibility"];

export type WalkSetupWizardProps = {
  data: NeighborWalkData;
  guides: ConversationGuide[];
  outing?: OutreachEvent;
  onClose: () => void;
  onComplete: (eventId: string) => void;
  onSaveOuting: (input: Omit<OutreachEvent, "id" | "churchId">, id?: string) => Promise<string>;
  onSaveTarget: SaveTarget;
  onSaveAssignment: (input: Omit<Assignment, "id" | "churchId">, id?: string) => Promise<string>;
  onSaveRoster: (eventId: string, memberIds: string[]) => Promise<void>;
  onAddZone: (input: NewParentZoneInput) => Promise<string>;
};

const steps = ["When", "Where", "Who", "Review"] as const;
const ignoreTargetChange = () => undefined;
const ignoreTargetSelection = () => undefined;

function plannedTarget(draft: WalkTargetDraft, responsibility: Responsibility): PlannedWalkTarget {
  const copy: Partial<WalkTargetDraft> = { ...draft };
  delete copy.clientId;
  delete copy.eventId;
  return { clientId: draft.clientId, target: copy as Omit<WalkTargetInput, "eventId">, responsibility };
}

function TargetPlanPreview({ data, territory, targets, label }: {
  data: NeighborWalkData;
  territory: Territory;
  targets: WalkTargetDraft[];
  label: string;
}) {
  const reviewData = useMemo<PlanningMapData>(() => ({
    streets: { type: "FeatureCollection", features: [] },
    parcels: snapshotParcelFeatureCollection(targets.flatMap((target) => target.parcels)),
    parcelRevision: targets.flatMap((target) => target.parcels)[0]?.datasetRevision,
    parcelComplete: false,
  }), [targets]);
  const loadReviewData = useMemo(() => async () => reviewData, [reviewData]);
  const visitedParcelKeys = useMemo(() => parentZoneTouchedParcelKeys(data, territory.id), [data, territory.id]);
  return <section className="walk-plan-preview" aria-label={label}>
    <WalkTargetPlanner
      parentTerritory={territory}
      eventId={targets[0]?.eventId ?? "draft-event"}
      targets={targets}
      mapStyleUrl={data.preferences.mapStyleUrl}
      demo={data.sync.mode === "device_only"}
      onSelectedTargetChange={ignoreTargetSelection}
      onChange={ignoreTargetChange}
      loadPlanningData={loadReviewData}
      visitedParcelKeys={visitedParcelKeys}
      readOnly
    />
    <ul className="walk-plan-preview-legend">
      {targets.map((target) => <li key={target.clientId}>
        <i style={{ background: target.color }} />
        <span><strong>{target.name}</strong><small>Staff at check-in · {target.parcels.length} residential {target.parcels.length === 1 ? "property" : "properties"}</small></span>
      </li>)}
    </ul>
  </section>;
}

export function WalkSetupWizard({ data, guides, outing, onClose, onComplete, onSaveOuting, onSaveTarget, onSaveAssignment, onSaveRoster, onAddZone }: WalkSetupWizardProps) {
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
  const [step, setStep] = useState(0);
  const [name, setName] = useState(outing?.name ?? "Neighborhood walk");
  const [start, setStart] = useState(outing ? localDateTimeValue(outing.startsAt, timezone) : `${calendarDaysFromNow(1, timezone)}T09:00`);
  const [end, setEnd] = useState(outing ? localDateTimeValue(outing.endsAt, timezone) : `${calendarDaysFromNow(1, timezone)}T11:00`);
  const [selectedTimezone, setSelectedTimezone] = useState(timezone);
  // New walks start with sensible preparation so leaders only change what differs.
  const previousWalk = outing ? undefined : [...data.events].filter((event) => event.meetingPoint).sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
  const planner = data.volunteers.find((volunteer) => volunteer.id === data.preferences.activeVolunteerId);
  const [purpose, setPurpose] = useState(outing?.purpose ?? (outing ? "" : "Meet our neighbors, listen well, and follow through on what they ask."));
  const [meetingPoint, setMeetingPoint] = useState(outing?.meetingPoint ?? previousWalk?.meetingPoint ?? "");
  const [leaderContact, setLeaderContact] = useState(outing?.leaderContact ?? previousWalk?.leaderContact ?? planner?.name ?? "");
  const [guideId, setGuideId] = useState(outing?.guideId ?? "");
  const [community, setCommunity] = useState(Boolean(outing && !initialTerritoryId));
  const [territoryId, setTerritoryId] = useState(initialTerritoryId);
  const [createdZone, setCreatedZone] = useState<Territory>();
  const [zoneCreatorOpen, setZoneCreatorOpen] = useState(false);
  const [targets, setTargets] = useState<WalkTargetDraft[]>(() => existingTargets.map((item) => ({ ...item, clientId: item.id })));
  const [invitedMemberIds, setInvitedMemberIds] = useState<string[]>(() => data.outingParticipants.filter((participant) => participant.eventId === outing?.id).map((participant) => participant.volunteerId));
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
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
  const territory = data.territories.find((item) => item.id === territoryId && item.kind !== "list")
    ?? (createdZone?.id === territoryId ? createdZone : undefined);
  const activeTerritoryId = territory?.id;
  const mappedTerritories = createdZone && !data.territories.some((item) => item.id === createdZone.id)
    ? [...data.territories.filter((item) => item.kind !== "list"), createdZone]
    : data.territories.filter((item) => item.kind !== "list");
  const planned = targets.map((draft) => plannedTarget(draft, {}));
  const visitedParcelKeys = useMemo(() => activeTerritoryId ? parentZoneTouchedParcelKeys(data, activeTerritoryId) : new Set<string>(), [activeTerritoryId, data]);
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
    ? Boolean(name.trim() && outingInput)
    : step === 1
      ? community || Boolean(territory && (locked || targets.length))
      : step === 2
        ? issues.length === 0
        : true;
  const readyMissing = outingInput ? [...readyPreparationMissing(outingInput), ...(invitedMemberIds.length ? [] : ["at least one invited person"])] : ["valid date and time"];
  const save = (intent: WalkSaveIntent) => {
    if (!outingInput) return;
    void action.run(async () => {
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

  return <Modal title={outing ? "Resume walk setup" : "Plan a walk"} description={outing ? "Pick up where you left off." : "Pick a time, a neighborhood and who’s coming."} onClose={action.busy ? () => undefined : zoneCreatorOpen ? () => setZoneCreatorOpen(false) : onClose} mobileImmersive={zoneCreatorOpen} wide>
    <div className="walk-setup form-stack" aria-busy={action.busy}>
      <ol className="walk-steps" aria-label="Walk setup progress">{steps.map((label, index) => <li key={label} className={index === step ? "active" : index < step ? "complete" : ""} aria-current={index === step ? "step" : undefined}><span>{index < step ? <Check size={14} /> : index + 1}</span>{label}</li>)}</ol>

      {step === 0 && <section className="walk-step-panel">
        <div className="walk-step-heading"><CalendarDays /><div><p>Step 1</p><h3>When are you going?</h3></div></div>
        <label>Walk name<input required value={name} maxLength={160} onChange={(event) => setName(event.target.value)} /></label>
        <div className="walk-field-grid"><label>Starts<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} /></label><label>Ends<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} /></label></div>
        <p className="walk-timezone-note">Times use <strong>{selectedTimezone}</strong>.</p>
        {parsedTimes.error && <p className="inline-error" role="alert">{parsedTimes.error}</p>}
        <details className="walk-extra-preparation"><summary>More options</summary><div className="walk-field-grid"><label>Timezone<input value={selectedTimezone} onChange={(event) => setSelectedTimezone(event.target.value)} /></label><label>Conversation guide<select value={guideId} onChange={(event) => setGuideId(event.target.value)}><option value="">No guide assigned</option>{guides.filter((item) => item.scope === "church").map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></div></details>
      </section>}

      {step === 1 && <section className="walk-step-panel walk-map-step">
        <div className="walk-step-heading"><MapPin /><div><p>Step 2</p><h3>Where are you going?</h3></div></div>
        {locked ? <div className="walk-locked-assignments"><strong>Routes are set</strong><small>Routes that are already assigned can’t be redrawn.</small></div> : <>
          <fieldset className="walk-choice-list"><legend>What kind of walk?</legend>
            <label><input type="radio" checked={!community} onChange={() => setCommunity(false)} /><span><strong>A neighborhood</strong><small>Knock on doors in a neighborhood.</small></span></label>
            {!community && <>
              <select aria-label="Neighborhood" value={territoryId} onChange={(event) => { setTerritoryId(event.target.value); setTargets([]); }}><option value="">Choose a neighborhood</option>{mappedTerritories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
              {targets.length === 0 ? <ParentZoneCreator churchId={data.church.id} mapStyleUrl={data.preferences.mapStyleUrl} baseTerritory={territory} demo={data.sync.mode === "device_only"} open={zoneCreatorOpen} onOpenChange={setZoneCreatorOpen} onAddZone={onAddZone} onCreated={(zone) => { setCreatedZone(zone); setTerritoryId(zone.id); setCommunity(false); }} /> : <small className="walk-help">Remove the routes before switching neighborhoods.</small>}
            </>}
            <label><input type="radio" checked={community} onChange={() => setCommunity(true)} /><span><strong>A gathering</strong><small>A meal, service day or event.</small></span></label>
          </fieldset>
          {territory && !community && <div className="walk-target-planner-host" aria-hidden={zoneCreatorOpen || undefined} inert={zoneCreatorOpen || undefined}><WalkTargetPlanner parentTerritory={territory} eventId={outing?.id ?? "draft-event"} targets={targets} selectedTargetId={selectedTargetId} mapStyleUrl={data.preferences.mapStyleUrl} visitedParcelKeys={visitedParcelKeys} demo={data.sync.mode === "device_only"} onSelectedTargetChange={setSelectedTargetId} onChange={setTargets} /></div>}
        </>}
      </section>}

      {step === 2 && <section className="walk-step-panel">
        <div className="walk-step-heading"><Users /><div><p>Step 3</p><h3>Who’s coming?</h3></div></div>
        <p className="walk-step-intro">They’ll see the walk on Home. You’ll form teams at check-in.</p>
        <OutingInvitationRoster data={data} eventId={outing?.id} selectedIds={invitedMemberIds} onChange={setInvitedMemberIds} />
        {issues.length > 0 && !locked && <ul className="walk-validation-list">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
      </section>}

      {step === 3 && <section className="walk-step-panel">
        <div className="walk-step-heading"><Check /><div><p>Step 4</p><h3>Review the plan</h3></div></div>
        <div className="walk-ready-fields"><h4>Details for volunteers</h4><label>Purpose<textarea rows={3} maxLength={1000} value={purpose} onChange={(event) => setPurpose(event.target.value)} /></label><div className="walk-field-grid"><label>Meeting point<input maxLength={300} value={meetingPoint} onChange={(event) => setMeetingPoint(event.target.value)} /></label><label>Leader contact<input maxLength={254} value={leaderContact} onChange={(event) => setLeaderContact(event.target.value)} /></label></div></div>
        <dl className="walk-review-list"><div><dt>When</dt><dd><strong>{outingInput?.name}</strong>{outingInput && <span>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: selectedTimezone }).formatRange(new Date(outingInput.startsAt), new Date(outingInput.endsAt))}</span>}</dd></div><div><dt>Neighborhood</dt><dd>{community ? "Gathering" : territory?.name ?? "No neighborhood"}</dd></div><div><dt>Invited</dt><dd><strong>{invitedMemberIds.length} {invitedMemberIds.length === 1 ? "person" : "people"}</strong><span>They’ll see it on Home.</span></dd></div><div><dt>Routes</dt><dd>{community ? "No routes" : `${targets.length} routes · ${new Set(targets.flatMap((item) => item.parcels.map((parcel) => `${parcel.countyFips}:${parcel.gislink}`))).size} homes`} {!community && <span>Teams form at check-in.</span>}</dd></div></dl>
        {territory && !community && targets.length > 0 && <TargetPlanPreview data={data} territory={territory} targets={targets} label="Routes" />}
        {(readyMissing.length > 0 || (!community && !locked && issues.length > 0)) && <p className="walk-ready-note">Still needed to mark ready: {[...readyMissing, ...issues].join(", ")}.</p>}
      </section>}

      {action.error && <p className="inline-error" role="alert">{action.error}</p>}
      <div className="walk-actions"><button type="button" className="button quiet" disabled={action.busy || step === 0} onClick={() => setStep((value) => value - 1)}><ChevronLeft size={15} /> Back</button>{step < 3 ? <button type="button" className="button primary" disabled={action.busy || !canContinue} onClick={() => setStep((value) => value + 1)}>Continue <ChevronRight size={15} /></button> : <div className="walk-review-actions"><button type="button" className="button quiet" disabled={action.busy} onClick={() => save("draft")}>Save draft</button><button type="button" className="button primary" disabled={action.busy || readyMissing.length > 0 || (!community && !locked && issues.length > 0)} onClick={() => save("ready")}>Save &amp; mark ready</button></div>}</div>
    </div>
  </Modal>;
}
