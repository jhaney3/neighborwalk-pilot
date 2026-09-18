"use client";

import { Check, UserPlus, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { NeighborWalkData } from "../lib/domain";

export type WalkCrewTarget = { id: string; name: string; color: string; propertyCount: number };
export type WalkCrews = Record<string, string[]>;

type Props = {
  data: NeighborWalkData;
  targets: WalkCrewTarget[];
  crews: WalkCrews;
  onChange: (crews: WalkCrews) => void;
  initialAttendingIds?: string[];
  onAttendanceChange?: (memberIds: string[]) => void;
};

export function WalkCrewBoard({ data, targets, crews, onChange, initialAttendingIds, onAttendanceChange }: Props) {
  const activeVolunteers = useMemo(() => data.volunteers.filter((volunteer) => volunteer.active), [data.volunteers]);
  const initialCrewMembers = useMemo(() => [...new Set(Object.values(crews).flat())], [crews]);
  const [attendingIds, setAttendingIds] = useState<string[]>(() => [...new Set([...(initialAttendingIds ?? []), ...initialCrewMembers])]);
  const names = useMemo(() => new Map(data.volunteers.map((volunteer) => [volunteer.id, volunteer.name])), [data.volunteers]);
  const targetByMember = useMemo(() => {
    const result = new Map<string, string>();
    for (const target of targets) for (const memberId of crews[target.id] ?? []) result.set(memberId, target.id);
    return result;
  }, [crews, targets]);
  const assignedCount = attendingIds.filter((id) => targetByMember.has(id)).length;
  const waitingIds = attendingIds.filter((id) => !targetByMember.has(id));
  const targetCrewTeamIds = new Set((data.assignments ?? []).filter((assignment) => assignment.targetId && assignment.assignedTeamId).map((assignment) => assignment.assignedTeamId));
  const savedGroups = data.teams.filter((team) => team.status !== "finished" && !targetCrewTeamIds.has(team.id)
    && team.memberIds.some((id) => activeVolunteers.some((volunteer) => volunteer.id === id)));

  const removeFromEveryCrew = (memberId: string, next: WalkCrews = crews) => Object.fromEntries(
    targets.map((target) => [target.id, (next[target.id] ?? []).filter((id) => id !== memberId)]),
  );
  const setAttendance = (next: string[]) => {
    setAttendingIds(next);
    onAttendanceChange?.(next);
  };
  const setPresent = (memberId: string) => {
    if (attendingIds.includes(memberId)) {
      setAttendance(attendingIds.filter((id) => id !== memberId));
      onChange(removeFromEveryCrew(memberId));
    } else {
      setAttendance([...attendingIds, memberId]);
    }
  };
  const moveMember = (targetId: string, memberId: string) => {
    if (!attendingIds.includes(memberId)) setAttendance([...attendingIds, memberId]);
    const wasHere = (crews[targetId] ?? []).includes(memberId);
    const next = removeFromEveryCrew(memberId);
    if (!wasHere) next[targetId] = [...(next[targetId] ?? []), memberId];
    onChange(next);
  };
  const addMembers = (targetId: string, memberIds: string[]) => {
    const eligible = [...new Set(memberIds)].filter((id) => activeVolunteers.some((volunteer) => volunteer.id === id));
    setAttendance([...new Set([...attendingIds, ...eligible])]);
    let next = crews;
    for (const memberId of eligible) next = removeFromEveryCrew(memberId, next);
    onChange({ ...next, [targetId]: [...new Set([...(next[targetId] ?? []), ...eligible])] });
  };
  const clearAttendance = () => {
    setAttendance([]);
    onChange(Object.fromEntries(targets.map((target) => [target.id, []])));
  };

  return <div className="walk-crew-board">
    <section className="walk-checkin" aria-labelledby="walk-checkin-title">
      <div className="walk-crew-section-heading"><div><p>Check-in</p><h4 id="walk-checkin-title">Who is here?</h4></div><span>{attendingIds.length} here</span></div>
      <p className="walk-crew-help">Tap names as people arrive. Marking someone absent also removes them from tonight’s crew.</p>
      <div className="walk-crew-quick-actions"><button type="button" className="button quiet small" onClick={() => setAttendance(activeVolunteers.map((volunteer) => volunteer.id))}>Everyone is here</button><button type="button" className="button quiet small" disabled={!attendingIds.length} onClick={clearAttendance}>Clear check-in</button></div>
      <div className="walk-attendance-list" role="group" aria-label="People here tonight">
        {activeVolunteers.map((volunteer) => {
          const present = attendingIds.includes(volunteer.id);
          return <button type="button" key={volunteer.id} className={present ? "present" : ""} aria-label={volunteer.name} aria-pressed={present} onClick={() => setPresent(volunteer.id)}><span>{volunteer.name.charAt(0).toUpperCase()}</span>{volunteer.name}{present && <Check size={14} aria-hidden="true" />}</button>;
        })}
      </div>
    </section>

    <div className="walk-crew-status" role="status"><Users size={17} aria-hidden="true" /><strong>{assignedCount} assigned</strong><span>{waitingIds.length ? `${waitingIds.length} still waiting: ${waitingIds.map((id) => names.get(id) ?? "Unavailable member").join(", ")}` : attendingIds.length ? "Everyone here has a target." : "Check people in now, or staff targets later."}</span></div>

    <div className="walk-crew-targets">
      {targets.map((target) => {
        const memberIds = crews[target.id] ?? [];
        const waiting = waitingIds.length > 0;
        return <article key={target.id} className="walk-crew-target" style={{ borderTopColor: target.color }}>
          <header><i style={{ background: target.color }} /><div><strong>{target.name}</strong><small>{target.propertyCount} residential {target.propertyCount === 1 ? "property" : "properties"}</small></div><span>{memberIds.length ? `${memberIds.length} ${memberIds.length === 1 ? "person" : "people"}` : "Staff later"}</span></header>
          <div className="walk-crew-members">
            {memberIds.map((memberId) => <button type="button" key={memberId} aria-label={`Remove ${names.get(memberId) ?? "unavailable member"} from ${target.name}`} onClick={() => moveMember(target.id, memberId)}>{names.get(memberId) ?? "Unavailable member"}<X size={13} aria-hidden="true" /></button>)}
            {!memberIds.length && <p>No one assigned yet. The target can still be saved and staffed when people arrive.</p>}
          </div>
          <details className="walk-crew-picker">
            <summary><UserPlus size={15} aria-hidden="true" /> Add or move people</summary>
            <div>
              {waiting && <button type="button" className="walk-crew-add-all" onClick={() => addMembers(target.id, waitingIds)}>Assign everyone waiting</button>}
              <div className="walk-crew-person-list" role="group" aria-label={`Crew for ${target.name}`}>
                {attendingIds.map((memberId) => {
                  const assignedTargetId = targetByMember.get(memberId);
                  const onThisTarget = assignedTargetId === target.id;
                  const assignedTarget = targets.find((item) => item.id === assignedTargetId);
                  return <button type="button" key={memberId} className={onThisTarget ? "selected" : ""} aria-pressed={onThisTarget} onClick={() => moveMember(target.id, memberId)}><span>{names.get(memberId) ?? "Unavailable member"}<small>{onThisTarget ? "On this target" : assignedTarget ? `Move from ${assignedTarget.name}` : "Waiting"}</small></span>{onThisTarget && <Check size={15} aria-hidden="true" />}</button>;
                })}
                {!attendingIds.length && <p>Check in at least one person above, or use a saved group.</p>}
              </div>
              {savedGroups.length > 0 && <div className="walk-saved-groups"><span>Use a saved group as a starting point</span><div>{savedGroups.map((team) => <button type="button" key={team.id} onClick={() => addMembers(target.id, team.memberIds)}>{team.name}<small>{team.memberIds.filter((id) => activeVolunteers.some((volunteer) => volunteer.id === id)).length} active</small></button>)}</div></div>}
            </div>
          </details>
        </article>;
      })}
    </div>
  </div>;
}
