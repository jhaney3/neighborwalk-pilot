"use client";

import { Check, MailPlus } from "lucide-react";
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
  not_going: "Can’t make it",
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

  return <section className="outing-invitation-roster" aria-labelledby="outing-invitation-title">
    <div className="walk-crew-section-heading"><h4 id="outing-invitation-title">Invited</h4><span>{selectedIds.length} invited</span></div>
    <div className="outing-invitation-list" role="group" aria-label="People invited to this walk">
      {activeVolunteers.map((volunteer) => {
        const invited = selected.has(volunteer.id);
        const status = participantStatus.get(volunteer.id);
        const checkedIn = status === "checked_in";
        return <button type="button" key={volunteer.id} className={invited ? "selected" : ""} aria-pressed={invited} aria-label={checkedIn ? `${volunteer.name} is already checked in` : `${invited ? "Remove" : "Invite"} ${volunteer.name}`} disabled={checkedIn} onClick={() => toggle(volunteer.id)}>
          <i>{volunteer.name.charAt(0).toUpperCase()}</i><span><strong>{volunteer.name}</strong>{status && invited && <small>{statusLabel[status]}</small>}</span>
          {invited ? <Check size={18} aria-hidden="true" /> : <MailPlus size={18} aria-hidden="true" />}
        </button>;
      })}
    </div>
    <div className="walk-crew-quick-actions">
      <button type="button" onClick={() => onChange(activeVolunteers.map((volunteer) => volunteer.id))}>Invite everyone</button>
      <button type="button" disabled={!removableInvitationCount} onClick={() => onChange([...checkedInIds])}>{checkedInIds.size ? "Clear other invitations" : "Clear invitations"}</button>
    </div>
    <p className="walk-crew-help">Invited people see the walk on Home and can respond. Crews are built from whoever arrives.</p>
    {savedGroups.length > 0 && <div className="walk-saved-groups"><span>Saved groups</span><div>{savedGroups.map((team) => <button type="button" key={team.id} onClick={() => addGroup(team.memberIds)}>{team.name}<small>{team.memberIds.filter((id) => activeVolunteers.some((volunteer) => volunteer.id === id)).length} active</small></button>)}</div></div>}
  </section>;
}
