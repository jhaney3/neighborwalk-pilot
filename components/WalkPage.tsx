"use client";

import { CalendarDays, Check, ChevronLeft, DoorOpen, Ellipsis, MapPin, MessageCircle, Phone, Search, UserRound, Users, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { calendarDate, calendarDaysFromNow, churchDateTimeToIso, formatCalendarDate, localDateTimeValue } from "../lib/calendar";
import { outcomeMeta, type NeighborWalkData, type OutreachEvent } from "../lib/domain";
import { reviewedEncounter } from "../lib/encounter-history";
import { activeFollowUpOwner } from "../lib/follow-up-filters";
import type { OutingParticipant, OutingResponse } from "../lib/outing-participants";
import { houseLabel, routeVisitsTonight, walkDoors } from "../lib/pin-counts";
import { useAsyncAction } from "../lib/use-async-action";
import { targetCrewMemberIds } from "../lib/walk-crews";
import { isCommunityOuting, rsvpCounts, walkPhase, walkPhases } from "../lib/walk-phase";
import { addLocalMinutes, clockLabel, localMinutesBetween } from "../lib/walk-schedule";
import type { SaveTarget, WalkTarget } from "../lib/walk-targets";
import { walkStatusLabels } from "../lib/status-labels";
import { walkCalendarFile } from "../lib/walk-calendar";
import { shareFile } from "../mobile/share-file";
import { shareText } from "../mobile/share-text";
import { selectionTick } from "../mobile/haptics";
import { ConversationLauncher } from "./ConversationLogger";
import type { EncounterInput } from "../lib/encounters";
import type { ResidentInput } from "../lib/domain";
import { HistoryList, outcomeWord } from "./OutcomeGrid";
import { ActionSheet, Sheet } from "./Sheet";
import { initials, useConfirm } from "./ui";
import { WalkWhenFields } from "./WalkWhen";
import { WalkWrapUp } from "./WalkWrapUp";
import { CheckInScreen, type WalkCrews } from "./WalkCrewBoard";

type Assignment = NonNullable<NeighborWalkData["assignments"]>[number];

export type WalkPageProps = {
  data: NeighborWalkData;
  outing: OutreachEvent;
  canManage: boolean;
  activeVolunteerId: string;
  onBack: () => void;
  /** Reopen Plan a walk at a step (0 Where, 1 When, 2 Who). */
  onEditSetup: (step: number) => void;
  onSelect: (id: string) => void;
  onStart: (id: string, territoryId: string, targetId?: string) => Promise<unknown>;
  onSave: (input: Omit<OutreachEvent, "id" | "churchId">, id?: string) => Promise<string>;
  onRepeat: (id: string, startsAt: string, endsAt: string) => Promise<string>;
  onAssign: (input: Omit<Assignment, "id" | "churchId">, id?: string) => Promise<string>;
  onSaveRoster: (eventId: string, memberIds: string[]) => Promise<void>;
  onSaveCrews: (eventId: string, crews: WalkCrews, attendingIds: string[]) => Promise<void>;
  onSaveTarget: SaveTarget;
  onReplaceRoute: (assignmentId: string) => void;
  onRecordEncounter: (input: EncounterInput) => Promise<unknown>;
  onCreatePerson: (input: ResidentInput) => Promise<string>;
  onUpdatePerson?: (residentId: string, input: ResidentInput) => Promise<unknown>;
  onRespond?: (participant: OutingParticipant, response: OutingResponse) => Promise<unknown>;
  onAssignFollowUp: (followUpId: string, volunteerId: string) => Promise<unknown>;
  onNotice?: (message: string) => void;
};

const channelIcon = { visit: DoorOpen, call: Phone, text: MessageCircle, email: UserRound, other: UserRound } as const;
const channelWord = { visit: "Visit", call: "Call", text: "Text", email: "Contact", other: "Follow up" } as const;

function durationWords(minutes: number) {
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** One walk: status and date, the phase rail, the one next thing to do as the
 * offset card, then routes and team activity. Everything else is behind ⋯. */
export function WalkPage(props: WalkPageProps) {
  const { data, outing, canManage, activeVolunteerId, onBack, onSave, onStart } = props;
  const action = useAsyncAction();
  const confirm = useConfirm();
  const headingId = useId();
  const [sheet, setSheet] = useState<"options" | "edit" | "repeat" | "invitations" | "when" | "name" | "checkin" | "route" | "end" | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const timezone = outing.timezone ?? data.church.timezone;
  const format = (iso: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...options, timeZone: timezone }).format(new Date(iso));
  const shortDay = format(outing.startsAt, { weekday: "short", month: "short", day: "numeric" }).replace(",", "");
  const timeRange = `${format(outing.startsAt, { hour: "numeric", minute: "2-digit" }).replace(/ [AP]M$/, "")}–${format(outing.endsAt, { hour: "numeric", minute: "2-digit" }).replace(/ [AP]M$/, "")}`;
  const participants = data.outingParticipants.filter((participant) => participant.eventId === outing.id);
  const me = participants.find((participant) => participant.volunteerId === activeVolunteerId);
  const counts = rsvpCounts(participants, outing.id);
  const phase = walkPhase(outing, participants);
  const phaseIndex = phase ? walkPhases.findIndex((item) => item.key === phase) : -1;
  const closed = ["completed", "archived", "cancelled"].includes(outing.status);
  const gathering = isCommunityOuting(outing.id, data.assignments ?? [], data.walkTargets);
  const assignments = (data.assignments ?? []).filter((assignment) => assignment.eventId === outing.id);
  const targets = data.walkTargets.filter((target) => target.eventId === outing.id);
  const openTargets = targets.filter((target) => !target.finishedAt);
  const myTeams = new Set(data.teams.filter((team) => team.memberIds.includes(activeVolunteerId)).map((team) => team.id));
  const mine = (assignment: Assignment) => assignment.assignedVolunteerId === activeVolunteerId || myTeams.has(assignment.assignedTeamId ?? "");
  const live = (assignment: Assignment) => ["assigned", "accepted"].includes(assignment.status) && (!assignment.targetId || targets.some((target) => target.id === assignment.targetId && !target.finishedAt));
  const checkedIn = me?.status === "checked_in";
  const fieldAssignments = assignments.filter((assignment) => live(assignment) && (canManage || (mine(assignment) && (assignment.status === "accepted" || checkedIn))));
  const [routeId, setRouteId] = useState<string>();
  const route = fieldAssignments.find((assignment) => assignment.id === routeId) ?? fieldAssignments.find(mine) ?? fieldAssignments[0];
  const routeName = (assignment?: Assignment) => assignment ? data.walkTargets.find((target) => target.id === assignment.targetId)?.name ?? data.territories.find((territory) => territory.id === assignment.territoryId)?.name ?? "Route" : "Route";
  const routeColor = (assignment?: Assignment) => (assignment && (data.walkTargets.find((target) => target.id === assignment.targetId)?.color ?? data.territories.find((territory) => territory.id === assignment.territoryId)?.color)) ?? "var(--tint)";
  const encounters = data.visits.map(reviewedEncounter).filter((visit) => !visit.voided && visit.eventId === outing.id);
  const doors = walkDoors(data, outing.id);
  const talked = encounters.filter((visit) => visit.outcome === "conversation").length;
  const openTasks = data.followUps.filter((task) => task.eventId === outing.id && task.status === "scheduled");
  const unowned = openTasks.filter((task) => !activeFollowUpOwner(task, data));
  const volunteerName = (id: string) => data.volunteers.find((volunteer) => volunteer.id === id)?.name ?? "Unavailable member";
  const minutes = Math.max(0, Math.floor((clock - Date.parse(outing.startsAt)) / 60000));
  const walkedMinutes = Math.max(0, Math.round((Date.parse(outing.endsAt) - Date.parse(outing.startsAt)) / 60000));
  const walkers = new Set(encounters.map((visit) => visit.volunteerId)).size || counts.here;
  const transition = (status: OutreachEvent["status"]) => action.run(() => onSave({ ...outing, status }, outing.id));
  const open = (assignment: Assignment) => void action.run(() => onStart(outing.id, assignment.territoryId, assignment.targetId));
  const nudge = () => void action.run(async () => {
    const weekday = format(outing.startsAt, { weekday: "long" });
    const message = `Are you coming to ${outing.name} on ${weekday} at ${format(outing.startsAt, { hour: "numeric", minute: "2-digit" })}?${outing.meetingPoint ? ` We meet at ${outing.meetingPoint}.` : ""} Reply in NeighborWalk under Today.`;
    if (await shareText("Walk reminder", message) === "copied") props.onNotice?.("Reminder copied. Paste it in your group text.");
  });
  const addToCalendar = () => void action.run(() => shareFile(new Blob([walkCalendarFile(outing, data.church.name)], { type: "text/calendar" }), `${outing.name.replace(/[^\w -]+/g, "").trim() || "walk"}.ics`));
  const respond = (status: OutingResponse) => me && props.onRespond && void action.run(() => props.onRespond!(me, status));
  const [meetPlace, ...meetRest] = (outing.meetingPoint ?? "").split(",").map((part) => part.trim()).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  const leader = outing.leaderContact;

  /* ---------- the next-action card ---------- */
  let card: React.ReactNode = null;
  if (canManage) {
    if (outing.status === "draft" || outing.status === "scheduled") card = <section className="wd-next offset-card" aria-labelledby={`${headingId}-next`}>
      <p className="mono-meta" id={`${headingId}-next`}>{walkStatusLabels[outing.status].label} · plan</p>
      <p className="wd-next-copy">Finish the plan, then send invites. They show on each person’s Today.</p>
      <div className="wd-buttons"><button type="button" className="button-outline" disabled={action.busy} onClick={() => props.onEditSetup(0)}>Resume setup</button><button type="button" className="button-ink" disabled={action.busy} onClick={() => void transition("ready")}>Send invites</button></div>
    </section>;
    else if (outing.status === "ready") card = <section className="wd-next offset-card" aria-labelledby={`${headingId}-next`}>
      <p className="mono-meta" id={`${headingId}-next`}>{counts.invited} invited · {phase === "checkin" ? `${counts.here} here` : "replies"}</p>
      <div className="wd-nums">
        <div><strong className="hedge">{counts.going}</strong><span className="mono-meta">Going</span></div>
        <div><strong className="porch">{counts.notGoing}</strong><span className="mono-meta">Can’t go</span></div>
        <div><strong>{counts.noReply}</strong><span className="mono-meta">No reply</span></div>
      </div>
      <div className="wd-buttons">
        {counts.noReply > 0 && <button type="button" className="button-outline" disabled={action.busy} onClick={nudge}>Nudge {counts.noReply}</button>}
        {gathering ? <button type="button" className="button-ink" disabled={action.busy} onClick={() => void transition("active")}>Start walk</button>
          : <button type="button" className="button-ink" disabled={action.busy || !openTargets.length} onClick={() => setSheet("checkin")}>Start check-in</button>}
      </div>
    </section>;
    else if (outing.status === "active") card = <section className="wd-next offset-card" aria-labelledby={`${headingId}-next`}>
      <p className="mono-meta" id={`${headingId}-next`}>Walking now · {durationWords(minutes)}</p>
      <div className="wd-nums">
        <div><strong className="hedge">{doors}</strong><span className="mono-meta">Doors</span></div>
        <div><strong>{talked}</strong><span className="mono-meta">Talked</span></div>
        <div><strong>{openTasks.length}</strong><span className="mono-meta">Follow-ups</span></div>
      </div>
      {!gathering && route && <div className="wd-route-pick"><i style={{ background: routeColor(route) }} aria-hidden="true" /><span><span className="mono-meta">Your route</span><strong>{routeName(route)}</strong></span>{fieldAssignments.length > 1 && <button type="button" className="mono-meta hedge" onClick={() => setSheet("route")}>Change</button>}</div>}
      {gathering && <ConversationLauncher data={data} outingId={outing.id} onSave={props.onRecordEncounter} onCreatePerson={props.onCreatePerson} onUpdatePerson={props.onUpdatePerson} />}
      <div className="wd-buttons">
        {!gathering && <button type="button" className="button-ink" disabled={action.busy || !route} onClick={() => route && open(route)}>Open route</button>}
        <button type="button" className="button-outline" disabled={action.busy} onClick={() => setSheet("end")}>End walk</button>
      </div>
    </section>;
    else if (outing.status === "completed") card = <section className="wd-next offset-card" aria-labelledby={`${headingId}-next`}>
      <p className="mono-meta" id={`${headingId}-next`}>Final · {walkers} {walkers === 1 ? "walker" : "walkers"} · {durationWords(walkedMinutes)}</p>
      <div className="wd-nums">
        <div><strong className="hedge">{doors}</strong><span className="mono-meta">Doors</span></div>
        <div><strong>{talked}</strong><span className="mono-meta">Talked</span></div>
        <div><strong>{data.followUps.filter((task) => task.eventId === outing.id && task.status !== "cancelled").length}</strong><span className="mono-meta">Follow-ups</span></div>
      </div>
    </section>;
  } else if (!closed) {
    const myAssignment = assignments.find((assignment) => mine(assignment) && live(assignment));
    const myTarget = myAssignment?.targetId ? data.walkTargets.find((target) => target.id === myAssignment.targetId) : undefined;
    const crew = myTarget ? targetCrewMemberIds(data, myTarget.id).filter((id) => id !== activeVolunteerId).map(volunteerName) : [];
    const myDoors = myAssignment ? routeVisitsTonight(data, outing, myAssignment).length : 0;
    if (!me) card = <section className="wd-next offset-card porch"><p className="wd-next-copy">You’re not on this walk’s list. Ask your leader if you’d like to join.</p></section>;
    else if (outing.status === "active" && myAssignment) card = <section className="wd-next offset-card porch" aria-labelledby={`${headingId}-next`}>
      <p className="mono-meta" id={`${headingId}-next`}>Your route</p>
      <h2 className="wd-next-title">{routeName(myAssignment)}</h2>
      <p className="wd-next-sub">{[crew.length ? `with ${crew.join(" & ")}` : undefined, `${myDoors} ${myDoors === 1 ? "door" : "doors"} so far`].filter(Boolean).join(" · ")}</p>
      <button type="button" className="button-ink wide" disabled={action.busy || !fieldAssignments.length} onClick={() => fieldAssignments[0] && open(fieldAssignments[0])}>Open my route</button>
    </section>;
    else if (me.status === "invited") card = <section className="wd-next offset-card porch" aria-labelledby={`${headingId}-next`}>
      <h2 className="wd-next-title" id={`${headingId}-next`}>Are you coming?</h2>
      <div className="wd-buttons"><button type="button" className="button-ink" disabled={action.busy} onClick={() => respond("going")}>I’m in</button><button type="button" className="button-outline" disabled={action.busy} onClick={() => respond("not_going")}>Can’t make it</button></div>
    </section>;
    else if (me.status === "not_going") card = <section className="wd-next offset-card porch" aria-labelledby={`${headingId}-next`}>
      <h2 className="wd-next-title" id={`${headingId}-next`}>You can’t make it</h2>
      <div className="wd-buttons"><button type="button" className="button-outline" disabled={action.busy} onClick={() => respond("going")}>I can come after all</button></div>
    </section>;
    else card = <section className="wd-next offset-card porch" aria-labelledby={`${headingId}-next`}>
      <h2 className="wd-next-title" id={`${headingId}-next`}>{outing.status === "active" ? "Your leader will give you a route" : "You’re in"}</h2>
      <div className="wd-buttons"><button type="button" className="button-outline" disabled={action.busy} onClick={addToCalendar}>Add to calendar</button><button type="button" className="button-outline" disabled={action.busy} onClick={() => respond("not_going")}>Can’t make it</button></div>
    </section>;
  }

  /* ---------- routes and activity ---------- */
  const crewItems = [
    ...targets.map((target) => {
      const targetAssignments = assignments.filter((assignment) => assignment.targetId === target.id);
      const assignment = targetAssignments.find((item) => ["assigned", "accepted"].includes(item.status)) ?? targetAssignments.find((item) => item.status === "completed") ?? targetAssignments[targetAssignments.length - 1];
      return { key: target.id, target, assignment };
    }),
    ...assignments.filter((assignment) => !assignment.targetId && !["cancelled", "declined"].includes(assignment.status)).map((assignment) => ({ key: assignment.id, target: undefined as WalkTarget | undefined, assignment })),
  ];
  const beforeWalk = phase === "plan" || phase === "invite" || phase === "checkin";
  const streetCount = targets.reduce((sum, target) => sum + (target.streetSelection?.streetNames.length ?? 0), 0);
  const pinsOnRoute = (target: WalkTarget) => {
    const keys = new Set(target.parcels.map((parcel) => `${parcel.countyFips}:${parcel.gislink}`));
    return data.properties.filter((property) => property.parcel && keys.has(`${property.parcel.countyFips}:${property.parcel.gislink}`) && property.currentOutcome !== "unvisited").length;
  };
  const activity = [...encounters].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).slice(0, 12);

  return <article className="walk-page" aria-labelledby={headingId}>
    <div className="screen-top">
      <button type="button" className="round-button float" aria-label="All walks" onClick={onBack}><ChevronLeft size={22} aria-hidden="true" /></button>
      {(canManage || (!closed && me)) && <button type="button" className="round-button float" aria-label="Walk options" onClick={() => setSheet("options")}><Ellipsis size={20} aria-hidden="true" /></button>}
    </div>
    <p className="mono-meta wd-kicker">{canManage || closed || outing.status === "active" ? `${walkStatusLabels[outing.status].label} · ${shortDay}` : `${shortDay} · ${format(outing.startsAt, { hour: "numeric", minute: "2-digit" })}`}</p>
    <h1 className="wd-title" id={headingId}>{outing.name}</h1>
    {canManage ? <p className="mono-meta wd-meta">{[timeRange, meetPlace].filter(Boolean).join(" · ")}</p>
      : !closed && outing.status !== "active" && <p className="wd-led">{[leader ? `Led by ${leader.split(" ")[0]}` : undefined, data.church.name.replace(/ Church$/, "")].filter(Boolean).join(" · ")}</p>}
    {phase && (canManage || outing.status === "active" || closed) && <ol className="wd-rail" aria-label="Walk progress">{walkPhases.map((item, index) => <li key={item.key} className={index < phaseIndex ? "done" : index === phaseIndex ? "now" : undefined} aria-current={index === phaseIndex ? "step" : undefined}>{item.label}</li>)}</ol>}
    {card}
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}

    {!canManage && !closed && me && <div className="grouped-rows outline">
      {outing.meetingPoint && <div className="grouped-row"><MapPin size={18} aria-hidden="true" /><span className="grouped-row-text"><strong>{meetPlace}</strong><small>{[...meetRest, outing.status === "active" ? `back by ${format(outing.endsAt, { hour: "numeric", minute: "2-digit" })}` : `meet ${format(new Date(Date.parse(outing.startsAt) - 10 * 60000).toISOString(), { hour: "numeric", minute: "2-digit" })}`].join(" · ")}</small></span></div>}
      {outing.status === "active" && leader ? <div className="grouped-row"><Phone size={18} aria-hidden="true" /><span className="grouped-row-text"><strong>{leader.split(" ")[0]} · leader</strong><small>{leader.includes(" at ") ? `At ${leader.split(" at ").slice(1).join(" at ")}` : "Your walk leader"}</small></span></div>
        : outing.status !== "active" && <div className="grouped-row"><Users size={18} aria-hidden="true" /><span className="grouped-row-text"><strong>Teams form at check-in</strong><small>You’ll get a route and a partner</small></span></div>}
    </div>}
    {!canManage && !closed && me && outing.status !== "active" && counts.going > 0 && <section className="wd-section" aria-labelledby={`${headingId}-going`}>
      <div className="list-section-head"><h2 id={`${headingId}-going`}>Who’s going</h2><span className="mono-meta">{counts.going}</span></div>
      <span className="face-stack large">{participants.filter((participant) => ["going", "checked_in"].includes(participant.status)).slice(0, 5).map((participant) => <span key={participant.id} title={volunteerName(participant.volunteerId)}>{initials(volunteerName(participant.volunteerId))}</span>)}{counts.going > 5 && <span className="more">+{counts.going - 5}</span>}</span>
    </section>}

    {canManage && outing.status === "completed" && unowned.length > 0 && <section className="wd-section wrap-up" aria-labelledby={`${headingId}-owners`}>
      <div className="list-section-head"><h2 id={`${headingId}-owners`}>Who’s following up?</h2><span className="mono-meta">{unowned.length} open</span></div>
      <div className="wrap-up-owners"><ul>{unowned.map((task) => {
        const person = data.residents.find((resident) => resident.id === task.residentId);
        const home = data.properties.find((property) => property.id === task.propertyId);
        const channel = task.channel ?? "visit";
        const Channel = channelIcon[channel];
        const title = person?.name ?? (home ? houseLabel(home.address, home.unit) : "Name not known");
        return <li key={task.id}><Channel size={17} aria-hidden="true" /><span className="wrap-up-owner-copy"><strong>{title}</strong><small>{channelWord[channel]} · {task.note ?? formatCalendarDate(calendarDate(task.dueAt, timezone), { weekday: "short", day: "numeric" })}</small></span>
          <label className="assign-chip"><span aria-hidden="true">Assign</span><select aria-label={`Assign ${title}`} value="" disabled={action.busy} onChange={(event) => { const id = event.target.value; if (id) void action.run(() => props.onAssignFollowUp(task.id, id)); }}><option value="" disabled>Assign</option>{data.volunteers.filter((volunteer) => volunteer.active).map((volunteer) => <option key={volunteer.id} value={volunteer.id}>{volunteer.name}</option>)}</select></label></li>;
      })}</ul></div>
    </section>}
    {canManage && outing.status === "completed" && <NotesForNextTime outing={outing} onSave={(debrief) => onSave({ ...outing, debrief }, outing.id)} />}

    {canManage && !gathering && crewItems.length > 0 && <section className="wd-section" aria-labelledby={`${headingId}-routes`}>
      <div className="list-section-head"><h2 id={`${headingId}-routes`}>Routes</h2>
        {outing.status === "active" && openTargets.length > 0 ? <button type="button" className="mono-meta hedge" onClick={() => setSheet("checkin")}>Edit teams</button>
          : <span className="mono-meta">{[crewItems.length, streetCount ? `${streetCount} streets` : undefined].filter(Boolean).join(" · ")}</span>}
      </div>
      <div className="grouped-rows">{crewItems.map(({ key, target, assignment }) => {
        const members = assignment?.assignedVolunteerId ? [assignment.assignedVolunteerId] : data.teams.find((team) => team.id === assignment?.assignedTeamId)?.memberIds ?? [];
        const routeDoors = assignment ? routeVisitsTonight(data, outing, assignment).length : 0;
        const pins = target ? pinsOnRoute(target) : 0;
        const streets = target?.streetSelection?.streetNames ?? [];
        const subtitle = beforeWalk ? (streets.length ? `${streets.slice(0, 3).join(" · ")}${streets.length > 3 ? ` · ${streets.length} streets` : ""}` : members.length ? members.map(volunteerName).join(", ") : "Teams form at check-in") : members.length ? members.map(volunteerName).join(", ") : "No team";
        const chip = beforeWalk ? (pins ? `${pins} pins` : "New") : `${routeDoors} ${routeDoors === 1 ? "door" : "doors"}`;
        const manageable = Boolean(assignment && !closed && !["cancelled", "completed", "declined"].includes(assignment.status));
        return <button type="button" key={key} className="grouped-row" disabled={!manageable} onClick={() => { if (assignment) { setRouteId(assignment.id); setSheet("route"); } }}>
          <i className="color-bar" style={{ background: target?.color ?? routeColor(assignment) }} aria-hidden="true" />
          <span className="grouped-row-text"><strong>{target?.name ?? routeName(assignment)}</strong><small>{subtitle}</small></span>
          <span className="status-chip">{chip}</span>
        </button>;
      })}</div>
    </section>}

    {canManage && (phase === "walk" || phase === "wrap") && activity.length > 0 && <section className="wd-section" aria-labelledby={`${headingId}-activity`}>
      <div className="list-section-head"><h2 id={`${headingId}-activity`}>Team activity</h2><span className="mono-meta">{encounters.length}</span></div>
      <HistoryList timezone={timezone} stamp="time" label="Team activity" entries={activity.map((visit) => {
        const home = visit.propertyId ? data.properties.find((property) => property.id === visit.propertyId) : undefined;
        return { id: visit.id, at: visit.recordedAt, color: outcomeMeta[visit.outcome].color, title: `${outcomeWord[visit.outcome]} · ${home ? houseLabel(home.address, home.unit) : visit.placeLabel ?? "Away from a door"}`, detail: volunteerName(visit.volunteerId) };
      })} />
    </section>}

    {sheet === "options" && <ActionSheet closeLabel="Close" onClose={() => setSheet(null)} actions={canManage ? [
      ...(!closed ? [{ label: "Edit walk", onSelect: () => setSheet(outing.status === "draft" ? null : "edit") }] : []),
      { label: "Repeat walk", onSelect: () => setSheet("repeat") },
      ...(outing.status === "completed" ? [{ label: "Archive walk", onSelect: () => { setSheet(null); void transition("archived"); } }] : []),
      ...(!closed ? [{ label: "Cancel walk", destructive: true, onSelect: () => { setSheet(null); void confirm({ title: "Cancel this walk?", message: "Everyone invited sees it’s cancelled. Conversations and follow-ups stay.", confirmLabel: "Cancel walk", cancelLabel: "Keep walk", destructive: true }).then((yes) => { if (yes) void transition("cancelled"); }); } }] : []),
    ].map((item) => item.label === "Edit walk" && outing.status === "draft" ? { ...item, onSelect: () => { setSheet(null); props.onEditSetup(0); } } : item) : [
      { label: "Add to calendar", onSelect: () => { setSheet(null); addToCalendar(); } },
      ...(me && me.status !== "not_going" && outing.status !== "active" ? [{ label: "Can’t make it", destructive: true, onSelect: () => { setSheet(null); respond("not_going"); } }] : []),
    ]} />}
    {sheet === "route" && <RouteSheet data={data} assignments={fieldAssignments} current={route} selected={routeId} canManage={canManage} routeName={routeName} onPick={(id) => { setRouteId(id); setSheet(null); }} onReplace={(id) => { setSheet(null); props.onReplaceRoute(id); }} onCancelRoute={(assignment) => { setSheet(null); void confirm({ title: `Cancel ${routeName(assignment)}?`, message: "Its team is freed up. Visits already logged stay.", confirmLabel: "Cancel route", destructive: true }).then((yes) => { if (yes) void action.run(() => props.onAssign({ ...assignment, status: "cancelled" }, assignment.id)); }); }} onClose={() => setSheet(null)} />}
    {sheet === "edit" && <EditWalk data={data} outing={outing} targets={targets} onChange={(step) => setSheet(step === "when" ? "when" : step === "who" ? "invitations" : step === "name" ? "name" : null)} onWhere={() => { setSheet(null); props.onEditSetup(0); }} onClose={() => setSheet(null)} />}
    {sheet === "when" && <WhenSheet data={data} outing={outing} onClose={() => setSheet("edit")} onSave={async (patch) => { await onSave({ ...outing, ...patch }, outing.id); setSheet("edit"); }} />}
    {sheet === "name" && <NameSheet outing={outing} onClose={() => setSheet("edit")} onSave={async (name) => { await onSave({ ...outing, name }, outing.id); setSheet("edit"); }} />}
    {sheet === "invitations" && <InvitationsSheet data={data} outing={outing} onClose={() => setSheet("edit")} onSave={async (ids) => { await props.onSaveRoster(outing.id, ids); setSheet("edit"); }} />}
    {sheet === "repeat" && <RepeatSheet data={data} outing={outing} targets={targets} onClose={() => setSheet(null)} onCreate={async (day, invite, copyRoutes) => {
      const zone = outing.timezone ?? data.church.timezone;
      const start = localDateTimeValue(outing.startsAt, zone);
      const length = localMinutesBetween(start, localDateTimeValue(outing.endsAt, zone));
      const newStart = `${day}T${start.slice(11, 16)}`;
      const id = await props.onRepeat(outing.id, churchDateTimeToIso(newStart, zone), churchDateTimeToIso(addLocalMinutes(newStart, length), zone));
      if (invite) await props.onSaveRoster(id, participants.map((participant) => participant.volunteerId));
      if (copyRoutes) for (const target of targets.filter((item) => item.parcels.length)) await props.onSaveTarget({ eventId: id, territoryId: target.territoryId, name: target.name, color: target.color, selectionKind: target.selectionKind, geometry: target.geometry, streetSelection: target.streetSelection, parcels: target.parcels });
      setSheet(null); props.onSelect(id);
    }} />}
    {sheet === "checkin" && <CheckInScreen data={data} outing={outing} targets={openTargets} onClose={() => setSheet(null)} onSave={props.onSaveCrews} onStart={outing.status === "ready" ? () => onSave({ ...outing, status: "active" }, outing.id) : undefined} />}
    {sheet === "end" && <WalkWrapUp scope="walk" data={data} outing={outing} routeName={outing.name} canManage={canManage} onFinish={async () => { await onSave({ ...outing, status: "completed" }, outing.id); setSheet(null); }} onAssign={props.onAssignFollowUp} onClose={() => setSheet(null)} />}
  </article>;
}

/** Notes for next time: saved when you leave the field; shown again when the walk is copied. */
function NotesForNextTime({ outing, onSave }: { outing: OutreachEvent; onSave: (debrief: string) => Promise<unknown> }) {
  const [value, setValue] = useState(outing.debrief ?? "");
  const [saved, setSaved] = useState(outing.debrief ?? "");
  const [justSaved, setJustSaved] = useState(false);
  const action = useAsyncAction();
  return <section className="wd-section" aria-labelledby="notes-next-time">
    <div className="list-section-head"><h2 id="notes-next-time">Notes for next time</h2><span className="mono-meta" role="status">{action.busy ? "Saving…" : justSaved && value === saved ? "Saved" : ""}</span></div>
    <textarea className="notes-field" aria-labelledby="notes-next-time" rows={3} maxLength={2000} value={value} placeholder="What should the next team know? Where to start, what to bring." onChange={(event) => { setValue(event.target.value); setJustSaved(false); }} onBlur={() => { if (value !== saved) void action.run(() => onSave(value.trim()), () => { setSaved(value); setJustSaved(true); }); }} />
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
  </section>;
}

function RouteSheet({ data, assignments, current, selected, canManage, routeName, onPick, onReplace, onCancelRoute, onClose }: {
  data: NeighborWalkData; assignments: Assignment[]; current?: Assignment; selected?: string; canManage: boolean; routeName: (assignment?: Assignment) => string;
  onPick: (id: string) => void; onReplace: (id: string) => void; onCancelRoute: (assignment: Assignment) => void; onClose: () => void;
}) {
  const chosen = assignments.find((assignment) => assignment.id === selected) ?? current;
  const target = chosen?.targetId ? data.walkTargets.find((item) => item.id === chosen.targetId) : undefined;
  return <ActionSheet title={chosen ? routeName(chosen) : "Your route"} closeLabel="Close" onClose={onClose} actions={[
    ...assignments.filter((assignment) => assignment.id !== current?.id).map((assignment) => ({ label: `Walk ${routeName(assignment)}`, onSelect: () => onPick(assignment.id) })),
    ...(canManage && chosen && target?.rosterState === "frozen" ? [{ label: "Replace route", onSelect: () => onReplace(chosen.id) }] : []),
    ...(canManage && chosen ? [{ label: "Cancel route", destructive: true, onSelect: () => onCancelRoute(chosen) }] : []),
  ]} />;
}

/** Edit walk (WK6): a summary of the Plan-a-walk steps; each Change opens that step. */
function EditWalk({ data, outing, targets, onChange, onWhere, onClose }: { data: NeighborWalkData; outing: OutreachEvent; targets: WalkTarget[]; onChange: (step: "when" | "who" | "name") => void; onWhere: () => void; onClose: () => void }) {
  const timezone = outing.timezone ?? data.church.timezone;
  const format = (iso: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...options, timeZone: timezone }).format(new Date(iso));
  const counts = rsvpCounts(data.outingParticipants, outing.id);
  const territory = data.territories.find((item) => item.id === (targets[0]?.territoryId ?? data.assignments?.find((assignment) => assignment.eventId === outing.id)?.territoryId));
  const locked = !["draft", "scheduled"].includes(outing.status);
  const range = `${format(outing.startsAt, { hour: "numeric", minute: "2-digit" }).replace(/ [AP]M$/, "")}–${format(outing.endsAt, { hour: "numeric", minute: "2-digit" }).replace(/ [AP]M$/, "")}`;
  return <div className="screen-page overlay edit-walk" role="dialog" aria-modal="true" aria-labelledby="edit-walk-title">
    <div className="screen-top"><button type="button" className="round-button float" aria-label="Close" onClick={onClose}><X size={19} aria-hidden="true" /></button><span className="mono-meta">Edit walk</span><span className="screen-top-spacer" /></div>
    <h1 className="screen-title wd-title" id="edit-walk-title">{outing.name}</h1>
    <div className="grouped-rows">
      <div className="grouped-row summary-row"><span className="grouped-row-text"><span className="mono-meta">Where</span><strong>{territory ? `${territory.name} · ${targets.length} ${targets.length === 1 ? "route" : "routes"}` : "A gathering"}</strong>{locked && <small>Routes are set once invites go out</small>}</span>{!locked && <button type="button" className="mono-meta hedge" onClick={onWhere}>Change</button>}</div>
      <div className="grouped-row summary-row"><span className="grouped-row-text"><span className="mono-meta">When</span><strong>{format(outing.startsAt, { weekday: "short", month: "short", day: "numeric" }).replace(",", "")} · {range}</strong>{outing.meetingPoint && <small>{outing.meetingPoint.split(",")[0]}</small>}</span><button type="button" className="mono-meta hedge" onClick={() => onChange("when")}>Change</button></div>
      <div className="grouped-row summary-row"><span className="grouped-row-text"><span className="mono-meta">Who</span><strong>{counts.invited} invited · {counts.going} going</strong></span><button type="button" className="mono-meta hedge" onClick={() => onChange("who")}>Change</button></div>
      <div className="grouped-row summary-row"><span className="grouped-row-text"><span className="mono-meta">Name</span><strong>{outing.name}</strong></span><button type="button" className="mono-meta hedge" onClick={() => onChange("name")}>Change</button></div>
    </div>
    <button type="button" className="walk-save" onClick={onClose}>Done</button>
  </div>;
}

function WhenSheet({ data, outing, onClose, onSave }: { data: NeighborWalkData; outing: OutreachEvent; onClose: () => void; onSave: (patch: Pick<OutreachEvent, "startsAt" | "endsAt" | "meetingPoint">) => Promise<unknown> }) {
  const timezone = outing.timezone ?? data.church.timezone;
  const start = localDateTimeValue(outing.startsAt, timezone);
  const [day, setDay] = useState(start.slice(0, 10));
  const [time, setTime] = useState(start.slice(11, 16));
  const [duration, setDuration] = useState(Math.max(30, localMinutesBetween(start, localDateTimeValue(outing.endsAt, timezone))));
  const [meetingPoint, setMeetingPoint] = useState(outing.meetingPoint ?? "");
  const action = useAsyncAction();
  const titleId = useId();
  return <Sheet className="plain-sheet" modal labelledBy={titleId} onDismiss={action.busy ? () => undefined : onClose}>
    <div className="home-sheet-head"><h2 className="pin-title" id={titleId}>When?</h2><button type="button" className="round-line" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
    <WalkWhenFields timezone={timezone} day={day} time={time} duration={duration} meetingPoint={meetingPoint} onDay={setDay} onTime={setTime} onDuration={setDuration} onMeetingPoint={setMeetingPoint} />
    <p className="mono-meta">{formatCalendarDate(day, { weekday: "short", month: "short", day: "numeric" })} · {clockLabel(time)}–{clockLabel(addLocalMinutes(`${day}T${time}`, duration).slice(11, 16))}</p>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save" disabled={action.busy} onClick={() => void action.run(() => onSave({ startsAt: churchDateTimeToIso(`${day}T${time}`, timezone), endsAt: churchDateTimeToIso(addLocalMinutes(`${day}T${time}`, duration), timezone), meetingPoint: meetingPoint.trim() }))}>{action.busy ? "Saving…" : "Save"}</button>
  </Sheet>;
}

function NameSheet({ outing, onClose, onSave }: { outing: OutreachEvent; onClose: () => void; onSave: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState(outing.name);
  const action = useAsyncAction();
  const titleId = useId();
  return <Sheet className="plain-sheet" modal labelledBy={titleId} onDismiss={action.busy ? () => undefined : onClose}>
    <div className="home-sheet-head"><h2 className="pin-title" id={titleId}>Name</h2><button type="button" className="round-line" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
    <label className="pin-field"><span className="mono-meta">Walk name</span><input value={name} maxLength={160} enterKeyHint="done" onChange={(event) => setName(event.target.value)} /></label>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save" disabled={action.busy || !name.trim()} onClick={() => void action.run(() => onSave(name.trim()))}>{action.busy ? "Saving…" : "Save"}</button>
  </Sheet>;
}

/** Who's invited? (WK8): search, saved team pills, then check rows with each reply. */
export function InvitationsSheet({ data, outing, onClose, onSave }: { data: NeighborWalkData; outing?: OutreachEvent; onClose: () => void; onSave: (memberIds: string[]) => Promise<unknown> }) {
  const [ids, setIds] = useState<string[]>(() => data.outingParticipants.filter((participant) => participant.eventId === outing?.id).map((participant) => participant.volunteerId));
  const action = useAsyncAction();
  const titleId = useId();
  return <Sheet className="plain-sheet invitations-sheet" modal detent="large" labelledBy={titleId} onDismiss={action.busy ? () => undefined : onClose}>
    <div className="home-sheet-head"><h2 className="pin-title" id={titleId}>Who’s invited?</h2><button type="button" className="round-line" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
    <InviteRoster data={data} eventId={outing?.id} selectedIds={ids} onChange={setIds} />
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save" disabled={action.busy} onClick={() => void action.run(() => onSave(ids))}>{action.busy ? "Saving…" : "Save"}</button>
  </Sheet>;
}

const replyWord = { invited: "No reply", going: "Going", not_going: "Can’t go", checked_in: "Here" } as const;

/** Search, saved team pills, and check rows with each person's reply in mono. */
export function InviteRoster({ data, eventId, selectedIds, onChange, search = true }: { data: NeighborWalkData; eventId?: string; selectedIds: string[]; onChange: (ids: string[]) => void; search?: boolean }) {
  const [query, setQuery] = useState("");
  const people = data.volunteers.filter((volunteer) => volunteer.active);
  const selected = new Set(selectedIds);
  const replies = new Map(data.outingParticipants.filter((participant) => participant.eventId === eventId).map((participant) => [participant.volunteerId, participant.status]));
  const crewTeams = new Set((data.assignments ?? []).filter((assignment) => assignment.targetId && assignment.assignedTeamId).map((assignment) => assignment.assignedTeamId));
  const savedTeams = data.teams.filter((team) => team.status !== "finished" && !crewTeams.has(team.id) && team.memberIds.some((id) => people.some((person) => person.id === id)));
  const teamOn = (memberIds: string[]) => memberIds.filter((id) => people.some((person) => person.id === id)).every((id) => selected.has(id));
  const toggleTeam = (memberIds: string[]) => { selectionTick(); onChange(teamOn(memberIds) ? selectedIds.filter((id) => !memberIds.includes(id) || replies.get(id) === "checked_in") : [...new Set([...selectedIds, ...memberIds.filter((id) => people.some((person) => person.id === id))])]); };
  const needle = query.trim().toLowerCase();
  const shown = people.filter((person) => !needle || person.name.toLowerCase().includes(needle));
  const going = selectedIds.filter((id) => ["going", "checked_in"].includes(replies.get(id) ?? "")).length;
  return <div className="invite-roster">
    {search && <label className="search-box"><Search size={17} aria-hidden="true" /><span className="visually-hidden">Find someone</span><input type="search" value={query} enterKeyHint="search" placeholder="Find someone" onChange={(event) => setQuery(event.target.value)} /></label>}
    {savedTeams.length > 0 && <div className="walk-field"><span className="mono-meta">Saved teams</span><div className="walk-chips" role="group" aria-label="Saved teams">{savedTeams.map((team) => {
      const count = team.memberIds.filter((id) => people.some((person) => person.id === id)).length;
      const on = teamOn(team.memberIds);
      return <button type="button" key={team.id} aria-pressed={on} onClick={() => toggleTeam(team.memberIds)}>{on && <Check size={14} aria-hidden="true" />}{team.name} · {count}</button>;
    })}</div></div>}
    <p className="mono-meta roster-count">{selectedIds.length} invited{eventId && !search ? "" : eventId ? ` · ${going} going` : ""}{!search && <> · <button type="button" className="mono-meta hedge" onClick={() => { selectionTick(); onChange(people.map((person) => person.id)); }}>Invite everyone</button></>}</p>
    <div className="grouped-rows" role="group" aria-label="People">{shown.map((person) => {
      const on = selected.has(person.id);
      const reply = replies.get(person.id);
      const here = reply === "checked_in";
      return <button type="button" key={person.id} className="grouped-row check-row" role="checkbox" aria-checked={on} disabled={here} onClick={() => { selectionTick(); onChange(on ? selectedIds.filter((id) => id !== person.id) : [...selectedIds, person.id]); }}>
        <span className={`check-square${on ? " on" : ""}`} aria-hidden="true">{on && <Check size={15} strokeWidth={3} />}</span>
        <span className="grouped-row-text"><strong>{person.name}</strong></span>
        {on && reply && <span className="mono-meta">{replyWord[reply]}</span>}
      </button>;
    })}</div>
  </div>;
}

/** Repeat this walk (WK7): pick the day; time and length carry over; copy people and routes. */
function RepeatSheet({ data, outing, targets, onClose, onCreate }: { data: NeighborWalkData; outing: OutreachEvent; targets: WalkTarget[]; onClose: () => void; onCreate: (day: string, invite: boolean, copyRoutes: boolean) => Promise<unknown> }) {
  const timezone = outing.timezone ?? data.church.timezone;
  const weekday = new Date(`${calendarDate(outing.startsAt, timezone)}T12:00:00Z`).getUTCDay();
  const today = calendarDaysFromNow(0, timezone);
  const todayWeekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const first = ((weekday - todayWeekday + 7) % 7) || 7;
  const days = [first, first + 7, first + 14].map((offset) => calendarDaysFromNow(offset, timezone));
  const [day, setDay] = useState(days[0]);
  const [picking, setPicking] = useState(false);
  const people = data.outingParticipants.filter((participant) => participant.eventId === outing.id).length;
  const routes = targets.filter((target) => target.parcels.length);
  const area = data.territories.find((territory) => territory.id === routes[0]?.territoryId);
  const [invite, setInvite] = useState(people > 0);
  const [copyRoutes, setCopyRoutes] = useState(routes.length > 0);
  const action = useAsyncAction();
  const titleId = useId();
  return <Sheet className="plain-sheet" modal labelledBy={titleId} onDismiss={action.busy ? () => undefined : onClose}>
    <h2 className="pin-title" id={titleId}>Repeat this walk</h2>
    <p className="pin-source">Same place, time and meeting point</p>
    <div className="walk-field"><span className="mono-meta">New day</span>
      <div className="day-cards" role="group" aria-label="New day">
        {days.map((date) => <button type="button" key={date} aria-pressed={!picking && day === date} aria-label={formatCalendarDate(date, { weekday: "long", month: "long", day: "numeric" })} onClick={() => { selectionTick(); setPicking(false); setDay(date); }}><small>{formatCalendarDate(date, { weekday: "short" })}</small><b>{formatCalendarDate(date, { day: "numeric" })}</b></button>)}
        <button type="button" className="icon-card" aria-pressed={picking} aria-label="Pick another day" onClick={() => setPicking(true)}><CalendarDays size={20} aria-hidden="true" /></button>
      </div>
      {picking && <input type="date" aria-label="New day" value={day} min={today} onChange={(event) => { if (event.target.value) setDay(event.target.value); }} />}
    </div>
    <div className="grouped-rows">
      <div className="grouped-row"><span className="grouped-row-text" id={`${titleId}-invite`}><strong>Invite the same people</strong><small>{people} {people === 1 ? "person" : "people"}</small></span><input type="checkbox" role="switch" aria-labelledby={`${titleId}-invite`} checked={invite} disabled={!people} onChange={(event) => setInvite(event.target.checked)} /></div>
      <div className="grouped-row"><span className="grouped-row-text" id={`${titleId}-routes`}><strong>Copy routes</strong><small>{routes.length ? `${routes.length} ${routes.length === 1 ? "route" : "routes"} in ${area?.name ?? "this neighborhood"}` : "No routes to copy"}</small></span><input type="checkbox" role="switch" aria-labelledby={`${titleId}-routes`} checked={copyRoutes} disabled={!routes.length} onChange={(event) => setCopyRoutes(event.target.checked)} /></div>
    </div>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save" disabled={action.busy} onClick={() => void action.run(() => onCreate(day, invite, copyRoutes))}>{action.busy ? "Creating…" : "Create draft"}</button>
  </Sheet>;
}
