import { describe, expect, it } from "vitest";
import { createSeedData } from "../lib/seed";
import { projectOutreachWorkspace } from "../lib/outreach-projection";
describe("derived outreach displays", () => {
  it("keeps last encounter date/count after a reviewed restriction lift", () => {
    const data = createSeedData();
    const propertyId = data.properties[0].id;
    data.visits = [{ ...data.visits[0], id: "old-restriction", propertyId, outcome: "do_not_visit", recordedAt: "2026-09-09T12:00:00.000Z" }];
    data.restrictions = [{ id: "r", churchId: data.church.id, propertyId, channel: "visit", active: false, reason: "Neighbor request", correctionReason: "Neighbor requested another visit", createdAt: "2026-09-09T12:00:00.000Z" }];
    const projected = projectOutreachWorkspace(data);
    expect(projected.properties[0]).toMatchObject({ visitCount: 1, lastVisitedAt: "2026-09-09T12:00:00.000Z", currentOutcome: "unvisited" });
  });
  it("shows pending do-not-visit conservatively before a server acknowledgement", () => {
    const data = createSeedData();
    expect(projectOutreachWorkspace(data, new Set([data.properties[0].id])).properties[0].currentOutcome).toBe("do_not_visit");
  });
});
