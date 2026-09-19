import { describe, expect, it } from "vitest";
import { acquireWorkspaceTab } from "../lib/workspace-tab";

function locks() {
  const held = new Set<string>();
  const request = async (key: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
    if (held.has(key)) return callback(null);
    held.add(key);
    try { await callback({ name: key }); } finally { held.delete(key); }
  };
  return { request: request as LockManager["request"] };
}
describe("single account workspace writer per browser", () => {
  it("refuses a competing tab but allows another account and clean takeover", async () => {
    const manager = locks();
    const release = await acquireWorkspaceTab(manager, "account-a");
    await expect(acquireWorkspaceTab(manager, "account-a")).rejects.toThrow("already open");
    const releaseB = await acquireWorkspaceTab(manager, "account-b");
    release(); await Promise.resolve(); await Promise.resolve();
    const releaseNew = await acquireWorkspaceTab(manager, "account-a");
    releaseNew(); releaseB();
  });
  it("does not silently fall back to unsafe cross-tab writes in unsupported browsers", async () => {
    await expect(acquireWorkspaceTab(undefined, "account-a")).rejects.toThrow("cannot safely coordinate");
  });
});
