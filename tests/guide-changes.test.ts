import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { openDB } from "idb";
import { storageKey } from "../lib/environment";
import { applyGuideReceipt, guideSaveInput, parseGuideChangeRequest, savedGuideFromReceipt, submitGuideChange, type GuideChangeRequest, type GuideChangeResult } from "../lib/guide-changes";
import { authoredDeviceRecovery, finishGuideChange, pendingGuideChange, preserveGuideChange, scopedStorageKey, type StorageScope } from "../lib/storage";

const sdk = vi.hoisted(() => ({ getSession: vi.fn(), rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ getSupabaseBrowserClient: () => ({ auth: { getSession: sdk.getSession }, rpc: sdk.rpc }) }));
let scope: StorageScope;
const guideInput = () => guideSaveInput({ scope: "personal", title: " Fictional private guide ", description: " Fictional description ",
  steps: [{ id: "first", order: 1, eyebrow: "Listen", title: "Ask permission", coaching: "Respect their answer", sampleWords: "May I listen?", reminder: "No pressure", scriptureReferences: [] }] }, 10);
const requestFor = (): GuideChangeRequest => parseGuideChangeRequest({ ...guideInput(), schemaVersion: 1, id: randomUUID(), ...scope });
const resultFor = (request: GuideChangeRequest): GuideChangeResult => ({ action: request.action, guideId: request.guideId,
  teamId: request.action === "group_default" ? request.teamId : null, version: request.expectedVersion + 1, revision: 8,
  savedAt: "2026-09-10T12:00:00.000Z", createdAt: request.action === "save" ? "2026-09-10T12:00:00.000Z" : null });
beforeEach(() => {
  scope = { userId: randomUUID(), churchId: randomUUID() };
  vi.stubGlobal("window", { localStorage: { getItem: () => null } });
  vi.stubGlobal("navigator", { onLine: true });
  sdk.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: scope.userId } } }, error: null });
  sdk.rpc.mockReset().mockImplementation(async (_name, { request }) => ({ data: resultFor(request), error: null }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("durable guide changes", () => {
  it("requires the version captured when an existing guide editor opened", () => {
    const input = guideInput(); if (input.action !== "save") throw new Error("Wrong fixture");
    expect(input.expectedVersion).toBe(0); expect(input.content.title).toBe("Fictional private guide");
    expect(() => guideSaveInput({ id: input.guideId, ...input.content }, 10)).toThrow(/original version/);
    expect(guideSaveInput({ id: input.guideId, ...input.content, expectedVersion: 3 }, 10).expectedVersion).toBe(3);
  });
  it("preserves a request before the RPC and keeps its exact successful history", async () => {
    sdk.rpc.mockImplementation(async (name, { request }) => {
      expect(name).toBe("outreach_guide_action");
      expect((await pendingGuideChange(scope))?.request).toEqual(request);
      expect(request.userId).toBe(scope.userId);
      return { data: resultFor(request), error: null };
    });
    const { request, result } = await submitGuideChange(scope, guideInput());
    expect(await pendingGuideChange(scope)).toBeNull();
    const recovery = await authoredDeviceRecovery(scope);
    expect(recovery.guideChanges[0].request).toEqual(request);
    expect((await authoredDeviceRecovery({ ...scope, userId: randomUUID() })).guideChanges).toEqual([]);
    expect(savedGuideFromReceipt(request, result)).toMatchObject({ id: request.guideId, ownerUserId: scope.userId, version: 1, title: "Fictional private guide" });
  });
  it("retries the same preserved payload after a lost response instead of creating another guide", async () => {
    sdk.rpc.mockRejectedValueOnce(new TypeError("Fictional response lost"));
    await expect(submitGuideChange(scope, guideInput())).rejects.toThrow(/response lost/);
    const original = (await pendingGuideChange(scope))!.request;
    await expect(submitGuideChange(scope, guideInput())).rejects.toThrow(/previous guide request/);
    expect(sdk.rpc).toHaveBeenCalledTimes(1);
    await submitGuideChange(scope, null);
    expect(sdk.rpc).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(sdk.rpc.mock.calls[1][1].request)).toBe(JSON.stringify(original));
    expect(await pendingGuideChange(scope)).toBeNull();
  });
  it("does not send a guide request when the device cannot preserve it", async () => {
    const originalPut = IDBObjectStore.prototype.put;
    const quota = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (typeof key === "string" && key.startsWith("guide-pending:")) throw new DOMException("Fictional storage full", "QuotaExceededError");
      return originalPut.call(this, value, key);
    });
    const input = guideInput();
    await expect(submitGuideChange(scope, input)).rejects.toThrow(/storage full/);
    expect(sdk.rpc).not.toHaveBeenCalled();
    quota.mockRestore();
    expect(await pendingGuideChange(scope)).toBeNull();
    const saved = await submitGuideChange(scope, input);
    expect(saved.request.guideId).toBe(input.guideId);
    expect(sdk.rpc).toHaveBeenCalledTimes(1);
  });
  it("retains a mismatched or incomplete receipt and refuses the wrong author or offline send", async () => {
    sdk.rpc.mockImplementation(async (_name, { request }) => ({ data: { ...resultFor(request), createdAt: null }, error: null }));
    await expect(submitGuideChange(scope, guideInput())).rejects.toThrow(/receipt/);
    expect(await pendingGuideChange(scope)).not.toBeNull();
    sdk.getSession.mockResolvedValue({ data: { session: { user: { id: randomUUID() } } }, error: null });
    await expect(submitGuideChange(scope, null)).rejects.toThrow(/authored/);
    vi.stubGlobal("navigator", { onLine: false });
    await expect(submitGuideChange(scope, null)).rejects.toThrow(/connection/);
    expect(sdk.rpc).toHaveBeenCalledTimes(1);
  });
  it("atomically rejects a competing request and archives without erasing the original", async () => {
    const first = requestFor(); const second = { ...requestFor(), id: randomUUID() };
    const attempts = await Promise.allSettled([preserveGuideChange(scope, first), preserveGuideChange(scope, second)]);
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const original = (await pendingGuideChange(scope))!.request;
    await finishGuideChange(scope, "not-the-receipt", {});
    expect((await pendingGuideChange(scope))!.request).toEqual(original);
    await finishGuideChange(scope, String(original.id), { reviewedWithoutResubmitting: true });
    expect(await pendingGuideChange(scope)).toBeNull();
    expect((await authoredDeviceRecovery(scope)).guideChanges[0].request).toEqual(original);
  });
  it("refuses a corrupted cross-account journal rather than rewriting it", async () => {
    const request = requestFor();
    const database = await openDB(storageKey("neighborwalk"), 1);
    const original = { request: { ...request, userId: randomUUID() }, scope, savedAt: "2026-09-10T12:00:00.000Z" };
    const key = "guide-pending:" + scopedStorageKey(scope);
    await database.put("app_state", original, key);
    await expect(pendingGuideChange(scope)).rejects.toThrow(/does not match/);
    await expect(preserveGuideChange(scope, request)).rejects.toThrow(/does not match/);
    expect(await database.get("app_state", key)).toEqual(original);
    expect((await authoredDeviceRecovery(scope)).guideChanges).toEqual([]);
    database.close();
  });
  it("does not overwrite a newer library with an old receipt and keeps cleared-choice versions", () => {
    const request = requestFor(); const result = resultFor(request);
    const current = { guides: [], teamGuideDefaults: {}, revision: 10 };
    expect(applyGuideReceipt(current, request, result)).toBe(current);
    const saved = applyGuideReceipt({ ...current, revision: 7 }, request, result);
    expect(saved.guides[0].id).toBe(request.guideId);
    const clear = { schemaVersion: 1 as const, id: randomUUID(), ...scope, action: "group_default" as const, teamId: "fictional-group", guideId: null, expectedVersion: 2 };
    const cleared = applyGuideReceipt({ ...saved, teamGuideDefaults: { "fictional-group": request.guideId! } }, clear, { ...resultFor(clear), revision: 9 });
    expect(cleared.teamGuideDefaults).toEqual({}); expect(cleared.teamGuideVersions).toEqual({ "fictional-group": 3 });
  });
});
