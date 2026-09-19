import { describe, expect, it } from "vitest";
import { createSeedData } from "../lib/seed";
import { prepareReviewedCommand, recoveryChoices } from "../lib/outreach-recovery";
import { DurableWorkspaceStore, reconcileOutreachWorkspace, stageWorkspaceChange } from "../lib/outreach-queue";
import { versionKey, type QueuedCommand } from "../lib/command-schema";

const scope = { churchId: "00000000-0000-4000-8000-000000000001", userId: "00000000-0000-4000-8000-000000000002" };
function fixture() {
  const base = createSeedData();
  base.church.id = scope.churchId;
  base.sync = { mode: "connected", pending: [], commands: [], recordVersions: { [versionKey("settings", scope.churchId)]: 7 }, serverRevision: 22 };
  const pending = stageWorkspaceChange(base, { ...base, church: { ...base.church, name: "Queued name", noteCharacterLimit: 400 } }, scope);
  const held: QueuedCommand = { ...pending.sync.commands![0], state: "needs_review", error: "Changed elsewhere" };
  const shared = { ...base, church: { ...base.church, name: "Shared name", noteCharacterLimit: 600 }, sync: { ...base.sync, recordVersions: { [versionKey("settings", scope.churchId)]: 8 } } };
  return { base, held, shared };
}
describe("reviewed recovery", () => {
  it("replays only selected fields, retaining current shared values for the rest", () => {
    const { held, shared } = fixture();
    const original = JSON.stringify(held);
    const choices = recoveryChoices(held, shared);
    expect(choices.map((c) => c.field)).toContain("name");
    const replacement = prepareReviewedCommand(held, shared, ["0:name"]);
    expect(replacement.command.id).not.toBe(held.command.id);
    expect(replacement.command.operations[0].expectedVersion).toBe(8);
    expect(replacement.command.operations[0].record?.name).toBe("Queued name");
    expect(replacement.command.operations[0].record?.noteCharacterLimit).toBe(600);
    expect(JSON.stringify(held)).toBe(original);
  });
  it("does not automatically restore archived or inaccessible records", () => {
    const { held, shared } = fixture();
    held.command.operations = [{ entityType: "resident", entityId: "not-visible", operation: "upsert", expectedVersion: 5, record: { name: "Old copy" } }];
    expect(recoveryChoices(held, shared)[0].blocked).toContain("Archived");
    expect(() => prepareReviewedCommand(held, shared, ["0"])).toThrow("available changes");
  });
  it("requires explicit selection and a held transaction from this church", () => {
    const { held, shared } = fixture();
    expect(() => prepareReviewedCommand(held, shared, [])).toThrow();
    expect(() => prepareReviewedCommand({ ...held, state: "queued" }, shared, ["0:name"])).toThrow();
    expect(() => prepareReviewedCommand(held, { ...shared, church: { ...shared.church, id: "another" } }, ["0:name"])).toThrow();
  });
  it("holds later optimistic overlays behind a rejected command", () => {
    const { base, held, shared } = fixture();
    const local = { ...base, sync: { ...base.sync, commands: [held, { ...held, state: "queued" as const, command: { ...held.command, id: "later" } }] } };
    expect(reconcileOutreachWorkspace(shared, local).church.name).toBe("Shared name");
    expect(reconcileOutreachWorkspace(shared, local).sync.commands).toHaveLength(2);
  });
  it("does not publish a recovery if preserving the original archive fails", async () => {
    const { base } = fixture();
    let published = false;
    const store = new DurableWorkspaceStore(base, async () => undefined, () => { published = true; });
    await expect(store.update(async () => { throw new Error("Archive storage quota"); })).rejects.toThrow("Archive storage");
    expect(published).toBe(false);
    expect(store.snapshot).toBe(base);
  });
});
