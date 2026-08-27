import { describe, expect, it } from "vitest";
import {
  conversationGuideTeam,
  legacyConversationGuide,
  makeBlankGuideStep,
  normalizeGuideSteps,
  preferredConversationGuide,
  validGuideInput,
} from "../lib/conversation-guides";
import type { ConversationGuide, GuideStep, Team } from "../lib/domain";

function step(patch: Partial<GuideStep> = {}): GuideStep {
  return {
    id: "step_one",
    order: 1,
    eyebrow: "Share clearly",
    title: "Walk through the passage",
    coaching: "",
    sampleWords: "",
    reminder: "",
    scriptureReferences: ["Romans 3:23"],
    ...patch,
  };
}

function guide(id: string, scope: ConversationGuide["scope"]): ConversationGuide {
  return {
    id,
    churchId: "church_one",
    scope,
    ownerUserId: scope === "personal" ? "user_one" : undefined,
    title: id,
    description: "",
    steps: [step()],
    sortOrder: 0,
    createdAt: "2026-08-25T12:00:00.000Z",
    updatedAt: "2026-08-25T12:00:00.000Z",
  };
}

describe("conversation guides", () => {
  it("allows a scripture-only step", () => {
    expect(validGuideInput({
      scope: "personal",
      title: "Romans Road",
      description: "A sequence of passages",
      steps: [step()],
    })).toBe(true);
  });

  it("requires either words or scripture in every step", () => {
    expect(validGuideInput({
      scope: "personal",
      title: "My testimony",
      description: "",
      steps: [step({ scriptureReferences: [], sampleWords: "" })],
    })).toBe(false);
  });

  it("normalizes order and removes duplicate scripture references", () => {
    const normalized = normalizeGuideSteps([
      step({ id: "second", order: 8, scriptureReferences: [" Romans 6:23 ", "Romans 6:23"] }),
      step({ id: "first", order: 3, scriptureReferences: ["John 3:16"] }),
    ]);

    expect(normalized.map((item) => item.order)).toEqual([1, 2]);
    expect(normalized[0].scriptureReferences).toEqual(["Romans 6:23"]);
  });

  it("uses the favorite guide and otherwise prefers a church guide", () => {
    const personal = guide("personal", "personal");
    const church = guide("church", "church");

    expect(preferredConversationGuide([personal, church], personal.id)?.id).toBe(personal.id);
    expect(preferredConversationGuide([personal, church])?.id).toBe(church.id);
  });

  it("lets a church guide selected for the group override a personal favorite", () => {
    const personal = guide("personal", "personal");
    const church = guide("church", "church");

    expect(preferredConversationGuide([personal, church], personal.id, church.id)?.id).toBe(church.id);
    expect(preferredConversationGuide([personal, church], personal.id, personal.id)?.id).toBe(personal.id);
  });

  it("prefers the volunteer's territory group, then their active group", () => {
    const teams: Team[] = [
      { id: "team_active", churchId: "church_one", eventId: "event_one", name: "Active", memberIds: ["volunteer_one"], territoryIds: [], status: "active" },
      { id: "team_territory", churchId: "church_one", eventId: "event_one", name: "Territory", memberIds: ["volunteer_one"], territoryIds: [], status: "ready" },
    ];

    expect(conversationGuideTeam(teams, "volunteer_one", "team_territory")?.id).toBe("team_territory");
    expect(conversationGuideTeam(teams, "volunteer_one")?.id).toBe("team_active");
    expect(conversationGuideTeam(teams, "someone_else")).toBeUndefined();
  });

  it("wraps the legacy shared steps as a church guide", () => {
    const legacy = legacyConversationGuide("church_one", [step()]);

    expect(legacy.scope).toBe("church");
    expect(legacy.steps).toHaveLength(1);
  });

  it("creates a blank editable step with stable hidden fields", () => {
    expect(makeBlankGuideStep(2)).toMatchObject({
      order: 2,
      eyebrow: "Step 2",
      coaching: "",
      reminder: "",
      scriptureReferences: [],
    });
  });
});
