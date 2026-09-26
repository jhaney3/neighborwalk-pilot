"use client";

import { ChevronLeft, DoorOpen, MessageCircle, Phone, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { calendarDate, formatCalendarDate } from "../lib/calendar";
import type { NeighborWalkData, OutreachEvent } from "../lib/domain";
import { reviewedEncounter } from "../lib/encounter-history";
import { activeFollowUpOwner } from "../lib/follow-up-filters";
import { houseLabel } from "../lib/pin-counts";
import { indexCurrentRecords } from "../lib/record-aliases";
import { useAsyncAction } from "../lib/use-async-action";
import { initials } from "./ui";

const channelIcon = { visit: DoorOpen, call: Phone, text: MessageCircle, email: UserRound, other: UserRound } as const;
const channelWord = { visit: "Visit", call: "Call", text: "Text", email: "Contact", other: "Follow up" } as const;

type ReviewedVisit = ReturnType<typeof reviewedEncounter>;

/** Ending a route (or, for a leader, the whole walk) is a hand-off: the big
 * number, three counts, then who owns each follow-up it created. */
export function WalkWrapUp({ scope = "route", data, outing, routeName, visits: routeVisits, canManage, onFinish, onAssign, onClose }: {
  /** A walker's route, or the whole walk when a leader ends it for everyone. */
  scope?: "route" | "walk";
  data: NeighborWalkData;
  outing: OutreachEvent;
  routeName: string;
  /** Tonight's visits on the route; the whole walk uses every visit on it. */
  visits?: ReviewedVisit[];
  canManage: boolean;
  onFinish: () => Promise<unknown>;
  onAssign: (followUpId: string, volunteerId: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const action = useAsyncAction();
  const [openedAt] = useState(() => Date.now());
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => { back.current?.focus({ preventScroll: true }); }, []);
  const timezone = outing.timezone ?? data.church.timezone;
  const visits = routeVisits ?? data.visits.map(reviewedEncounter).filter((visit) => !visit.voided && visit.eventId === outing.id);
  const latestPerHome = new Map<string, ReviewedVisit>();
  for (const visit of visits) if (visit.propertyId && (!latestPerHome.has(visit.propertyId) || visit.recordedAt > latestPerHome.get(visit.propertyId)!.recordedAt)) latestPerHome.set(visit.propertyId, visit);
  const doors = [...latestPerHome.values()];
  const count = (outcome: string) => doors.filter((visit) => visit.outcome === outcome).length;
  const visitIds = new Set(visits.map((visit) => visit.id));
  const followUps = data.followUps.filter((task) => task.status === "scheduled" && (task.sourceVisitId ? visitIds.has(task.sourceVisitId) : scope === "walk" && task.eventId === outing.id));
  const people = indexCurrentRecords(data.residents);
  const places = indexCurrentRecords(data.properties);
  const unowned = followUps.filter((task) => !activeFollowUpOwner(task, data)).length;
  // The walk crew comes first in the picker, then everyone else.
  const crewIds = new Set([
    ...data.outingParticipants.filter((participant) => participant.eventId === outing.id && participant.status === "checked_in").map((participant) => participant.volunteerId),
    ...visits.map((visit) => visit.volunteerId),
  ]);
  const members = data.volunteers.filter((volunteer) => volunteer.active);
  const crew = members.filter((member) => crewIds.has(member.id));
  const others = members.filter((member) => !crewIds.has(member.id));
  const minutes = Math.max(0, Math.round((openedAt - Date.parse(outing.startsAt)) / 60000));
  const stamp = [formatCalendarDate(calendarDate(new Date(openedAt), timezone), { weekday: "short", month: "short", day: "numeric" }).replace(",", ""),
    outing.status === "active" && minutes > 0 && minutes < 24 * 60 ? (minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`) : undefined].filter(Boolean).join(" · ");
  const big = scope === "route" ? doors.length : new Set(visits.map((visit) => visit.propertyId).filter(Boolean)).size;

  return <div className="wrap-up screen-page overlay" role="dialog" aria-modal="true" aria-labelledby="wrap-up-number">
    <div className="screen-top">
      <button type="button" ref={back} className="round-button float" aria-label={scope === "walk" ? "Close without ending the walk" : "Back to the map"} disabled={action.busy} onClick={onClose}>{scope === "walk" ? <X size={19} aria-hidden="true" /> : <ChevronLeft size={22} aria-hidden="true" />}</button>
      <span className="mono-meta">{stamp}</span>
    </div>
    <p className="mono-meta wrap-up-kicker">{routeName} · done</p>
    <div className="wrap-up-hero" id="wrap-up-number"><strong>{big}</strong><span>{scope === "route" ? <>{big === 1 ? "door" : "doors"}<br />tonight</> : <>{big === 1 ? "home" : "homes"}<br />visited</>}</span></div>
    <div className="wrap-up-stats">
      <div><strong style={{ color: "var(--o-talk)" }}>{count("conversation")}</strong><span className="mono-meta">Talked</span></div>
      <div><strong style={{ color: "var(--o-no)" }}>{count("no_answer")}</strong><span className="mono-meta">No answer</span></div>
      <div><strong style={{ color: "var(--o-fu)" }}>{count("follow_up")}</strong><span className="mono-meta">Come back</span></div>
    </div>

    <section className="wrap-up-owners" aria-labelledby="wrap-up-owners-title">
      <h2 id="wrap-up-owners-title">Who’s following up?</h2>
      {followUps.length ? <ul>{followUps.map((task) => {
        const person = people.get(task.residentId ?? "");
        const home = places.get(task.propertyId ?? "");
        const owner = activeFollowUpOwner(task, data);
        const channel = task.channel ?? "visit";
        const Channel = channelIcon[channel];
        const title = [person?.name, home ? houseLabel(home.address, home.unit) : undefined].filter(Boolean).join(" · ") || "Name not known";
        const when = formatCalendarDate(calendarDate(task.dueAt, timezone), { weekday: "short", day: "numeric" });
        return <li key={task.id}>
          <Channel size={17} aria-hidden="true" />
          <span className="wrap-up-owner-copy"><strong>{title}</strong><small>{[channelWord[channel], task.note && !person ? task.note : when].join(" · ")}</small></span>
          {owner ? <span className="fu-owner" title={owner.name} aria-label={`Owner: ${owner.name}`}>{initials(owner.name)}</span>
            : canManage ? <label className="assign-chip"><span aria-hidden="true">Assign</span><select aria-label={`Assign ${title}`} value="" disabled={action.busy} onChange={(event) => { const id = event.target.value; if (id) void action.save(() => onAssign(task.id, id)); }}><option value="" disabled>Assign</option>{crew.length > 0 && <optgroup label="On this walk">{crew.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</optgroup>}<optgroup label={crew.length ? "Everyone else" : "Church members"}>{others.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</optgroup></select></label>
            : <span className="mono-meta">Open</span>}
        </li>;
      })}</ul> : <p className="wrap-up-empty">No follow-ups from this {scope === "walk" ? "walk" : "route"}.</p>}
      {unowned > 0 && <p className="mono-meta wrap-up-note">{unowned} unassigned · {canManage ? "goes to the Open queue" : "a leader will place it"}</p>}
    </section>

    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save" disabled={action.busy} onClick={() => void action.save(onFinish)}>{action.busy ? "Finishing…" : scope === "walk" ? "Finish walk" : "Finish route"}</button>
  </div>;
}
