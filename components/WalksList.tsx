"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import type { NeighborWalkData, OutreachEvent } from "../lib/domain";
import { walkDoors } from "../lib/pin-counts";
import { walkStatusLabels } from "../lib/status-labels";
import { rsvpCounts } from "../lib/walk-phase";
import { initials } from "./ui";

/** Walks: the switch first, then the live walk as the porch card, what's coming
 * up by date, Plan a walk (leaders) and a Past walks row. */
export function WalksList({ data, canManage, activeVolunteerId, viewSwitch, onSelect, onPlan }: {
  data: NeighborWalkData; canManage: boolean; activeVolunteerId: string; viewSwitch?: React.ReactNode;
  onSelect: (id: string) => void; onPlan: () => void;
}) {
  const [showPast, setShowPast] = useState(false);
  const byStart = [...data.events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const live = byStart.filter((event) => event.status === "active" && (canManage || data.outingParticipants.some((participant) => participant.eventId === event.id && participant.volunteerId === activeVolunteerId)));
  const visible = (event: OutreachEvent) => canManage || data.outingParticipants.some((participant) => participant.eventId === event.id && participant.volunteerId === activeVolunteerId);
  const upcoming = byStart.filter((event) => ["draft", "scheduled", "ready"].includes(event.status) && visible(event) && (canManage || event.status !== "draft"));
  const past = byStart.filter((event) => ["completed", "archived"].includes(event.status) && visible(event)).reverse();
  const zone = (event: OutreachEvent) => event.timezone ?? data.church.timezone;
  const format = (event: OutreachEvent, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone(event) }).format(new Date(event.startsAt));
  const routes = (event: OutreachEvent) => new Set([...(data.assignments ?? []).filter((assignment) => assignment.eventId === event.id && !["cancelled", "declined"].includes(assignment.status)).map((assignment) => assignment.targetId ?? assignment.id), ...data.walkTargets.filter((target) => target.eventId === event.id).map((target) => target.id)]).size;
  const myRoute = (event: OutreachEvent) => {
    const teams = new Set(data.teams.filter((team) => team.memberIds.includes(activeVolunteerId)).map((team) => team.id));
    const assignment = (data.assignments ?? []).find((item) => item.eventId === event.id && ["assigned", "accepted"].includes(item.status) && (item.assignedVolunteerId === activeVolunteerId || teams.has(item.assignedTeamId ?? "")));
    return assignment ? data.walkTargets.find((target) => target.id === assignment.targetId)?.name ?? data.territories.find((territory) => territory.id === assignment.territoryId)?.name : undefined;
  };

  if (showPast) return <section className="walks-home" aria-labelledby="past-walks-title">
    <div className="screen-top"><button type="button" className="round-button float" aria-label="Back to walks" onClick={() => setShowPast(false)}><ChevronLeft size={22} aria-hidden="true" /></button><span className="mono-meta">{past.length} {past.length === 1 ? "walk" : "walks"}</span></div>
    <h1 className="screen-title" id="past-walks-title">Past walks</h1>
    <div className="grouped-rows">{past.map((event) => <WalkRow key={event.id} event={event} format={format} meta={`${format(event, { month: "short", year: "numeric" })} · ${walkDoors(data, event.id)} doors`} chip={<span className="status-chip">{walkStatusLabels[event.status].label}</span>} onOpen={() => onSelect(event.id)} />)}</div>
    {!past.length && <p className="home-empty">Walks you finish show up here.</p>}
  </section>;

  return <section className="walks-home" aria-label="Walks">
    {viewSwitch}
    {live.map((event) => {
      const walkers = data.outingParticipants.filter((participant) => participant.eventId === event.id && participant.status === "checked_in").map((participant) => data.volunteers.find((volunteer) => volunteer.id === participant.volunteerId)?.name).filter((name): name is string => Boolean(name));
      const route = canManage ? undefined : myRoute(event);
      return <button key={event.id} type="button" className="walks-live offset-card porch" onClick={() => onSelect(event.id)}>
        <span className="mono-meta walks-live-kicker"><i aria-hidden="true" />{canManage || !route ? `Live now · ${walkDoors(data, event.id)} doors` : `Live now · you’re on ${route}`}</span>
        <strong className="walks-live-title">{event.name}</strong>
        {canManage && <span className="walks-live-meta">{[`Started ${format(event, { hour: "numeric", minute: "2-digit" })}`, event.meetingPoint?.split(",")[0]].filter(Boolean).join(" · ")}</span>}
        {canManage ? <span className="walks-live-foot">
          {walkers.length > 0 ? <span className="face-stack" aria-label={`${walkers.length} walking`}>{walkers.slice(0, 3).map((name) => <span key={name} aria-hidden="true">{initials(name)}</span>)}{walkers.length > 3 && <span className="more" aria-hidden="true">+{walkers.length - 3}</span>}</span> : <span />}
          <span className="mono-meta hedge">Open ›</span>
        </span> : <span className="mono-meta hedge walks-live-open">Open ›</span>}
      </button>;
    })}
    {upcoming.length > 0 && <section className="walks-group" aria-labelledby="walks-upcoming">
      <h2 id="walks-upcoming" className="mono-meta walks-group-label">Coming up</h2>
      <div className="grouped-rows">{upcoming.map((event) => {
        const counts = rsvpCounts(data.outingParticipants, event.id);
        const mine = data.outingParticipants.find((participant) => participant.eventId === event.id && participant.volunteerId === activeVolunteerId);
        const routeCount = routes(event);
        const meta = canManage
          ? [format(event, { hour: "numeric", minute: "2-digit" }), event.status === "draft" ? "draft" : routeCount ? `${routeCount} ${routeCount === 1 ? "route" : "routes"}` : "gathering", event.status !== "draft" && counts.invited ? `${counts.going} going` : undefined].filter(Boolean).join(" · ")
          : [format(event, { hour: "numeric", minute: "2-digit" }), event.meetingPoint?.split(",")[0]].filter(Boolean).join(" · ");
        const reply = !canManage && mine?.status === "invited";
        return <WalkRow key={event.id} event={event} format={format} meta={meta} chip={<span className={`status-chip${reply ? " reply" : ""}`}>{reply ? "Reply" : walkStatusLabels[event.status].label}</span>} onOpen={() => onSelect(event.id)} />;
      })}</div>
    </section>}
    {canManage && <button type="button" className="dash-row" onClick={onPlan}><Plus size={20} aria-hidden="true" /><strong>Plan a walk</strong></button>}
    {!live.length && !upcoming.length && !canManage && <p className="home-empty">Walks you’re invited to show up here.</p>}
    <div className="grouped-rows"><button type="button" className="grouped-row" onClick={() => setShowPast(true)}><span className="grouped-row-text"><strong>Past walks</strong></span><span className="mono-meta">{past.length}</span><ChevronRight size={17} aria-hidden="true" /></button></div>
  </section>;
}

function WalkRow({ event, format, meta, chip, onOpen }: { event: OutreachEvent; format: (event: OutreachEvent, options: Intl.DateTimeFormatOptions) => string; meta: string; chip: React.ReactNode; onOpen: () => void }) {
  return <button type="button" className="grouped-row walk-row" onClick={onOpen}>
    <span className="date-box" aria-hidden="true"><small>{format(event, { weekday: "short" })}</small><b>{format(event, { day: "numeric" })}</b></span>
    <span className="grouped-row-text"><strong>{event.name}</strong><small>{meta}</small></span>
    {chip}
  </button>;
}
