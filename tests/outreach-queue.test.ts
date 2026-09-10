import { describe, expect, it, vi } from "vitest";
import { createSeedData } from "../lib/seed";
import { createFollowUp } from "../lib/follow-ups";
import { DurableWorkspaceStore, reconcileOutreachWorkspace, stageWorkspaceChange } from "../lib/outreach-queue";
import { versionKey } from "../lib/command-schema";
import { calendarDate, calendarDaysFromNow } from "../lib/calendar";
import type { NeighborWalkData } from "../lib/domain";

const scope = { churchId: "00000000-0000-4000-8000-000000000001", userId: "00000000-0000-4000-8000-000000000002" };
function workspace(): NeighborWalkData {
  const seed = createSeedData();
  return { ...seed, church: { ...seed.church, id: scope.churchId }, events: [], territories: [], teams: [], properties: [], visits: [], residents: [], personNotes: [], followUps: [], audit: [],
    sync: { mode: "connected", pending: [], commands: [], recordVersions: {}, serverRevision: 1 } };
}

describe("durable outreach commands", () => {
  it("does not publish failed writes and permits a later successful retry", async () => {
    const base = workspace();
    const persist = vi.fn().mockRejectedValueOnce(new Error("Quota exceeded")).mockResolvedValue(undefined);
    const publish = vi.fn();
    const store = new DurableWorkspaceStore(base, persist, publish);
    await expect(store.update((current) => ({ ...current, church: { ...current.church, name: "Not saved" } }))).rejects.toThrow("Quota exceeded");
    expect(publish).not.toHaveBeenCalled();
    expect(store.snapshot).toBe(base);
    await store.update((current) => ({ ...current, church: { ...current.church, name: "Saved" } }));
    expect(store.snapshot.church.name).toBe("Saved");
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent writes against the latest persisted state", async () => {
    const base = workspace();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const persist = vi.fn().mockImplementationOnce(() => waiting).mockResolvedValue(undefined);
    const publish = vi.fn();
    const store = new DurableWorkspaceStore(base, persist, publish);
    const first = store.update((d) => ({ ...d, church: { ...d.church, name: "First" } }));
    const second = store.update((d) => ({ ...d, church: { ...d.church, name: d.church.name + " second" } }));
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second]);
    expect(store.snapshot.church.name).toBe("First second");
  });

  it("captures an encounter and ordinary next step in one immutable command", () => {
    const base = workspace();
    const now = new Date().toISOString();
    const visit = { id: "visit-a", churchId: scope.churchId, volunteerId: base.preferences.activeVolunteerId, outcome: "follow_up" as const, recordedAt: now, deviceId: "device-a" };
    const task = createFollowUp({ id: "task-a", churchId: scope.churchId, dueAt: "2026-10-01", sourceVisitId: visit.id, note: "Requested coffee" }, base.preferences.activeVolunteerId, now);
    const staged = stageWorkspaceChange(base, { ...base, visits: [visit], followUps: [task] }, scope);
    expect(staged.sync.commands).toHaveLength(1);
    expect(staged.sync.commands![0].command.operations.map((o) => o.entityType)).toEqual(["visit", "follow_up"]);
    task.note = "Later unsaved edit";
    expect(staged.sync.commands![0].command.operations[1].record?.note).toBe("Requested coffee");
    const changed = stageWorkspaceChange(staged, { ...staged, followUps: staged.followUps.map((t) => ({ ...t, dueAt: "2026-10-02" })) }, scope);
    expect(changed.sync.commands![1].command.operations[0].expectedVersion).toBe(1);
    expect(changed.sync.commands![0].command.operations[1].record?.dueAt).toBe("2026-10-01");
  });

  it("preserves new work created while an earlier receipt is being saved", async () => {
    const base = workspace();
    const first = stageWorkspaceChange(base, { ...base, church: { ...base.church, name: "First edit" } }, scope);
    const firstId = first.sync.commands![0].command.id;
    const store = new DurableWorkspaceStore(first, async () => undefined, () => undefined);
    const newWork = store.update((d) => stageWorkspaceChange(d, { ...d, church: { ...d.church, name: "Second edit" } }, scope));
    const ack = store.update((d) => ({ ...d, sync: { ...d.sync, commands: d.sync.commands?.filter((q) => q.command.id !== firstId) } }));
    await Promise.all([newWork, ack]);
    expect(store.snapshot.sync.commands).toHaveLength(1);
    expect(store.snapshot.sync.commands![0].command.operations[0].record?.name).toBe("Second edit");
  });

  it("refreshes remote work while retaining exact queued payloads and versions", () => {
    const base = workspace();
    const local = stageWorkspaceChange(base, { ...base, church: { ...base.church, name: "Local edit" } }, scope);
    const merged = reconcileOutreachWorkspace({ ...base, sync: { ...base.sync, serverRevision: 9, recordVersions: { [versionKey("settings", scope.churchId)]: 5 } } }, local);
    expect(merged.sync.serverRevision).toBe(9);
    expect(merged.church.name).toBe("Local edit");
    expect(merged.sync.commands![0].command.operations[0].expectedVersion).toBe(0);
  });

  it("blocks ambiguous legacy work without deleting the original queue", () => {
    const base = workspace();
    base.sync.legacyRecoveryRequired = true;
    expect(() => stageWorkspaceChange(base, { ...base, church: { ...base.church, name: "Unsafe" } }, scope)).toThrow("legacy pending");
  });

  it("moves only open person tasks and predicts the server version before a later queued edit", () => {
    const base = workspace();
    const person = { ...createSeedData().residents[0], churchId: base.church.id, propertyId: "old-place" };
    const task = createFollowUp({ id: "open-task", churchId: base.church.id, residentId: person.id, propertyId: "old-place", dueAt: "2026-10-01" }, base.preferences.activeVolunteerId, new Date().toISOString());
    base.residents = [person]; base.followUps = [task, { ...task, id: "closed-task", status: "completed" }];
    base.sync.recordVersions = { [versionKey("resident", person.id)]: 2, [versionKey("follow_up", task.id)]: 5, [versionKey("follow_up", "closed-task")]: 4 };
    const moved = stageWorkspaceChange(base, { ...base, residents: [{ ...person, propertyId: "new-place" }] }, scope, [], { [versionKey("resident", person.id)]: "Neighbor corrected the meeting address." });
    expect(moved.sync.commands![0].command.operations.map((op) => op.entityType)).toEqual(["resident"]);
    expect(moved.sync.commands![0].command.operations[0].reason).toBe("Neighbor corrected the meeting address.");
    expect(moved.followUps.map((task) => task.propertyId)).toEqual(["new-place", "old-place"]);
    expect(moved.sync.recordVersions![versionKey("follow_up", task.id)]).toBe(6);
    const updated = stageWorkspaceChange(moved, { ...moved, followUps: moved.followUps.map((task) => task.id === "open-task" ? { ...task, dueAt: "2026-10-02" } : task) }, scope);
    expect(updated.sync.commands![0]).toEqual(moved.sync.commands![0]);
    expect(updated.sync.commands![1].command.operations[0]).toMatchObject({ entityType: "follow_up", expectedVersion: 6, record: { propertyId: "new-place" } });
    const replayed = reconcileOutreachWorkspace(base, updated);
    expect(replayed.followUps.find((task) => task.id === "open-task")).toMatchObject({ propertyId: "new-place", dueAt: "2026-10-02" });
    expect(replayed.sync.recordVersions![versionKey("follow_up", task.id)]).toBe(7);
    const acknowledgedButLost = { ...moved, sync: { ...moved.sync, commands: [], pending: [] } };
    const replayedAgain = reconcileOutreachWorkspace(acknowledgedButLost, updated);
    expect(replayedAgain.sync.recordVersions![versionKey("follow_up", task.id)]).toBe(7);
    expect(updated.sync.commands![1].command.operations[0].expectedVersion).toBe(6);
    expect(base.followUps[0].propertyId).toBe("old-place");
  });
});

describe("church calendar dates", () => {
  it("uses the church date around midnight, independent of the device", () => {
    expect(calendarDate("2026-09-10T02:00:00Z", "America/Chicago")).toBe("2026-09-09");
    expect(calendarDate("2026-09-10", "Pacific/Auckland")).toBe("2026-09-10");
  });
  it("adds calendar days across daylight saving rather than elapsed hours", () => {
    expect(calendarDaysFromNow(1, "America/Chicago", new Date("2026-03-08T05:00:00Z"))).toBe("2026-03-08");
    expect(calendarDaysFromNow(1, "America/Chicago", new Date("2026-11-01T04:00:00Z"))).toBe("2026-11-01");
  });
});
