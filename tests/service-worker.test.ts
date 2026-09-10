import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { validAppSegments } from "../lib/app-routes";

function worker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const deleteCache = vi.fn();
  const skipWaiting = vi.fn();
  const addAll = vi.fn<(paths: Request[]) => Promise<void>>().mockResolvedValue(undefined);
  const match = vi.fn(async () => new Response("Prepared shell"));
  const fetch = vi.fn();
  const scope = { location: new URL("https://neighborwalk.test/sw.js"), addEventListener: (name: string, handler: (event: unknown) => void) => listeners.set(name, handler), skipWaiting,
    clients: { claim: async () => undefined }, NEIGHBORWALK_BUILD: { version: "test-build", assets: ["/_next/static/test.js"], bytes: 100 } };
  runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    URL, Request, Response,
    importScripts: () => undefined,
    self: scope,
    fetch,
    caches: { keys: async () => ["other-app-data", "neighborwalk-app-v16", "neighborwalk-app-v16-sandbox"], delete: deleteCache, open: async () => ({ addAll, match }) },
  });
  return { listeners, deleteCache, skipWaiting, addAll, match, fetch };
}

describe("service-worker safety", () => {
  it("prepares the build's immutable JavaScript before installation succeeds, without forced activation", async () => {
    const { listeners, addAll, skipWaiting } = worker();
    let completion = Promise.resolve();
    listeners.get("install")!({ waitUntil: (value: Promise<void>) => { completion = value; } });
    await completion;
    expect(addAll.mock.calls[0][0].map((request) => new URL(request.url).pathname)).toEqual(expect.arrayContaining(["/app/today", "/_next/static/test.js"]));
    expect(addAll.mock.calls[0][0].every((request) => request.credentials === "omit")).toBe(true);
    expect(skipWaiting).not.toHaveBeenCalled();
  });
  it("only removes its own obsolete caches, preserving other apps and environments", async () => {
    const { listeners, deleteCache } = worker();
    let completion: Promise<unknown> = Promise.resolve();
    listeners.get("activate")!({ waitUntil: (value: Promise<unknown>) => { completion = value; } });
    await completion;
    expect(deleteCache.mock.calls).toEqual([["neighborwalk-app-v16"]]);
  });
  it("does not intercept invitation URLs, token-bearing navigation, APIs or external maps", () => {
    const { listeners } = worker();
    for (const url of ["https://neighborwalk.test/login", "https://neighborwalk.test/invite", "https://neighborwalk.test/?invite=secret", "https://neighborwalk.test/invite/secret", "https://neighborwalk.test/api/data", "https://api.maptiler.com/map.pbf"]) {
      const respondWith = vi.fn();
      listeners.get("fetch")!({ request: { method: "GET", mode: "navigate", url }, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });
  it("does not cache unlisted images or token-bearing asset URLs", () => {
    const { listeners } = worker();
    for (const path of ["/private-image.png", "/_next/static/test.js?token=secret"]) {
      const respondWith = vi.fn();
      listeners.get("fetch")!({ request: { method: "GET", destination: "script", url: "https://neighborwalk.test" + path }, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });
  it("uses the same reviewed app-route boundary as the server", () => {
    const { listeners } = worker();
    for (const path of ["today", "today/extra", "people/person_1", "outreach/outing-1/field", "guides/guide_1", "recovery", "data", "unknown", "people/a/b", "settings/private", "people/%2Fsecret"]) {
      const respondWith = vi.fn();
      listeners.get("fetch")!({ request: { method: "GET", mode: "navigate", url: "https://neighborwalk.test/app/" + path }, respondWith });
      expect(respondWith.mock.calls.length > 0).toBe(validAppSegments(path.split("/")));
    }
    const respondWith = vi.fn();
    listeners.get("fetch")!({ request: { method: "GET", mode: "navigate", url: "https://neighborwalk.test/unreviewed-private-page" }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  });
  it("pins app navigation to the prepared shell while a newer worker waits", async () => {
    const { listeners, fetch } = worker();
    let response = Promise.resolve(new Response());
    listeners.get("fetch")!({ request: { method: "GET", mode: "navigate", url: "https://neighborwalk.test/app/followups?person=person_1" }, respondWith: (value: Promise<Response>) => { response = value; } });
    expect(await (await response).text()).toBe("Prepared shell");
    expect(fetch).not.toHaveBeenCalled();
  });
});
