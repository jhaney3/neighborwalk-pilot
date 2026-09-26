"use client";
import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import type { NeighborWalkData, OutreachEvent, ResidentInput } from "../lib/domain";
import type { OutingParticipant, OutingResponse } from "../lib/outing-participants";
import type { EncounterInput } from "../lib/encounters";
import { parentZoneTouchedParcelKeys } from "../lib/target-coverage";
import type { SaveTarget, WalkTarget } from "../lib/walk-targets";
import { useAsyncAction } from "../lib/use-async-action";
import { assignmentStatusLabels } from "../lib/status-labels";
import type { NewParentZoneInput } from "./ParentZoneCreator";
import { Modal, useConfirm } from "./ui";
import { WalkSetupWizard } from "./WalkSetupWizard";
import type { WalkCrews } from "./WalkCrewBoard";
import { WalkTargetPlanner, type WalkTargetDraft } from "./WalkTargetPlanner";
import { WalkPage } from "./WalkPage";
import { WalksList } from "./WalksList";

type Assignment = NonNullable<NeighborWalkData["assignments"]>[number];

// Kept here for existing imports; the rule lives with the other walk helpers.
export { isCommunityOuting } from "../lib/walk-phase";

type Props = {
  data: NeighborWalkData; canManage: boolean; activeVolunteerId: string;
  selectedId?: string; initialCreate?: boolean; onCreateClosed?: () => void; onSelect: (id?: string) => void; onStart: (id: string, territoryId: string, targetId?: string) => Promise<unknown>;
  onSave: (input: Omit<OutreachEvent, "id" | "churchId">, id?: string) => Promise<string>;
  onRepeat: (id: string, startsAt: string, endsAt: string) => Promise<string>;
  onAssign: (input: Omit<Assignment, "id" | "churchId">, id?: string) => Promise<string>;
  onSaveRoster: (eventId: string, memberIds: string[]) => Promise<void>;
  onSaveCrews: (eventId: string, crews: WalkCrews, attendingIds: string[]) => Promise<void>;
  onSaveTarget: SaveTarget; onAddZone: (input: NewParentZoneInput) => Promise<string>;
  onReplaceTarget: (assignmentId: string, input: Parameters<SaveTarget>[0], owner: { assignedTeamId?: string; assignedVolunteerId?: string }) => Promise<string>;
  onRecordEncounter: (input: EncounterInput) => Promise<unknown>;
  onCreatePerson: (input: ResidentInput) => Promise<string>;
  onUpdatePerson?: (residentId: string, input: ResidentInput) => Promise<unknown>;
  onRespond?: (participant: OutingParticipant, response: OutingResponse) => Promise<unknown>;
  onAssignFollowUp: (followUpId: string, volunteerId: string) => Promise<unknown>;
  onNotice?: (message: string) => void;
  viewSwitch?: React.ReactNode;
};

/** Walks: the list (WK1, WK10), one walk's page (WK2–WK9), and Plan a walk. */
export function OutreachView(props: Props) {
  const { data, canManage, selectedId, onSelect, onSave } = props;
  const [wizard, setWizard] = useState<{ outing?: OutreachEvent; step: number } | null>(props.initialCreate ? { step: 0 } : null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const selected = data.events.find((event) => event.id === selectedId);
  const replacementAssignment = data.assignments?.find((assignment) => assignment.id === replacing);
  const replacementTarget = data.walkTargets.find((target) => target.id === replacementAssignment?.targetId);
  const replacementTerritory = data.territories.find((territory) => territory.id === replacementAssignment?.territoryId && territory.kind !== "list");
  return <section className="content-view outreach-view">
    {selected ? <WalkPage key={selected.id} {...props} outing={selected} onBack={() => onSelect()} onSelect={(id) => onSelect(id)} onEditSetup={(step) => setWizard({ outing: selected, step })} onReplaceRoute={setReplacing} />
      : <WalksList data={data} canManage={canManage} activeVolunteerId={props.activeVolunteerId} viewSwitch={props.viewSwitch} onSelect={(id) => onSelect(id)} onPlan={() => setWizard({ step: 0 })} />}
    {wizard && <WalkSetupWizard data={data} outing={wizard.outing} initialStep={wizard.step} onClose={() => { setWizard(null); props.onCreateClosed?.(); }} onComplete={(id) => { setWizard(null); onSelect(id); }} onSaveOuting={onSave} onSaveTarget={props.onSaveTarget} onSaveAssignment={props.onAssign} onSaveRoster={props.onSaveRoster} onAddZone={props.onAddZone} />}
    {replacementAssignment && replacementTarget && replacementTerritory && selected && <TargetReplacementModal data={data} outing={selected} assignment={replacementAssignment} target={replacementTarget} territory={replacementTerritory} onClose={() => setReplacing(null)} onReplace={props.onReplaceTarget} />}
  </section>;
}

function TargetReplacementModal({ data, outing, assignment, target, territory, onClose, onReplace }: {
  data: NeighborWalkData;
  outing: OutreachEvent;
  assignment: Assignment;
  target: WalkTarget;
  territory: NeighborWalkData["territories"][number];
  onClose: () => void;
  onReplace: Props["onReplaceTarget"];
}) {
  const [targets, setTargets] = useState<WalkTargetDraft[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const action = useAsyncAction();
  const replacement = targets.length === 1 ? targets[0] : undefined;
  const canReplace = Boolean(replacement?.parcels.length && (assignment.assignedTeamId || assignment.assignedVolunteerId));
  const currentCrewIds = assignment.assignedVolunteerId ? [assignment.assignedVolunteerId] : data.teams.find((team) => team.id === assignment.assignedTeamId)?.memberIds ?? [];
  const currentCrew = currentCrewIds.map((id) => data.volunteers.find((volunteer) => volunteer.id === id)?.name ?? "Unavailable member").join(", ");
  const visitedParcelKeys = useMemo(() => parentZoneTouchedParcelKeys(data, territory.id), [data, territory.id]);
  const confirm = useConfirm();
  const save = async () => {
    if (!replacement || !canReplace) return;
    if (!await confirm({ title: `Replace ${target.name}?`, message: "Its assignment is cancelled. Past visits stay on record.", confirmLabel: "Replace" })) return;
    const input = { ...replacement };
    delete (input as Partial<WalkTargetDraft>).clientId;
    void action.run(() => onReplace(assignment.id, input, {
      assignedTeamId: assignment.assignedTeamId,
      assignedVolunteerId: assignment.assignedVolunteerId,
    }), onClose);
  };

  return <Modal title="Replace route" description="Draw the new route inside the same neighborhood. The old route stays in the walk’s history." onClose={action.busy ? () => undefined : onClose} wide>
    <div className="form-stack walk-replacement" aria-busy={action.busy}>
      <div className="walk-replacement-context"><span>Replacing</span><strong>{target.name}</strong><small>{target.parcels.length} homes · {assignmentStatusLabels[assignment.status]}</small></div>
      <WalkTargetPlanner parentTerritory={territory} eventId={outing.id} targets={targets} selectedTargetId={selectedTargetId} mapStyleUrl={data.preferences.mapStyleUrl} visitedParcelKeys={visitedParcelKeys} demo={data.sync.mode === "device_only"} onSelectedTargetChange={setSelectedTargetId} onChange={setTargets} />
      <div className="walk-replacement-context"><span>Team carries over</span><strong>{currentCrew || "Current team"}</strong><small>You can change the team afterward.</small></div>
      {targets.length > 1 && <p className="walk-ready-note">Draw just one new route.</p>}
      {replacement && !replacement.parcels.length && <p className="walk-ready-note">Include at least one home in the new route.</p>}
      {action.error && <p className="inline-error" role="alert">{action.error}</p>}
      <div className="modal-actions"><button type="button" className="button quiet" disabled={action.busy} onClick={onClose}>Keep current route</button><button type="button" className="button primary" disabled={action.busy || !canReplace} onClick={save}><Check size={16} /> {action.busy ? "Replacing…" : "Confirm replacement"}</button></div>
    </div>
  </Modal>;
}

