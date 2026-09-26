"use client";

import { Check, ChevronLeft } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { autoPair } from "../lib/auto-pair";
import type { NeighborWalkData, OutreachEvent } from "../lib/domain";
import { useAsyncAction } from "../lib/use-async-action";
import { targetCrewMemberIds } from "../lib/walk-crews";
import type { WalkTarget } from "../lib/walk-targets";
import { selectionTick } from "../mobile/haptics";
import { Sheet } from "./Sheet";
import { initials } from "./ui";

export type WalkCrews = Record<string, string[]>;

/** Check-in (BD9): tap who's here, then pair them onto routes. Auto-pair keeps
 * saved teams together; tapping a route moves people onto it. */
export function CheckInScreen({ data, outing, targets, onClose, onSave, onStart }: {
  data: NeighborWalkData;
  outing: OutreachEvent;
  targets: WalkTarget[];
  onClose: () => void;
  onSave: (eventId: string, crews: WalkCrews, attendingIds: string[]) => Promise<void>;
  /** Present while the walk is ready: save teams, then start the walk. */
  onStart?: () => Promise<unknown>;
}) {
  const [crews, setCrews] = useState<WalkCrews>(() => Object.fromEntries(targets.map((target) => [target.id, targetCrewMemberIds(data, target.id)])));
  const [attendingIds, setAttendingIds] = useState<string[]>(() => [...new Set([
    ...data.outingParticipants.filter((participant) => participant.eventId === outing.id && participant.status === "checked_in").map((participant) => participant.volunteerId),
    ...targets.flatMap((target) => targetCrewMemberIds(data, target.id)),
  ])]);
  const [editing, setEditing] = useState<string | null>(null);
  const action = useAsyncAction();
  const titleId = useId();
  const people = useMemo(() => data.volunteers.filter((volunteer) => volunteer.active), [data.volunteers]);
  const names = useMemo(() => new Map(data.volunteers.map((volunteer) => [volunteer.id, volunteer.name])), [data.volunteers]);
  const invited = new Set(data.outingParticipants.filter((participant) => participant.eventId === outing.id && participant.status !== "not_going").map((participant) => participant.volunteerId));
  const faces = [...people].filter((person) => invited.size === 0 || invited.has(person.id) || attendingIds.includes(person.id)).sort((a, b) => a.name.localeCompare(b.name));
  const crewTeamIds = new Set((data.assignments ?? []).filter((assignment) => assignment.targetId && assignment.assignedTeamId).map((assignment) => assignment.assignedTeamId));
  const savedTeams = data.teams.filter((team) => team.status !== "finished" && !crewTeamIds.has(team.id) && team.memberIds.some((id) => people.some((person) => person.id === id)));
  const withoutEveryCrew = (memberId: string, next: WalkCrews = crews) => Object.fromEntries(targets.map((target) => [target.id, (next[target.id] ?? []).filter((id) => id !== memberId)]));
  const toggleHere = (memberId: string) => {
    selectionTick();
    if (attendingIds.includes(memberId)) { setAttendingIds(attendingIds.filter((id) => id !== memberId)); setCrews(withoutEveryCrew(memberId)); }
    else setAttendingIds([...attendingIds, memberId]);
  };
  const toggleOnRoute = (targetId: string, memberId: string) => {
    selectionTick();
    if (!attendingIds.includes(memberId)) setAttendingIds([...attendingIds, memberId]);
    const was = (crews[targetId] ?? []).includes(memberId);
    const next = withoutEveryCrew(memberId);
    if (!was) next[targetId] = [...(next[targetId] ?? []), memberId];
    setCrews(next);
  };
  const staffed = targets.filter((target) => (crews[target.id] ?? []).length).length;
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: outing.timezone ?? data.church.timezone }).format(new Date());
  const save = () => void action.save(() => onSave(outing.id, crews, attendingIds), onClose);
  const start = () => void action.save(async () => { await onSave(outing.id, crews, attendingIds); await onStart!(); }, onClose);
  const editingTarget = targets.find((target) => target.id === editing);

  return <div className="screen-page overlay check-in" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={action.busy}>
    <div className="screen-top"><button type="button" className="round-button float" aria-label="Back to the walk" disabled={action.busy} onClick={onClose}><ChevronLeft size={22} aria-hidden="true" /></button><span className="mono-meta">Check-in · {time}</span></div>
    <h1 className="screen-title" id={titleId}>Who’s here?</h1>
    <p className="mono-meta screen-kicker">{attendingIds.length} of {invited.size || people.length} {invited.size ? "going" : "people"} · tap to check in</p>
    <div className="face-grid" role="group" aria-label="People here">
      {faces.map((person) => {
        const here = attendingIds.includes(person.id);
        return <button type="button" key={person.id} className={here ? "here" : undefined} aria-pressed={here} aria-label={person.name} onClick={() => toggleHere(person.id)}>
          <span aria-hidden="true">{initials(person.name)}{here && <i><Check size={12} strokeWidth={3} /></i>}</span>
          <b>{person.name.split(" ")[0]}</b>
        </button>;
      })}
    </div>
    <div className="list-section-head teams-head"><h2>Teams</h2><button type="button" className="ink-pill" disabled={!attendingIds.length || !targets.length} onClick={() => { selectionTick(); setCrews(autoPair(targets.map((target) => target.id), attendingIds, savedTeams)); }}>Auto-pair</button></div>
    <div className="team-rows">
      {targets.map((target) => {
        const members = crews[target.id] ?? [];
        return <button type="button" key={target.id} className={`team-row${members.length ? "" : " empty"}`} aria-label={`${target.name}: ${members.length ? members.map((id) => names.get(id)).join(", ") : "no one yet"}. Change who walks it`} onClick={() => setEditing(target.id)}>
          <i className="color-bar" style={{ background: target.color }} aria-hidden="true" />
          <strong>{target.name}</strong>
          <span className="face-stack" aria-hidden="true">{members.map((id) => <span key={id}>{initials(names.get(id) ?? "?")}</span>)}</span>
        </button>;
      })}
    </div>
    {action.error && <p role="alert" className="inline-error">{action.error}</p>}
    {onStart ? <button type="button" className="walk-save" disabled={action.busy || !staffed} onClick={start}>{action.busy ? "Starting…" : `Start walk · ${staffed} ${staffed === 1 ? "team" : "teams"}`}</button>
      : <button type="button" className="walk-save" disabled={action.busy} onClick={save}>{action.busy ? "Saving…" : "Save teams"}</button>}
    {editingTarget && <Sheet className="plain-sheet" modal label={`Who walks ${editingTarget.name}`} onDismiss={() => setEditing(null)}>
      <h2 className="pin-title">{editingTarget.name}</h2>
      <p className="pin-source">Tap to put someone on this route. It moves them from any other.</p>
      <div className="grouped-rows" role="group" aria-label={`Team for ${editingTarget.name}`}>
        {attendingIds.map((memberId) => {
          const on = (crews[editingTarget.id] ?? []).includes(memberId);
          const elsewhere = targets.find((target) => target.id !== editingTarget.id && (crews[target.id] ?? []).includes(memberId));
          return <button type="button" key={memberId} className="grouped-row check-row" role="checkbox" aria-checked={on} onClick={() => toggleOnRoute(editingTarget.id, memberId)}>
            <span className={`check-square${on ? " on" : ""}`} aria-hidden="true">{on && <Check size={15} strokeWidth={3} />}</span>
            <span className="grouped-row-text"><strong>{names.get(memberId) ?? "Unavailable member"}</strong><small>{on ? "On this route" : elsewhere ? `On ${elsewhere.name}` : "Waiting"}</small></span>
          </button>;
        })}
        {!attendingIds.length && <p className="home-empty">Check people in first.</p>}
      </div>
      <button type="button" className="walk-save" onClick={() => setEditing(null)}>Done</button>
    </Sheet>}
  </div>;
}
