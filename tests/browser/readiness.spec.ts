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
  await dialog.getByRole("button", { name: "Add a person or note", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Brief factual note (optional)" }).fill(note);
  await dialog.getByRole("button", { name: "Save encounter", exact: true }).click();
  await expect(dialog).toBeHidden();
}
function recorded(label: string) {
  if (!/^Fictional browser rehearsal [a-f0-9-]+(?: [a-z]+)?$/.test(label)) throw new Error("Only generated fictional fixture prefixes may be queried.");
  return Number(execFileSync("psql", [database, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c",
    "select count(*) from public.outreach_encounters where objective_note like '" + label + "%';"], { encoding: "utf8" }).trim());
}
async function queued(page: Page, accountId?: string) {
  return page.evaluate(async (requestedAccount) => {
    const request = indexedDB.open("neighborwalk:sandbox:http://127.0.0.1:54321", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const store = db.transaction("app_state").objectStore("app_state");
      const keysRequest = store.getAllKeys();
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => { keysRequest.onsuccess = () => resolve(keysRequest.result); keysRequest.onerror = () => reject(keysRequest.error); });
      const key = keys.find((key) => typeof key === "string" && key.startsWith('["account",')
        && (!requestedAccount || JSON.parse(key)[1] === requestedAccount));
      if (!key) return -1;
      const dataRequest = db.transaction("app_state").objectStore("app_state").get(key);
      return await new Promise<number>((resolve, reject) => { dataRequest.onsuccess = () => resolve(dataRequest.result?.sync?.commands?.length ?? -1); dataRequest.onerror = () => reject(dataRequest.error); });
    } finally { db.close(); }
  }, accountId);
}

test("email reminders require explicit self opt-in and can be turned off without changing church records", async ({ context, page }) => {
  await isolate(context); await signIn(page);
  await page.goto(origin + "/app/settings");
  await expect(page.getByRole("heading", { name: "Email reminders", exact: true })).toBeVisible();
  await expect(page.getByText(/^Reminders are (on|off)\.$/)).toBeVisible();
  // A prior interrupted local rehearsal may have left this test account opted in.
  if (await page.getByRole("button", { name: "Turn off email reminders", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Turn off email reminders", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "Enable daily email reminders", exact: true })).toBeDisabled();
  await expect(page.getByText("Email reminders aren’t available on this deployment.", { exact: true })).toBeVisible();
  // Only the availability response is fictional. Preference writes/reads use
  // the real local RPC; no sender credentials or scheduler are configured.
  await context.route("**/api/reminders/status", (route) => route.fulfill({ contentType: "application/json", body: '{"available":true}' }));
  await page.getByRole("button", { name: "Reload reminder settings", exact: true }).click();
  const enable = page.getByRole("button", { name: "Enable daily email reminders", exact: true });
  await expect(enable).toBeEnabled(); await enable.click();
  await expect(page.getByText("Reminders are on.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Reminders are on.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Turn off email reminders", exact: true }).click();
  await expect(page.getByText("Reminders are off.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Reminders are off.", { exact: true })).toBeVisible();
});

test("a reviewed person move follows open tasks and records its reason in history", async ({ context, page }) => {
  await isolate(context); await signIn(page);
  await page.goto(origin + "/app/people");
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  let dialog = page.getByRole("dialog");
  const label = prefix + " moving person";
  await dialog.getByRole("textbox", { name: "Name or useful identifying description", exact: true }).fill(label);
  const place = dialog.getByRole("combobox", { name: "Home or meeting location (optional)", exact: true });
  const options = await place.locator("option").evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value).filter(Boolean));
  expect(options.length).toBeGreaterThan(1);
  await place.selectOption(options[0]);
  await dialog.getByRole("button", { name: "Save person", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Plan follow-up", exact: true }).click();
  await page.getByRole("textbox", { name: "What needs to happen?", exact: true }).fill("Fictional next step for a reviewed move");
  await page.getByRole("button", { name: "Add follow-up", exact: true }).click();
  await expect.poll(() => queued(page), { timeout: 60_000 }).toBe(0);
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Home or meeting location (optional)", exact: true }).selectOption(options[1]);
  await expect(dialog.getByText(/1 open next step follows/)).toBeVisible();
  const save = dialog.getByRole("button", { name: "Save person", exact: true });
  await expect(save).toBeDisabled();
  const reason = "Neighbor corrected the meeting address.";
  await dialog.getByRole("textbox", { name: "Reason for the location change", exact: true }).fill(reason);
  await expect(save).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "I have reviewed this location change and its open next steps.", exact: true }).check();
  await save.click(); await expect(dialog).toBeHidden();
  await expect.poll(() => queued(page), { timeout: 60_000 }).toBe(0);
  await page.getByRole("tab", { name: /^Activity/ }).click();
  await expect(page.getByText("Location changed after review", { exact: true })).toBeVisible();
  await expect(page.getByText(reason, { exact: true })).toBeVisible();
  // Only the specifically generated fictional person's aggregate is read.
  if (!/^Fictional browser rehearsal [a-f0-9-]+ moving person$/.test(label)) throw new Error("Invalid fixture label");
  const result = execFileSync("psql", [database, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c",
    "select count(*) from public.outreach_tasks t join public.discipleship_people p on p.id=t.person_id and p.church_id=t.church_id where p.name='" + label + "' and t.status='scheduled' and t.location_id=p.property_id and exists(select 1 from public.outreach_audit a where a.entity_id=p.id and a.action='resident.location_changed' and a.details->>'openTasksMoved'='1');"], { encoding: "utf8" }).trim();
  expect(Number(result)).toBe(1);
});

test("a reviewed encounter correction survives a lost response and preserves the promised next step", async ({ context, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await isolate(context); await signIn(page);
  const label = prefix + " corrected person";
  await page.goto(origin + "/app/people");
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Name or useful identifying description", exact: true }).fill(label);
  await dialog.getByRole("button", { name: "Save person", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => queued(page), { timeout: 60_000 }).toBe(0);
  await page.goto(origin + "/app/today");
  await page.getByRole("button", { name: "Record a community encounter", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "What happened?", exact: true }).selectOption("follow_up");
  await dialog.getByRole("combobox", { name: "Person (optional)", exact: true }).selectOption({ label });
  await dialog.getByRole("textbox", { name: "Requested next step", exact: true }).fill("Fictional promised next step survives correction");
  await dialog.getByRole("button", { name: "Save encounter", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => queued(page), { timeout: 60_000 }).toBe(0);
  if (!/^Fictional browser rehearsal [a-f0-9-]+ corrected person$/.test(label)) throw new Error("Invalid fixture label");
  const fixture = JSON.parse(execFileSync("psql", [database, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c",
    "select jsonb_build_object('id',e.id,'personId',p.id) from public.outreach_encounters e join public.discipleship_people p on p.id=e.person_id and p.church_id=e.church_id where p.name='" + label + "';"], { encoding: "utf8" }).trim());
  if (!/^[a-zA-Z0-9_-]+$/.test(fixture.id) || !/^[a-zA-Z0-9_-]+$/.test(fixture.personId)) throw new Error("Invalid fixture identifiers");
  await page.goto(origin + "/app/people/" + fixture.personId);
  await expect(page.locator(".person-context-details").getByText(/^Last contact /)).toBeVisible();
  await page.goto(origin + "/app/data");
  await page.getByRole("button", { name: /^Correct records/ }).click();
  await page.getByRole("button", { name: /^Correct an encounter/ }).click();
  const review = page.getByRole("region", { name: "Correct an encounter after review", exact: true });
  await review.getByRole("searchbox", { name: "Search encounter date, person, address or ID", exact: true }).fill(fixture.id);
  await review.getByRole("combobox", { name: "Encounter to review", exact: true }).selectOption(fixture.id);
  await review.getByRole("button", { name: "Review original encounter", exact: true }).click();
  await expect(review.getByText(/1 linked tasks remain unchanged/)).toBeVisible();
  const save = review.getByRole("button", { name: "Save reviewed correction", exact: true });
  await expect(save).toBeDisabled();
  await review.getByRole("combobox", { name: "Reviewed outcome", exact: true }).selectOption("conversation");
  await review.getByRole("combobox", { name: "Reviewed context", exact: true }).selectOption("service");
  await review.getByRole("checkbox", { name: /Entered in error — preserve history/ }).check();
  const reason = "Fictional duplicate encounter; keep the promised follow-up.";
  await review.getByRole("textbox", { name: "Factual reason for this correction", exact: true }).fill(reason);
  await expect(save).toBeDisabled();
  await review.getByRole("checkbox", { name: /I reviewed the original and will handle tasks/ }).check();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  let lost = false;
  await context.route("**/rest/v1/rpc/outreach_admin_action", async (route) => {
    if (!lost && route.request().postDataJSON()?.request?.action === "encounter_correct") {
      lost = true; const committed = await route.fetch(); expect(committed.ok()).toBe(true); await route.abort("failed");
    } else await route.continue();
  });
  await save.click();
  await expect(page.getByRole("heading", { name: "Preserved administration request", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry preserved request", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Preserved administration request", exact: true })).toBeHidden();
  expect(lost).toBe(true);
  const aggregate = JSON.parse(execFileSync("psql", [database, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c",
    "select jsonb_build_object('outcome',e.outcome,'corrections',jsonb_array_length(e.corrections),'voided',e.corrections#>>'{0,voided}','tasks',(select count(*) from public.outreach_tasks t where t.encounter_id=e.id and t.status='scheduled')) from public.outreach_encounters e where e.id='" + fixture.id + "';"], { encoding: "utf8" }).trim());
  expect(aggregate).toEqual({ outcome: "follow_up", corrections: 1, voided: "true", tasks: 1 });
  await page.goto(origin + "/app/people/" + fixture.personId);
  await expect(page.locator(".person-context-details").getByText("No recorded contact yet", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /^Activity/ }).click();
  await expect(page.getByText("Encounter reviewed · entered in error", { exact: true })).toBeVisible();
  await expect(page.getByText(reason + " Tasks and restrictions unchanged.", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Note kind", exact: true }).selectOption("prayer");
  await page.getByRole("textbox", { name: "Care note", exact: true }).fill("Fictional requested prayer note");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.locator(".person-timeline-entry").filter({ hasText: "Fictional requested prayer note" }).getByText("Prayer", { exact: true })).toBeVisible();
  await expect.poll(() => queued(page), { timeout: 60_000 }).toBe(0);
});

test("reviewed duplicate people and locations retain history and resolve original links", async ({ context, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = randomUUID();
  const firstLocation = "browser_merge_" + fixture + "_a";
  const secondLocation = "browser_merge_" + fixture + "_b";
  // Only new generated fictional locations in the fixed local church are seeded.
  execFileSync("psql", [database, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c",
    `insert into public.outreach_locations(church_id,id,address,unit,source) values ('00000000-0000-4000-8000-000000000001','${firstLocation}','Fictional duplicate ${fixture}','A','manual'),('00000000-0000-4000-8000-000000000001','${secondLocation}','Fictional duplicate ${fixture}','A','manual');`], { stdio: "pipe" });
  await isolate(context); await signIn(page);
  const label = prefix + " duplicate person";
  const ids: string[] = [];
  for (const phone of ["555-0101", "555-0102"]) {
    await page.goto(origin + "/app/people");
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Name or useful identifying description", exact: true }).fill(label);
    await dialog.getByRole("textbox", { name: "Phone (optional)", exact: true }).fill(phone);
    await dialog.getByRole("combobox", { name: "Home or meeting location (optional)", exact: true }).selectOption(firstLocation);
    await dialog.getByRole("button", { name: "Save person", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/app\/people\/[^/]+$/);
    ids.push(decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!));
    if (ids.length === 1) {
      await page.getByRole("tab", { name: /^Activity/ }).click();
      await page.getByRole("textbox", { name: "Care note", exact: true }).fill("Fictional original duplicate history " + fixture);
      await page.getByRole("button", { name: "Save note", exact: true }).click();
      await expect(page.locator(".person-profile").getByText("Fictional original duplicate history " + fixture, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Plan follow-up", exact: true }).click();
      await page.getByRole("textbox", { name: "What needs to happen?", exact: true }).fill("Fictional duplicate next step " + fixture);
      await page.getByRole("button", { name: "Add follow-up", exact: true }).click();
    }
    await expect.poll(() => queued(page), { timeout: 60_000 }).toBe(0);
  }
  await page.goto(origin + "/app/data");
  await page.getByRole("button", { name: /^Correct records/ }).click();
  await page.getByRole("button", { name: /^Combine duplicate records/ }).click();
  const review = page.getByRole("region", { name: "Combine reviewed duplicates", exact: true });
  await expect(review).toBeVisible();
  for (const kind of ["people", "locations"] as const) {
    await review.getByRole("combobox", { name: "Duplicate kind", exact: true }).selectOption(kind);
    await review.getByRole("combobox", { name: "Original to preserve as history", exact: true }).selectOption(kind === "people" ? ids[0] : firstLocation);
    await review.getByRole("combobox", { name: "Record to keep current", exact: true }).selectOption(kind === "people" ? ids[1] : secondLocation);
    await review.getByRole("button", { name: "Preview exact combination", exact: true }).click();
    await expect(review.getByRole("table")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const combine = review.getByRole("button", { name: "Combine exactly the reviewed records", exact: true });
    await expect(combine).toBeDisabled();
    await review.getByRole("textbox", { name: "Why are these the same person or location?", exact: true }).fill("Reviewed the same fictional identity or dwelling.");
    await review.getByRole("checkbox").check();
    await expect(combine).toBeDisabled();
    await review.getByRole("textbox", { name: kind === "people" ? "Type COMBINE SAME PERSON" : "Type COMBINE SAME LOCATION", exact: true }).fill(kind === "people" ? "COMBINE SAME PERSON" : "COMBINE SAME LOCATION");
    await combine.click();
    await expect(review.getByText(/Reviewed duplicates combined\. Original history/)).toBeVisible({ timeout: 60_000 });
  }
  await page.goto(origin + "/app/people/" + ids[0]);
  await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /^Activity/ }).click();
  await expect(page.locator(".person-profile").getByText("Fictional original duplicate history " + fixture, { exact: true })).toBeVisible();
  await expect(page.getByText("Duplicate profiles combined after review", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  await page.getByText("Preserved original profiles (1)", { exact: true }).click();
  await expect(page.getByText("555-0101", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("textbox", { name: "Phone (optional)", exact: true })).toHaveValue("555-0102");
  await expect(editor.getByRole("combobox", { name: "Home or meeting location (optional)", exact: true })).toHaveValue(secondLocation);
  await expect(editor.locator(`option[value="${firstLocation}"]`)).toHaveCount(0);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto(origin + "/app/followups?person=" + ids[0]);
  await expect(page.getByRole("region", { name: "Follow-up brief", exact: true }).getByRole("paragraph").filter({ hasText: "Fictional duplicate next step " + fixture })).toBeVisible();
  const aggregate = execFileSync("psql", [database, "-X", "-A", "-t", "-c",
    `select count(*) from public.outreach_tasks t join public.discipleship_people p on p.church_id=t.church_id and p.id=t.person_id where p.property_id='${secondLocation}' and p.merged_into_id is null and t.location_id=p.property_id and t.status='scheduled';`], { encoding: "utf8" }).trim();
  expect(Number(aggregate)).toBe(1);
  await page.goto(origin + "/app/people/unavailable-" + fixture);
  await expect(page.getByText("This person is unavailable", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to people", exact: true }).click();
  await expect(page).toHaveURL(origin + "/app/people");
});

test("guide words reach fieldwork with keyboard-accessible steps and location tabs", async ({ context, page }) => {
  await isolate(context); await signIn(page, "volunteer");
  const fixture = randomUUID(); const title = "Fictional guide " + fixture;
  const locationId = "browser_guide_" + fixture;
  execFileSync("psql", [database, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c",
    `insert into public.outreach_locations(church_id,id,address,source) values ('00000000-0000-4000-8000-000000000001','${locationId}','Fictional Guide Location ${fixture}','manual');`], { stdio: "pipe" });
  await page.goto(origin + "/app/guides");
  await page.getByRole("button", { name: "New personal guide", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Guide name", exact: true }).fill(title);
  const first = dialog.locator(".guide-composer-step").first();
  await first.getByRole("textbox", { name: "Step title", exact: true }).fill("Fictional listen first");
  await first.getByRole("textbox", { name: /Coaching before speaking/ }).fill("Fictional coaching: ask permission and listen.");
  await first.getByRole("textbox", { name: /Words or testimony notes/ }).fill("Fictional words for a respectful greeting.");
  await first.getByRole("textbox", { name: /Closing reminder/ }).fill("Fictional reminder: respect their answer.");
  await dialog.getByRole("button", { name: "Add another step", exact: true }).click();
  const second = dialog.locator(".guide-composer-step").nth(1);
  await second.getByRole("textbox", { name: "Step title", exact: true }).fill("Fictional agree next step");
  await second.getByRole("textbox", { name: /Words or testimony notes/ }).fill("Fictional words to agree personal follow-through.");
  await dialog.getByRole("button", { name: "Save private guide", exact: true }).click();
  await expect(dialog).toBeHidden();
  const firstTab = page.getByRole("tab", { name: "Step 1: Fictional listen first", exact: true });
  const secondTab = page.getByRole("tab", { name: "Step 2: Fictional agree next step", exact: true });
  const panel = page.getByRole("tabpanel");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole("tablist")).toHaveAttribute("aria-orientation", width === 390 ? "horizontal" : "vertical");
    await firstTab.focus();
    await firstTab.press(width === 390 ? "ArrowRight" : "ArrowDown");
    await expect(secondTab).toBeFocused(); await expect(secondTab).toHaveAttribute("aria-selected", "true");
    await expect(panel).toHaveAttribute("aria-labelledby", (await secondTab.getAttribute("id"))!);
    await secondTab.press("Home"); await expect(firstTab).toBeFocused();
    await expect(panel.getByText(/Fictional words for a respectful greeting\./)).toBeVisible();
    await firstTab.press("Tab"); await expect(panel).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.getByRole("button", { name: "Set as favorite", exact: true }).click();
  await expect(page.getByText(/Favorite guide saved\./)).toBeVisible();
  await page.goto(origin + "/app/locations/" + locationId);
  const drawer = page.getByRole("dialog");
  const record = drawer.getByRole("tab", { name: "Record visit", exact: true });
  await record.focus(); await record.press("End");
  const history = drawer.getByRole("tab", { name: /^History/ });
  await expect(history).toBeFocused(); await expect(history).toHaveAttribute("aria-selected", "true");
  await history.press("Tab"); await expect(drawer.getByRole("tabpanel")).toBeFocused();
  await history.focus(); await history.press("ArrowRight"); await expect(record).toBeFocused();
  await drawer.locator(".guided-entry-card").click();
  await expect(drawer.getByText(/Fictional words for a respectful greeting\./)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("guide-mobile.png") });
  await page.keyboard.press("Escape"); await expect(drawer).toBeHidden();
});

test("guide writes survive a lost response and reject stale editors while archives preserve the saved record", async ({ browser, context, page }) => {
  await isolate(context); await signIn(page, "volunteer");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/app/guides");
  const title = "Fictional guide journal " + randomUUID();
  let guideId = ""; let commandId = ""; let dropped = false;
  await context.route("**/rest/v1/rpc/outreach_guide_action", async (route) => {
    const request = route.request().postDataJSON().request;
    if (!dropped && request.action === "save" && request.content?.title === title) {
      dropped = true; guideId = request.guideId; commandId = request.id;
      const response = await route.fetch(); expect(response.ok()).toBe(true);
      await route.abort("failed");
    } else await route.continue();
  });
  const snapshot = () => {
    if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(guideId) || !/^[a-zA-Z0-9_-]{1,180}$/.test(commandId)) throw new Error("Invalid fictional guide identifiers");
    return JSON.parse(execFileSync("psql", [database, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c",
      "select jsonb_build_object('count',count(*),'version',max(version),'archived',bool_or(archived_at is not null),'words',max(steps->0->>'sampleWords'),'receipts',(select count(*) from private.outreach_receipts where church_id='00000000-0000-4000-8000-000000000001' and command_id='guide_" + commandId + "')) from public.conversation_guides where church_id='00000000-0000-4000-8000-000000000001' and id='" + guideId + "';"], { encoding: "utf8" }).trim());
  };
  await page.getByRole("button", { name: "New personal guide", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Guide name", exact: true }).fill(title);
  await dialog.getByRole("textbox", { name: "Step title", exact: true }).fill("Fictional guide journal step");
  await dialog.getByRole("textbox", { name: /Words or testimony notes/ }).fill("Fictional original words");
  await dialog.getByRole("button", { name: "Save private guide", exact: true }).click();
  await expect(dialog.getByText(/This submission is preserved exactly/)).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Guide name", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(snapshot()).toMatchObject({ count: 1, version: 1, archived: false, receipts: 1 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "A guide request needs confirmation", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New personal guide", exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const refreshBounds = await page.getByRole("button", { name: "Refresh guides", exact: true }).boundingBox();
  const retryBounds = await page.getByRole("button", { name: "Retry original guide request", exact: true }).boundingBox();
  expect(refreshBounds).not.toBeNull(); expect(retryBounds).not.toBeNull();
  expect(retryBounds!.y - refreshBounds!.y - refreshBounds!.height).toBeGreaterThanOrEqual(8);
  await page.screenshot({ path: test.info().outputPath("guide-journal-mobile.png") });
  await page.getByRole("button", { name: "Retry original guide request", exact: true }).click();
  await expect(page.getByRole("heading", { name: "A guide request needs confirmation", exact: true })).toHaveCount(0);
  expect(snapshot()).toMatchObject({ count: 1, version: 1, receipts: 1 });
  await page.goto(origin + "/app/guides/" + guideId);
  await page.getByRole("button", { name: "Set as favorite", exact: true }).click();
  await page.getByRole("button", { name: "Clear personal favorite", exact: true }).click();
  await expect(page.getByText(/Personal favorite cleared/)).toBeVisible();
  await page.getByRole("button", { name: "Set as favorite", exact: true }).click();
  await page.getByRole("button", { name: "Edit guide", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: /Words or testimony notes/ }).fill("Fictional first device stale edit");
  const other = await browser.newContext();
  try {
    await isolate(other); const otherPage = await other.newPage(); await signIn(otherPage, "volunteer");
    await otherPage.goto(origin + "/app/guides/" + guideId);
    await otherPage.getByRole("button", { name: "Edit guide", exact: true }).click();
    const otherDialog = otherPage.getByRole("dialog");
    await otherDialog.getByRole("textbox", { name: /Words or testimony notes/ }).fill("Fictional second device accepted edit");
    await otherDialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(otherDialog).toBeHidden();
    expect(snapshot()).toMatchObject({ version: 2, words: "Fictional second device accepted edit" });
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(/guide changed or was archived/i);
    expect(snapshot()).toMatchObject({ version: 2, words: "Fictional second device accepted edit" });
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Refresh guides", exact: true }).click();
    await expect(page.getByText("“Fictional second device accepted edit”", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Preserve request as reviewed", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Stop retrying", exact: true }).click();
    await expect(page.getByRole("heading", { name: "A guide request needs confirmation", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Edit guide", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(dialog.getByText(/This is not permanent erasure/)).toBeVisible();
    await dialog.getByRole("button", { name: "Archive guide", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(snapshot()).toMatchObject({ count: 1, version: 3, archived: true, words: "Fictional second device accepted edit", receipts: 1 });
    await page.goto(origin + "/app/guides/" + guideId);
    await expect(page.getByText(/The requested guide is not available in your active library/)).toBeVisible();
    await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
  } finally { await other.close(); }
});

test("cold offline guide, 100 durable encounters, close/reopen and exactly-once reconnect", async ({ context, page }) => {
  await isolate(context);
  await signIn(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Conversation guides", exact: true }).click();
  await page.locator(".guide-library-choice").filter({ hasText: "Test conversation guide" }).click();
  await expect(page.getByRole("tabpanel")).toBeVisible();
  const preparedGuideText = await page.getByRole("tabpanel").innerText();
  const preparedGuidePath = new URL(page.url()).pathname;
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect(page.getByText(/App shell prepared on this device/)).toBeVisible();
  const cdp = await context.newCDPSession(page);
  // HTTP memory/disk cache must not disguise missing service-worker preparation.
  await cdp.send("Network.clearBrowserCache");
  await setDisconnected(context, true);
  await page.close();
  const offline = await context.newPage();
  await offline.goto(origin + preparedGuidePath, { waitUntil: "domcontentloaded" });
  await expect(offline.getByRole("tabpanel")).toHaveText(preparedGuideText, { useInnerText: true });
  // Some Chromium/CDP versions restore navigator.onLine after new-page
  // navigation while requests remain blocked. Verify the actual network, not
  // that advisory signal (also unreliable behind a real captive portal).
  expect(await offline.evaluate(() => fetch("/manifest.webmanifest?network-probe=offline", { cache: "no-store" }).then(() => "reachable", () => "blocked"))).toBe("blocked");
  await setDisconnected(context, true);
  await offline.getByRole("button", { name: "Home", exact: true }).click();
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

test("work saved during an in-flight refresh is retried without waiting for the periodic poll", async ({ context, page }) => {
  // Install before app timers exist. Advancing only the known debounce window
  // makes the joined-sync race deterministic, without editing the device queue.
  await page.clock.install();
  await isolate(context); await signIn(page);
  let held = false;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await context.route("**/rest/v1/rpc/outreach_guide_state", async (route) => {
    if (!held) { held = true; await gate; }
    await route.continue();
  });
  try {
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => held).toBe(true);
    await encounter(page, prefix + " refresh /during-read");
    await expect.poll(() => queued(page)).toBe(1);
    expect(recorded(prefix + " refresh")).toBe(0);
    await page.clock.fastForward(2_000);
    release();
    // The ordinary 30-second periodic refresh cannot explain this result.
    await expect.poll(() => recorded(prefix + " refresh"), { timeout: 12_000 }).toBe(1);
    await expect.poll(() => queued(page)).toBe(0);
  } finally { release(); }
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
  await dialog.getByRole("button", { name: "Add a person or note", exact: true }).click();
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

test("actual session revocation and account switching preserve authored work without giving another account its queue", async ({ browser, context, page }) => {
  await isolate(context); await signIn(page, "volunteer");
  await expect(page.getByText(/App shell prepared on this device/)).toBeVisible();
  // Return identifiers only, never the access/refresh tokens. Delete exactly
  // this local fictional session, the same state change made by Auth sign-out.
  const session = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("neighborwalk-auth:sandbox:http://127.0.0.1:54321")!);
    const payload = JSON.parse(atob(stored.access_token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")));
    return { id: payload.session_id, user: payload.sub, expiresAt: payload.exp };
  });
  if (![session.id, session.user].every((id) => typeof id === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))) throw new Error("Invalid fictional session identifiers");
  expect(session.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + 60);
  const other = await browser.newContext();
  try {
    await isolate(other); const otherPage = await other.newPage(); await signIn(otherPage, "volunteer");
    await setDisconnected(context, true);
    await encounter(page, prefix + " revoked /one");
    expect(await queued(page)).toBe(1); expect(recorded(prefix + " revoked")).toBe(0);
    const removed = execFileSync("psql", [database, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c",
      "with removed as (delete from auth.sessions s using auth.users u where s.id='" + session.id + "' and s.user_id='" + session.user + "' and u.id=s.user_id and u.email='volunteer@neighborwalk.test' returning s.id) select count(*) from removed;"], { encoding: "utf8" }).trim();
    expect(Number(removed)).toBe(1);
    await encounter(otherPage, prefix + " surviving /one");
    await expect.poll(() => queued(otherPage), { timeout: 60_000 }).toBe(0);
    expect(recorded(prefix + " surviving")).toBe(1);
    await setDisconnected(context, false);
    await expect(page.getByRole("heading", { name: "Workspace access needs attention" })).toBeVisible({ timeout: 60_000 });
    expect(await queued(page)).toBe(1); expect(recorded(prefix + " revoked")).toBe(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("neighborwalk-supabase-workspace:sandbox:http://127.0.0.1:54321")!).verifiedAt)).toBe("");
    await setDisconnected(context, true); await page.reload();
    await expect(page.getByRole("heading", { name: "Workspace access needs attention" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Hello,/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open prepared offline workspace", exact: true })).toHaveCount(0);
    expect(await queued(page)).toBe(1);
    await setDisconnected(context, false);
    await page.getByRole("button", { name: "Sign out or use a different account", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Pick up where care left off." })).toBeVisible();
    await signIn(page, "leader");
    const otherAccount = await page.evaluate(() => JSON.parse(localStorage.getItem("neighborwalk-auth:sandbox:http://127.0.0.1:54321")!).user.id as string);
    expect(otherAccount).not.toBe(session.user);
    expect(await queued(page, otherAccount)).toBe(0);
    expect(await queued(page, session.user)).toBe(1);
    expect(recorded(prefix + " revoked")).toBe(0);
    await page.goto(origin + "/app/recovery");
    await expect(page.getByRole("heading", { name: "Everything is shared", exact: true })).toBeVisible();
    await expect(page.getByText(prefix + " revoked /one", { exact: false })).toHaveCount(0);
    await page.goto(origin + "/app/settings");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Pick up where care left off." })).toBeVisible();
    await signIn(page, "volunteer");
    await expect.poll(() => queued(page, session.user), { timeout: 60_000 }).toBe(0);
    expect(recorded(prefix + " revoked")).toBe(1);
    expect(recorded(prefix + " surviving")).toBe(1);
  } finally { await other.close(); }
});

test("an already open offline workspace locks after its authorization window without clearing queued work", async ({ context, page }) => {
  await isolate(context); await signIn(page);
  await expect(page.getByText(/App shell prepared on this device/)).toBeVisible();
  await setDisconnected(context, true);
  await encounter(page, prefix + " window /one");
  expect(await queued(page)).toBe(1); expect(recorded(prefix + " window")).toBe(0);
  // Only browser time changes. Timers run normally; focus checks the existing
  // in-memory authorization, without replacing the cache or a server response.
  await page.clock.setFixedTime(new Date(Date.now() + 25 * 60 * 60 * 1000));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Workspace access needs attention" })).toBeVisible();
  await expect(page.getByText(/This device needs an online membership check/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Hello,/ })).toHaveCount(0);
  expect(await queued(page)).toBe(1); expect(recorded(prefix + " window")).toBe(0);
  await page.clock.setFixedTime(new Date());
  await setDisconnected(context, false); await page.reload();
  await expect(page.getByRole("heading", { name: /Hello,/ })).toBeVisible();
  await expect.poll(() => queued(page), { timeout: 60_000 }).toBe(0);
  expect(recorded(prefix + " window")).toBe(1);
});

for (const endpoint of ["outreach_workspace_info", "outreach_guide_state"]) {
test(`known ${endpoint} access denial locks the cache and prevents a later offline reopen`, async ({ context, page }) => {
  await isolate(context); await signIn(page);
  await expect(page.getByText(/App shell prepared on this device/)).toBeVisible();
  if (endpoint === "outreach_guide_state") {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("button", { name: "Conversation guides", exact: true }).click();
    await expect(page.getByRole("button", { name: "Refresh guides", exact: true })).toBeVisible();
  }
  // Exercise the UI's real API-denial path without suspending the shared fixture
  // account. Actual membership removal is covered by the SQL regression suite.
  await context.route("**/rest/v1/rpc/" + endpoint, (route) => route.fulfill({ status: 403,
    contentType: "application/json", body: JSON.stringify({ code: "42501", message: "Fictional access denial" }) }));
  if (endpoint === "outreach_guide_state") {
    await page.getByRole("button", { name: "Refresh guides", exact: true }).click();
  } else await page.reload();
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
}

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
  await expect(page.getByRole("heading", { name: "Name not known", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "All people", exact: true }).click();
  await expect(page).toHaveURL(origin + "/app/people?view=all");
  await page.reload();
  await expect(page.getByRole("tab", { name: "All people", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(page).toHaveURL(origin + "/app/followups/" + id);
  await page.getByText("More actions", { exact: true }).click();
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
