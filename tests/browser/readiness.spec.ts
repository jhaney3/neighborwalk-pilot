import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// These tests have no configurable remote target, account or database URL.
// Outbound browser traffic is limited to the local app and local Supabase.
const origin = "http://127.0.0.1:3013";
const database = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const prefix = "Fictional browser rehearsal " + randomUUID();
const disconnected = new WeakSet<BrowserContext>();

async function setDisconnected(context: BrowserContext, value: boolean) {
  // CDP's advisory offline state can change around target/tab replacement.
  // Keep an independent request boundary across every page in the context.
  if (value) disconnected.add(context); else disconnected.delete(context);
  await Promise.all(context.pages().map((page) => page.evaluate((offline) => {
    localStorage.setItem("fictional-network-disconnected", String(offline));
  }, value)));
  await context.setOffline(value);
}

async function isolate(context: BrowserContext) {
  // Service-worker-controlled pages can bypass Playwright request interception,
  // and CDP's offline flag can reset when a new target opens. Keep a final fetch
  // transport boundary in every tab. This only simulates network failure; it
  // never changes application state, queued commands, or server responses.
  await context.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (...args: Parameters<typeof fetch>) => {
      if (localStorage.getItem("fictional-network-disconnected") === "true") return Promise.reject(new TypeError("Failed to fetch"));
      return originalFetch(...args);
    };
  });
  await context.route("**/*", (route) => {
    if (disconnected.has(context)) return route.abort("internetdisconnected");
    const url = new URL(route.request().url());
    return [origin, "http://127.0.0.1:54321"].includes(url.origin) ? route.continue() : route.abort();
  });
}
async function signIn(page: Page, account = "leader") {
  await page.goto(origin + "/login");
  await page.getByRole("textbox", { name: "Email address" }).fill(account + "@neighborwalk.test");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("NeighborWalk-test-123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Hello,/ })).toBeVisible();
}
async function encounter(page: Page, note: string) {
  await page.getByRole("button", { name: "Record a community encounter", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Brief factual note (optional)" }).fill(note);
  await dialog.getByRole("button", { name: "Save encounter", exact: true }).click();
  await expect(dialog).toBeHidden();
}
function recorded(label: string) {
  if (!/^Fictional browser rehearsal [a-f0-9-]+(?: [a-z]+)?$/.test(label)) throw new Error("Only generated fictional fixture prefixes may be queried.");
  return Number(execFileSync("psql", [database, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c",
    "select count(*) from public.outreach_encounters where objective_note like '" + label + "%';"], { encoding: "utf8" }).trim());
}
async function queued(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("neighborwalk:sandbox:http://127.0.0.1:54321", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const store = db.transaction("app_state").objectStore("app_state");
      const keysRequest = store.getAllKeys();
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => { keysRequest.onsuccess = () => resolve(keysRequest.result); keysRequest.onerror = () => reject(keysRequest.error); });
      const key = keys.find((key) => typeof key === "string" && key.startsWith('["account",'));
      if (!key) return -1;
      const dataRequest = db.transaction("app_state").objectStore("app_state").get(key);
      return await new Promise<number>((resolve, reject) => { dataRequest.onsuccess = () => resolve(dataRequest.result?.sync?.commands?.length ?? -1); dataRequest.onerror = () => reject(dataRequest.error); });
    } finally { db.close(); }
  });
}

test("cold offline guide, 100 durable encounters, close/reopen and exactly-once reconnect", async ({ context, page }) => {
  await isolate(context);
  await signIn(page);
  await page.getByRole("button", { name: "Conversation guide", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Make room to decline" })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect(page.getByText(/App shell prepared on this device/)).toBeVisible();
  const cdp = await context.newCDPSession(page);
  // HTTP memory/disk cache must not disguise missing service-worker preparation.
  await cdp.send("Network.clearBrowserCache");
  await setDisconnected(context, true);
  await page.close();
  const offline = await context.newPage();
  await offline.goto(origin + "/app/guides", { waitUntil: "domcontentloaded" });
  await expect(offline.getByRole("heading", { name: "Make room to decline" })).toBeVisible();
  // Some Chromium/CDP versions restore navigator.onLine after new-page
  // navigation while requests remain blocked. Verify the actual network, not
  // that advisory signal (also unreliable behind a real captive portal).
  expect(await offline.evaluate(() => fetch("/manifest.webmanifest?network-probe=offline", { cache: "no-store" }).then(() => "reachable", () => "blocked"))).toBe("blocked");
  await setDisconnected(context, true);
  await offline.getByRole("button", { name: "Today", exact: true }).click();
  for (let i = 0; i < 100; i++) await encounter(offline, prefix + " offline /" + i);
  expect(await queued(offline)).toBe(100);
  expect(recorded(prefix + " offline")).toBe(0);
  await offline.close();
  const reopened = await context.newPage();
  await reopened.goto(origin + "/app/today", { waitUntil: "domcontentloaded" });
  await expect(reopened.getByRole("heading", { name: /Hello,/ })).toBeVisible();
  expect(await queued(reopened)).toBe(100);
  await setDisconnected(context, false);
  await expect.poll(() => queued(reopened), { timeout: 120_000 }).toBe(0);
  expect(recorded(prefix + " offline")).toBe(100);
});

test("two isolated devices retain both encounters; a lost commit response does not duplicate", async ({ browser, context, page }) => {
  await isolate(context); await signIn(page);
  const other = await browser.newContext();
  try {
    await isolate(other);
    const second = await other.newPage(); await signIn(second, "volunteer");
    await Promise.all([encounter(page, prefix + " concurrent /leader"), encounter(second, prefix + " concurrent /volunteer")]);
    await expect.poll(() => recorded(prefix + " concurrent")).toBe(2);
    let dropped = false;
    await context.route("**/rest/v1/rpc/outreach_apply_command", async (route) => {
      if (dropped) return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      dropped = true;
      await route.abort("failed");
    });
    await encounter(page, prefix + " receipt /one");
    await expect.poll(() => dropped).toBe(true);
    await expect.poll(() => queued(page), { timeout: 60_000 }).toBe(0);
    expect(recorded(prefix + " receipt")).toBe(1);
  } finally { await other.close(); }
});

test("quota failure retains the form and never claims a persisted encounter", async ({ context, page }) => {
  await isolate(context);
  await context.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore["put"]>) {
      if (sessionStorage.getItem("fictional-quota-test") === "on") throw new DOMException("Fictional quota failure", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await signIn(page);
  await page.evaluate(() => sessionStorage.setItem("fictional-quota-test", "on"));
  await page.getByRole("button", { name: "Record a community encounter", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Brief factual note (optional)" }).fill(prefix + " quota /one");
  await dialog.getByRole("button", { name: "Save encounter", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("textbox")).toHaveValue(prefix + " quota /one");
  expect(recorded(prefix + " quota")).toBe(0);
  await page.evaluate(() => sessionStorage.removeItem("fictional-quota-test"));
  await dialog.getByRole("button", { name: "Save encounter", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => recorded(prefix + " quota")).toBe(1);
});

test("expired access token can explicitly reopen a recently prepared offline workspace", async ({ context, page }) => {
  await isolate(context); await signIn(page);
  await expect(page.getByText(/App shell prepared on this device/)).toBeVisible();
  await setDisconnected(context, true);
  // Exercise the SDK's expired-session path without emitting the fictional
  // account's credentials into test output or replacing its refresh token.
  await page.evaluate(() => {
    const key = "neighborwalk-auth:sandbox:http://127.0.0.1:54321";
    const stored = JSON.parse(localStorage.getItem(key)!);
    stored.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem(key, JSON.stringify(stored));
  });
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(origin + "/app/today", { waitUntil: "domcontentloaded" });
  await expect(reopened.getByRole("button", { name: "Open prepared offline workspace", exact: true })).toBeVisible();
  await reopened.getByRole("button", { name: "Open prepared offline workspace", exact: true }).click();
  await expect(reopened.getByRole("heading", { name: /Hello,/ })).toBeVisible();
  await setDisconnected(context, true);
  await encounter(reopened, prefix + " expired /one");
  expect(await queued(reopened)).toBe(1);
  expect(recorded(prefix + " expired")).toBe(0);
  await setDisconnected(context, false);
  await expect.poll(() => queued(reopened), { timeout: 120_000 }).toBe(0);
  expect(recorded(prefix + " expired")).toBe(1);
});

test("known access denial locks the cache and prevents a later offline reopen", async ({ context, page }) => {
  await isolate(context); await signIn(page);
  await expect(page.getByText(/App shell prepared on this device/)).toBeVisible();
  // Exercise the UI's real API-denial path without suspending the shared fixture
  // account. Actual membership removal is covered by the SQL regression suite.
  await context.route("**/rest/v1/rpc/outreach_workspace_info", (route) => route.fulfill({ status: 403,
    contentType: "application/json", body: JSON.stringify({ code: "42501", message: "Fictional access denial" }) }));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Workspace access needs attention" })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("neighborwalk-supabase-workspace:sandbox:http://127.0.0.1:54321")!).verifiedAt)).toBe("");
  await setDisconnected(context, true);
  await page.evaluate(() => {
    const key = "neighborwalk-auth:sandbox:http://127.0.0.1:54321";
    const auth = JSON.parse(localStorage.getItem(key)!);
    auth.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem(key, JSON.stringify(auth));
  });
  await page.close();
  const reopened = await context.newPage(); await reopened.goto(origin + "/app/today", { waitUntil: "domcontentloaded" });
  await expect(reopened.getByRole("heading", { name: "Check your connection or invitation" })).toBeVisible({ timeout: 45_000 });
  await expect(reopened.getByRole("button", { name: "Open prepared offline workspace", exact: true })).toHaveCount(0);
  await expect(reopened.getByRole("heading", { name: /Hello,/ })).toHaveCount(0);
});

test("cross-tab session removal hides offline records without clearing authored work", async ({ context, page }) => {
  await isolate(context); await signIn(page);
  await expect(page.getByText(/App shell prepared on this device/)).toBeVisible();
  const second = await context.newPage(); await second.goto(origin + "/app/today");
  await expect(second.getByText(/already open in another tab or window/)).toBeVisible();
  await setDisconnected(context, true);
  await encounter(page, prefix + " signout /one");
  expect(await queued(page)).toBe(1);
  await second.evaluate(() => localStorage.removeItem("neighborwalk-auth:sandbox:http://127.0.0.1:54321"));
  await expect(page.getByRole("heading", { name: "Pick up where care left off." })).toBeVisible();
  expect(await queued(page)).toBe(1);
  expect(recorded(prefix + " signout")).toBe(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Pick up where care left off." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open prepared offline workspace", exact: true })).toHaveCount(0);
});

test("a second tab cannot overwrite unsent work and can reopen after the first closes", async ({ context, page }) => {
  await isolate(context); await signIn(page);
  await expect(page.getByText(/App shell prepared on this device/)).toBeVisible();
  await setDisconnected(context, true);
  await encounter(page, prefix + " tabs /one");
  expect(recorded(prefix + " tabs")).toBe(0);
  const second = await context.newPage(); await second.goto(origin + "/app/today", { waitUntil: "domcontentloaded" });
  await expect(second.getByText(/already open in another tab or window/)).toBeVisible();
  await expect(second.getByRole("button", { name: "Record a community encounter", exact: true })).toHaveCount(0);
  expect(await queued(second)).toBe(1);
  expect(recorded(prefix + " tabs")).toBe(0);
  await page.close(); await second.reload();
  await expect(second.getByRole("heading", { name: /Hello,/ })).toBeVisible();
  expect(await queued(second)).toBe(1);
  expect(recorded(prefix + " tabs")).toBe(0);
  await setDisconnected(context, true);
  await encounter(second, prefix + " tabs /two");
  expect(await queued(second)).toBe(2);
  expect(recorded(prefix + " tabs")).toBe(0);
  await setDisconnected(context, false);
  await expect.poll(() => queued(second), { timeout: 60_000 }).toBe(0);
  expect(recorded(prefix + " tabs")).toBe(2);
});

test("a reassigned next step requires the responsible volunteer to accept before completing", async ({ browser, context, page }) => {
  await isolate(context); await signIn(page);
  await page.getByRole("button", { name: "Record a community encounter", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "What happened?" }).selectOption("follow_up");
  await dialog.getByRole("textbox", { name: "Requested next step" }).fill(prefix + " task /one");
  await dialog.getByRole("button", { name: "Save encounter", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => queued(page)).toBe(0);
  const taskState = () => JSON.parse(execFileSync("psql", [database, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c",
    "select json_build_object('id',id,'status',status,'acceptance',acceptance) from public.outreach_tasks where note='" + prefix + " task /one';"], { encoding: "utf8" }).trim()) as { id: string; status: string; acceptance: string };
  const id = taskState().id;
  await page.goto(origin + "/app/followups/" + id);
  await page.getByRole("combobox", { name: "Responsible person" }).selectOption({ label: "Test Volunteer" });
  await expect.poll(() => taskState().acceptance).toBe("pending");
  const other = await browser.newContext();
  try {
    await isolate(other);
    const volunteer = await other.newPage(); await signIn(volunteer, "volunteer");
    await volunteer.goto(origin + "/app/followups/" + id);
    await expect(volunteer.getByRole("button", { name: "Accept responsibility", exact: true })).toBeVisible();
    await expect(volunteer.getByRole("button", { name: "Complete", exact: true })).toHaveCount(0);
    await volunteer.getByRole("button", { name: "Decline", exact: true }).click();
    await expect.poll(() => taskState().acceptance).toBe("declined");
    await expect(volunteer.getByRole("button", { name: "Complete", exact: true })).toHaveCount(0);
    await volunteer.getByRole("button", { name: "Accept responsibility", exact: true }).click();
    await expect.poll(() => taskState().acceptance).toBe("accepted");
    await volunteer.getByRole("button", { name: "Complete", exact: true }).click();
    await volunteer.getByRole("dialog").getByRole("textbox", { name: "What happened? (optional)" }).fill("Fictional follow-through completed.");
    await volunteer.getByRole("dialog").getByRole("button", { name: "Complete follow-up", exact: true }).click();
    await expect.poll(() => taskState().status).toBe("completed");
    await expect(volunteer.getByRole("button", { name: "Complete", exact: true })).toHaveCount(0);
  } finally { await other.close(); }
});
