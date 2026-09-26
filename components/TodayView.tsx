"use client";
import { useState } from "react";
import { ChevronRight, HeartHandshake, Play } from "lucide-react";
import { calendarDate, calendarDaysFromNow, formatCalendarDate } from "../lib/calendar";
import { outcomeMeta, type NeighborWalkData, type OutreachEvent } from "../lib/domain";
import { homeWalk } from "../lib/home-walk";
import type { OutingParticipant, OutingResponse } from "../lib/outing-participants";
import { houseLabel } from "../lib/pin-counts";
import { elapsedLabel, personalHistory, todayWalkSummary } from "../lib/today-history";
import { relativeDueLabel } from "../lib/follow-up-groups";
import { useAsyncAction } from "../lib/use-async-action";
import { HistoryList, outcomeWord } from "./OutcomeGrid";
import { ListGroup, ListRow, TabTopBar } from "./ui";

/** Today: your walk (or an invitation) as the one offset card, then your
 * follow-ups and your own history for the day. */
export function TodayView({ data, activeVolunteerId, canManage, profileName, attention, syncLabel, onProfile, onSync, onFollowUps, onPerson, onOuting, onReviewSync, onPeople, onStart, onWalkResponse }: {
  data: NeighborWalkData; activeVolunteerId: string; canManage: boolean;
  profileName: string; attention: boolean; syncLabel?: string; onProfile: () => void; onSync: () => void;
  onFollowUps: (id?: string, scope?: "mine" | "unowned" | "declined") => void; onPerson: (id: string) => void;
  onOuting: (id?: string) => void; onReviewSync: () => void; onPeople: () => void;
  onStart: (id: string, territoryId: string, targetId?: string) => Promise<unknown>;
  onWalkResponse: (participant: OutingParticipant, response: OutingResponse) => Promise<unknown>;
}) {
  const responseAction = useAsyncAction();
  const startAction = useAsyncAction();
  const [justAnswered, setJustAnswered] = useState<string | null>(null);
  const timezone = data.church.timezone;
  const today = calendarDate(new Date(), timezone);
  const activeMembers = new Set(data.volunteers.filter((v) => v.active).map((v) => v.id));
  const open = data.followUps.filter((task) => task.status === "scheduled");
  const mine = open.filter((task) => task.assignedVolunteerId === activeVolunteerId && task.acceptance !== "declined").sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const weekEnd = calendarDaysFromNow(6, timezone);
  const thisWeek = mine.filter((task) => calendarDate(task.dueAt, timezone) <= weekEnd);
  const handoffs = data.residents.filter((person) => person.pendingOwnerId === activeVolunteerId);
  const unowned = open.filter((task) => !task.assignedVolunteerId || !activeMembers.has(task.assignedVolunteerId));
  const declined = open.filter((task) => task.acceptance === "declined");
  const waiting = data.residents.filter((person) => person.pendingOwnerId);
  const needsReview = (data.sync.commands?.filter((command) => command.state === "needs_review").length ?? 0) + Number(Boolean(data.sync.legacyRecoveryRequired));
  const { outing, resumable, responseOutings } = homeWalk(data, activeVolunteerId, canManage);
  const unanswered = responseOutings.filter(({ participant }) => participant.status === "invited");
  const answered = responseOutings.filter(({ participant, outing: invited }) => participant.status !== "invited" && invited.status !== "active");
  const liveWalk = outing?.status === "active" ? outing : undefined;
  const shownFollowUps = (thisWeek.length ? thisWeek : mine).slice(0, 3);
  const overdueCount = mine.filter((task) => calendarDate(task.dueAt, timezone) < today).length;
  const history = personalHistory(data, activeVolunteerId, new Date(), 8);
  const summary = outing ? todayWalkSummary(data, outing, resumable, activeVolunteerId) : undefined;
  const routeName = resumable?.targetId ? data.walkTargets.find((target) => target.id === resumable.targetId)?.name : undefined;
  const leaderAttention = canManage && (unowned.length > 0 || declined.length > 0 || waiting.length > 0 || Boolean(data.migrationIssues?.length));
  const format = (event: OutreachEvent, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...options, timeZone: event.timezone ?? timezone }).format(new Date(event.startsAt)).replace(",", "");
  const leaderOf = (event: OutreachEvent) => event.leaderContact?.split(" ")[0];
  // One offset card: a live walk, otherwise the first invitation, otherwise the next walk.
  const invitation = !liveWalk ? unanswered[0] : undefined;
  const answer = (participant: OutingParticipant, status: OutingResponse) => void responseAction.run(() => onWalkResponse(participant, status), () => setJustAnswered(participant.eventId));
  const church = data.church.name.replace(/ Church$/, "");

  return <section className="content-view today-view">
    <TabTopBar label={syncLabel ?? church} labelAriaLabel={`${data.church.name}${syncLabel ? `, ${syncLabel}` : ""}. Sync`} onLabel={onSync} name={profileName} attention={attention} onProfile={onProfile} />
    <header className="today-heading">
      <h1>Today</h1>
      <p className="mono-meta">{formatCalendarDate(today, { weekday: "long" })} · {formatCalendarDate(today, { month: "short", day: "numeric" })}</p>
    </header>

    {invitation ? <InvitationCard offset event={invitation.outing} format={format} leader={leaderOf(invitation.outing)} busy={responseAction.busy} onAnswer={(status) => answer(invitation.participant, status)} />
      : outing && summary ? <section className="today-walk offset-card" aria-labelledby="today-walk-title">
        <div className="today-walk-copy">
          <p className="mono-meta">{outing.status === "active" ? `Walking now${summary.minutes !== undefined ? ` · ${elapsedLabel(summary.minutes)}` : ""}` : `Next walk · ${format(outing, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}</p>
          <h2 id="today-walk-title">{routeName ?? outing.name}</h2>
          <p className="today-walk-sub">{[routeName ? outing.name : outing.meetingPoint?.split(",")[0], summary.partners.length ? `with ${summary.partners.join(" & ")}` : undefined].filter(Boolean).join(" · ")}</p>
          {summary.total ? summary.total <= 16
            ? <div className="today-walk-homes" role="img" aria-label={`${summary.touched} of ${summary.total} homes reached`}>{Array.from({ length: summary.total }, (_, index) => <i key={index} className={index < (summary.touched ?? 0) ? "done" : undefined} />)}</div>
            : <div className="today-walk-bar" role="img" aria-label={`${summary.touched} of ${summary.total} homes reached`}><i style={{ width: `${Math.round((summary.touched ?? 0) / summary.total * 100)}%` }} /></div>
            : null}
        </div>
        <button type="button" className="today-walk-action" aria-label={resumable ? "Resume walk" : "View walk"} disabled={startAction.busy} onClick={() => resumable ? void startAction.run(() => onStart(outing.id, resumable.territoryId, resumable.targetId)) : onOuting(outing.id)}>{resumable ? <Play size={20} fill="currentColor" aria-hidden="true" /> : <ChevronRight size={22} aria-hidden="true" />}</button>
        {startAction.error && <p role="alert" className="inline-error">{startAction.error}</p>}
      </section>
      : <div className="grouped-rows"><ListRow title="No walks planned yet" subtitle={canManage ? "Plan one when you’re ready." : "Your leader will invite you."} onClick={() => onOuting()} /></div>}

    {unanswered.filter((item) => item !== invitation).map(({ outing: event, participant }) => <InvitationCard key={event.id} event={event} format={format} leader={leaderOf(event)} busy={responseAction.busy} onAnswer={(status) => answer(participant, status)} />)}
    {answered.length > 0 && <div className="grouped-rows">{answered.map(({ outing: event, participant }) => <button type="button" key={event.id} className={`grouped-row reply-line${justAnswered === event.id ? " fresh" : ""}`} onClick={() => onOuting(event.id)}>
      <span className="grouped-row-text"><strong>{participant.status === "not_going" ? "You can’t make it" : participant.status === "checked_in" ? "You’re checked in" : "You’re in"} · {format(event, { weekday: "short", day: "numeric" })}</strong><small>{event.name}</small></span>
      <ChevronRight size={17} aria-hidden="true" />
    </button>)}</div>}
    {responseAction.error && <p role="alert" className="inline-error">{responseAction.error}</p>}

    <section className="today-section" aria-labelledby="today-followups">
      <div className="list-section-head"><h2 id="today-followups">Follow-ups</h2>{overdueCount ? <span className="mono-meta danger">{overdueCount} overdue</span> : thisWeek.length ? <span className="mono-meta">{thisWeek.length} this week</span> : null}</div>
      {shownFollowUps.length ? <div className="grouped-rows">{shownFollowUps.map((task) => {
        const person = data.residents.find((resident) => resident.id === task.residentId);
        const address = !task.residentId ? data.properties.find((property) => property.id === task.propertyId)?.address : undefined;
        const dueDate = calendarDate(task.dueAt, timezone);
        return <button type="button" key={task.id} className="grouped-row task-row" onClick={() => onFollowUps(task.id)}>
          <span className="task-circle" aria-hidden="true" />
          <span className="grouped-row-text"><strong>{person?.name ?? address ?? "Name not known"}</strong><small>{task.note || "Requested follow-up"}</small></span>
          <span className={`due-chip${dueDate < today ? " late" : ""}`}>{relativeDueLabel(dueDate, today)}</span>
        </button>;
      })}</div> : <p className="home-empty">Nothing due. New follow-ups show up here.</p>}
    </section>

    <section className="today-section" aria-labelledby="today-history">
      <div className="list-section-head"><h2 id="today-history">History</h2><span className="mono-meta">You · {history.length} today</span></div>
      {history.length
        ? <HistoryList timezone={timezone} stamp="time" label="Your history today" entries={history.map((entry) => {
          const visit = data.visits.find((item) => item.id === entry.id);
          const home = visit?.propertyId ? data.properties.find((item) => item.id === visit.propertyId) : undefined;
          return { id: entry.id, at: entry.recordedAt, color: outcomeMeta[entry.outcome].color, title: home ? `${outcomeWord[entry.outcome]} · ${houseLabel(home.address, home.unit)}` : entry.title, detail: entry.detail };
        })} />
        : <p className="home-empty">Your visits and conversations today show up here.</p>}
    </section>

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

/** A walk invitation, in the walk page's words: I'm in or Can't make it (TD1). */
function InvitationCard({ event, format, leader, offset = false, busy, onAnswer }: { event: OutreachEvent; format: (event: OutreachEvent, options: Intl.DateTimeFormatOptions) => string; leader?: string; offset?: boolean; busy: boolean; onAnswer: (status: OutingResponse) => void }) {
  return <section className={`today-invite${offset ? " offset-card porch" : ""}`} aria-label={`Invitation to ${event.name}`}>
    <p className="mono-meta">Invitation · {format(event, { weekday: "short", month: "short", day: "numeric" })} · {format(event, { hour: "numeric", minute: "2-digit" })}</p>
    <h2>{event.name}</h2>
    <p className="today-walk-sub">{[event.meetingPoint?.split(",")[0], leader ? `led by ${leader}` : undefined].filter(Boolean).join(" · ")}</p>
    <div className="wd-buttons"><button type="button" className="button-ink" disabled={busy} onClick={() => onAnswer("going")}>I’m in</button><button type="button" className="button-outline" disabled={busy} onClick={() => onAnswer("not_going")}>Can’t make it</button></div>
  </section>;
}
