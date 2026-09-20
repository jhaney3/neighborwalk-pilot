"use client";
import { useState } from "react";
import { ArrowRight, CalendarClock, CheckCircle2, ChevronDown, CircleX, HeartHandshake, MapPinned } from "lucide-react";
import { calendarDate, formatCalendarDate } from "../lib/calendar";
import type { NeighborWalkData } from "../lib/domain";
import { homeWalk } from "../lib/home-walk";
import type { OutingParticipant, OutingResponse } from "../lib/outing-participants";
import { useAsyncAction } from "../lib/use-async-action";
import { ViewHeading } from "./ui";

export function TodayView({ data, activeVolunteerId, canManage, onFollowUps, onPerson, onOuting, onReviewSync, onPeople, onViewMap, onStart, onWalkResponse, additionalAction }: {
  data: NeighborWalkData; activeVolunteerId: string; canManage: boolean;
  onFollowUps: (id?: string, scope?: "mine" | "unowned" | "declined") => void; onPerson: (id: string) => void;
  onOuting: (id?: string) => void; onReviewSync: () => void; onPeople: () => void;
  onViewMap: () => void; onStart: (id: string, territoryId: string, targetId?: string) => Promise<unknown>;
  onWalkResponse: (participant: OutingParticipant, response: OutingResponse) => Promise<unknown>;
  additionalAction?: React.ReactNode;
}) {
  const responseAction = useAsyncAction();
  const startAction = useAsyncAction();
  const [changingResponseId, setChangingResponseId] = useState<string | null>(null);
  const [responseReviewOpen, setResponseReviewOpen] = useState(false);
  const today = calendarDate(new Date(), data.church.timezone);
  const name = data.volunteers.find((v) => v.id === activeVolunteerId)?.name.split(" ")[0] ?? "friend";
  const activeMembers = new Set(data.volunteers.filter((v) => v.active).map((v) => v.id));
  const open = data.followUps.filter((task) => task.status === "scheduled");
  const mine = open.filter((task) => task.assignedVolunteerId === activeVolunteerId).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const due = mine.filter((task) => calendarDate(task.dueAt, data.church.timezone) <= today);
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
  const walkFirst = Boolean(outing);
  const responseCards = (groups: typeof responseOutings) => <div className="home-walk-response-list">{groups.map(({ outing: responseOuting, participant }) => <article className="home-walk-response" key={responseOuting.id}>
    <div className="home-walk-response-heading"><strong>{responseOuting.name}</strong><span>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: responseOuting.timezone ?? data.church.timezone }).format(new Date(responseOuting.startsAt))}{responseOuting.meetingPoint ? ` · ${responseOuting.meetingPoint}` : ""}</span></div>
    {(() => {
      const hasResponse = participant.status !== "invited";
      const checkedIn = participant.status === "checked_in";
      const changingResponse = changingResponseId === participant.id;
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
      return <div className={`home-walk-response-choice${hasResponse ? ` is-${participant.status}` : ""}${changingResponse ? " is-changing" : ""}`} role="group" aria-label={`Your invitation for ${responseOuting.name}`}>
        <div className="home-walk-response-copy"><strong>Outing invitation</strong>{hasResponse && !changingResponse
          ? <div className="home-walk-response-confirmation" role="status">{participant.status === "not_going" ? <CircleX size={20} aria-hidden="true" /> : <CheckCircle2 size={20} aria-hidden="true" />}<span>{checkedIn ? "You’re checked in." : participant.status === "going" ? "You’re going." : "You’re not going."}</span></div>
          : <span>{hasResponse ? "Choose a new response, or keep the one you have." : "Please choose a response."}</span>}
        </div>
        {hasResponse && !changingResponse
          ? !checkedIn && <button type="button" className="button quiet home-walk-change-response" disabled={responseAction.busy} onClick={() => setChangingResponseId(participant.id)}>Change response</button>
          : <div className="home-walk-response-actions">
            <button type="button" className="button quiet" aria-pressed={participant.status === "going"} disabled={responseAction.busy} onClick={() => saveResponse("going")}>I can join</button>
            <button type="button" className="button quiet" aria-pressed={participant.status === "not_going"} disabled={responseAction.busy} onClick={() => saveResponse("not_going")}>I can’t make it</button>
            {hasResponse && <button type="button" className="home-walk-response-cancel" disabled={responseAction.busy} onClick={() => setChangingResponseId(null)}>Cancel</button>}
          </div>}
      </div>;
    })()}
  </article>)}</div>;
  return <section className="content-view today-view">
    <ViewHeading eyebrow={formatCalendarDate(today, { weekday: "long", month: "long", day: "numeric" })} title={"Hello, " + name + "."} aside={canManage && <button type="button" className="button quiet" onClick={onViewMap}><MapPinned size={16} aria-hidden="true" /> View map</button>} />
    {unansweredResponseOutings.length > 0 && <section className="today-card home-walk-invitations">
      <span className="eyebrow"><MapPinned size={16} /> Your walk responses</span>
      <h2>Can you join?</h2>
      <p>Let your leader know for each walk.</p>
      {responseCards(unansweredResponseOutings)}
    </section>}
    {answeredResponseOutings.length > 0 && <section className={`home-walk-response-review${responseReviewOpen ? " is-open" : ""}`} aria-label="Saved walk responses">
      <button type="button" className="home-walk-response-review-toggle" aria-expanded={responseReviewOpen} aria-controls="saved-walk-responses" aria-label={`Review ${answeredResponseCount} saved walk ${answeredResponseCount === 1 ? "response" : "responses"}`} onClick={() => { if (responseReviewOpen) setChangingResponseId(null); setResponseReviewOpen(!responseReviewOpen); }}><span>Review walk responses</span><small>{answeredResponseCount} saved</small><ChevronDown size={16} aria-hidden="true" /></button>
      {responseReviewOpen && <div className="home-walk-response-review-body" id="saved-walk-responses">{responseCards(answeredResponseOutings)}</div>}
    </section>}
    {responseAction.error && <p role="alert" className="inline-error home-walk-response-error">{responseAction.error}</p>}
    <div className="today-grid">
      <section className={walkFirst ? "today-card today-priority" : "today-card"}>
        <span className="eyebrow"><MapPinned size={16} /> Your next walk</span>
        <h2>{outing?.name ?? "No walk planned for you yet"}</h2>
        {outing ? <><p>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: outing.timezone ?? data.church.timezone }).format(new Date(outing.startsAt))}</p>{outing.meetingPoint && <p>{outing.meetingPoint}</p>}<button className="button primary" disabled={startAction.busy} onClick={() => resumable ? void startAction.run(() => onStart(outing.id, resumable.territoryId, resumable.targetId)) : onOuting(outing.id)}>{resumable ? "Resume walk" : "View walk details"}<ArrowRight size={16} /></button></>
          : <><p>{canManage ? "Choose when, where, and who. We’ll guide you through it." : "Your leader will share your meeting details and where to begin."}</p><button className="button quiet" onClick={() => onOuting()}>View walks</button></>}
        {startAction.error && <p role="alert" className="inline-error">{startAction.error}</p>}
      </section>
      <section className={!walkFirst ? "today-card today-priority" : "today-card"}>
        <span className="eyebrow">People to follow up with</span><h2>{due.length ? due.length + (due.length === 1 ? " follow-up needs" : " follow-ups need") + " your attention" : "You’re clear for today"}</h2>
        <p>{due.length ? "A small next step can make a difference." : mine.length ? "Here’s what’s coming up." : "Requested follow-ups will appear here and in People."}</p>
        <ul>{(due.length ? due : mine).slice(0, 3).map((task) => <li key={task.id}><button onClick={() => onFollowUps(task.id)}><CalendarClock size={20} /><span><strong>{data.residents.find((person) => person.id === task.residentId)?.name ?? "Name not known"}</strong><small>{!task.residentId && data.properties.find((property) => property.id === task.propertyId)?.address}{!task.residentId && task.propertyId ? " · " : ""}{task.note || "Requested follow-up"} · {formatCalendarDate(calendarDate(task.dueAt, data.church.timezone))}</small></span><ArrowRight size={18} /></button></li>)}</ul>
        <button className={walkFirst ? "button quiet" : "button primary"} onClick={() => onFollowUps()}>Open People <ArrowRight size={16} /></button>
      </section>
    </div>
    {!!handoffs.length && <section className="today-card"><h2><HeartHandshake size={22} /> Someone needs your help</h2><p>Review each person before accepting responsibility.</p><ul>{handoffs.map((person) => <li key={person.id}><button className="button quiet" onClick={() => onPerson(person.id)}>{person.name || "Person awaiting handoff"}<ArrowRight size={16} /></button></li>)}</ul></section>}
    {(needsReview > 0 || (canManage && (unowned.length > 0 || declined.length > 0 || waiting.length > 0 || Boolean(data.migrationIssues?.length)))) && <section className="today-card leader-inbox"><h2>Needs attention</h2><div className="exception-grid">
      {canManage && unowned.length > 0 && <button onClick={() => onFollowUps(undefined, "unowned")}><strong>{unowned.length}</strong><span>Follow-ups need someone responsible</span></button>}
      {canManage && declined.length > 0 && <button onClick={() => onFollowUps(undefined, "declined")}><strong>{declined.length}</strong><span>Follow-ups were declined</span></button>}
      {canManage && waiting.length > 0 && <button onClick={onPeople}><strong>{waiting.length}</strong><span>People awaiting a handoff</span></button>}
      {needsReview > 0 && <button onClick={onReviewSync}><strong>{needsReview}</strong><span>Changes on this device need review</span></button>}
    </div>{canManage && Boolean(data.migrationIssues?.length) && <p className="inline-notice">Some historical records need review. Open More → Data &amp; health before assigning that work.</p>}</section>}
    {additionalAction}
  </section>;
}
