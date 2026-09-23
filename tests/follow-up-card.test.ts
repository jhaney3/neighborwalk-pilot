import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskCard, type FollowUpsViewProps } from "../components/FollowUpsView";
import type { FollowUp } from "../lib/domain";
import { createSeedData } from "../lib/seed";

function renderTask(task: FollowUp, canManage = true) {
  const data = createSeedData();
  const props: FollowUpsViewProps & { task: FollowUp } = {
    task,
    data,
    canManage,
    activeVolunteerId: data.volunteers[0].id,
    onClearPersonFocus: () => undefined,
    onOpenProperty: () => undefined,
    onOpenPerson: () => undefined,
    onAddPersonNote: async () => undefined,
    onComplete: async () => undefined,
    onReschedule: async () => undefined,
    onCancel: async () => undefined,
    onAssign: async () => undefined,
    onAccept: async () => undefined,
  };
  return renderToStaticMarkup(createElement(TaskCard, props));
}

describe("follow-up task ownership", () => {
  it("shows a leader an assignment control instead of accepted work controls when the owner is missing", () => {
    const data = createSeedData();
    const task = { ...data.followUps[0], assignedVolunteerId: undefined, acceptance: "accepted" as const };
    const markup = renderTask(task);

    expect(markup).toContain("Owner: Needs an owner");
    expect(markup).toContain("Assign an owner");
    expect(markup).toContain('aria-label="Owner"');
    expect(markup).toContain('class="followup-actions needs-owner"');
    expect(markup).not.toContain('class="followup-actions-outcome"');
    expect(markup).not.toContain("Who will do this?");
    expect(markup).not.toContain(">Accepted<");
    expect(markup).not.toMatch(/\bMark done<\/button>/);
  });

  it("shows acceptance and completion only when the task has an active owner", () => {
    const data = createSeedData();
    const owner = data.volunteers[0];
    const task = { ...data.followUps[0], assignedVolunteerId: owner.id, acceptance: "accepted" as const };
    const markup = renderTask(task);

    expect(markup).toContain(`Owner: ${owner.name}`);
    expect(markup).toContain(">Accepted<");
    expect(markup).toMatch(/\bMark done<\/button>/);
  });

  it("keeps the access warning with an unowned person-linked task", () => {
    const data = createSeedData();
    const task = { ...data.followUps.find((followUp) => followUp.residentId)!, assignedVolunteerId: undefined, acceptance: "accepted" as const };
    const markup = renderTask(task);

    expect(markup).toContain("Share their profile or hand them off before assigning someone new.");
  });
});
