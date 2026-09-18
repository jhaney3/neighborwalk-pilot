import { describe, expect, it } from "vitest";
import {
  conversationGuideTeam,
  conversationGuideFromRow,
  legacyConversationGuide,
  makeBlankGuideStep,
  normalizeGuideSteps,
  parseScriptureReferenceInput,
  preferredConversationGuide,
  resolveFieldGuide,
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

  it("preserves spaces and an unfinished comma while scripture references are entered", () => {
    expect(parseScriptureReferenceInput("Romans ")).toEqual(["Romans "]);
    expect(parseScriptureReferenceInput("Romans 3:23, ")).toEqual(["Romans 3:23", ""]);
    expect(parseScriptureReferenceInput("1 John 4:8,   Song of Solomon 2:4"))
      .toEqual(["1 John 4:8", "Song of Solomon 2:4"]);
    expect(parseScriptureReferenceInput("Romans 3:23, Romans 5:8, Ephesians 2:8–9"))
      .toEqual(["Romans 3:23", "Romans 5:8", "Ephesians 2:8–9"]);
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

  it("labels the actual field guide, preserving precedence without treating stale/private IDs as church assignments", () => {
    const personal = guide("personal", "personal"); const church = guide("church", "church"); const outing = guide("outing", "church");
    const library = [personal, church, outing];
    expect(resolveFieldGuide(library, { outingGuideId: outing.id, teamDefaultGuideId: church.id, favoriteGuideId: personal.id })).toEqual({ guide: outing, source: "outing" });
    expect(resolveFieldGuide(library, { outingGuideId: "unavailable", teamDefaultGuideId: church.id, favoriteGuideId: personal.id })).toEqual({ guide: church, source: "group" });
    expect(resolveFieldGuide(library, { outingGuideId: personal.id, teamDefaultGuideId: personal.id, favoriteGuideId: personal.id })).toEqual({ guide: personal, source: "favorite" });
    expect(resolveFieldGuide(library, { favoriteGuideId: "unavailable" })).toEqual({ guide: church, source: "church" });
    expect(resolveFieldGuide([personal], {})).toEqual({ guide: personal, source: "personal" });
    expect(resolveFieldGuide([], {})).toEqual({ guide: undefined, source: undefined });
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

  it("creates a blank editable step with optional coaching and reminder fields", () => {
    expect(makeBlankGuideStep(2)).toMatchObject({
      order: 2,
      eyebrow: "Step 2",
      coaching: "",
      reminder: "",
      scriptureReferences: [],
    });
  });

  it("preserves useful coaching/reminders and enforces their editable limits", () => {
    const input = { scope: "church" as const, title: "Fictional guide", description: "", steps: [step({ coaching: "  Listen before speaking.  ", reminder: "  Respect their answer.  " })] };
    expect(normalizeGuideSteps(input.steps)[0]).toMatchObject({ coaching: "Listen before speaking.", reminder: "Respect their answer." });
    expect(validGuideInput(input)).toBe(true);
    expect(validGuideInput({ ...input, steps: [step({ coaching: "a".repeat(801) })] })).toBe(false);
    expect(validGuideInput({ ...input, steps: [step({ reminder: "a".repeat(801) })] })).toBe(false);
  });

  it("reads Supabase timestamps that include a UTC offset", () => {
    const parsed = conversationGuideFromRow({
      id: "00000000-0000-4000-8000-000000000001",
      church_id: "00000000-0000-4000-8000-000000000002",
      scope: "church",
      owner_user_id: null,
      title: "Listen, share, invite",
      description: "A guide",
      steps: [step()],
      sort_order: 0,
      created_by: "00000000-0000-4000-8000-000000000003",
      updated_by: "00000000-0000-4000-8000-000000000003",
      created_at: "2026-08-29T12:00:00+00:00",
      updated_at: "2026-08-29T12:00:01.123456+00:00",
    });

    expect(parsed).toMatchObject({
      createdAt: "2026-08-29T12:00:00.000Z",
      updatedAt: "2026-08-29T12:00:01.123Z",
    });
  });
});
