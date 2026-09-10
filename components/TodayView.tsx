"use client";
import { ArrowRight, CalendarClock, CheckCircle2, HeartHandshake, Users } from "lucide-react";
import { calendarDate, formatCalendarDate } from "../lib/calendar";
import type { NeighborWalkData } from "../lib/domain";
import { ViewHeading } from "./ui";

export function TodayView({ data, activeVolunteerId, canManage, onFollowUps, onPerson, onOuting, onReviewSync, onPeople }: {
  data: NeighborWalkData; activeVolunteerId: string; canManage: boolean;
  onFollowUps: (id?: string, scope?: "mine" | "unowned" | "declined") => void; onPerson: (id: string) => void; onOuting: (id?: string) => void;
  onReviewSync: () => void; onPeople: () => void;
}) {
  const today = calendarDate(new Date(), data.church.timezone);
  const name = data.volunteers.find((v) => v.id === activeVolunteerId)?.name.split(" ")[0] ?? "friend";
  const activeMembers = new Set(data.volunteers.filter((v) => v.active).map((v) => v.id));
  const open = data.followUps.filter((t) => t.status === "scheduled");
  const mine = open.filter((t) => t.assignedVolunteerId === activeVolunteerId).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const due = mine.filter((t) => calendarDate(t.dueAt, data.church.timezone) <= today);
  const handoffs = data.residents.filter((p) => p.pendingOwnerId === activeVolunteerId);
  const unowned = open.filter((t) => !t.assignedVolunteerId || !activeMembers.has(t.assignedVolunteerId));
  const declined = open.filter((t) => t.acceptance === "declined");
  const waiting = data.residents.filter((p) => p.pendingOwnerId);
  const nextStepPeople = new Set(open.map((t) => t.residentId));
  const careWithoutPlan = data.residents.filter((p) => p.status === "active" && p.contactPermission !== "do_not_contact"
    && (canManage || p.assignedVolunteerId === activeVolunteerId) && !nextStepPeople.has(p.id));
  const nextOuting = data.events.filter((e) => ["ready", "active", "scheduled", "draft"].includes(e.status) && e.endsAt >= new Date().toISOString()).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const needsReview = data.sync.commands?.filter((q) => q.state === "needs_review").length ?? 0;
  return <section className="content-view today-view">
    <ViewHeading eyebrow={formatCalendarDate(today, { weekday: "long", month: "long", day: "numeric" })} title={"Hello, " + name + "."} description="A conversation matters. What happens next matters, too." />
    <div className="today-grid">
      <section className="today-card today-priority"><span className="eyebrow">Your next steps</span><h2>{due.length ? due.length + " need your attention" : "You’re clear for today"}</h2><p>{due.length ? "Due today or overdue, in your church’s timezone." : mine.length ? "Your upcoming follow-ups are ready when you need them." : "Plan a requested next step from a person’s profile or after an outreach conversation."}</p>
        <ul>{(due.length ? due : mine).slice(0, 5).map((task) => <li key={task.id}><button onClick={() => onFollowUps(task.id)}><CalendarClock size={20} /><span><strong>{data.residents.find((p) => p.id === task.residentId)?.name ?? data.properties.find((p) => p.id === task.propertyId)?.address ?? "Personal next step"}</strong><small>{task.note || "Requested return visit"} · {formatCalendarDate(calendarDate(task.dueAt, data.church.timezone))}</small></span><ArrowRight size={18} /></button></li>)}</ul><button className="button primary" onClick={() => onFollowUps()}>Open my follow-ups <ArrowRight size={16} /></button>
      </section>
      <section className="today-card"><span className="eyebrow">Go together</span><h2>{nextOuting?.name ?? "Prepare your next outing"}</h2><p>{nextOuting ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: nextOuting.timezone ?? data.church.timezone }).format(new Date(nextOuting.startsAt)) : "One shared plan for meeting, assignments and follow-through."}</p>{nextOuting?.meetingPoint && <p>{nextOuting.meetingPoint}</p>}<button className="button quiet" onClick={() => onOuting(nextOuting?.id)}>{nextOuting ? "Open outing & preparation" : "Open outreach"}</button></section>
    </div>
    {!!handoffs.length && <section className="today-card"><h2><HeartHandshake size={22} /> Care handoffs for you</h2><p>Review the profile before accepting. The current owner remains responsible until you do.</p><ul>{handoffs.map((p) => <li key={p.id}><button className="button quiet" onClick={() => onPerson(p.id)}>{p.name || "Person awaiting handoff"} <ArrowRight size={16} /></button></li>)}</ul></section>}
    {canManage && <section className="today-card leader-inbox"><span className="eyebrow">Leader review</span><h2>Keep people from falling through the cracks</h2><div className="exception-grid">
      <button onClick={() => onFollowUps(undefined, "unowned")}><strong>{unowned.length}</strong><span>Unowned or inactive-owner tasks</span></button><button onClick={() => onFollowUps(undefined, "declined")}><strong>{declined.length}</strong><span>Declined task assignments</span></button><button onClick={onPeople}><strong>{waiting.length}</strong><span>Care handoffs awaiting acceptance</span></button><button onClick={onReviewSync}><strong>{needsReview + (data.sync.legacyRecoveryRequired ? 1 : 0)}</strong><span>Sync/recovery issues on this device</span></button>
    </div>{data.migrationIssues?.length ? <p className="inline-notice">{data.migrationIssues.length} historical records were flagged during migration. Review the data-health report before assigning legacy work.</p> : null}<p>Only records you are authorized to see are counted. Device sync issues on other phones are not visible here.</p></section>}
    <section className="today-card"><h2><Users size={22} /> People without an open next step</h2><p>A prompt to review, not a requirement to contact everyone. Respect pauses and recorded restrictions.</p><ul>{careWithoutPlan.slice(0, 6).map((p) => <li key={p.id}><button className="button quiet" onClick={() => onPerson(p.id)}>{p.name || "Name not provided"} <ArrowRight size={16} /></button></li>)}</ul>{!careWithoutPlan.length && <p><CheckCircle2 size={18} /> No active people in this view need a plan review.</p>}</section>
  </section>;
}
