"use client";
import { CalendarDays, Check, MapPin, Plus, Repeat2, Users } from "lucide-react";
import { useState } from "react";
import { calendarDaysFromNow, churchDateTimeToIso, localDateTimeValue } from "../lib/calendar";
import type { ConversationGuide, NeighborWalkData, OutreachEvent } from "../lib/domain";
import { useAsyncAction } from "../lib/use-async-action";
import { EmptyState, Modal, ViewHeading } from "./ui";

type Assignment = NonNullable<NeighborWalkData["assignments"]>[number];
type Props = {
  data: NeighborWalkData; canManage: boolean; activeVolunteerId: string; guides: ConversationGuide[];
  selectedId?: string; onSelect: (id?: string) => void; onStart: (id: string, territoryId?: string) => Promise<unknown>;
  onSave: (input: Omit<OutreachEvent, "id" | "churchId">, id?: string) => Promise<string>;
  onRepeat: (id: string, startsAt: string, endsAt: string) => Promise<string>;
  onAssign: (input: Omit<Assignment, "id" | "churchId">, id?: string) => Promise<string>;
  onAddList: (name: string) => Promise<unknown>; onOpenGuide: (id: string) => void;
};

export function OutreachView(props: Props) {
  const { data, canManage, selectedId, onSelect, onSave, onRepeat } = props;
  const [editor, setEditor] = useState<"new" | OutreachEvent | null>(null);
  const [repeat, setRepeat] = useState<OutreachEvent | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const selected = data.events.find((e) => e.id === selectedId);
  const outings = data.events.filter((e) => showArchived || !["archived", "cancelled", "completed"].includes(e.status)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return <section className="content-view outreach-view">
    <ViewHeading eyebrow="Go together. Follow through personally." title="Outreach" description="Prepare an outing, make responsibility clear, and leave with a plan for what happens next." aside={canManage && <button className="button primary" onClick={() => setEditor("new")}><Plus size={16} /> Plan an outing</button>} />
    {selected ? <><button className="button quiet" onClick={() => onSelect()}>← All outings</button><OutingDetail {...props} outing={selected} onEdit={() => setEditor(selected)} onRepeatRequest={() => setRepeat(selected)} /></>
      : <><label className="checkbox-label"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Include completed, cancelled and archived outings</label>
        {outings.length ? <div className="outing-grid">{outings.map((outing) => <button className="outing-card" key={outing.id} onClick={() => onSelect(outing.id)}><span className="status-badge">{outing.status}</span><h2>{outing.name}</h2><p><CalendarDays size={18} /> {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: outing.timezone ?? data.church.timezone }).format(new Date(outing.startsAt))}</p>{outing.meetingPoint && <p><MapPin size={18} /> {outing.meetingPoint}</p>}<p>{outing.purpose || "Prepare the purpose and plan together."}</p><strong>{data.assignments?.filter((a) => a.eventId === outing.id && !["cancelled", "declined"].includes(a.status)).length ?? 0} assignments</strong></button>)}</div>
          : <EmptyState icon={<CalendarDays size={26} />} title="Your next outing starts here" copy={canManage ? "Plan a neighborhood walk, community meal, or service outing. You can begin with a simple address list; no map setup is required." : "Your leader’s planned outings and assignments will appear here."} />}</>}
    {editor && <OutingEditor churchTimezone={data.church.timezone} guides={props.guides} outing={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} onSave={async (input) => { const id = await onSave(input, editor === "new" ? undefined : editor.id); setEditor(null); onSelect(id); }} />}
    {repeat && <RepeatOuting outing={repeat} churchTimezone={data.church.timezone} onClose={() => setRepeat(null)} onSave={async (start, end) => { const id = await onRepeat(repeat.id, start, end); setRepeat(null); onSelect(id); }} />}
  </section>;
}

function OutingDetail({ outing, onEdit, onRepeatRequest, ...props }: Props & { outing: OutreachEvent; onEdit: () => void; onRepeatRequest: () => void }) {
  const { data, canManage, activeVolunteerId, onAssign, onSave, onStart, onAddList, onOpenGuide } = props;
  const action = useAsyncAction();
  const [area, setArea] = useState("");
  const [responsibility, setResponsibility] = useState("");
  const [listName, setListName] = useState("");
  const [debrief, setDebrief] = useState(outing.debrief ?? "");
  const assignments = data.assignments?.filter((a) => a.eventId === outing.id) ?? [];
  const myTeams = new Set(data.teams.filter((t) => t.memberIds.includes(activeVolunteerId)).map((t) => t.id));
  const myAssignment = assignments.find((a) => (a.assignedVolunteerId === activeVolunteerId || myTeams.has(a.assignedTeamId ?? "")) && !["cancelled", "declined"].includes(a.status));
  const openTasks = data.followUps.filter((t) => t.eventId === outing.id && t.status === "scheduled");
  const encounters = data.visits.filter((v) => v.eventId === outing.id);
  const guide = props.guides.find((g) => g.id === outing.guideId);
  const closed = ["completed", "archived", "cancelled"].includes(outing.status);
  const transition = (status: OutreachEvent["status"]) => action.run(() => onSave({ ...outing, status }, outing.id));
  return <article className="outing-detail">
    <header><span className="status-badge">{outing.status}</span><h2>{outing.name}</h2><p>{outing.purpose || "Add a clear purpose for this outing."}</p><p><strong>Meet:</strong> {outing.meetingPoint || "Meeting point not set"}</p><p><strong>Leader contact:</strong> {outing.leaderContact || "Ask your church leader"}</p><p>{new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short", timeZone: outing.timezone ?? data.church.timezone }).format(new Date(outing.startsAt))} · {outing.timezone ?? data.church.timezone}</p></header>
    <div className="care-next-actions">{canManage && <><button className="button quiet" onClick={onEdit}>Edit preparation</button><button className="button quiet" onClick={onRepeatRequest}><Repeat2 size={16} /> Repeat outing</button></>}
      {guide ? <button className="button quiet" onClick={() => onOpenGuide(guide.id)}>Prepare with {guide.title}</button> : <span>Guide optional · Record conversations without one.</span>}
      {!closed && <button className="button primary" disabled={action.busy} onClick={() => void action.run(() => onStart(outing.id, myAssignment?.territoryId))}>Open fieldwork</button>}
    </div>
    {canManage && <div className="care-next-actions">{["draft", "scheduled"].includes(outing.status) && <button disabled={action.busy} onClick={() => void transition("ready")}>Mark ready</button>}{outing.status === "ready" && <button disabled={action.busy} onClick={() => void transition("active")}>Start outing</button>}{["ready", "active"].includes(outing.status) && <button disabled={action.busy} onClick={() => void transition("completed")}>Complete outing</button>}{outing.status === "completed" && <button disabled={action.busy} onClick={() => void transition("archived")}>Archive outing</button>}{!closed && <button disabled={action.busy} onClick={() => { if (window.confirm("Cancel this outing? Encounters and follow-up responsibilities are preserved.")) void transition("cancelled"); }}>Cancel outing</button>}</div>}
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <section><h3><Users size={20} /> Who is responsible?</h3><p>Assignments are specific to this outing. Lists, locations and groups can be reused. Offline assignments are provisional until shared.</p>
      <ul className="assignment-list">{assignments.map((assignment) => {
        const mine = assignment.assignedVolunteerId === activeVolunteerId || myTeams.has(assignment.assignedTeamId ?? "");
        return <li key={assignment.id}><div><strong>{data.territories.find((t) => t.id === assignment.territoryId)?.name ?? "Archived area"}</strong><p>{data.teams.find((t) => t.id === assignment.assignedTeamId)?.name ?? data.volunteers.find((v) => v.id === assignment.assignedVolunteerId)?.name ?? "Owner unavailable"} · {assignment.status}</p></div><div className="care-next-actions">{mine && ["assigned", "accepted"].includes(assignment.status) && <>{assignment.status === "assigned" && <button disabled={action.busy} onClick={() => void action.run(() => onAssign({ ...assignment, status: "accepted" }, assignment.id))}>Accept</button>}<button disabled={action.busy} onClick={() => void action.run(() => onAssign({ ...assignment, status: "completed" }, assignment.id))}>Finish assignment</button><button disabled={action.busy} onClick={() => void action.run(() => onAssign({ ...assignment, status: "declined" }, assignment.id))}>Decline</button></>}{canManage && !["cancelled", "completed", "declined"].includes(assignment.status) && <button disabled={action.busy} onClick={() => void action.run(() => onAssign({ ...assignment, status: "cancelled" }, assignment.id))}>Cancel assignment</button>}</div></li>;
      })}</ul>
      {!assignments.length && <p>No assignments yet. A leader can assign a list or territory below.</p>}
      {canManage && !closed && <div className="outing-preparation-grid"><form className="form-stack" onSubmit={(e) => { e.preventDefault(); const [kind, id] = responsibility.split(":"); void action.run(() => onAssign({ eventId: outing.id, territoryId: area, assignedTeamId: kind === "team" ? id : undefined, assignedVolunteerId: kind === "volunteer" ? id : undefined, status: "assigned" }), () => { setArea(""); setResponsibility(""); }); }}>
        <label>List or territory<select required value={area} onChange={(e) => setArea(e.target.value)}><option value="">Choose an area</option>{data.territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>Responsible group or volunteer<select required value={responsibility} onChange={(e) => setResponsibility(e.target.value)}><option value="">Choose responsibility</option><optgroup label="Groups">{data.teams.map((t) => <option key={t.id} value={"team:" + t.id}>{t.name}</option>)}</optgroup><optgroup label="Volunteers">{data.volunteers.filter((v) => v.active).map((v) => <option key={v.id} value={"volunteer:" + v.id}>{v.name}</option>)}</optgroup></select></label><button className="button primary" disabled={action.busy}>Assign area</button>
      </form><form className="form-stack" onSubmit={(e) => { e.preventDefault(); void action.run(() => onAddList(listName.trim()), () => setListName("")); }}><label>Need a list without a map?<input value={listName} required minLength={2} maxLength={120} onChange={(e) => setListName(e.target.value)} placeholder="Saturday north-side addresses" /></label><p>Add addresses in fieldwork. No map boundary or coordinates are required.</p><button className="button quiet" disabled={action.busy}>Create reusable address list</button></form></div>}
    </section>
    <section><h3>Debrief &amp; next steps</h3><p>{encounters.length} recorded encounters · {openTasks.length} open follow-ups · {openTasks.filter((t) => !t.assignedVolunteerId).length} without an owner</p><p>These are activity counts, not measures of a neighbor’s faith or value.</p>{canManage ? <form className="form-stack" onSubmit={(e) => { e.preventDefault(); void action.run(() => onSave({ ...outing, debrief }, outing.id)); }}><label>What should the next team know? (no private person notes)<textarea value={debrief} maxLength={2000} rows={4} onChange={(e) => setDebrief(e.target.value)} /></label><button className="button quiet" disabled={action.busy}><Check size={16} /> Save debrief</button></form> : <p>{outing.debrief || "The leader’s debrief will appear here."}</p>}</section>
  </article>;
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
  return <Modal title={outing ? "Edit outing" : "Plan an outing"} description="A simple shared plan helps volunteers arrive prepared." onClose={action.busy ? () => undefined : onClose} wide><form className="form-stack" onSubmit={(e) => { e.preventDefault(); void action.run(async () => onSave({ name, purpose, meetingPoint, leaderContact, timezone, guideId: guideId || undefined,
    startsAt: churchDateTimeToIso(start, timezone), endsAt: churchDateTimeToIso(end, timezone), status: outing?.status ?? "draft", debrief: outing?.debrief ?? "" })); }}>
    <label>Outing name<input required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} placeholder="Saturday neighborhood walk" /></label><label>Purpose<textarea maxLength={1000} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Listen to our neighbors and follow through on requested help." /></label>
    <div className="person-editor-grid"><label>Starts<input required type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label><label>Ends<input required type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label><label>Timezone<input required value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/Chicago" /></label><label>Meeting point<input maxLength={300} value={meetingPoint} onChange={(e) => setMeetingPoint(e.target.value)} /></label><label>Leader contact<input maxLength={254} value={leaderContact} onChange={(e) => setLeaderContact(e.target.value)} /></label><label>Optional church guide<select value={guideId} onChange={(e) => setGuideId(e.target.value)}><option value="">No guide assigned</option>{guides.filter((g) => g.scope === "church").map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label></div>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}<div className="modal-actions"><button type="button" className="button quiet" disabled={action.busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={action.busy}>{action.busy ? "Saving to device…" : "Save outing"}</button></div>
  </form></Modal>;
}

function RepeatOuting({ outing, churchTimezone, onClose, onSave }: { outing: OutreachEvent; churchTimezone: string; onClose: () => void; onSave: (start: string, end: string) => Promise<unknown> }) {
  const timezone = outing.timezone ?? churchTimezone;
  const [start, setStart] = useState(calendarDaysFromNow(7, timezone, new Date(outing.startsAt)) + "T09:00");
  const [end, setEnd] = useState(calendarDaysFromNow(7, timezone, new Date(outing.startsAt)) + "T11:00");
  const action = useAsyncAction();
  return <Modal title="Repeat this outing" description="Creates a draft using the same preparation and assignments. People, visits and tasks are not duplicated." onClose={action.busy ? () => undefined : onClose}><form className="form-stack" onSubmit={(e) => { e.preventDefault(); void action.run(async () => onSave(churchDateTimeToIso(start, timezone), churchDateTimeToIso(end, timezone))); }}><p>Times use {timezone}.</p><label>New start<input required type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label><label>New end<input required type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label>{action.error && <p role="alert" className="inline-error">{action.error}</p>}<button className="button primary" disabled={action.busy}>Create repeated draft</button></form></Modal>;
}
