import { describe, expect, it } from "vitest";
import { createSeedData } from "../lib/seed";
import { elapsedLabel, personalHistory, todayWalkSummary } from "../lib/today-history";
import type { Visit } from "../lib/domain";

const NOW = new Date("2026-09-24T15:00:00.000Z"); // 10:00 AM in Chicago

function visit(overrides: Partial<Visit>): Visit {
  return { id: "v", churchId: "c", volunteerId: "volunteer_erica", outcome: "conversation", context: "door", recordedAt: "2026-09-24T14:42:00.000Z", deviceId: "d", ...overrides };
}

describe("personalHistory", () => {
  it("lists only the signed-in person's encounters from today, newest first", () => {
    const data = createSeedData();
    data.church.timezone = "America/Chicago";
    const home = data.properties[0];
    data.visits = [
      visit({ id: "mine-early", propertyId: home.id, outcome: "no_answer", recordedAt: "2026-09-24T14:31:00.000Z" }),
      visit({ id: "mine-late", propertyId: home.id, recordedAt: "2026-09-24T14:42:00.000Z", needs: ["prayer"] }),
      visit({ id: "teammate", volunteerId: "volunteer_maya", recordedAt: "2026-09-24T14:50:00.000Z" }),
      visit({ id: "yesterday", recordedAt: "2026-09-23T20:00:00.000Z" }),
    ];
    const entries = personalHistory(data, "volunteer_erica", NOW);
    expect(entries.map((entry) => entry.id)).toEqual(["mine-late", "mine-early"]);
    expect(entries[0].title).toBe(`Talked · ${home.address}`);
    expect(entries[0].detail).toBe("Prayer");
    expect(entries[1].title).toBe(`No answer · ${home.address}`);
  });

  it("uses the reviewed outcome and hides voided encounters", () => {
    const data = createSeedData();
    data.church.timezone = "America/Chicago";
    data.visits = [
      visit({ id: "corrected", context: "community_meal", placeLabel: "Friday supper", corrections: [{ id: "c1", actorId: "volunteer_erica", createdAt: NOW.toISOString(), reason: "Wrong outcome", outcome: "follow_up", context: "community_meal", voided: false }] }),
      visit({ id: "voided", corrections: [{ id: "c2", actorId: "volunteer_erica", createdAt: NOW.toISOString(), reason: "Duplicate", outcome: "conversation", context: "door", voided: true }] }),
    ];
    const entries = personalHistory(data, "volunteer_erica", NOW);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Follow-up · Friday supper");
  });
});

describe("todayWalkSummary", () => {
  it("reports minutes only once a live walk has started, plus walking partners", () => {
    const data = createSeedData();
    const outing = { ...data.events[0], status: "active" as const, startsAt: "2026-09-24T14:22:00.000Z" };
    data.teams = [{ ...data.teams[0], id: "pair", memberIds: ["volunteer_erica", "volunteer_maya"] }];
    const assignment = { id: "a", churchId: data.church.id, eventId: outing.id, territoryId: data.territories[0].id, assignedTeamId: "pair", status: "accepted" as const };
    const summary = todayWalkSummary(data, outing, assignment, "volunteer_erica", NOW);
    expect(summary.minutes).toBe(38);
    expect(summary.partners).toEqual(["Maya"]);
    expect(todayWalkSummary(data, { ...outing, status: "ready" }, assignment, "volunteer_erica", NOW).minutes).toBeUndefined();
  });

  it("formats elapsed time", () => {
    expect(elapsedLabel(38)).toBe("38 min");
    expect(elapsedLabel(60)).toBe("1 hr");
    expect(elapsedLabel(72)).toBe("1 hr 12 min");
  });
});
