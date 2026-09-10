import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { createSeedData } from "../lib/seed";
import { storageKey } from "../lib/environment";
import { archiveWorkspaceRecovery, exportRecoveryArchive, recoveryArchives, loadScopedNeighborWalkData, saveNeighborWalkData, scopedStorageKey, StorageRecoveryError } from "../lib/storage";

afterEach(() => vi.unstubAllGlobals());

describe("account-scoped durable storage", () => {
  const storage = new Map<string, string>();
  function browser() {
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => storage.get(key) ?? null } });
  }

  it("never exposes one account's records to another account in the same church", async () => {
    browser();
    const data = createSeedData();
    const owner = { userId: "alice", churchId: data.church.id };
    await saveNeighborWalkData(data, owner);
    expect((await loadScopedNeighborWalkData(owner))?.properties.length).toBe(data.properties.length);
    expect(await loadScopedNeighborWalkData({ ...owner, userId: "bob" })).toBeNull();
  });

  it("does not allow a scope to save another church's records", async () => {
    browser();
    await expect(saveNeighborWalkData(createSeedData(), { userId: "alice", churchId: "different-church" })).rejects.toThrow("different church");
  });

  it("preserves an invalid record, quarantines it and refuses a silent sample reset", async () => {
    browser();
    const scope = { userId: "corrupt-account", churchId: "church-corrupt" };
    const database = await openDB(storageKey("neighborwalk"), 1);
    const original = { schemaVersion: 10, valuableUnsentDraft: "Fictional test draft" };
    await database.put("app_state", original, scopedStorageKey(scope));
    await expect(loadScopedNeighborWalkData(scope)).rejects.toBeInstanceOf(StorageRecoveryError);
    expect(await database.get("app_state", scopedStorageKey(scope))).toEqual(original);
    expect((await database.getAllKeys("app_state")).some((key) => String(key).startsWith("quarantine:"))).toBe(true);
    database.close();
  });

  it("round-trips more than 2,000 unsent changes without truncation", async () => {
    browser();
    const data = createSeedData();
    data.sync.pending = Array.from({ length: 2501 }, (_, index) => ({
      id: `queued-${index}`, entityType: "visit", entityId: `encounter-${index}`,
      operation: "upsert", changedAt: "2026-09-09T12:00:00.000Z",
    }));
    const scope = { userId: "large-outbox", churchId: data.church.id };
    await saveNeighborWalkData(data, scope);
    expect((await loadScopedNeighborWalkData(scope))?.sync.pending).toEqual(data.sync.pending);
  });

  it("retains downloadable recovery work only within the owning account and church", async () => {
    browser();
    const data = createSeedData();
    const scope = { userId: "recovery-owner", churchId: data.church.id };
    const key = await archiveWorkspaceRecovery(data, scope, "Fictional reviewed recovery");
    expect(await recoveryArchives(scope)).toHaveLength(1);
    expect(await recoveryArchives({ ...scope, userId: "someone-else" })).toHaveLength(0);
    const copy = JSON.parse(await (await exportRecoveryArchive(scope, key)).text());
    expect(copy.data).toEqual(data);
    await expect(exportRecoveryArchive({ ...scope, userId: "someone-else" }, key)).rejects.toThrow("different account");
  });

  it("quarantines failures thrown during date migration, not only schema validation", async () => {
    browser();
    const data = { ...createSeedData(), schemaVersion: 10 };
    data.followUps[0].dueAt = "invalid-date";
    const scope = { userId: "invalid-migration-date", churchId: data.church.id };
    const database = await openDB(storageKey("neighborwalk"), 1);
    await database.put("app_state", data, scopedStorageKey(scope));
    await expect(loadScopedNeighborWalkData(scope)).rejects.toBeInstanceOf(StorageRecoveryError);
    expect(await database.get("app_state", scopedStorageKey(scope))).toEqual(data);
    database.close();
  });
});
