// Captures the built iOS app screen by screen for the final check (index.html).
//
// Run from the worktree root while the sample app is running:
//   npm run mobile:dev -- --port 4392 --strictPort
//   node docs/design/final-check/capture.mjs            # every screen that has a step
//   node docs/design/final-check/capture.mjs WM1 WM2    # just these screens
//
// Each step drives the sample church (/demo) to one locked screen. Steps are
// filled in as screens are built. A missing step means "Not captured yet" on the
// page. Captures are iPhone-sized (393×852 @2x) JPEGs in built/<ID>.jpg.
// After a pass, compare every capture with its mockup and update status.js.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// FINAL_CHECK_OUT and FINAL_CHECK_WIDTH are for extra passes (dark mode, 320pt)
// that must not overwrite the gate captures in built/.
const out = process.env.FINAL_CHECK_OUT ? resolve(process.env.FINAL_CHECK_OUT) : join(here, "built");
const WIDTH = Number(process.env.FINAL_CHECK_WIDTH ?? 393);
mkdirSync(out, { recursive: true });
const BASE = process.env.FINAL_CHECK_URL ?? "http://localhost:4392/demo";
const THEME = process.env.FINAL_CHECK_THEME ?? "light";

/* ---------- helpers (from the audit run) ---------- */
// Every step starts from a fresh sample church, so one step's changes (a
// volunteer view, a saved visit) never leak into the next.
const home = async (p) => {
  await p.goto(BASE); await p.waitForTimeout(400);
  await p.evaluate(async () => {
    sessionStorage.clear();
    for (const info of await indexedDB.databases()) {
      const db = await new Promise((res) => { const r = indexedDB.open(info.name); r.onsuccess = () => res(r.result); });
      if (!db.objectStoreNames.contains("app_state")) { db.close(); continue; }
      await new Promise((res) => { const r = db.transaction("app_state", "readwrite").objectStore("app_state").delete("demo"); r.onsuccess = res; r.onerror = res; });
      db.close();
    }
  });
  await p.reload(); await p.waitForTimeout(2200);
};
const tab = async (p, label) => { await p.locator(`.mobile-nav button[aria-label^='${label}']`).click(); await p.waitForTimeout(900); };
const esc = async (p) => { await p.keyboard.press("Escape"); await p.waitForTimeout(400); };
// Rewrites the sample church stored in IndexedDB, then reloads. Use it to reach
// states the sample data doesn't start in (a volunteer, a ready walk, an invite).
const mutateSample = async (p, fn) => {
  await p.evaluate(async (source) => {
    const change = new Function("data", source);
    for (const info of await indexedDB.databases()) {
      const db = await new Promise((res) => { const r = indexedDB.open(info.name); r.onsuccess = () => res(r.result); });
      if (!db.objectStoreNames.contains("app_state")) continue;
      const store = () => db.transaction("app_state", "readwrite").objectStore("app_state");
      const data = await new Promise((res) => { const r = store().get("demo"); r.onsuccess = () => res(r.result); });
      if (!data) continue;
      change(data);
      await new Promise((res) => { const r = store().put(data, "demo"); r.onsuccess = res; });
    }
  }, fn);
  await p.reload(); await p.waitForTimeout(2200);
};
const asVolunteer = (p) => mutateSample(p, `data.preferences.activeVolunteerId = "volunteer_maya";`);

/* ---------- shared paths into the app ---------- */
const byRole = (p, role, name) => p.getByRole(role, { name });
// Walk mode on Erica's route (Crockett north), from Today's play button.
const walk = async (p) => { await home(p); await byRole(p, "button", "Resume walk").click(); await p.waitForTimeout(3500); };
// A pin logged tonight (130 Crockett Street) and an empty spot north of the route.
const tapPin = async (p) => { await p.mouse.click(160, 443); await p.waitForTimeout(1200); };
const tapEmpty = async (p) => { await p.mouse.click(200, 300); await p.waitForTimeout(1400); };
const walksMap = async (p) => { await home(p); await tab(p, "Walks"); await byRole(p, "button", "Map").click(); await p.waitForTimeout(3000); };
const homeSheet = async (p) => { await home(p); await tab(p, "Walks"); await byRole(p, "button", "List").click(); await p.waitForTimeout(1200); await byRole(p, "button", /118 Crockett/).click(); await p.waitForTimeout(3500); };
const drawCorners = async (p, close = false) => {
  await walksMap(p); await byRole(p, "button", "Map options").click(); await p.waitForTimeout(400);
  await byRole(p, "button", "New neighborhood").click(); await p.waitForTimeout(1500);
  for (const [x, y] of [[80, 300], [300, 280], [320, 560], [190, 620], [70, 540], ...(close ? [[80, 300]] : [])]) { await p.mouse.click(x, y); await p.waitForTimeout(300); }
};
const walkPage = async (p, name) => { await home(p); await tab(p, "Walks"); await byRole(p, "button", name).click(); await p.waitForTimeout(700); };
const plan = async (p) => { await home(p); await tab(p, "Walks"); await byRole(p, "button", "Plan a walk").click(); await p.waitForTimeout(900); };
// Two routes on Crockett Heights: a north–south avenue, then a cross street.
const streets = async (p) => {
  await p.getByRole("radio", { name: /Crockett Heights/ }).click(); await p.waitForTimeout(3500);
  await p.mouse.click(196, 380); await p.waitForTimeout(500);
  await byRole(p, "button", "+ Route").click(); await p.waitForTimeout(300);
  const box = await p.locator(".walk-target-map").boundingBox();
  await p.mouse.click(box.x + 40, box.y + box.height * 0.5); await p.waitForTimeout(600);
};
const person = async (p) => { await home(p); await tab(p, "People"); await byRole(p, "button", /^Tasha/).click(); await p.waitForTimeout(700); };
const personMenu = async (p, item) => { await person(p); await byRole(p, "button", "Options for Tasha").click(); await p.waitForTimeout(300); await byRole(p, "button", item).click(); await p.waitForTimeout(500); };
const more = async (p, row) => { await home(p); await p.getByRole("button", { name: /profile, settings and more/ }).first().click(); await p.waitForTimeout(600); if (row) { await byRole(p, "button", row).click(); await p.waitForTimeout(600); } };
const settings = async (p, row) => { await more(p, "Settings"); if (row) { await p.getByRole("button", { name: row }).first().click(); await p.waitForTimeout(500); } };
const followUp = async (p) => { await home(p); await tab(p, "Follow-ups"); await byRole(p, "button", /^Tasha\./).click(); await p.waitForTimeout(700); };
const logger = async (p) => { await home(p); await byRole(p, "button", "Log a conversation").click(); await p.waitForTimeout(900); };

/* ---------- one step per locked screen ---------- */
// Fill these in as screens are built. Keep IDs identical to the walkthrough.
const STEPS = {
  // Board screens (locked before the walkthrough)
  BD1: async (p) => { await home(p); },
  BD3: async (p) => { await home(p); await tab(p, "Follow-ups"); await byRole(p, "button", "Team").click(); },
  // Walk mode
  WM1: walk,
  WM2: async (p) => { await walk(p); await tapEmpty(p); },
  WM3: async (p) => { await walk(p); await tapPin(p); },
  WM4: async (p) => {
    await walk(p); await tapPin(p); await p.locator("[data-outcome=conversation]").click(); await p.waitForTimeout(600);
    await p.getByLabel("Name").fill("Tasha"); await p.getByPlaceholder("(555) 000-0000").fill("(555) 014-2231");
    await byRole(p, "button", "Prayed together").click(); await byRole(p, "button", "Health").click(); await p.getByRole("switch").check();
  },
  WM5: async (p) => { await walk(p); await tapEmpty(p); await p.locator("[data-outcome=no_answer]").click(); await p.waitForTimeout(500); },
  WM6: async (p) => { await walk(p); await tapPin(p); await byRole(p, "button", "Another home").click(); await p.waitForTimeout(400); await p.keyboard.type("Apt B"); },
  WM7: async (p) => { await walk(p); await byRole(p, "button", "Logged tonight").click(); },
  WM8: async (p) => { await walk(p); await byRole(p, "button", "Finish").click(); },
  PL1: logger,
  MP1: walksMap,
  MP2: async (p) => { await walksMap(p); await byRole(p, "button", "Search an address").click(); await p.waitForTimeout(300); await p.keyboard.type("215 gai"); await p.waitForTimeout(1200); },
  MP3: async (p) => { await walksMap(p); await byRole(p, "button", /Choose a neighborhood/).click(); },
  MP4: async (p) => { await walksMap(p); await byRole(p, "button", "Map options").click(); },
  MP5: async (p) => { await drawCorners(p); },
  MP6: async (p) => { await drawCorners(p, true); await p.getByPlaceholder("Riverside").fill("Riverside"); },
  MP7: async (p) => { await walksMap(p); await byRole(p, "button", "Map options").click(); await p.waitForTimeout(400); await byRole(p, "button", /^Edit Crockett/).click(); },
  MP8: async (p) => { await home(p); await tab(p, "Walks"); await byRole(p, "button", "List").click(); },
  MP9: homeSheet,
  MP10: async (p) => { await homeSheet(p); await p.locator(".home-sheet .sheet-body").evaluate((element) => element.scrollTo(0, 80)); await p.waitForTimeout(500); await p.locator(".home-sheet .sheet-body").evaluate((element) => element.scrollTo(0, 600)); },
  MP11: async (p) => { await homeSheet(p); await byRole(p, "button", /Options for/).click(); await p.waitForTimeout(400); await byRole(p, "button", "Edit home").click(); },
  MP12: async (p) => { await homeSheet(p); await byRole(p, "button", /Options for/).click(); },
  WK1: async (p) => { await home(p); await tab(p, "Walks"); },
  WK2: async (p) => { await walkPage(p, /Saturday outreach/); },
  WK3: async (p) => { await walkPage(p, /Saturday outreach/); await p.locator(".content-view").evaluate((element) => element.scrollTo(0, 470)); },
  WK4: async (p) => { await home(p); await tab(p, "Walks"); await byRole(p, "button", "Past walks").click(); await p.waitForTimeout(300); await byRole(p, "button", /Late summer walk/).click(); },
  WK5: async (p) => { await walkPage(p, /Westside prayer walk/); await byRole(p, "button", "Walk options").click(); },
  WK6: async (p) => { await walkPage(p, /Westside prayer walk/); await byRole(p, "button", "Walk options").click(); await p.waitForTimeout(300); await byRole(p, "button", "Edit walk").click(); },
  WK7: async (p) => { await walkPage(p, /Westside prayer walk/); await byRole(p, "button", "Walk options").click(); await p.waitForTimeout(300); await byRole(p, "button", "Repeat walk").click(); },
  WK8: async (p) => { await walkPage(p, /Westside prayer walk/); await byRole(p, "button", "Walk options").click(); await p.waitForTimeout(300); await byRole(p, "button", "Edit walk").click(); await p.waitForTimeout(300); await byRole(p, "button", "Change").nth(1).click(); },
  WK9: async (p) => { await home(p); await asVolunteer(p); await tab(p, "Walks"); await byRole(p, "button", /Saturday outreach/).click(); },
  WK10: async (p) => { await home(p); await asVolunteer(p); await tab(p, "Walks"); },
  PW1: async (p) => { await plan(p); },
  PW2: async (p) => { await plan(p); await streets(p); },
  PW3: async (p) => { await plan(p); await streets(p); await byRole(p, "button", "Next · when").click(); await p.waitForTimeout(400); await byRole(p, "button", "Next · who").click(); await p.waitForTimeout(400); await byRole(p, "button", /Team Barnabas/).click(); },
  FU1: async (p) => { await followUp(p); await p.locator(".content-view").last().evaluate((element) => element.scrollTo(0, 2000)); },
  TD1: async (p) => { await home(p); await mutateSample(p, `data.preferences.activeVolunteerId = "volunteer_maya"; data.events.find((event) => event.status === "active").status = "completed";`); },
  PE1: async (p) => { await home(p); await tab(p, "People"); },
  PE2: async (p) => { await home(p); await tab(p, "People"); await byRole(p, "button", /Conversations away/).click(); },
  PE3: async (p) => { await person(p); },
  PE4: async (p) => { await person(p); await p.locator(".person-history h2").evaluate((element) => element.scrollIntoView()); },
  PE5: async (p) => { await person(p); await byRole(p, "button", "Add a note").click(); await p.waitForTimeout(400); await p.getByLabel("Note", { exact: true }).fill("Prefers visits after 5 PM. Her daughter Kayla answers the door."); },
  PE6: async (p) => { await personMenu(p, "Privacy and status"); },
  PE7: async (p) => { await personMenu(p, "Edit person"); },
  PE8: async (p) => { await home(p); await tab(p, "People"); await byRole(p, "button", "Add person").click(); },
  AD1: async (p) => { await more(p); },
  AD2: async (p) => { await more(p, /Team & invitations/); },
  AD3: async (p) => { await more(p, /Team & invitations/); await byRole(p, "button", "Invite").click(); await p.waitForTimeout(400); await p.getByPlaceholder("Who’s joining you?").fill("Dee"); await p.getByPlaceholder("(555) 000-0000").fill("5550184420"); await p.getByPlaceholder("Who’s joining you?").focus(); await p.evaluate(() => document.activeElement.blur()); },
  AD4: async (p) => { await more(p, /Team & invitations/); await byRole(p, "button", /^Team Barnabas/).click(); },
  AD5: async (p) => { await settings(p); },
  AD6: async (p) => { await settings(p, /^Church profile/); },
  AD7: async (p) => { await settings(p, /^Records & privacy/); },
  AD8: async (p) => { await settings(p, /^Data/); },
  AD9: async (p) => { await more(p, /^Sync/); },
  BD2: async (p) => { await walkPage(p, /Saturday outreach/); await byRole(p, "button", "End walk").click(); },
  BD4: async (p) => { await followUp(p); },
  BD5: async (p) => { await followUp(p); await byRole(p, "button", "Log check-in").click(); await p.waitForTimeout(400); await p.getByRole("radio", { name: /Talked with/ }).click(); await byRole(p, "button", "2 wks").click(); },
  BD6: async (p) => { await followUp(p); await byRole(p, "button", /Snooze/).first().click(); },
  BD7: async (p) => { await walkPage(p, /Westside prayer walk/); },
  BD8: async (p) => { await home(p); await asVolunteer(p); await tab(p, "Walks"); await byRole(p, "button", /Westside prayer walk/).click(); },
  BD9: async (p) => { await walkPage(p, /Westside prayer walk/); await byRole(p, "button", "Start check-in").click(); },
  BD10: async (p) => { await plan(p); await streets(p); await byRole(p, "button", "Next · when").click(); },
  // The + logger with a live gathering instead of a door walk.
  BD11: async (p) => {
    await home(p);
    await mutateSample(p, `data.events[0].status = "completed"; data.events.push({ id: "event_friday_supper", churchId: data.church.id, name: "Friday supper", startsAt: new Date(Date.now() - 3600000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), status: "active", timezone: "America/Chicago" });`);
    await byRole(p, "button", "Log a conversation").click(); await p.waitForTimeout(900);
  },
  BD12: async (p) => {
    await logger(p); await byRole(p, "button", /^Talked/).click(); await p.waitForTimeout(500);
    await p.getByPlaceholder("If they shared it").fill("Ray Ortiz"); await p.getByRole("button", { name: "Yes", exact: true }).click(); await p.getByPlaceholder("(555) 000-0000").fill("(555) 013-8840");
    await p.getByRole("button", { name: "Call", exact: true }).click(); await p.getByPlaceholder("Only if they asked for prayer").fill("His job interview on Tuesday"); await p.getByRole("switch").check();
  },
};

const wanted = process.argv.slice(2);
const ids = (wanted.length ? wanted : Object.keys(STEPS)).filter((id) => STEPS[id]);
const b = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE ?? "/usr/bin/chromium" });
const ctx = await b.newContext({ viewport: { width: WIDTH, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: THEME });
const p = await ctx.newPage();
// Offline-safe map style so captures don't depend on tile servers.
await p.route(/api\.maptiler\.com\/.*style\.json.*/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#ebe6d9" } }] }) }));
const failed = [];
for (const id of ids) {
  try {
    await STEPS[id](p);
    await p.waitForTimeout(700);
    await p.screenshot({ path: join(out, `${id}.jpg`), type: "jpeg", quality: 80 });
    console.log("captured", id);
  } catch (error) {
    failed.push(id);
    console.log("FAILED", id, String(error).split("\n")[0]);
  }
}
await b.close();
const missing = Object.keys(STEPS).filter((id) => !STEPS[id]);
console.log(`\n${ids.length - failed.length} captured, ${failed.length} failed, ${missing.length} without a step yet.`);
if (missing.length) console.log("No step yet:", missing.join(" "));
void esc; void asVolunteer; void byRole;
