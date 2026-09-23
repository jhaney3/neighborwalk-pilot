"use client";
import { CalendarDays, Check, MapPin, MessageCircle, PencilLine, Plus, Repeat2, Users } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { calendarDaysFromNow, churchDateTimeToIso, localDateTimeValue } from "../lib/calendar";
import type { ConversationGuide, NeighborWalkData, OutreachEvent, ResidentInput, Territory } from "../lib/domain";
import type { EncounterInput } from "../lib/encounters";
import { fetchPlanningParcelsForBoundary, type PlanningParcelResult } from "../lib/target-parcels";
import { parentZoneCoverage, parentZoneTouchedParcelKeys, targetCoverage } from "../lib/target-coverage";
import type { SaveTarget, WalkTarget } from "../lib/walk-targets";
import { useAsyncAction } from "../lib/use-async-action";
import { reviewedEncounter } from "../lib/encounter-history";
import { targetCrewMemberIds } from "../lib/walk-crews";
import { ConversationLauncher } from "./ConversationLogger";
import { ConversationRow } from "./ConversationFeed";
import { communityConversations } from "../lib/conversations";
import { NeighborhoodShape, ProgressRing, neighborhoodProgress, outingTerritory } from "./visuals";
import { OutingInvitationRoster } from "./OutingInvitationRoster";
import type { NewParentZoneInput } from "./ParentZoneCreator";
import { BackButton, Badge, EmptyState, ListGroup, ListRow, Modal, ViewHeading, useConfirm, type ConfirmOptions } from "./ui";
import { assignmentStatusLabels, walkStatusLabels } from "../lib/status-labels";
import { WalkSetupWizard } from "./WalkSetupWizard";
import { WalkCrewBoard, type WalkCrews } from "./WalkCrewBoard";
import { WalkTargetPlanner, type WalkTargetDraft } from "./WalkTargetPlanner";

type Assignment = NonNullable<NeighborWalkData["assignments"]>[number];
type LoadedPlanningInventory = { boundarySignature: string; result: PlanningParcelResult };
const completeWalkConfirmation: ConfirmOptions = { title: "Complete this walk?", message: "It closes for everyone. Conversations and follow-ups stay.", confirmLabel: "Complete walk" };

function walkGroups(outings: OutreachEvent[]): [string, OutreachEvent[]][] {
  const groups: [string, OutreachEvent[]][] = [
    ["Happening now", outings.filter((outing) => outing.status === "active")],
    ["Coming up", outings.filter((outing) => ["draft", "scheduled", "ready"].includes(outing.status))],
    ["Past", outings.filter((outing) => ["completed", "cancelled", "archived"].includes(outing.status)).reverse()],
  ];
  return groups.filter(([, items]) => items.length > 0);
}

export function isCommunityOuting(eventId: string, assignments: readonly { eventId: string; status?: string }[], targets: readonly { eventId: string }[]) {
  return !assignments.some((assignment) => assignment.eventId === eventId)
    && !targets.some((target) => target.eventId === eventId);
}

function planningBoundarySignature(territory: Territory) {
  return territory.boundary.map(([longitude, latitude]) => `${longitude.toFixed(7)},${latitude.toFixed(7)}`).join(";");
}

function usePlanningInventories(territories: Territory[], enabled: boolean) {
  const [loaded, setLoaded] = useState<Record<string, LoadedPlanningInventory>>({});
  const requests = useMemo(() => territories.map((territory) => ({
    id: territory.id,
    boundary: territory.boundary,
    boundarySignature: planningBoundarySignature(territory),
  })), [territories]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async ({ id, boundary, boundarySignature }: (typeof requests)[number]) => {
      try {
        const result = await fetchPlanningParcelsForBoundary(boundary);
        if (!cancelled) setLoaded((current) => ({ ...current, [id]: { boundarySignature, result } }));
      } catch {
        // Coverage remains unavailable when the authoritative planning inventory cannot load.
      }
    };
    void Promise.all(requests.map(load));
    return () => { cancelled = true; };
  }, [enabled, requests]);

  return useMemo(() => {
    if (!enabled) return {};
    return Object.fromEntries(requests.flatMap(({ id, boundarySignature }) => {
      const entry = loaded[id];
      return entry?.boundarySignature === boundarySignature ? [[id, entry.result]] : [];
    })) as Record<string, PlanningParcelResult>;
  }, [enabled, loaded, requests]);
}

type Props = {
  data: NeighborWalkData; canManage: boolean; activeVolunteerId: string; guides: ConversationGuide[];
  selectedId?: string; initialCreate?: boolean; onCreateClosed?: () => void; onSelect: (id?: string) => void; onStart: (id: string, territoryId: string, targetId?: string) => Promise<unknown>;
  onSave: (input: Omit<OutreachEvent, "id" | "churchId">, id?: string) => Promise<string>;
  onRepeat: (id: string, startsAt: string, endsAt: string) => Promise<string>;
  onAssign: (input: Omit<Assignment, "id" | "churchId">, id?: string) => Promise<string>;
  onSaveRoster: (eventId: string, memberIds: string[]) => Promise<void>;
  onSaveCrews: (eventId: string, crews: WalkCrews, attendingIds: string[]) => Promise<void>;
  onSaveTarget: SaveTarget; onAddZone: (input: NewParentZoneInput) => Promise<string>;
  onReplaceTarget: (assignmentId: string, input: Parameters<SaveTarget>[0], owner: { assignedTeamId?: string; assignedVolunteerId?: string }) => Promise<string>;
  onAddList?: (name: string) => Promise<string>; onOpenGuide: (id: string) => void;
  onRecordEncounter: (input: EncounterInput) => Promise<unknown>;
  onCreatePerson: (input: ResidentInput) => Promise<string>;
  viewSwitch?: React.ReactNode;
};

export function OutreachView(props: Props) {
  const { data, canManage, selectedId, onSelect, onSave, onRepeat } = props;
  const confirm = useConfirm();
  const [wizard, setWizard] = useState<"new" | OutreachEvent | null>(props.initialCreate ? "new" : null);
  const [editor, setEditor] = useState<OutreachEvent | null>(null);
  const [repeat, setRepeat] = useState<OutreachEvent | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [pendingCardId, setPendingCardId] = useState<string>();
  const listAction = useAsyncAction();
  const selected = data.events.find((e) => e.id === selectedId);
  const outings = data.events.filter((e) => showArchived || !["archived", "cancelled", "completed"].includes(e.status)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const transitionFromCard = async (outing: OutreachEvent, status: OutreachEvent["status"]) => {
    if (status === "completed" && !await confirm(completeWalkConfirmation)) return;
    setPendingCardId(outing.id);
    void listAction.run(async () => {
      try { await onSave({ ...outing, status }, outing.id); }
      finally { setPendingCardId(undefined); }
    });
  };
  return <section className="content-view outreach-view">
    {selected ? <BackButton label="Walks" ariaLabel="All walks" onClick={() => onSelect()} /> : <ViewHeading title="Walks" aside={canManage && <button className="button primary outreach-plan-button" aria-label="Plan a walk" onClick={() => setWizard("new")}><Plus size={16} aria-hidden="true" /><span>Plan a walk</span></button>} />}
    {!selected && props.viewSwitch && <div className="walks-view-switch">{props.viewSwitch}</div>}
    {selected ? <><OutingDetail key={selected.id} {...props} outing={selected} onEdit={() => selected.status === "draft" ? setWizard(selected) : setEditor(selected)} onRepeatRequest={() => setRepeat(selected)} /></>
      : <><label className="checkbox-label"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show past walks</label>
        {listAction.error && <p role="alert" className="inline-error">{listAction.error}</p>}
        {outings.length ? <div className="walk-groups">{walkGroups(outings).map(([groupLabel, groupOutings]) => <section key={groupLabel} className="walk-group" aria-label={groupLabel}>
          <h2 className="list-group-label">{groupLabel}</h2>
          <div className="outing-grid">{groupOutings.map((outing) => {
          const assignmentCount = data.assignments?.filter((assignment) => assignment.eventId === outing.id && !["cancelled", "declined"].includes(assignment.status)).length ?? 0;
          const territory = outingTerritory(data, outing.id);
          const progress = territory ? neighborhoodProgress(data, territory.id) : undefined;
          const cardAction = canManage
            ? outing.status === "draft"
              ? { label: "Continue setup", onClick: () => setWizard(outing), primary: false }
              : outing.status === "scheduled"
                ? { label: "Review setup", onClick: () => setWizard(outing), primary: false }
                : outing.status === "ready"
                  ? { label: "Start walk", pendingLabel: "Starting…", onClick: () => transitionFromCard(outing, "active"), primary: true }
                  : outing.status === "active"
                    ? { label: "Complete walk", pendingLabel: "Completing…", onClick: () => transitionFromCard(outing, "completed"), primary: true }
                    : undefined
            : undefined;
          const cardPending = pendingCardId === outing.id;
          return <article className={`outing-card walk-card is-${outing.status}`} key={outing.id}>
            <div className="walk-card-shape">{territory ? <NeighborhoodShape territory={territory} data={data} size={84} /> : <span className="walk-card-shape-empty"><MessageCircle size={26} aria-hidden="true" /></span>}</div>
            <div className="walk-card-body">
              <div className="outing-card-status-row"><Badge tone={walkStatusLabels[outing.status].tone}>{outing.status === "active" && <i className="live-dot" aria-hidden="true" />}{walkStatusLabels[outing.status].label}</Badge><span className="walk-card-date">{new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: outing.timezone ?? data.church.timezone }).format(new Date(outing.startsAt))}</span></div>
              <h2>{outing.name}</h2>
              <p className="walk-card-where">{territory ? territory.name : "Gathering"}{assignmentCount ? `, ${assignmentCount} ${assignmentCount === 1 ? "route" : "routes"}` : ""}</p>
              {progress && progress.total > 0 && <div className="walk-card-progress" aria-label={`${progress.touched} of ${progress.total} homes reached`}><i style={{ width: `${Math.round((progress.touched / progress.total) * 100)}%` }} /><span>{progress.touched} of {progress.total} homes</span></div>}
            </div>
            {cardAction && <button type="button" className={`button outing-card-action ${cardAction.primary ? "primary" : "quiet"}`} disabled={listAction.busy} onClick={cardAction.onClick}>{cardPending ? cardAction.pendingLabel ?? cardAction.label : cardAction.label}</button>}
            <button type="button" className="outing-card-details" aria-label={`View details for ${outing.name}`} onClick={() => onSelect(outing.id)} />
          </article>;
        })}</div></section>)}</div>
          : <EmptyState icon={<CalendarDays size={26} />} title="No walks yet" copy={canManage ? "Pick a neighborhood and the streets you’ll cover." : "Walks you’re invited to will show up here."} />}</>}
    {wizard && <WalkSetupWizard data={data} guides={props.guides} outing={wizard === "new" ? undefined : wizard} onClose={() => { setWizard(null); props.onCreateClosed?.(); }} onComplete={(id) => { setWizard(null); onSelect(id); }} onSaveOuting={onSave} onSaveTarget={props.onSaveTarget} onSaveAssignment={props.onAssign} onSaveRoster={props.onSaveRoster} onAddZone={props.onAddZone} />}
    {editor && <OutingEditor churchTimezone={data.church.timezone} guides={props.guides} outing={editor} onClose={() => setEditor(null)} onSave={async (input) => { const id = await onSave(input, editor.id); setEditor(null); onSelect(id); }} />}
    {repeat && <RepeatOuting outing={repeat} churchTimezone={data.church.timezone} onClose={() => setRepeat(null)} onSave={async (start, end) => { const id = await onRepeat(repeat.id, start, end); setRepeat(null); onSelect(id); }} />}
  </section>;
}

function ParentZoneCoveragePanel({ data, territoryIds, eventId }: { data: NeighborWalkData; territoryIds: string[]; eventId: string }) {
  const territoryKey = territoryIds.join("|");
  const territories = useMemo(() => {
    const ids = new Set(territoryKey.split("|").filter(Boolean));
    return data.territories.filter((territory) => ids.has(territory.id) && territory.kind !== "list");
  }, [data.territories, territoryKey]);
  const parcelResults = usePlanningInventories(territories, data.sync.mode === "connected" && data.coverageVisibility === "complete");

  return <section className="outing-panel outing-zone-coverage" aria-label="Neighborhood coverage">
    <div className="outing-section-heading"><span><MapPin size={20} /></span><div><h3>Coverage</h3></div></div>
    <div className="outing-zone-coverage-grid">{territories.map((territory) => {
      const result = parcelResults[territory.id];
      const completeInventory = Boolean(result?.complete && !result.truncated);
      const residentialParcels = result?.parcels.features
        .map((parcel) => ({ countyFips: parcel.properties.countyFips, gislink: parcel.properties.gislink })) ?? [];
      const inventory = result ? { parcels: residentialParcels, complete: completeInventory } : undefined;
      const cumulative = parentZoneCoverage(data, territory.id, inventory);
      const tonight = parentZoneCoverage(data, territory.id, inventory, eventId);
      const authoritative = cumulative.complete && tonight.complete;
      return <article key={territory.id}>
        <div className="outing-zone-coverage-title"><i style={{ background: territory.color }} /><strong>{territory.name}</strong></div>
        {authoritative ? <div className="outing-zone-progress-pair">
          <div><small>All walks</small><strong>{cumulative.percent === null ? "—" : `${cumulative.percent}%`}</strong><span>{cumulative.touched} of {cumulative.total} homes</span></div>
          <div><small>Tonight</small><strong>{tonight.percent === null ? "—" : `${tonight.percent}%`}</strong><span>{tonight.touched} of {tonight.total} homes</span></div>
        </div> : <p className="outing-zone-coverage-unavailable">Coverage shows once the neighborhood’s homes finish loading.</p>}
      </article>;
    })}</div>
  </section>;
}

function OutingDetail({ outing, onEdit, onRepeatRequest, ...props }: Props & { outing: OutreachEvent; onEdit: () => void; onRepeatRequest: () => void }) {
  const { data, canManage, activeVolunteerId, onAssign, onSave, onStart, onOpenGuide, onRecordEncounter, onCreatePerson } = props;
  const action = useAsyncAction();
  const confirm = useConfirm();
  const [fieldAssignmentId, setFieldAssignmentId] = useState("");
  const [replacementAssignmentId, setReplacementAssignmentId] = useState("");
  const [crewEditorOpen, setCrewEditorOpen] = useState(false);
  const [rosterEditorOpen, setRosterEditorOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuId = useId();
  const statusTrigger = useRef<HTMLButtonElement>(null);
  const statusMenu = useRef<HTMLDivElement>(null);
  const closeStatusMenu = () => { setStatusMenuOpen(false); statusTrigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (statusMenuOpen) statusMenu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [statusMenuOpen]);
  const [debrief, setDebrief] = useState(outing.debrief ?? "");
  const assignments = data.assignments?.filter((assignment) => assignment.eventId === outing.id) ?? [];
  const participants = data.outingParticipants.filter((participant) => participant.eventId === outing.id);
  const myTeams = new Set(data.teams.filter((t) => t.memberIds.includes(activeVolunteerId)).map((t) => t.id));
  const myAssignments = assignments.filter((assignment) => (assignment.assignedVolunteerId === activeVolunteerId || myTeams.has(assignment.assignedTeamId ?? "")) && !["cancelled", "declined"].includes(assignment.status));
  const checkedIn = data.outingParticipants.some((participant) => participant.eventId === outing.id && participant.volunteerId === activeVolunteerId && participant.status === "checked_in");
  const availableAssignments = myAssignments.filter((assignment) => assignment.status === "accepted" || checkedIn && assignment.status === "assigned");
  const activeAssignments = assignments.filter((assignment) => ["assigned", "accepted"].includes(assignment.status));
  const outingTargets = data.walkTargets.filter((target) => target.eventId === outing.id);
  const openTargets = outingTargets.filter((target) => !target.finishedAt);
  const fieldAssignments = (canManage ? activeAssignments : availableAssignments)
    .filter((assignment) => !assignment.targetId || data.walkTargets.some((target) => target.id === assignment.targetId && !target.finishedAt));
  const openTasks = data.followUps.filter((t) => t.eventId === outing.id && t.status === "scheduled");
  const encounters = data.visits.filter((v) => v.eventId === outing.id && !reviewedEncounter(v).voided);
  const walkConversations = communityConversations(data, { eventId: outing.id });
  const guide = props.guides.find((g) => g.id === outing.guideId);
  const closed = ["completed", "archived", "cancelled"].includes(outing.status);
  const parentTerritoryIds = [...new Set([...outingTargets.map((target) => target.territoryId), ...activeAssignments.map((assignment) => assignment.territoryId)])];
  const replacementAssignment = assignments.find((assignment) => assignment.id === replacementAssignmentId);
  const replacementTarget = data.walkTargets.find((target) => target.id === replacementAssignment?.targetId);
  const replacementTerritory = data.territories.find((territory) => territory.id === replacementAssignment?.territoryId && territory.kind !== "list");
  const personalFieldAssignments = fieldAssignments.filter((assignment) => myAssignments.some((mine) => mine.id === assignment.id));
  const defaultFieldAssignment = personalFieldAssignments.length === 1 ? personalFieldAssignments[0] : fieldAssignments.length === 1 ? fieldAssignments[0] : undefined;
  const fieldAssignment = fieldAssignments.find((assignment) => assignment.id === fieldAssignmentId) ?? defaultFieldAssignment;
  const communityOuting = isCommunityOuting(outing.id, data.assignments ?? [], data.walkTargets);
  const fieldworkAvailable = ["ready", "active"].includes(outing.status);
  const timezone = outing.timezone ?? data.church.timezone;
  const dateLabel = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: timezone }).format(new Date(outing.startsAt));
  const startTime = new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: timezone }).format(new Date(outing.startsAt));
  const endTime = new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: timezone }).format(new Date(outing.endsAt));
  const transition = (status: OutreachEvent["status"]) => action.run(() => onSave({ ...outing, status }, outing.id));
  const lifecycleMessage = outing.status === "ready"
    ? "Ready to start."
    : outing.status === "active"
      ? "Walking now."
      : ["draft", "scheduled"].includes(outing.status)
        ? "Mark ready when the plan is set."
        : outing.status === "completed"
          ? "Complete."
          : "Closed.";
  const crewItems = [
    ...outingTargets.map((target) => {
      const targetAssignments = assignments.filter((assignment) => assignment.targetId === target.id);
      const assignment = targetAssignments.find((item) => ["assigned", "accepted"].includes(item.status))
        ?? (target.finishedAt ? targetAssignments.find((item) => item.status === "completed") : undefined)
        ?? (closed ? targetAssignments[targetAssignments.length - 1] : undefined);
      return { key: target.id, target, assignment };
    }),
    ...assignments.filter((assignment) => !assignment.targetId && (closed || !["cancelled", "declined"].includes(assignment.status)))
      .map((assignment) => ({ key: assignment.id, target: undefined, assignment })),
  ];
  const heroTerritory = outingTerritory(data, outing.id);
  const heroProgress = heroTerritory ? neighborhoodProgress(data, heroTerritory.id) : undefined;
  return <article className="outing-detail">
    <header className="outing-hero">
      {heroTerritory && <div className="outing-hero-visual"><NeighborhoodShape territory={heroTerritory} data={data} size={132} />{heroProgress && heroProgress.total > 0 && <ProgressRing value={heroProgress.touched} total={heroProgress.total} size={56} label={`${heroProgress.touched} of ${heroProgress.total} homes reached`} />}</div>}
      <div className="outing-hero-main"><div><div className="outing-hero-kicker"><Badge tone={walkStatusLabels[outing.status].tone}>{walkStatusLabels[outing.status].label}</Badge></div><h2>{outing.name}</h2>{outing.purpose && <p>{outing.purpose}</p>}</div>
        {!closed && !communityOuting && <div className="outing-fieldwork-entry">
          {fieldAssignments.length > 1 && <label><span>Route</span><select value={fieldAssignment?.id ?? ""} onChange={(event) => setFieldAssignmentId(event.target.value)}>{!fieldAssignment && <option value="">Choose a route</option>}{fieldAssignments.map((assignment) => <option key={assignment.id} value={assignment.id}>{data.walkTargets.find((target) => target.id === assignment.targetId)?.name ?? data.territories.find((territory) => territory.id === assignment.territoryId)?.name ?? "Archived route"}</option>)}</select></label>}
          {fieldAssignment && personalFieldAssignments.some((assignment) => assignment.id === fieldAssignment.id) && <small>Your route{fieldAssignments.length === 1 ? `: ${data.walkTargets.find((target) => target.id === fieldAssignment.targetId)?.name ?? data.territories.find((territory) => territory.id === fieldAssignment.territoryId)?.name ?? "Archived route"}` : " is selected."}</small>}
          <button className="button primary outing-fieldwork-button" disabled={action.busy || !fieldworkAvailable || !fieldAssignment} onClick={() => { if (fieldAssignment) void action.run(() => onStart(outing.id, fieldAssignment.territoryId, fieldAssignment.targetId)); }}>Open walk</button>
          {!fieldworkAvailable && <small>Mark the walk ready to open it.</small>}
          {fieldworkAvailable && !fieldAssignments.length && <small>{canManage ? "Add a route to open the walk." : "Reply on Home. Your leader will check you in and give you a route when the walk starts."}</small>}
        </div>}
      </div>
      <ListGroup className="outing-facts">
        <ListRow icon={<CalendarDays />} title={dateLabel} subtitle={`${startTime}–${endTime}`} />
        <ListRow icon={<MapPin />} title={outing.meetingPoint || "No meeting point yet"} subtitle={outing.meetingPoint ? "Meeting point" : canManage ? "Add one when you edit the walk." : undefined} />
        <ListRow icon={<Users />} title={outing.leaderContact || "No leader contact yet"} subtitle={outing.leaderContact ? "Leader contact" : undefined} />
      </ListGroup>
      <div className="outing-summary-row" aria-label="Walk summary"><div><strong>{outingTargets.length ? `${activeAssignments.filter((assignment) => assignment.targetId).length}/${outingTargets.length}` : activeAssignments.length}</strong><span>Routes with a team</span></div><div><strong>{encounters.length}</strong><span>Conversations</span></div><div><strong>{openTasks.length}</strong><span>Open follow-ups</span></div></div>
      <div className="outing-support-actions">{canManage && <><button className="button quiet" onClick={onEdit}>{outing.status === "draft" ? "Resume setup" : "Edit walk"}</button><button className="button quiet" onClick={onRepeatRequest}><Repeat2 size={16} /> Repeat walk</button></>}
        {guide ? <button className="button quiet" onClick={() => onOpenGuide(guide.id)}>Open {guide.title}</button> : <span>Conversation guide is optional.</span>}
      </div>
      {!closed && communityOuting && <div className="outing-community-entry"><div><strong>Gathering</strong><span>Log conversations from a meal, service day or other gathering.</span></div><ConversationLauncher data={data} outingId={outing.id} onSave={onRecordEncounter} onCreatePerson={onCreatePerson} /></div>}
    </header>
    {canManage && <section className="outing-lifecycle" aria-label="Walk status controls"><div className="outing-lifecycle-copy" aria-live="polite"><small><i aria-hidden="true" /> Status</small><strong>{walkStatusLabels[outing.status].label}</strong><span>{lifecycleMessage}</span></div><div className="outing-lifecycle-actions">{(outing.status === "completed" || !closed) && <div className={`outing-status-options${statusMenuOpen ? " open" : ""}`}><button type="button" ref={statusTrigger} className="outing-status-options-trigger" aria-controls={statusMenuOpen ? statusMenuId : undefined} onKeyDown={(event) => { if (event.key === "Escape") closeStatusMenu(); if (event.key === "ArrowDown") { event.preventDefault(); setStatusMenuOpen(true); } }} aria-haspopup="menu" aria-expanded={statusMenuOpen} onClick={() => setStatusMenuOpen((open) => !open)}>Options</button>{statusMenuOpen && <><button type="button" className="outing-status-options-backdrop" aria-label="Close options" tabIndex={-1} onClick={closeStatusMenu} /><div ref={statusMenu} id={statusMenuId} className="outing-status-options-menu" role="menu" tabIndex={-1} aria-label="Walk options" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); closeStatusMenu(); }
      if (event.key === "Tab") closeStatusMenu();
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>{outing.status === "completed" && <button role="menuitem" className="button quiet small" disabled={action.busy} onClick={() => { closeStatusMenu(); void transition("archived"); }}>Archive walk</button>}{!closed && <button role="menuitem" className="button danger small" disabled={action.busy} onClick={() => { closeStatusMenu(); void confirm({ title: "Cancel this walk?", message: "Conversations and follow-ups stay.", confirmLabel: "Cancel walk", cancelLabel: "Keep walk", destructive: true }).then((confirmed) => { if (confirmed) void transition("cancelled"); }); }}>Cancel walk</button>}</div></>}</div>}{["draft", "scheduled"].includes(outing.status) && <button className="button primary" disabled={action.busy} onClick={() => void transition("ready")}>Mark ready</button>}{outing.status === "ready" && <button className="button primary" disabled={action.busy} onClick={() => void transition("active")}>Start walk</button>}{outing.status === "active" && <button className="button primary" disabled={action.busy} onClick={() => { void confirm(completeWalkConfirmation).then((confirmed) => { if (confirmed) void transition("completed"); }); }}>Complete walk</button>}</div></section>}
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    {canManage && parentTerritoryIds.length > 0 && <ParentZoneCoveragePanel data={data} territoryIds={parentTerritoryIds} eventId={outing.id} />}
    {canManage && <section className="outing-panel outing-roster-panel"><div className="outing-section-title-row"><div className="outing-section-heading"><span><Users size={20} /></span><div><h3>Invited</h3>{participants.length > 0 && <p>{[
      [participants.filter((participant) => participant.status === "checked_in").length, "here"],
      [participants.filter((participant) => participant.status === "going").length, "going"],
      [participants.filter((participant) => participant.status === "not_going").length, "can’t make it"],
      [participants.filter((participant) => participant.status === "invited").length, "no reply"],
     ].filter(([count, label]) => Number(count) > 0 || label === "here" || label === "going").map(([count, label]) => `${count} ${label}`).join(" · ")}</p>}</div></div>{!closed && <button className="button quiet" onClick={() => setRosterEditorOpen(true)}><PencilLine size={15} /> Manage invitations</button>}</div>
      {participants.length ? <ul className="outing-roster-list">{participants.map((participant) => {
        const name = data.volunteers.find((volunteer) => volunteer.id === participant.volunteerId)?.name ?? "Unavailable member";
        return <li key={participant.id}><i aria-hidden="true">{name.charAt(0).toUpperCase()}</i><strong>{name}</strong><span className={`outing-participant-status ${participant.status}`}>{participant.status === "not_going" ? "Can’t go" : participant.status === "checked_in" ? "Here" : participant.status === "going" ? "Going" : "No reply"}</span></li>;
      })}</ul>
        : <p className="outing-roster-empty">No one has been invited yet.</p>}
    </section>}
    <section className="outing-panel outing-assignments-panel"><div className="outing-section-title-row"><div className="outing-section-heading"><span><Users size={20} /></span><div><h3>Teams</h3></div></div>{canManage && !closed && openTargets.length > 0 && <button className="button primary" onClick={() => setCrewEditorOpen(true)}><PencilLine size={15} /> Edit teams</button>}</div>
      <ul className="assignment-list">{crewItems.map(({ key, assignment, target }) => {
        const areaName = target?.name ?? data.territories.find((t) => t.id === assignment?.territoryId)?.name ?? "Archived route";
        const memberIds = assignment?.assignedVolunteerId ? [assignment.assignedVolunteerId] : data.teams.find((team) => team.id === assignment?.assignedTeamId)?.memberIds ?? [];
        const memberNames = memberIds.map((id) => data.volunteers.find((volunteer) => volunteer.id === id)?.name ?? "Unavailable member");
        const crewLabel = memberNames.length ? memberNames.join(", ") : "No team yet. Assign one at check-in.";
        const coverage = target ? targetCoverage(data, target) : undefined;
        const stateLabel = target?.finishedAt ? "Finished tonight" : assignment ? assignmentStatusLabels[assignment.status] : "No team yet";
        const coverageLabel = coverage ? `${coverage.touched} of ${coverage.total} visited${coverage.percent === null ? "" : ` · ${coverage.percent}%`}` : undefined;
        const canReplace = Boolean(assignment && canManage && target?.rosterState === "frozen" && !closed && !["cancelled", "completed", "declined"].includes(assignment.status));
        const canCancel = Boolean(assignment && canManage && !["cancelled", "completed", "declined"].includes(assignment.status));
        return <li key={key} className={!assignment ? "is-unstaffed" : undefined}>
          <div className="assignment-summary">
            <i className="assignment-map-mark" style={target ? { background: target.color } : undefined} aria-hidden="true" />
            <strong>{areaName}</strong>
            <span className={`assignment-state ${assignment?.status ?? "unassigned"}`}>{stateLabel}</span>
          </div>
          <div className="assignment-row"><span>Team</span><p>{crewLabel}</p></div>
          {coverageLabel && <div className="assignment-row"><span>Coverage</span><p>{coverageLabel}</p></div>}
          {(canReplace || canCancel) && <div className="assignment-actions">
            {canReplace && <button type="button" disabled={action.busy} onClick={() => setReplacementAssignmentId(assignment!.id)}>Replace route</button>}
            {canCancel && <button type="button" className="destructive" disabled={action.busy} onClick={() => void action.run(() => onAssign({ ...assignment!, status: "cancelled" }, assignment!.id))}>Cancel assignment</button>}
          </div>}
        </li>;
      })}</ul>
      {!crewItems.length && <div className="outing-empty-assignment"><MapPin size={20} /><div><strong>No routes yet</strong><p>Finish setup to add routes.</p></div></div>}
    </section>
    <details className="outing-panel outing-context-details outing-debrief-panel"><summary>Debrief</summary><div className="outing-section-heading"><span><MessageCircle size={20} /></span><div><h3>Debrief</h3></div></div><div className="outing-debrief-summary"><span>{encounters.length} logged</span><span>{openTasks.length} open follow-ups</span><span className={openTasks.some((task) => !task.assignedVolunteerId) ? "needs-attention" : ""}>{openTasks.filter((task) => !task.assignedVolunteerId).length} without an owner</span></div>{walkConversations.length > 0 && <ListGroup label="Conversations away from doors">{walkConversations.map((entry) => <ConversationRow key={entry.visit.id} entry={entry} />)}</ListGroup>}{canManage ? <form className="form-stack outing-debrief-form" onSubmit={(e) => { e.preventDefault(); void action.run(() => onSave({ ...outing, debrief }, outing.id)); }}><label>What should the next team know?<textarea value={debrief} maxLength={2000} rows={4} onChange={(e) => setDebrief(e.target.value)} placeholder="Logistics, what worked, what to bring next time." /></label><button className="button quiet" disabled={action.busy}><Check size={16} /> Save debrief</button></form> : <p>{outing.debrief || "The leader’s debrief will appear here."}</p>}</details>
    {replacementAssignment && replacementTarget && replacementTerritory && <TargetReplacementModal data={data} outing={outing} assignment={replacementAssignment} target={replacementTarget} territory={replacementTerritory} onClose={() => setReplacementAssignmentId("")} onReplace={props.onReplaceTarget} />}
    {rosterEditorOpen && <OutingRosterModal data={data} outing={outing} onClose={() => setRosterEditorOpen(false)} onSave={props.onSaveRoster} />}
    {crewEditorOpen && <WalkCrewModal data={data} outing={outing} targets={openTargets} onClose={() => setCrewEditorOpen(false)} onSave={props.onSaveCrews} />}
  </article>;
}

function OutingRosterModal({ data, outing, onClose, onSave }: {
  data: NeighborWalkData;
  outing: OutreachEvent;
  onClose: () => void;
  onSave: Props["onSaveRoster"];
}) {
  const [memberIds, setMemberIds] = useState<string[]>(() => data.outingParticipants.filter((participant) => participant.eventId === outing.id).map((participant) => participant.volunteerId));
  const action = useAsyncAction();
  return <Modal title="Invitations" onClose={action.busy ? () => undefined : onClose} wide>
    <div className="form-stack" aria-busy={action.busy}>
      <OutingInvitationRoster data={data} eventId={outing.id} selectedIds={memberIds} onChange={setMemberIds} />
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}
      <div className="modal-actions"><button type="button" className="button quiet" disabled={action.busy} onClick={onClose}>Cancel</button><button type="button" className="button primary" disabled={action.busy} onClick={() => void action.run(() => onSave(outing.id, memberIds), onClose)}><Check size={16} /> {action.busy ? "Saving invitations…" : "Save invitations"}</button></div>
    </div>
  </Modal>;
}

function WalkCrewModal({ data, outing, targets, onClose, onSave }: {
  data: NeighborWalkData;
  outing: OutreachEvent;
  targets: WalkTarget[];
  onClose: () => void;
  onSave: Props["onSaveCrews"];
}) {
  const [crews, setCrews] = useState<WalkCrews>(() => Object.fromEntries(targets.map((target) => [target.id, targetCrewMemberIds(data, target.id)])));
  const [attendingIds, setAttendingIds] = useState<string[]>(() => [...new Set([
    ...data.outingParticipants.filter((participant) => participant.eventId === outing.id && participant.status === "checked_in").map((participant) => participant.volunteerId),
    ...targets.flatMap((target) => targetCrewMemberIds(data, target.id)),
  ])]);
  const action = useAsyncAction();
  const save = () => void action.run(() => onSave(outing.id, crews, attendingIds), onClose);
  return <Modal title="Teams" onClose={action.busy ? () => undefined : onClose} wide>
    <div className="form-stack" aria-busy={action.busy}>
      <WalkCrewBoard data={data} targets={targets.map((target) => ({ id: target.id, name: target.name, color: target.color, propertyCount: target.parcels.length }))} crews={crews} onChange={setCrews} initialAttendingIds={attendingIds} onAttendanceChange={setAttendingIds} />
      {action.error && <p role="alert" className="inline-error">{action.error}</p>}
      <div className="modal-actions"><button type="button" className="button quiet" disabled={action.busy} onClick={onClose}>Cancel</button><button type="button" className="button primary" disabled={action.busy} onClick={save}><Check size={16} /> {action.busy ? "Saving…" : "Save teams"}</button></div>
    </div>
  </Modal>;
}

function TargetReplacementModal({ data, outing, assignment, target, territory, onClose, onReplace }: {
  data: NeighborWalkData;
  outing: OutreachEvent;
  assignment: Assignment;
  target: WalkTarget;
  territory: NeighborWalkData["territories"][number];
  onClose: () => void;
  onReplace: Props["onReplaceTarget"];
}) {
  const [targets, setTargets] = useState<WalkTargetDraft[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const action = useAsyncAction();
  const replacement = targets.length === 1 ? targets[0] : undefined;
  const canReplace = Boolean(replacement?.parcels.length && (assignment.assignedTeamId || assignment.assignedVolunteerId));
  const currentCrewIds = assignment.assignedVolunteerId ? [assignment.assignedVolunteerId] : data.teams.find((team) => team.id === assignment.assignedTeamId)?.memberIds ?? [];
  const currentCrew = currentCrewIds.map((id) => data.volunteers.find((volunteer) => volunteer.id === id)?.name ?? "Unavailable member").join(", ");
  const visitedParcelKeys = useMemo(() => parentZoneTouchedParcelKeys(data, territory.id), [data, territory.id]);
  const confirm = useConfirm();
  const save = async () => {
    if (!replacement || !canReplace) return;
    if (!await confirm({ title: `Replace ${target.name}?`, message: "Its assignment is cancelled. Past visits stay on record.", confirmLabel: "Replace" })) return;
    const input = { ...replacement };
    delete (input as Partial<WalkTargetDraft>).clientId;
    void action.run(() => onReplace(assignment.id, input, {
      assignedTeamId: assignment.assignedTeamId,
      assignedVolunteerId: assignment.assignedVolunteerId,
    }), onClose);
  };

  return <Modal title="Replace route" description="Draw the new route inside the same neighborhood. The old route stays in the walk’s history." onClose={action.busy ? () => undefined : onClose} wide>
    <div className="form-stack walk-replacement" aria-busy={action.busy}>
      <div className="walk-replacement-context"><span>Replacing</span><strong>{target.name}</strong><small>{target.parcels.length} homes · {assignmentStatusLabels[assignment.status]}</small></div>
      <WalkTargetPlanner parentTerritory={territory} eventId={outing.id} targets={targets} selectedTargetId={selectedTargetId} mapStyleUrl={data.preferences.mapStyleUrl} visitedParcelKeys={visitedParcelKeys} demo={data.sync.mode === "device_only"} onSelectedTargetChange={setSelectedTargetId} onChange={setTargets} />
      <div className="walk-replacement-context"><span>Team carries over</span><strong>{currentCrew || "Current team"}</strong><small>You can change the team afterward.</small></div>
      {targets.length > 1 && <p className="walk-ready-note">Draw just one new route.</p>}
      {replacement && !replacement.parcels.length && <p className="walk-ready-note">Include at least one home in the new route.</p>}
      {action.error && <p className="inline-error" role="alert">{action.error}</p>}
      <div className="modal-actions"><button type="button" className="button quiet" disabled={action.busy} onClick={onClose}>Keep current route</button><button type="button" className="button primary" disabled={action.busy || !canReplace} onClick={save}><Check size={16} /> {action.busy ? "Replacing…" : "Confirm replacement"}</button></div>
    </div>
  </Modal>;
}

function OutingEditor({ outing, churchTimezone, guides, onClose, onSave }: { outing?: OutreachEvent; churchTimezone: string; guides: ConversationGuide[]; onClose: () => void; onSave: (input: Omit<OutreachEvent, "id" | "churchId">) => Promise<unknown> }) {
  const [timezone, setTimezone] = useState(outing?.timezone ?? churchTimezone);
  const [name, setName] = useState(outing?.name ?? "");
  const [purpose, setPurpose] = useState(outing?.purpose ?? "");
  const [meetingPoint, setMeetingPoint] = useState(outing?.meetingPoint ?? "");
  const [leaderContact, setLeaderContact] = useState(outing?.leaderContact ?? "");
  const [guideId, setGuideId] = useState(outing?.guideId ?? "");
  const [start, setStart] = useState(outing ? localDateTimeValue(outing.startsAt, timezone) : calendarDaysFromNow(1, timezone) + "T09:00");
  const [end, setEnd] = useState(outing ? localDateTimeValue(outing.endsAt, timezone) : calendarDaysFromNow(1, timezone) + "T11:00");
  const action = useAsyncAction();
  return <Modal title="Edit walk" onClose={action.busy ? () => undefined : onClose} wide><form className="form-stack" onSubmit={(e) => { e.preventDefault(); void action.run(async () => onSave({ name, purpose, meetingPoint, leaderContact, timezone, guideId: guideId || undefined,
    startsAt: churchDateTimeToIso(start, timezone), endsAt: churchDateTimeToIso(end, timezone), status: outing?.status ?? "draft", debrief: outing?.debrief ?? "" })); }}>
    <label>Walk name<input required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} placeholder="Saturday neighborhood walk" /></label><label>Purpose<textarea maxLength={1000} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Listen to our neighbors and follow through on requested help." /></label>
    <div className="person-editor-grid"><label>Starts<input required type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label><label>Ends<input required type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label><label>Timezone<input required value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/Chicago" /></label><label>Meeting point<input maxLength={300} value={meetingPoint} onChange={(e) => setMeetingPoint(e.target.value)} /></label><label>Leader contact<input maxLength={254} value={leaderContact} onChange={(e) => setLeaderContact(e.target.value)} /></label><label>Conversation guide<select value={guideId} onChange={(e) => setGuideId(e.target.value)}><option value="">No guide assigned</option>{guides.filter((g) => g.scope === "church").map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label></div>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}<div className="modal-actions"><button type="button" className="button quiet" disabled={action.busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={action.busy}>{action.busy ? "Saving…" : "Save walk"}</button></div>
  </form></Modal>;
}

function RepeatOuting({ outing, churchTimezone, onClose, onSave }: { outing: OutreachEvent; churchTimezone: string; onClose: () => void; onSave: (start: string, end: string) => Promise<unknown> }) {
  const timezone = outing.timezone ?? churchTimezone;
  const [start, setStart] = useState(calendarDaysFromNow(7, timezone, new Date(outing.startsAt)) + "T09:00");
  const [end, setEnd] = useState(calendarDaysFromNow(7, timezone, new Date(outing.startsAt)) + "T11:00");
  const action = useAsyncAction();
  return <Modal title="Repeat this walk" description="Makes a new draft with the same details and neighborhood. Routes and teams start fresh." onClose={action.busy ? () => undefined : onClose}><form className="form-stack" onSubmit={(e) => { e.preventDefault(); void action.run(async () => onSave(churchDateTimeToIso(start, timezone), churchDateTimeToIso(end, timezone))); }}><p>Times use {timezone}. Draw fresh targets after creating the draft.</p><label>New start<input required type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label><label>New end<input required type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label>{action.error && <p role="alert" className="inline-error">{action.error}</p>}<button className="button primary" disabled={action.busy}>Create draft</button></form></Modal>;
}
