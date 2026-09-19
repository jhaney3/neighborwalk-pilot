import { describe, expect, it } from "vitest";
import { enforceRetention, summarizePropertyVisits } from "../lib/domain";
import { changeFollowUp, createFollowUp } from "../lib/follow-ups";
import { createSeedData } from "../lib/seed";

describe("church readiness: record preservation", () => {
  it("retains a recently completed standalone follow-up without a source encounter", () => {
    const data = createSeedData();
    const now = "2026-09-09T12:00:00.000Z";
    const task = createFollowUp({
      id: "standalone", churchId: data.church.id,
      propertyId: data.properties[0].id, dueAt: now,
    }, data.preferences.activeVolunteerId, now);
    const completed = changeFollowUp(task, { action: "completed" }, data.preferences.activeVolunteerId, now);
    expect(enforceRetention({ ...data, followUps: [completed] }, new Date(now)).followUps).toEqual([completed]);
  });

  it("uses recent task activity, not an old creation date, for resolved-task retention", () => {
    const data = createSeedData();
    const task = createFollowUp({
      id: "long_running", churchId: data.church.id,
      propertyId: data.properties[0].id, dueAt: "2026-09-09T12:00:00.000Z",
    }, data.preferences.activeVolunteerId, "2020-01-01T12:00:00.000Z");
    const completed = changeFollowUp(task, { action: "completed" }, data.preferences.activeVolunteerId, "2026-09-09T12:00:00.000Z");
    expect(enforceRetention({ ...data, followUps: [completed] }, new Date("2026-09-10")).followUps).toHaveLength(1);
  });

  it("does not lift a restriction after a later ordinary encounter", () => {
    const data = createSeedData();
    const property = data.properties[0];
    const older = { ...data.visits[0], propertyId: property.id, outcome: "do_not_visit" as const, recordedAt: "2020-01-01T12:00:00.000Z" };
    const newer = { ...older, id: "newer", outcome: "no_answer" as const, recordedAt: "2026-09-09T12:00:00.000Z" };
    expect(summarizePropertyVisits([property], [newer, older])[0]).toMatchObject({ currentOutcome: "do_not_visit", visitCount: 2 });
    expect(enforceRetention({ ...data, properties: [property], visits: [newer, older] }, new Date("2026-09-10")).properties[0].currentOutcome).toBe("do_not_visit");
  });

  it("retains a legacy location restriction even when its source visit is missing", () => {
    const data = createSeedData();
    expect(summarizePropertyVisits([{ ...data.properties[0], currentOutcome: "do_not_visit" }], [])[0].currentOutcome).toBe("do_not_visit");
  });
});
