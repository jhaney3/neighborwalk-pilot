"use client";

import { useState, type ComponentProps } from "react";
import { ClipboardCheck, MessageCircle, Plus, Users } from "lucide-react";
import { navigateTabs } from "../lib/tab-navigation";
import { ConversationFeed } from "./ConversationFeed";
import { FollowUpsView } from "./FollowUpsView";
import { PeopleView } from "./PeopleView";
import { ViewHeading } from "./ui";

export type PeopleWorkspaceProps = {
  peopleProps: ComponentProps<typeof PeopleView>;
  followUpProps: ComponentProps<typeof FollowUpsView>;
  initialPanel?: "followups" | "directory";
  onPanelChange?: (panel: "followups" | "directory") => void;
  hidden?: boolean;
};

export function PeopleWorkspace({ peopleProps, followUpProps, initialPanel = "followups", onPanelChange, hidden }: PeopleWorkspaceProps) {
  const initialSelection = peopleProps.initialSelectedResidentId ?? null;
  const [localSelectedResidentId, setSelectedResidentId] = useState<string | null>(initialSelection);
  const [addPersonRequested, setAddPersonRequested] = useState(false);
  // The conversations feed is a local view; the URL keeps tracking the
  // follow-up and directory panels it always has.
  const [conversationsOpen, setConversationsOpen] = useState(false);
  const [localPanel, setPanel] = useState<"followups" | "directory">(
    initialSelection ? "directory" : initialPanel,
  );
  const selectedResidentId = addPersonRequested ? null : onPanelChange ? initialSelection : localSelectedResidentId;
  const panel = addPersonRequested ? "directory" : onPanelChange ? (initialSelection ? "directory" : initialPanel) : localPanel;

  const selectResident = (residentId?: string) => {
    setConversationsOpen(false);
    setSelectedResidentId(residentId ?? null);
    if (residentId) setPanel("directory");
    peopleProps.onSelectResident?.(residentId);
  };

  const selectPanel = (index: number, clearLegacyFocus = true) => {
    if (index === 2) { setConversationsOpen(true); return; }
    setConversationsOpen(false);
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

  return <section hidden={hidden} className={`content-view people-workspace${panel === "directory" && selectedResidentId ? " has-selected-person" : ""}`}>
    <ViewHeading title="People" />
    <div className="people-workspace-switcher">
      <div className="people-workspace-tabs" role="tablist" tabIndex={-1} aria-orientation="horizontal" aria-label="People views" onKeyDown={(event) => navigateTabs(event, selectPanel)}>
        <button id="people-followups-tab" type="button" role="tab" aria-controls="people-workspace-panel" aria-selected={!conversationsOpen && panel === "followups"} tabIndex={!conversationsOpen && panel === "followups" ? 0 : -1} className={!conversationsOpen && panel === "followups" ? "active" : ""} onClick={() => selectPanel(0)} onFocus={() => selectPanel(0, false)}><ClipboardCheck size={16} /> Follow-ups</button>
        <button id="people-directory-tab" type="button" role="tab" aria-controls="people-workspace-panel" aria-selected={!conversationsOpen && panel === "directory"} tabIndex={!conversationsOpen && panel === "directory" ? 0 : -1} className={!conversationsOpen && panel === "directory" ? "active" : ""} onClick={() => selectPanel(1)} onFocus={() => selectPanel(1, false)}><Users size={16} /> Everyone</button>
        <button id="people-conversations-tab" type="button" role="tab" aria-controls="people-workspace-panel" aria-selected={conversationsOpen} tabIndex={conversationsOpen ? 0 : -1} className={conversationsOpen ? "active" : ""} onClick={() => selectPanel(2)}><MessageCircle size={16} aria-hidden="true" /> Conversations</button>
      </div>
      {!conversationsOpen && panel === "followups" && <button type="button" className="button primary people-workspace-add" onClick={() => { setSelectedResidentId(null); setAddPersonRequested(true); setPanel("directory"); }}><Plus size={15} /> Add person</button>}
    </div>
    <div id="people-workspace-panel" role="tabpanel" aria-labelledby={conversationsOpen ? "people-conversations-tab" : panel === "followups" ? "people-followups-tab" : "people-directory-tab"} className="people-workspace-panel">
      {conversationsOpen
        ? <ConversationFeed data={peopleProps.data} onOpenPerson={(residentId) => selectResident(residentId)} />
        : panel === "followups"
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
