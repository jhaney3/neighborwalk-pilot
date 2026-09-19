import { describe, expect, it } from "vitest";
import { authoredRecovery } from "../lib/device-recovery";
import { createSeedData } from "../lib/seed";
import { stageWorkspaceChange } from "../lib/outreach-queue";

const scope = { userId: "00000000-0000-4000-8000-000000000002", churchId: "00000000-0000-4000-8000-000000000001" };
describe("authored recovery", () => {
  it("does not export read caches or another author's commands after demotion", () => {
    const base = createSeedData(); base.church.id = scope.churchId;
    const changed = stageWorkspaceChange(base, { ...base, church: { ...base.church, name: "My queued change" } }, scope);
    const own = changed.sync.commands![0];
    changed.sync.commands!.push({ ...own, command: { ...own.command, userId: "00000000-0000-4000-8000-000000000003" } });
    const exported = authoredRecovery(changed, scope);
    expect(exported.commands).toEqual([own.command]);
    expect(exported).not.toHaveProperty("data");
    expect(exported).not.toHaveProperty("residents");
    expect(authoredRecovery(changed, { ...scope, churchId: "different" }).commands).toEqual([]);
  });
  it("holds legacy or malformed archives for supervised recovery", () => {
    expect(() => authoredRecovery({ sync: { legacyRecoveryRequired: true, commands: [] } }, scope)).toThrow("supervised");
    expect(() => authoredRecovery({}, scope)).toThrow("supervised");
  });
});
