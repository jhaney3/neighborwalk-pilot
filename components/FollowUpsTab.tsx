"use client";

import { ArrowRightToLine, CalendarDays, Check, ChevronLeft, ChevronRight, DoorOpen, Ellipsis, Mail, MapPin, MessageCircle, Moon, Phone, Plus, Star, UserRound } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { calendarDate, calendarDaysFromNow, formatCalendarDate } from "../lib/calendar";
import { contactRestricted } from "../lib/contact-restrictions";
import { outcomeMeta, type FollowUp, type NeighborWalkData } from "../lib/domain";
import { activeFollowUpOwner, type FollowUpScope } from "../lib/follow-up-filters";
import { checkInCompletion, checkInOutcomes, followUpInList, groupFollowUpsByWhen, relativeDueLabel, snoozeChoices, type CheckInOutcome, type FollowUpList } from "../lib/follow-up-groups";
import { houseLabel } from "../lib/pin-counts";
import { indexCurrentRecords } from "../lib/record-aliases";
import { useAsyncAction } from "../lib/use-async-action";
import { selectionTick } from "../mobile/haptics";
import { TaskEditor, type FollowUpsViewProps } from "./FollowUpsView";
import { visitDetailLine } from "./HomeSheet";
import { HistoryList, outcomeWord, type HistoryEntry } from "./OutcomeGrid";
import { ActionSheet, Sheet } from "./Sheet";
import { EmptyState, TabTopBar, initials } from "./ui";

const channelIcon = { visit: DoorOpen, call: Phone, text: MessageCircle, email: Mail, other: UserRound } as const;
const channelLabel = { visit: "Visit", call: "Call", text: "Text", email: "Email", other: "Follow-up" } as const;

function listFromScope(scope?: FollowUpScope): FollowUpList {
  return scope === "unowned" || scope === "declined" ? "open" : scope === "all" || scope === "team" ? "all" : "mine";
}

/** Who owns a task and whether the viewer can act on it. */
function taskPermissions(task: FollowUp, data: NeighborWalkData, canManage: boolean, actorId: string) {
  const owner = activeFollowUpOwner(task, data);
  const ownTask = owner?.id === actorId;
  const restricted = contactRestricted(data, task.residentId, task.channel ?? "visit", task.propertyId);
  const open = task.status === "scheduled" && !restricted;
  const canAct = Boolean(open && (canManage || ownTask) && owner && (task.acceptance === "accepted" || ownTask));
  return { owner, ownTask, restricted, open, canAct };
}

function useTaskLabels(data: NeighborWalkData) {
  const people = useMemo(() => indexCurrentRecords(data.residents), [data.residents]);
  const homes = useMemo(() => indexCurrentRecords(data.properties), [data.properties]);
  return (task: FollowUp) => {
    const person = people.get(task.residentId ?? "");
    const home = homes.get(task.propertyId ?? "");
    return { person, home, title: person?.name || (home ? houseLabel(home.address, home.unit) : undefined) || "Name not known" };
  };
}

type Sort = "due" | "newest";

/** Follow-ups (BD3): Mine / Team / Open, grouped by when they're due. Swipe a
 * row for Snooze or Done. */
export function FollowUpsList(props: FollowUpsViewProps) {
  const { data, canManage, activeVolunteerId, initialPersonId, onClearPersonFocus } = props;
  const [list, setList] = useState<FollowUpList>(listFromScope(props.initialScope));
  const [sort, setSort] = useState<Sort>("due");
  const [sortMenu, setSortMenu] = useState(false);
  const [showLater, setShowLater] = useState(false);
  const [sheet, setSheet] = useState<{ kind: "checkin" | "later"; task: FollowUp } | null>(null);
  const labels = useTaskLabels(data);
  const timezone = data.church.timezone;
  const today = calendarDate(new Date(), timezone);
  const people = indexCurrentRecords(data.residents);
  const focusPerson = initialPersonId ? people.get(initialPersonId) : undefined;
  const lists: FollowUpList[] = canManage ? ["mine", "all", "open"] : ["mine", "all"];
  const listLabels: Record<FollowUpList, string> = { mine: "Mine", all: "Team", open: "Open" };
  const matchesPerson = (task: FollowUp) => !initialPersonId || (Boolean(focusPerson) && people.get(task.residentId ?? "")?.id === focusPerson?.id);
  const scheduled = data.followUps.filter((task) => task.status === "scheduled" && matchesPerson(task));
  const counts = Object.fromEntries(lists.map((key) => [key, scheduled.filter((task) => followUpInList(task, key, data, activeVolunteerId)).length])) as Record<FollowUpList, number>;
  const visible = scheduled.filter((task) => initialPersonId || followUpInList(task, list, data, activeVolunteerId));
  const groups = sort === "newest"
    ? visible.length ? [{ key: "newest", label: "Newest first", tasks: [...visible].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }] : []
    : groupFollowUpsByWhen(visible, timezone, today).reduce<{ key: string; label: string; tasks: FollowUp[] }[]>((all, group) => {
      // Today's follow-ups sit with the rest of this week, as drawn.
      if (group.key === "today" || group.key === "week") {
        const week = all.find((item) => item.key === "week");
        if (week) week.tasks.push(...group.tasks); else all.push({ key: "week", label: "This week", tasks: [...group.tasks] });
      } else all.push(group);
      return all;
    }, []);

  return <section className={`${props.embedded ? "followups-view followups-view-embedded" : "content-view followups-view"} fu-list-view`}>
    {!props.profileMode && props.onProfile && <TabTopBar label={sort === "due" ? "Due first" : "Newest first"} labelAriaLabel={`Sorted ${sort === "due" ? "by due date" : "newest first"}. Change`} onLabel={() => setSortMenu(true)} name={props.profileName ?? "You"} attention={props.attention} onProfile={props.onProfile} />}
    {!props.profileMode && <h1 className="tab-title">Follow-ups</h1>}
    {initialPersonId && <div className="fu-person-focus"><span>Follow-ups for <strong>{focusPerson?.name ?? "this person"}</strong></span><button type="button" onClick={onClearPersonFocus}>Show all</button></div>}
    {!initialPersonId && <div className="fu-lists" role="group" aria-label="Whose follow-ups">
      {lists.map((key) => <button type="button" key={key} aria-pressed={list === key} onClick={() => { selectionTick(); setList(key); }}>{listLabels[key]}<span className="fu-count">{counts[key]}</span></button>)}
    </div>}
    {groups.length ? groups.map((group) => {
      const collapsed = group.key === "later" && !showLater;
      return <section className="fu-group" key={group.key} aria-labelledby={`fu-group-${group.key}`}>
        <div className="list-section-head"><h2 id={`fu-group-${group.key}`} className={group.key === "overdue" ? "late" : undefined}>{group.label}</h2>
          {collapsed ? <button type="button" className="mono-meta" onClick={() => setShowLater(true)}>Show {group.tasks.length} ›</button> : <span className={`mono-meta${group.key === "overdue" ? " danger" : ""}`}>{group.tasks.length}</span>}
        </div>
        {!collapsed && <ul className="fu-rows grouped-rows">{group.tasks.map((task) => <FollowUpRow key={task.id} task={task} {...props} list={initialPersonId ? "mine" : list} today={today} labels={labels} onCheckIn={() => setSheet({ kind: "checkin", task })} onLater={() => setSheet({ kind: "later", task })} />)}</ul>}
      </section>;
    }) : <EmptyState icon={<Check size={26} />} title="All caught up" copy={list === "open" ? "Every follow-up has an owner." : "New follow-ups from walks and conversations show up here."} />}
    {sortMenu && <ActionSheet title="Sort follow-ups" onClose={() => setSortMenu(false)} actions={[
      { label: "Due first", onSelect: () => { setSort("due"); setSortMenu(false); } },
      { label: "Newest first", onSelect: () => { setSort("newest"); setSortMenu(false); } },
    ]} />}
    {sheet?.kind === "checkin" && <CheckInSheet task={sheet.task} title={labels(sheet.task).title} data={data} onComplete={props.onComplete} onClose={() => setSheet(null)} />}
    {sheet?.kind === "later" && <LaterSheet task={sheet.task} data={data} canManage={canManage} activeVolunteerId={activeVolunteerId} onReschedule={props.onReschedule} onAssign={props.onAssign} onAccept={props.onAccept} onClose={() => setSheet(null)} />}
  </section>;
}

function FollowUpRow({ task, data, canManage, activeVolunteerId, list, today, labels, onOpenTask, onCheckIn, onLater }: FollowUpsViewProps & {
  task: FollowUp; list: FollowUpList; today: string; labels: ReturnType<typeof useTaskLabels>; onCheckIn: () => void; onLater: () => void;
}) {
  const { title } = labels(task);
  const { owner, ownTask, restricted, canAct } = taskPermissions(task, data, canManage, activeVolunteerId);
  const due = calendarDate(task.dueAt, data.church.timezone);
  const late = task.status === "scheduled" && due < today;
  const Channel = channelIcon[task.channel ?? "visit"];
  const pendingReply = ownTask && task.acceptance === "pending";
  const status = restricted ? "Don’t contact" : task.acceptance === "declined" ? "Declined" : pendingReply ? "Needs reply" : undefined;
  return <li className="fu-row">
    <div className="fu-row-track">
      <div className="fu-row-main">
        {canAct
          ? <button type="button" className="fu-check" aria-label={`Log a check-in for ${title}`} onClick={onCheckIn}><Check size={14} aria-hidden="true" /></button>
          : <span className="fu-check idle" aria-hidden="true" />}
        <button type="button" className="fu-row-open" onClick={() => onOpenTask?.(task.id)} aria-label={`${title}. ${task.note || "Visit requested"}. ${late ? "Overdue, " : ""}due ${relativeDueLabel(due, today)}${status ? `. ${status}` : ""}`}>
          <span className="fu-row-text"><strong>{title}</strong><small>{task.note || "Visit requested"}</small></span>
          <span className="fu-row-meta">
            {list !== "mine" && <span className={`fu-owner${owner ? "" : " none"}`} title={owner?.name ?? "No owner"}>{owner ? initials(owner.name) : "?"}</span>}
            <Channel size={17} aria-hidden="true" className="fu-channel" />
            <span className={`due-chip${late ? " late" : ""}`}>{status ?? relativeDueLabel(due, today)}</span>
          </span>
        </button>
      </div>
      {canAct && <div className="fu-row-actions">
        <button type="button" className="later" onClick={onLater} aria-label={`Snooze ${title}`}><Moon size={17} aria-hidden="true" />Snooze</button>
        <button type="button" className="done" onClick={onCheckIn} aria-label={`Done with ${title}`}><Check size={17} aria-hidden="true" />Done</button>
      </div>}
    </div>
  </li>;
}

/** Follow-up detail (BD4, FU1): the person, the next step as the offset card,
 * Log check-in, Snooze and Hand off, history, then the person and home rows. */
export function FollowUpDetail(props: FollowUpsViewProps & { taskId: string }) {
  const { data, canManage, activeVolunteerId, taskId, onClearPersonFocus, onOpenPerson, onOpenProperty, onAccept } = props;
  const [sheet, setSheet] = useState<"checkin" | "later" | "cancel" | "menu" | null>(null);
  const action = useAsyncAction();
  const labels = useTaskLabels(data);
  const task = data.followUps.find((item) => item.id === taskId);
  const timezone = data.church.timezone;
  const today = calendarDate(new Date(), timezone);
  const top = <div className="screen-top"><button type="button" className="round-button float" aria-label="Back to follow-ups" onClick={onClearPersonFocus}><ChevronLeft size={22} aria-hidden="true" /></button>{task && <button type="button" className="round-button float" aria-label="Follow-up options" onClick={() => setSheet("menu")}><Ellipsis size={20} aria-hidden="true" /></button>}</div>;
  if (!task) return <section className={props.embedded ? "fu-detail" : "content-view fu-detail"}>{top}<p className="inline-notice">This follow-up may be archived, or not shared with you. <button onClick={onClearPersonFocus}>Open my follow-ups</button></p></section>;

  const { person, home, title } = labels(task);
  const { owner, ownTask, restricted, open, canAct } = taskPermissions(task, data, canManage, activeVolunteerId);
  const due = calendarDate(task.dueAt, timezone);
  const late = task.status === "scheduled" && due < today;
  const channel = task.channel ?? "visit";
  const source = task.sourceVisitId ? data.visits.find((visit) => visit.id === task.sourceVisitId) : undefined;
  const met = source?.recordedAt ?? (person ? data.visits.filter((visit) => visit.residentId === person.id).map((visit) => visit.recordedAt).sort()[0] ?? person.createdAt : undefined);
  const statusLine = task.status === "completed" ? "Done" : task.status === "cancelled" ? "Cancelled" : `Due ${relativeDueLabel(due, today).toLowerCase()}`;
  const acceptance = !owner ? "No owner yet" : task.acceptance === "pending" ? "waiting to accept" : task.acceptance === "declined" ? "declined" : "accepted";
  const names = new Map(data.volunteers.map((volunteer) => [volunteer.id, volunteer.name]));
  const historyLabel: Record<string, string> = { created: "Follow-up created", rescheduled: "Snoozed", completed: "Done", cancelled: "Cancelled", accepted: "Accepted", declined: "Given back", reassigned: "Handed off" };
  const entries: HistoryEntry[] = [
    ...[...task.history].reverse().map((entry) => ({ id: entry.id, at: entry.createdAt,
      title: [`${historyLabel[entry.action] ?? entry.action}${entry.action === "rescheduled" && entry.dueAt ? ` to ${formatCalendarDate(calendarDate(entry.dueAt, timezone), { weekday: "short", day: "numeric" })}` : ""}`, entry.action === "created" ? channelLabel[channel].toLowerCase() : undefined, names.get(entry.actorId)].filter(Boolean).join(" · "),
      detail: entry.action !== "created" ? entry.note : undefined })),
    ...(source ? [{ id: source.id, at: source.recordedAt, color: outcomeMeta[source.outcome].color, title: source.context === "door" ? `${outcomeWord[source.outcome]} at the door` : outcomeWord[source.outcome], detail: visitDetailLine(source) ?? names.get(source.volunteerId) }] : []),
  ];

  return <section className={props.embedded ? "fu-detail" : "content-view fu-detail"} aria-labelledby="fu-detail-title">
    {top}
    <header className="fu-detail-person">
      <span className="fu-detail-avatar" aria-hidden="true">{person?.name ? initials(person.name).slice(0, 1) : <DoorOpen size={26} />}</span>
      <div><h1 id="fu-detail-title">{title}</h1>{(home || met) && <p className="mono-meta">{[person && home ? houseLabel(home.address, home.unit) : undefined, met ? `Met ${formatCalendarDate(calendarDate(met, timezone), { month: "short", day: "numeric" })}` : undefined].filter(Boolean).join(" · ")}</p>}</div>
    </header>

    <article className={`fu-detail-card offset-card${open ? " porch" : ""}`}>
      <p className={`mono-meta${late ? " danger" : ""}`}>{statusLine} · {channelLabel[channel]}</p>
      <p className="fu-detail-note">{task.note || "Visit requested"}</p>
      {task.completionNote && <p className="fu-detail-completion"><Check size={14} aria-hidden="true" /> {task.completionNote}</p>}
      <p className="fu-detail-owner"><span className="fu-owner">{owner ? initials(owner.name) : "?"}</span><span className="mono-meta">{owner ? `${ownTask ? "You" : owner.name} · ${acceptance}` : acceptance}</span></p>
      {restricted && task.status === "scheduled" && <p role="status" className="inline-notice">Don’t act on this. They asked not to be contacted this way.</p>}
    </article>

    {ownTask && task.acceptance === "pending" && onAccept && open && <div className="fu-detail-accept">
      <p>This was handed to you. Will you take it?</p>
      <div className="wd-buttons"><button type="button" className="button-outline" disabled={action.busy} onClick={() => void action.save(() => onAccept(task.id, "declined"))}>Give it back</button><button type="button" className="button-ink" disabled={action.busy} onClick={() => void action.save(() => onAccept(task.id, "accepted"))}>Accept</button></div>
    </div>}

    {canAct && <div className="fu-detail-actions">
      <button type="button" className="button-ink wide" onClick={() => setSheet("checkin")}>Log check-in</button>
      <div className="wd-buttons">
        <button type="button" className="button-outline" onClick={() => setSheet("later")}><Moon size={17} aria-hidden="true" /> Snooze</button>
        <button type="button" className="button-outline" onClick={() => setSheet("later")}><ArrowRightToLine size={17} aria-hidden="true" /> Hand off</button>
      </div>
    </div>}
    {open && canManage && !owner && <button type="button" className="button-ink wide" onClick={() => setSheet("later")}>Choose an owner</button>}
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}

    <section className="fu-detail-history" aria-labelledby="fu-history-title">
      <h2 id="fu-history-title">History</h2>
      <HistoryList timezone={timezone} label="Follow-up history" entries={entries} />
    </section>

    {(person || home || (open && (canManage || ownTask))) && <div className="grouped-rows">
      {person && <button type="button" className="grouped-row" onClick={() => onOpenPerson(person.id)}><span className="avatar-dot" aria-hidden="true">{initials(person.name ?? "?").slice(0, 1)}</span><span className="grouped-row-text"><strong>{person.name}</strong><small>Person page</small></span><ChevronRight size={17} aria-hidden="true" /></button>}
      {home && <button type="button" className="grouped-row" onClick={() => onOpenProperty(home.id)}><MapPin size={19} aria-hidden="true" /><span className="grouped-row-text"><strong>{home.address}</strong><small>Home and visits</small></span><ChevronRight size={17} aria-hidden="true" /></button>}
      {open && (canManage || ownTask) && <button type="button" className="grouped-row danger" onClick={() => setSheet("cancel")}><span className="grouped-row-text"><strong>Cancel follow-up</strong></span></button>}
    </div>}

    {sheet === "menu" && <ActionSheet title={title} closeLabel="Close" onClose={() => setSheet(null)} actions={[
      ...(person ? [{ label: "Person page", onSelect: () => { setSheet(null); onOpenPerson(person.id); } }] : []),
      ...(home ? [{ label: "Home and visits", onSelect: () => { setSheet(null); onOpenProperty(home.id); } }] : []),
      ...(open && (canManage || ownTask) ? [{ label: "Cancel follow-up", destructive: true, onSelect: () => setSheet("cancel") }] : []),
    ]} />}
    {sheet === "checkin" && <CheckInSheet task={task} title={title} data={data} onComplete={props.onComplete} onClose={() => setSheet(null)} />}
    {sheet === "later" && <LaterSheet task={task} data={data} canManage={canManage} activeVolunteerId={activeVolunteerId} onReschedule={props.onReschedule} onAssign={props.onAssign} onAccept={props.onAccept} onClose={() => setSheet(null)} />}
    {sheet === "cancel" && <TaskEditor {...props} task={task} mode="cancel" onClose={() => setSheet(null)} />}
  </section>;
}

/** Check-in (BD5): how did it go, then whether to plan the next follow-up. */
function CheckInSheet({ task, title, data, onComplete, onClose }: { task: FollowUp; title: string; data: NeighborWalkData; onComplete: FollowUpsViewProps["onComplete"]; onClose: () => void }) {
  const action = useAsyncAction();
  const groupId = useId();
  const timezone = data.church.timezone;
  const [outcome, setOutcome] = useState<CheckInOutcome | null>(null);
  const weeks = [{ label: "1 wk", date: calendarDaysFromNow(7, timezone) }, { label: "2 wks", date: calendarDaysFromNow(14, timezone) }];
  const [next, setNext] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const choose = (value: CheckInOutcome) => {
    selectionTick();
    setOutcome(value);
    const option = checkInOutcomes.find((item) => item.value === value)!;
    if (value === "all_set") { setNext(null); setPicking(false); }
    else if (option.nextByDefault && next === null) setNext(weeks[0].date);
  };
  const tooLong = note.length > data.church.noteCharacterLimit;
  return <Sheet className="plain-sheet" modal labelledBy={groupId} onDismiss={action.busy ? () => undefined : onClose}>
    <p className="mono-meta pin-kicker">Check-in · {title}</p>
    <h2 className="pin-title" id={groupId}>How did it go?</h2>
    <div className="check-outcomes" role="radiogroup" aria-labelledby={groupId}>
      {checkInOutcomes.map((option) => <button type="button" role="radio" key={option.value} aria-checked={outcome === option.value} onClick={() => choose(option.value)}><span>{option.label}</span><i aria-hidden="true" /></button>)}
    </div>
    {outcome !== "all_set" && <div className="walk-field">
      <span className="mono-meta" id={`${groupId}-next`}>Next follow-up</span>
      <div className="walk-date-seg" role="group" aria-labelledby={`${groupId}-next`}>
        <button type="button" aria-pressed={next === null && !picking} onClick={() => { setNext(null); setPicking(false); }}>None</button>
        {weeks.map((choice) => <button type="button" key={choice.label} aria-pressed={!picking && next === choice.date} onClick={() => { setPicking(false); setNext(choice.date); }}>{choice.label}</button>)}
        <button type="button" className="icon" aria-pressed={picking} aria-label="Pick a date" onClick={() => { setPicking(true); setNext((current) => current ?? weeks[0].date); }}><CalendarDays size={17} aria-hidden="true" /></button>
      </div>
      {picking && <input type="date" aria-label="Next follow-up date" min={calendarDaysFromNow(0, timezone)} value={next ?? ""} onChange={(event) => setNext(event.target.value || null)} />}
    </div>}
    {noteOpen
      ? <label className="walk-field"><span className="mono-meta">Note</span><textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Keep it short and factual." /></label>
      : <button type="button" className="pin-add-note mono-meta" onClick={() => setNoteOpen(true)}>+ Add a note</button>}
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    <button type="button" className="walk-save" disabled={!outcome || action.busy || tooLong} onClick={() => outcome && void action.save(async () => { await onComplete(task.id, checkInCompletion(task, outcome, outcome === "all_set" ? null : next, note)); }, onClose)}>{action.busy ? "Saving…" : "Save"}</button>
  </Sheet>;
}

/** Not you, not now? (BD6): snooze it, or hand it off. Leaders hand it to
 * anyone; an owner can give it back to the leaders' Open list. */
function LaterSheet({ task, data, canManage, activeVolunteerId, onReschedule, onAssign, onAccept, onClose }: {
  task: FollowUp; data: NeighborWalkData; canManage: boolean; activeVolunteerId: string;
  onReschedule: FollowUpsViewProps["onReschedule"]; onAssign?: FollowUpsViewProps["onAssign"]; onAccept?: FollowUpsViewProps["onAccept"]; onClose: () => void;
}) {
  const action = useAsyncAction();
  const titleId = useId();
  const [picking, setPicking] = useState(false);
  const [everyone, setEveryone] = useState(false);
  const [date, setDate] = useState(calendarDaysFromNow(3, data.church.timezone));
  const { owner, ownTask, canAct } = taskPermissions(task, data, canManage, activeVolunteerId);
  const choices = snoozeChoices(data, activeVolunteerId);
  const members = data.volunteers.filter((volunteer) => volunteer.active && volunteer.id !== owner?.id);
  // People who walked the same walk come first.
  const crew = new Set(data.outingParticipants.filter((participant) => participant.eventId === task.eventId).map((participant) => participant.volunteerId));
  const shown = everyone ? members : [...members].sort((a, b) => Number(crew.has(b.id)) - Number(crew.has(a.id))).slice(0, 2);
  const snooze = (to: string) => void action.save(() => onReschedule(task.id, to), onClose);
  const dateLabel = (value: string, first: boolean) => `${formatCalendarDate(value, { weekday: "short" })} ${first ? "9:00 AM" : formatCalendarDate(value, { day: "numeric" })}`;
  const canHandOff = canManage && onAssign && task.status === "scheduled";
  const canGiveBack = ownTask && onAccept && task.status === "scheduled";
  return <Sheet className="plain-sheet" modal labelledBy={titleId} onDismiss={action.busy ? () => undefined : onClose}>
    <h2 className="pin-title" id={titleId}>{canAct ? "Not you, not now?" : "Who should take it?"}</h2>
    {canAct && <section aria-label="Snooze until">
      <p className="mono-meta">Snooze until</p>
      <div className="snooze-rows">
        {choices.map((choice, index) => <button type="button" key={choice.label} disabled={action.busy} onClick={() => snooze(choice.date)}><span>{choice.label}</span><span className="mono-meta">{dateLabel(choice.date, index === 0)}</span></button>)}
        {picking
          ? <div className="snooze-pick"><input type="date" aria-label="Snooze until" min={calendarDaysFromNow(1, data.church.timezone)} value={date} onChange={(event) => setDate(event.target.value)} /><button type="button" className="button-ink" disabled={action.busy || !date} onClick={() => snooze(date)}>Snooze</button></div>
          : <button type="button" onClick={() => setPicking(true)}><span>Pick a date</span><span className="mono-meta" aria-hidden="true">›</span></button>}
      </div>
    </section>}
    {(canHandOff || canGiveBack) && <section aria-label="Hand it off">
      <p className="mono-meta">{canAct ? "Or hand it off" : "Hand it to"}</p>
      <div className="handoff-faces">
        {canHandOff && shown.map((member) => <button type="button" key={member.id} aria-label={`Hand off to ${member.name}`} disabled={action.busy} onClick={() => void action.save(() => onAssign!(task.id, member.id), onClose)}><span>{initials(member.name)}</span>{member.id === activeVolunteerId ? "Me" : member.name.split(" ")[0]}</button>)}
        {canGiveBack && <button type="button" className="leaders" aria-label="Give it back to the leaders" disabled={action.busy} onClick={() => void action.save(() => onAccept!(task.id, "declined"), onClose)}><span><Star size={16} aria-hidden="true" /></span>Leaders</button>}
        {canHandOff && !everyone && members.length > shown.length && <button type="button" className="anyone" aria-label="Choose from everyone" onClick={() => setEveryone(true)}><span><Plus size={18} aria-hidden="true" /></span>Anyone</button>}
      </div>
      {canHandOff && <p className="handoff-note">They’ll be asked to accept it.</p>}
    </section>}
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
  </Sheet>;
}
