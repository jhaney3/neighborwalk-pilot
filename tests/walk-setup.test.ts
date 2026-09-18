import { describe, expect, it, vi } from "vitest";
import { parseWalkDateTimes, readyPreparationMissing, saveWalkSetup, targetPlanIssues, type PlannedWalkTarget, type WalkSetupCheckpoint, type WalkSetupPlan } from "../lib/walk-setup";

const outing: WalkSetupPlan["outing"] = { name: "Saturday walk", startsAt: "2026-09-19T14:00:00.000Z", endsAt: "2026-09-19T16:00:00.000Z", timezone: "America/Chicago", purpose: "Listen well", meetingPoint: "Front entrance", leaderContact: "Alex · 555-0100", status: "draft", debrief: "" };
const target = (clientId = "target-a", gislink = "parcel-1"): PlannedWalkTarget => ({
  clientId,
  target: { territoryId: "territory-1", name: "Oak Street", color: "#24745e", selectionKind: "rectangle", geometry: { type: "Polygon", coordinates: [[[-87, 35], [-87, 35.01], [-86.99, 35.01], [-87, 35]]] }, parcels: [{ countyFips: "47055", gislink, datasetRevision: "2026-09", inclusionSource: "polygon_auto" }] },
  responsibility: {},
});

describe("map-first walk setup persistence", () => {
  it("reports invalid wall-clock choices and readiness gaps", () => {
    expect(parseWalkDateTimes("", "2026-09-19T11:00", "America/Chicago").error).toBe("Choose a complete date and time.");
    expect(parseWalkDateTimes("2026-09-19T11:00", "2026-09-19T09:00", "America/Chicago").error).toBe("Choose an end time after the start.");
    expect(readyPreparationMissing({ ...outing, purpose: "", meetingPoint: "" })).toEqual(["purpose", "meeting point"]);
  });

  it("checkpoints the outing ID and reuses it after a partial failure", async () => {
    const checkpoints: WalkSetupCheckpoint[] = [];
    const callbacks = { saveOuting: vi.fn().mockResolvedValue("event-1"), saveRoster: vi.fn(), saveTarget: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("saved-target"), saveAssignment: vi.fn() };
    const plan: WalkSetupPlan = { outing, area: { kind: "existing", territoryId: "territory-1" }, invitedMemberIds: ["volunteer-1"], targets: [target()] };
    await expect(saveWalkSetup(plan, {}, callbacks, "draft", (value) => checkpoints.push(value))).rejects.toThrow("offline");
    expect(checkpoints.at(-1)).toMatchObject({ eventId: "event-1" });
    const saved = await saveWalkSetup(plan, checkpoints.at(-1)!, callbacks, "draft");
    expect(saved).toMatchObject({ targetIds: { "target-a": "saved-target" } });
    expect(callbacks.saveTarget).toHaveBeenNthCalledWith(2, expect.objectContaining({ eventId: "event-1" }), undefined);
  });

  it("saves all snapshots and assignments before marking ready", async () => {
    const order: string[] = [];
    const callbacks = {
      saveOuting: vi.fn(async (value: WalkSetupPlan["outing"], id?: string) => { order.push(`event:${value.status}`); return id ?? "event-1"; }),
      saveRoster: vi.fn(async () => { order.push("roster"); }),
      saveTarget: vi.fn(async () => { order.push("target"); return "target-1"; }),
      saveAssignment: vi.fn(async (input: { targetId?: string }) => { order.push(`assignment:${input.targetId}`); return "assignment-1"; }),
    };
    await saveWalkSetup({ outing, area: { kind: "existing", territoryId: "territory-1" }, invitedMemberIds: ["volunteer-1"], targets: [target()] }, {}, callbacks, "ready");
    expect(order).toEqual(["event:draft", "roster", "target", "event:ready"]);
    expect(callbacks.saveAssignment).not.toHaveBeenCalled();
  });

  it("allows staffing later but rejects conflicting crews, duplicate people, empty rosters, and overlaps", () => {
    const unowned = target(); unowned.responsibility = {};
    const duplicate = target("target-b"); duplicate.responsibility = { teamId: "team", volunteerId: "volunteer" };
    const issues = targetPlanIssues([unowned, duplicate]);
    expect(issues).not.toContain("Oak Street needs exactly one owner");
    expect(issues).toContain("Oak Street has conflicting crew choices");
    expect(issues).toContain("Oak Street overlaps another target");
    const sharedPerson = target("target-b", "parcel-2"); sharedPerson.target.name = "Cedar Street"; sharedPerson.responsibility = { memberIds: ["volunteer-1"] };
    const firstCrew = target(); firstCrew.responsibility = { memberIds: ["volunteer-1"] };
    expect(targetPlanIssues([firstCrew, sharedPerson])).toContain("One person is assigned to both Oak Street and Cedar Street");
    const whole = target(); whole.target.selectionKind = "whole_zone";
    expect(targetPlanIssues([whole, target("b", "parcel-2")])).toContain("A whole-zone target cannot be combined with smaller targets");
  });

  it("saves the advance roster without creating target ownership", async () => {
    const order: string[] = [];
    const callbacks = {
      saveOuting: vi.fn(async () => { order.push("event"); return "event-1"; }),
      saveRoster: vi.fn(async (_eventId: string, memberIds: string[]) => { order.push(`roster:${memberIds.length}`); }),
      saveTarget: vi.fn(async () => { order.push("target"); return "target-1"; }),
      saveAssignment: vi.fn(),
    };
    await saveWalkSetup({ outing, area: { kind: "existing", territoryId: "territory-1" }, invitedMemberIds: ["volunteer-1", "volunteer-2"], targets: [target()] }, {}, callbacks, "draft");
    expect(order).toEqual(["event", "roster:2", "target"]);
    expect(callbacks.saveAssignment).not.toHaveBeenCalled();
  });

  it("requires an advance invitation before sharing a ready walk", async () => {
    const callbacks = { saveOuting: vi.fn(), saveRoster: vi.fn(), saveTarget: vi.fn(), saveAssignment: vi.fn() };
    await expect(saveWalkSetup({ outing, area: { kind: "community" }, invitedMemberIds: [] }, {}, callbacks, "ready"))
      .rejects.toThrow("Invite at least one person");
    expect(callbacks.saveOuting).not.toHaveBeenCalled();
  });

  it("rejects overlapping draft rosters before saving any part of the outing", async () => {
    const callbacks = { saveOuting: vi.fn().mockResolvedValue("event-1"), saveRoster: vi.fn(), saveTarget: vi.fn(), saveAssignment: vi.fn() };
    await expect(saveWalkSetup({ outing, area: { kind: "existing", territoryId: "territory-1" }, invitedMemberIds: ["volunteer-1"], targets: [target(), target("target-b")] }, {}, callbacks, "draft"))
      .rejects.toThrow("overlaps another target");
    expect(callbacks.saveOuting).not.toHaveBeenCalled();
    expect(callbacks.saveTarget).not.toHaveBeenCalled();
    expect(callbacks.saveAssignment).not.toHaveBeenCalled();
  });

  it("keeps community settings target-free and preserves existing assignments", async () => {
    const callbacks = { saveOuting: vi.fn().mockResolvedValue("event-1"), saveRoster: vi.fn(), saveTarget: vi.fn(), saveAssignment: vi.fn() };
    await saveWalkSetup({ outing, area: { kind: "community" }, invitedMemberIds: [] }, {}, callbacks, "draft");
    await saveWalkSetup({ outing, area: { kind: "existing", territoryId: "territory-1" }, invitedMemberIds: ["volunteer-1"], preserveAssignments: true }, {}, callbacks, "draft");
    expect(callbacks.saveTarget).not.toHaveBeenCalled();
    expect(callbacks.saveAssignment).not.toHaveBeenCalled();
  });
});
