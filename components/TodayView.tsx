"use client";
import { useState } from "react";
import { ChevronDown, HeartHandshake } from "lucide-react";
import { calendarDate, formatCalendarDate } from "../lib/calendar";
import type { NeighborWalkData, OutreachEvent } from "../lib/domain";
import { homeWalk } from "../lib/home-walk";
import type { OutingParticipant, OutingResponse } from "../lib/outing-participants";
import { useAsyncAction } from "../lib/use-async-action";
import { Badge, ListGroup, ListRow, ViewHeading } from "./ui";

function greetingFor(timezone: string, now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(now));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export function TodayView({ data, activeVolunteerId, canManage, onFollowUps, onPerson, onOuting, onReviewSync, onPeople, onStart, onWalkResponse }: {
  data: NeighborWalkData; activeVolunteerId: string; canManage: boolean;
  onFollowUps: (id?: string, scope?: "mine" | "unowned" | "declined") => void; onPerson: (id: string) => void;
  onOuting: (id?: string) => void; onReviewSync: () => void; onPeople: () => void;
  onStart: (id: string, territoryId: string, targetId?: string) => Promise<unknown>;
  onWalkResponse: (participant: OutingParticipant, response: OutingResponse) => Promise<unknown>;
}) {
  const responseAction = useAsyncAction();
  const startAction = useAsyncAction();
  const [changingResponseId, setChangingResponseId] = useState<string | null>(null);
  const [responseReviewOpen, setResponseReviewOpen] = useState(false);
  const timezone = data.church.timezone;
  const today = calendarDate(new Date(), timezone);
  const name = data.volunteers.find((v) => v.id === activeVolunteerId)?.name.split(" ")[0] ?? "friend";
  const activeMembers = new Set(data.volunteers.filter((v) => v.active).map((v) => v.id));
  const open = data.followUps.filter((task) => task.status === "scheduled");
  const mine = open.filter((task) => task.assignedVolunteerId === activeVolunteerId).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const due = mine.filter((task) => calendarDate(task.dueAt, timezone) <= today);
  const handoffs = data.residents.filter((person) => person.pendingOwnerId === activeVolunteerId);
  const unowned = open.filter((task) => !task.assignedVolunteerId || !activeMembers.has(task.assignedVolunteerId));
  const declined = open.filter((task) => task.acceptance === "declined");
  const waiting = data.residents.filter((person) => person.pendingOwnerId);
  const needsReview = (data.sync.commands?.filter((command) => command.state === "needs_review").length ?? 0) + Number(Boolean(data.sync.legacyRecoveryRequired));
  const { outing, resumable, responseOutings } = homeWalk(data, activeVolunteerId, canManage);
  const unansweredResponseOutings = responseOutings.filter(({ participant }) => participant.status === "invited");
  const answeredResponseOutings = responseOutings.filter(({ participant }) => participant.status !== "invited");
  const unansweredResponseCount = unansweredResponseOutings.length;
  const answeredResponseCount = answeredResponseOutings.length;
  const when = (event: OutreachEvent) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: event.timezone ?? timezone }).format(new Date(event.startsAt));
  const shownFollowUps = (due.length ? due : mine).slice(0, 3);
  const leaderAttention = canManage && (unowned.length > 0 || declined.length > 0 || waiting.length > 0 || Boolean(data.migrationIssues?.length));

  const invitationRows = (groups: typeof responseOutings) => groups.map(({ outing: invited, participant }) => {
    const hasResponse = participant.status !== "invited";
    const checkedIn = participant.status === "checked_in";
    const changing = changingResponseId === participant.id;
    const saveResponse = (status: OutingResponse) => {
      if (participant.status === status) {
        setChangingResponseId(null);
        return;
      }
      void responseAction.run(() => onWalkResponse(participant, status), () => {
        setChangingResponseId(null);
        if (!hasResponse && unansweredResponseCount === 1) setResponseReviewOpen(false);
      });
    };
    return <article className="home-invitation" key={invited.id} role="group" aria-label={`Your invitation for ${invited.name}`}>
      <div className="home-invitation-copy"><strong>{invited.name}</strong><span>{when(invited)}{invited.meetingPoint ? `, ${invited.meetingPoint}` : ""}</span></div>
      {hasResponse && !changing
        ? <div className="home-invitation-answer" role="status">
          <Badge tone={participant.status === "not_going" ? "neutral" : "tint"}>{checkedIn ? "Checked in" : participant.status === "going" ? "Going" : "Not going"}</Badge>
          {!checkedIn && <button type="button" className="text-button" disabled={responseAction.busy} onClick={() => setChangingResponseId(participant.id)}>Change</button>}
        </div>
        : <div className="home-invitation-actions">
          <button type="button" className="button primary small" aria-pressed={participant.status === "going"} disabled={responseAction.busy} onClick={() => saveResponse("going")}>Going</button>
          <button type="button" className="button quiet small" aria-pressed={participant.status === "not_going"} disabled={responseAction.busy} onClick={() => saveResponse("not_going")}>Can’t go</button>
          {hasResponse && <button type="button" className="text-button" disabled={responseAction.busy} onClick={() => setChangingResponseId(null)}>Cancel</button>}
        </div>}
    </article>;
  });

  return <section className="content-view today-view">
    <ViewHeading eyebrow={formatCalendarDate(today, { weekday: "long", month: "long", day: "numeric" })} title={`${greetingFor(timezone)}, ${name}`} />

    {outing
      ? <section className="home-hero" aria-labelledby="home-next-walk">
        <p className="home-hero-label">{outing.status === "active" ? "Happening now" : "Your next walk"}</p>
        <h2 id="home-next-walk">{outing.name}</h2>
        <p className="home-hero-meta">{when(outing)}{outing.meetingPoint && <><br />{outing.meetingPoint}</>}</p>
        <button className="button hero-action" disabled={startAction.busy} onClick={() => resumable ? void startAction.run(() => onStart(outing.id, resumable.territoryId, resumable.targetId)) : onOuting(outing.id)}>{resumable ? "Resume walk" : "View walk"}</button>
        {startAction.error && <p role="alert" className="inline-error">{startAction.error}</p>}
      </section>
      : <ListGroup label="Walks">
        <ListRow title="No walks planned yet" subtitle={canManage ? "Plan one when you’re ready." : "Your leader will invite you."} onClick={() => onOuting()} />
      </ListGroup>}

    {unansweredResponseCount > 0 && <ListGroup label={<span id="home-invitations">Walk invitations</span>} className="home-invitations">{invitationRows(unansweredResponseOutings)}</ListGroup>}
    {answeredResponseCount > 0 && <section className={`home-replies${responseReviewOpen ? " is-open" : ""}`} aria-label="Saved walk responses">
      <button type="button" className="home-replies-toggle" aria-expanded={responseReviewOpen} aria-controls="saved-walk-responses" aria-label={`Review ${answeredResponseCount} saved walk ${answeredResponseCount === 1 ? "response" : "responses"}`} onClick={() => { if (responseReviewOpen) setChangingResponseId(null); setResponseReviewOpen(!responseReviewOpen); }}><span>Your replies</span><small>{answeredResponseCount}</small><ChevronDown size={16} aria-hidden="true" /></button>
      {responseReviewOpen && <div className="list-group-rows" id="saved-walk-responses">{invitationRows(answeredResponseOutings)}</div>}
    </section>}
    {responseAction.error && <p role="alert" className="inline-error">{responseAction.error}</p>}

    <ListGroup label="Follow up">
      {shownFollowUps.map((task) => {
        const person = data.residents.find((resident) => resident.id === task.residentId);
        const address = !task.residentId ? data.properties.find((property) => property.id === task.propertyId)?.address : undefined;
        const dueDate = calendarDate(task.dueAt, timezone);
        const dueLabel = dueDate === today ? "Today" : formatCalendarDate(dueDate, { month: "short", day: "numeric" });
        return <ListRow key={task.id} title={person?.name ?? address ?? "Name not known"} subtitle={task.note || "Requested follow-up"} value={<Badge tone={dueDate <= today ? "accent" : "neutral"}>{dueLabel}</Badge>} onClick={() => onFollowUps(task.id)} />;
      })}
      {!shownFollowUps.length && <ListRow title="Nothing due" subtitle="New follow-ups will show up here." />}
      <ListRow className="list-row-link" title="All follow-ups" onClick={() => onFollowUps()} />
    </ListGroup>

    {handoffs.length > 0 && <ListGroup label="Asked to take over">
      {handoffs.map((person) => <ListRow key={person.id} icon={<HeartHandshake />} title={person.name || "Someone"} subtitle="Review before you accept" onClick={() => onPerson(person.id)} />)}
    </ListGroup>}

    {(needsReview > 0 || leaderAttention) && <ListGroup label="Needs your attention" footer={canManage && data.migrationIssues?.length ? "Some older records need review in More, Data & health." : undefined}>
      {canManage && unowned.length > 0 && <ListRow title="Follow-ups without an owner" value={unowned.length} onClick={() => onFollowUps(undefined, "unowned")} />}
      {canManage && declined.length > 0 && <ListRow title="Declined follow-ups" value={declined.length} onClick={() => onFollowUps(undefined, "declined")} />}
      {canManage && waiting.length > 0 && <ListRow title="Waiting on a handoff" value={waiting.length} onClick={onPeople} />}
      {needsReview > 0 && <ListRow title="Changes to review" value={needsReview} onClick={onReviewSync} />}
    </ListGroup>}

  </section>;
}
