"use client";

import { Check } from "lucide-react";
import { useMemo } from "react";
import type { NeighborWalkData } from "../lib/domain";

type Props = {
  data: NeighborWalkData;
  eventId?: string;
  selectedIds: string[];
  onChange: (memberIds: string[]) => void;
};

const statusLabel = {
  invited: "Invited",
  going: "Going",
  not_going: "Can’t go",
  checked_in: "Here",
} as const;

export function OutingInvitationRoster({ data, eventId, selectedIds, onChange }: Props) {
  const activeVolunteers = useMemo(() => data.volunteers.filter((volunteer) => volunteer.active), [data.volunteers]);
  const selected = new Set(selectedIds);
  const participantStatus = new Map(data.outingParticipants.filter((participant) => participant.eventId === eventId)
    .map((participant) => [participant.volunteerId, participant.status]));
  const checkedInIds = new Set([...participantStatus].filter(([, status]) => status === "checked_in").map(([volunteerId]) => volunteerId));
  const removableInvitationCount = selectedIds.filter((id) => !checkedInIds.has(id)).length;
  const targetCrewTeamIds = new Set((data.assignments ?? []).filter((assignment) => assignment.targetId && assignment.assignedTeamId)
    .map((assignment) => assignment.assignedTeamId));
  const savedGroups = data.teams.filter((team) => team.status !== "finished" && !targetCrewTeamIds.has(team.id)
    && team.memberIds.some((id) => activeVolunteers.some((volunteer) => volunteer.id === id)));
  const toggle = (memberId: string) => onChange(selected.has(memberId)
    ? selectedIds.filter((id) => id !== memberId)
    : [...selectedIds, memberId]);
  const addGroup = (memberIds: string[]) => onChange([...new Set([...selectedIds, ...memberIds.filter((id) => activeVolunteers.some((volunteer) => volunteer.id === id))])]);

  const teamInvited = (memberIds: string[]) => memberIds.filter((id) => activeVolunteers.some((volunteer) => volunteer.id === id)).every((id) => selected.has(id));
  return <section className="outing-invitation-roster" aria-labelledby="outing-invitation-title">
    {savedGroups.length > 0 && <div className="walk-saved-groups" role="group" aria-label="Saved teams"><span className="mono-meta">Saved teams</span><div>{savedGroups.map((team) => {
      const count = team.memberIds.filter((id) => activeVolunteers.some((volunteer) => volunteer.id === id)).length;
      const all = teamInvited(team.memberIds);
      return <button type="button" key={team.id} aria-pressed={all} onClick={() => addGroup(team.memberIds)}>{all && <Check size={14} aria-hidden="true" />}{team.name}<small>{count}</small></button>;
    })}</div></div>}
    <div className="walk-crew-section-heading"><h4 id="outing-invitation-title">{selectedIds.length} invited</h4><div className="walk-crew-quick-actions">
      <button type="button" onClick={() => onChange(activeVolunteers.map((volunteer) => volunteer.id))}>Invite everyone</button>
      <button type="button" disabled={!removableInvitationCount} onClick={() => onChange([...checkedInIds])}>{checkedInIds.size ? "Clear others" : "Clear"}</button>
    </div></div>
    <div className="outing-invitation-list" role="group" aria-label="People invited to this walk">
      {activeVolunteers.map((volunteer) => {
        const invited = selected.has(volunteer.id);
        const status = participantStatus.get(volunteer.id);
        const checkedIn = status === "checked_in";
        return <button type="button" key={volunteer.id} className={invited ? "selected" : ""} aria-pressed={invited} aria-label={checkedIn ? `${volunteer.name} is already checked in` : `${invited ? "Remove" : "Invite"} ${volunteer.name}`} disabled={checkedIn} onClick={() => toggle(volunteer.id)}>
          <b className="check-box" aria-hidden="true">{invited && <Check size={15} strokeWidth={3} />}</b><span><strong>{volunteer.name}</strong></span>
          {status && invited ? <small className="mono-meta">{statusLabel[status]}</small> : <span aria-hidden="true" />}
        </button>;
      })}
    </div>
    <p className="walk-crew-help">Invited people see the walk on Today and can reply. Teams form from whoever shows up.</p>
  </section>;
}
