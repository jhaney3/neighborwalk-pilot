"use client";

import { type ComponentProps } from "react";
import { FollowUpsView } from "./FollowUpsView";
import { PeopleView } from "./PeopleView";

export type PeopleWorkspaceProps = {
  peopleProps: ComponentProps<typeof PeopleView>;
  followUpProps: ComponentProps<typeof FollowUpsView>;
  initialPanel?: "followups" | "directory";
  onPanelChange?: (panel: "followups" | "directory") => void;
  hidden?: boolean;
};

/** Follow-ups and People are separate tabs that share one mounted workspace,
 * so a trip to the map and back keeps each tab where it was. */
export function PeopleWorkspace({ peopleProps, followUpProps, initialPanel = "followups", hidden }: PeopleWorkspaceProps) {
  const selectedResidentId = peopleProps.initialSelectedResidentId ?? null;
  const panel = selectedResidentId ? "directory" : initialPanel;
  return <section hidden={hidden} className={`content-view people-workspace section-${panel}`}>
    <div id="people-workspace-panel" className="people-workspace-panel">
      {panel === "followups"
        ? <FollowUpsView key={[followUpProps.focusedTaskId, followUpProps.initialPersonId, followUpProps.initialScope].join(":")} {...followUpProps} embedded />
        : <PeopleView key={selectedResidentId ?? "directory"} {...peopleProps} embedded initialSelectedResidentId={selectedResidentId} />}
    </div>
  </section>;
}
