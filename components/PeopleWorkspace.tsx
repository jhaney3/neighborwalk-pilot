"use client";

import { useState, type ComponentProps } from "react";
import { ClipboardCheck, Plus, Users } from "lucide-react";
import { navigateTabs } from "../lib/tab-navigation";
import { FollowUpsView } from "./FollowUpsView";
import { PeopleView } from "./PeopleView";
import { ViewHeading } from "./ui";

export type PeopleWorkspaceProps = {
  peopleProps: ComponentProps<typeof PeopleView>;
  followUpProps: ComponentProps<typeof FollowUpsView>;
  initialPanel?: "followups" | "directory";
  onPanelChange?: (panel: "followups" | "directory") => void;
};

export function PeopleWorkspace({ peopleProps, followUpProps, initialPanel = "followups", onPanelChange }: PeopleWorkspaceProps) {
  const initialSelection = peopleProps.initialSelectedResidentId ?? null;
  const [localSelectedResidentId, setSelectedResidentId] = useState<string | null>(initialSelection);
  const [addPersonRequested, setAddPersonRequested] = useState(false);
  const [localPanel, setPanel] = useState<"followups" | "directory">(
    initialSelection ? "directory" : initialPanel,
  );
  const selectedResidentId = addPersonRequested ? null : onPanelChange ? initialSelection : localSelectedResidentId;
  const panel = addPersonRequested ? "directory" : onPanelChange ? (initialSelection ? "directory" : initialPanel) : localPanel;

  const selectResident = (residentId?: string) => {
    setSelectedResidentId(residentId ?? null);
    if (residentId) setPanel("directory");
    peopleProps.onSelectResident?.(residentId);
  };

  const selectPanel = (index: number, clearLegacyFocus = true) => {
    const nextPanel = (["followups", "directory"] as const)[index];
    if (!nextPanel) return;
    setPanel(nextPanel);
    if (clearLegacyFocus && onPanelChange) {
      onPanelChange(nextPanel);
      return;
    }
    if (nextPanel === "followups" && clearLegacyFocus && (followUpProps.focusedTaskId || followUpProps.initialPersonId)) {
      followUpProps.onClearPersonFocus();
    }
  };

  return <section className={`content-view people-workspace${panel === "directory" && selectedResidentId ? " has-selected-person" : ""}`}>
    <ViewHeading title="People" />
    <div className="people-workspace-switcher">
      <div className="people-workspace-tabs" role="tablist" tabIndex={-1} aria-orientation="horizontal" aria-label="People views" onKeyDown={(event) => navigateTabs(event, selectPanel)}>
        <button id="people-followups-tab" type="button" role="tab" aria-controls="people-workspace-panel" aria-selected={panel === "followups"} tabIndex={panel === "followups" ? 0 : -1} className={panel === "followups" ? "active" : ""} onClick={() => selectPanel(0)} onFocus={() => selectPanel(0, false)}><ClipboardCheck size={16} /> Needs follow-up</button>
        <button id="people-directory-tab" type="button" role="tab" aria-controls="people-workspace-panel" aria-selected={panel === "directory"} tabIndex={panel === "directory" ? 0 : -1} className={panel === "directory" ? "active" : ""} onClick={() => selectPanel(1)} onFocus={() => selectPanel(1, false)}><Users size={16} /> All people</button>
      </div>
      {panel === "followups" && <button type="button" className="button primary people-workspace-add" onClick={() => { setSelectedResidentId(null); setAddPersonRequested(true); setPanel("directory"); }}><Plus size={15} /> Add person</button>}
    </div>
    <div id="people-workspace-panel" role="tabpanel" aria-labelledby={panel === "followups" ? "people-followups-tab" : "people-directory-tab"} className="people-workspace-panel">
      {panel === "followups"
        ? <FollowUpsView key={[followUpProps.focusedTaskId, followUpProps.initialPersonId, followUpProps.initialScope].join(":")} {...followUpProps} embedded onOpenPerson={(residentId) => selectResident(residentId)} />
        : <PeopleView
            key={selectedResidentId ?? "directory"}
            {...peopleProps}
            embedded
            initialSelectedResidentId={selectedResidentId}
            onSelectResident={selectResident}
            initialAddPerson={addPersonRequested}
            onAddPersonClosed={() => setAddPersonRequested(false)}
            onOpenFollowUps={() => selectPanel(0)}
            renderPersonFollowUps={(residentId) => <FollowUpsView
              {...followUpProps}
              embedded
              profileMode
              focusedTaskId={undefined}
              initialPersonId={residentId}
              initialScope="all"
              onOpenTask={undefined}
              onClearPersonFocus={() => undefined}
              onOpenPerson={selectResident}
            />}
          />}
    </div>
  </section>;
}
