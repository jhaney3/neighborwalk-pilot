import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const deleteCache = vi.fn();
  const skipWaiting = vi.fn();
  runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    URL, Response,
    self: { location: new URL("https://neighborwalk.test/sw.js"), addEventListener: (name: string, handler: (event: unknown) => void) => listeners.set(name, handler), skipWaiting },
    caches: { keys: async () => ["other-app-data", "neighborwalk-app-v16", "neighborwalk-app-v16-sandbox"], delete: deleteCache },
  });
  return { listeners, deleteCache, skipWaiting };
}

describe("service-worker safety", () => {
  it("only removes its own obsolete caches, preserving other apps and environments", async () => {
    const { listeners, deleteCache } = worker();
    let completion: Promise<unknown> = Promise.resolve();
    listeners.get("activate")!({ waitUntil: (value: Promise<unknown>) => { completion = value; } });
    await completion;
    expect(deleteCache.mock.calls).toEqual([["neighborwalk-app-v16"]]);
  });
  it("does not intercept invitation URLs, token-bearing navigation, APIs or external maps", () => {
    const { listeners } = worker();
    for (const url of ["https://neighborwalk.test/?invite=secret", "https://neighborwalk.test/invite/secret", "https://neighborwalk.test/api/data", "https://api.maptiler.com/map.pbf"]) {
      const respondWith = vi.fn();
      listeners.get("fetch")!({ request: { method: "GET", mode: "navigate", url }, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });
});
