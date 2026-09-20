import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

type TargetFixture = {
  eventId: string;
  eventName: string;
  parentId: string;
  parentName: string;
  firstTargetId: string;
  firstTargetName: string;
  firstAssignmentId: string;
  secondTargetId: string;
  secondTargetName: string;
  secondAssignmentId: string;
  apartmentAddress: string;
  apartmentParcel: { countyFips: string; gislink: string };
  outsideAddress: string;
};

type PlanningGisRequest = { pathname: string; boundary: unknown };

function hasGeoJsonPoint(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as { type?: unknown; coordinates?: unknown };
  return point.type === "Point" && Array.isArray(point.coordinates) && point.coordinates.length >= 2
    && point.coordinates.slice(0, 2).every(Number.isFinite);
}

const TEST_GIS_CENTER = [-87.7824, 41.8856] as const;
const TEST_STREET_RESPONSE = {
  release: "playwright-test-streets-v1",
  source: "Playwright test GIS fixture",
  complete: true,
  truncated: false,
  features: [
    { id: "playwright-test-main-west", name: "Test Main Street", road_class: "residential", subclass: null,
      geometry: { type: "LineString", coordinates: [[-87.7849, 41.8856], [-87.7824, 41.8856]] } },
    { id: "playwright-test-main-east", name: "Test Main Street", road_class: "residential", subclass: null,
      geometry: { type: "LineString", coordinates: [[-87.7824, 41.8856], [-87.7799, 41.8856]] } },
    { id: "playwright-test-cross", name: "Test Church Avenue", road_class: "residential", subclass: null,
      geometry: { type: "LineString", coordinates: [[-87.7824, 41.8838], [-87.7824, 41.8874]] } },
  ],
};

const TEST_PARCEL_RESPONSE = {
  datasetRevision: "playwright-test-parcels-v1",
  complete: true,
  truncated: false,
  features: Array.from({ length: 6 }, (_, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const left = TEST_GIS_CENTER[0] - 0.0022 + column * 0.0015;
    const bottom = TEST_GIS_CENTER[1] - 0.00135 + row * 0.0015;
    return {
      county_fips: "47099",
      gislink: `playwright-test-parcel-${index + 1}`,
      representative_point: [left + 0.00055, bottom + 0.0005],
      geometry: { type: "Polygon", coordinates: [[
        [left, bottom], [left + 0.0011, bottom], [left + 0.0011, bottom + 0.001],
        [left, bottom + 0.001], [left, bottom],
      ]] },
    };
  }),
};

async function installTestPlanningGis(page: Page) {
  const requests: PlanningGisRequest[] = [];
  const routeRpc = async (pathname: string, response: unknown) => {
    await page.route(`**/rest/v1/rpc/${pathname}`, async (route) => {
      const body = route.request().postDataJSON() as { territory_boundary?: unknown } | null;
      requests.push({ pathname, boundary: body?.territory_boundary });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
    });
  };
  await routeRpc("public_map_streets_for_boundary_v1", TEST_STREET_RESPONSE);
  await routeRpc("public_map_parcels_for_boundary_v1", TEST_PARCEL_RESPONSE);
  return requests;
}

async function openDemo(page: Page, options: { realPlanningGis?: boolean } = {}) {
  const planningRequests = options.realPlanningGis ? [] : await installTestPlanningGis(page);
  await page.route(/https:\/\/api\.maptiler\.com\/maps\/streets-v4\/style\.json.*/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
  }));
  await page.goto("/demo");
  await expect(page.getByText(/Sample workspace · fictional data only/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
  return planningRequests;
}

const LAWRENCE_ZONE = {
  id: "playwright-lawrence-downtown-zone",
  name: "Lawrence downtown QA zone",
  center: [-87.34, 35.24] as [number, number],
  boundary: [[-87.35, 35.23], [-87.33, 35.23], [-87.33, 35.25], [-87.35, 35.25]] as [number, number][],
};

async function installLawrenceDemoZone(page: Page) {
  await page.evaluate(async (zone) => {
    type DemoWorkspace = {
      church: { id: string };
      territories: Array<Record<string, unknown> & { id: string }>;
      updatedAt: string;
    };
    const databaseNames = (await indexedDB.databases())
      .map(({ name }) => name)
      .filter((name): name is string => Boolean(name?.startsWith("neighborwalk")));

    for (const databaseName of databaseNames) {
      const request = indexedDB.open(databaseName);
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        if (!database.objectStoreNames.contains("app_state")) continue;
        const read = database.transaction("app_state", "readonly").objectStore("app_state").get("demo");
        const data = await new Promise<DemoWorkspace | undefined>((resolve, reject) => {
          read.onsuccess = () => resolve(read.result as DemoWorkspace | undefined);
          read.onerror = () => reject(read.error);
        });
        if (!data) continue;
        data.territories = [
          ...data.territories.filter(({ id }) => id !== zone.id),
          { ...zone, churchId: data.church.id, kind: "map", color: "#286c59", zoom: 15 },
        ];
        data.updatedAt = new Date().toISOString();
        const write = database.transaction("app_state", "readwrite");
        write.objectStore("app_state").put(data, "demo");
        await new Promise<void>((resolve, reject) => {
          write.oncomplete = () => resolve();
          write.onerror = () => reject(write.error);
          write.onabort = () => reject(write.error);
        });
        return;
      } finally {
        database.close();
      }
    }
    throw new Error("The fictional demo workspace was not found in IndexedDB.");
  }, LAWRENCE_ZONE);
  await page.reload();
  await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
}

function requestUsesLawrenceBoundary(request: import("@playwright/test").Request) {
  try {
    const body = request.postDataJSON() as { territory_boundary?: { coordinates?: number[][][] } };
    const ring = body.territory_boundary?.coordinates?.[0] ?? [];
    return ring.some(([longitude, latitude]) => longitude === LAWRENCE_ZONE.boundary[0][0] && latitude === LAWRENCE_ZONE.boundary[0][1]);
  } catch {
    return false;
  }
}

function collectRuntimeErrors(page: Page) {
  const evidence = { errors: [] as string[], parcelRpcRequests: [] as string[] };
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) evidence.errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => evidence.errors.push(`page: ${error.message}`));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/rest/v1/rpc/parcels_")) evidence.parcelRpcRequests.push(`${response.request().method()} ${url.pathname} -> ${response.status()}`);
    if (response.status() >= 400) evidence.errors.push(`http ${response.status()}: ${url.hostname}${url.pathname}`);
  });
  return evidence;
}

async function captureDesktopAndMobile(page: Page, name: string) {
  const original = page.viewportSize() ?? { width: 1280, height: 900 };
  const directory = path.resolve("work/verification");
  mkdirSync(directory, { recursive: true });
  for (const viewport of [{ label: "desktop", width: 1280, height: 900 }, { label: "mobile", width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.screenshot({ path: path.join(directory, `${name}-${viewport.label}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  }
  await page.setViewportSize(original);
}

async function dragAcrossMap(page: Page, map: Locator, from: readonly [number, number], to: readonly [number, number]) {
  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width * from[0], bounds!.y + bounds!.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * to[0], bounds!.y + bounds!.height * to[1], { steps: 8 });
  await page.mouse.up();
}

test("a leader can start drawing a new zone from the app header", async ({ page }) => {
  await openDemo(page);

  const addZone = page.getByRole("button", { name: "Add zone", exact: true });
  await expect(addZone).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(addZone).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await addZone.click();

  const drawingControls = page.locator(".draw-controls");
  await expect(drawingControls).toBeVisible();
  const shape = page.getByRole("group", { name: "Boundary shape", exact: true });
  const rectangle = shape.getByRole("button", { name: "Rectangle", exact: true });
  const polygon = shape.getByRole("button", { name: "Polygon", exact: true });
  const finish = drawingControls.getByRole("button", { name: "Finish boundary", exact: true });
  await expect(rectangle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".map-drawing-panel")).toContainText("Press and drag diagonally");
  await expect(finish).toBeDisabled();

  const map = page.getByRole("region", { name: /Interactive map of/ });
  const mapShell = page.locator(".map-engine-shell");
  await expect(mapShell).toHaveClass(/map-drawing-active/);
  await expect(mapShell).toHaveCSS("touch-action", "none");
  await expect(map.locator(".maplibregl-canvas")).toHaveCSS("touch-action", "none");
  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  await map.click({ position: { x: bounds!.width * .2, y: bounds!.height * .35 } });
  await expect(finish).toBeDisabled();
  await dragAcrossMap(page, map, [.2, .35], [.8, .75]);
  await expect(page.locator(".map-drawing-panel")).toContainText("Rectangle ready");
  await expect(finish).toBeEnabled();

  await polygon.click();
  await expect(polygon).toHaveAttribute("aria-pressed", "true");
  await expect(finish).toBeDisabled();
  await map.click({ position: { x: bounds!.width * .2, y: bounds!.height * .35 } });
  await map.click({ position: { x: bounds!.width * .8, y: bounds!.height * .4 } });
  await map.click({ position: { x: bounds!.width * .5, y: bounds!.height * .75 } });
  await expect(page.locator(".map-drawing-panel")).toContainText("3 corners added");
  await expect(finish).toBeEnabled();
  await expect(addZone).toHaveCount(0);
});

async function targetFixtureState(page: Page, fixture: TargetFixture) {
  return page.evaluate(async (requested) => {
    type DemoWorkspace = {
      events: Array<{ id: string; name: string; status: string }>;
      assignments?: Array<{ id: string; eventId: string; targetId?: string; status: string }>;
      walkTargets: Array<{ id: string; eventId: string; territoryId: string; name: string; rosterState: string; frozenAt?: string; finishedAt?: string }>;
      visits: Array<{ id: string; targetId?: string; targetParcel?: { countyFips: string; gislink: string }; propertyId?: string }>;
      properties: Array<{ id: string; address: string; unit?: string }>;
    };
    const databaseNames = (await indexedDB.databases())
      .map(({ name }) => name)
      .filter((name): name is string => Boolean(name?.startsWith("neighborwalk")));

    for (const databaseName of databaseNames) {
      const request = indexedDB.open(databaseName);
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        if (!database.objectStoreNames.contains("app_state")) continue;
        const stored = database.transaction("app_state", "readonly").objectStore("app_state").get("demo");
        const data = await new Promise<DemoWorkspace | undefined>((resolve, reject) => {
          stored.onsuccess = () => resolve(stored.result as DemoWorkspace | undefined);
          stored.onerror = () => reject(stored.error);
        });
        if (!data) continue;
        const apartment = data.properties.find((property) => property.address === requested.apartmentAddress && property.unit === "Apartment A");
        const repeatedEvents = data.events.filter(({ id, name }) => id !== requested.eventId && name === requested.eventName);
        return {
          event: data.events.find(({ id }) => id === requested.eventId),
          targetVisits: data.visits.filter((visit) => visit.propertyId === apartment?.id && visit.targetId === requested.secondTargetId)
            .map((visit) => ({ id: visit.id, targetId: visit.targetId, targetParcel: visit.targetParcel })),
          assignment: data.assignments?.find(({ id }) => id === requested.secondAssignmentId),
          target: data.walkTargets.find(({ id }) => id === requested.secondTargetId),
          eventAssignments: (data.assignments ?? []).filter(({ eventId }) => eventId === requested.eventId)
            .map(({ id, targetId, status }) => ({ id, targetId: targetId ?? null, status })).sort((left, right) => left.id.localeCompare(right.id)),
          eventTargets: data.walkTargets.filter(({ eventId }) => eventId === requested.eventId)
            .map(({ id, territoryId, name, rosterState, frozenAt }) => ({ id, territoryId, name, rosterState, frozenAt: frozenAt ?? null })).sort((left, right) => left.id.localeCompare(right.id)),
          repeatedEvents,
          repeatedAssignmentCount: (data.assignments ?? []).filter(({ eventId }) => repeatedEvents.some((event) => event.id === eventId)).length,
          repeatedTargetCount: data.walkTargets.filter(({ eventId }) => repeatedEvents.some((event) => event.id === eventId)).length,
        };
      } finally {
        database.close();
      }
    }
    throw new Error("The fictional demo workspace was not found in IndexedDB.");
  }, fixture);
}

async function installTargetFixture(page: Page): Promise<TargetFixture> {
  await openDemo(page);
  const suffix = randomUUID().slice(0, 8);
  const fixture = await page.evaluate(async (idSuffix) => {
    type StoredRecord = Record<string, unknown> & { id: string };
    type DemoWorkspace = {
      church: { id: string };
      volunteers: Array<StoredRecord>;
      events: Array<StoredRecord>;
      territories: Array<StoredRecord & { name: string }>;
      assignments?: Array<StoredRecord>;
      outingParticipants?: Array<StoredRecord>;
      walkTargets: Array<StoredRecord>;
      properties: Array<StoredRecord>;
      visits: Array<StoredRecord>;
      updatedAt: string;
    };

    const databaseNames = (await indexedDB.databases())
      .map(({ name }) => name)
      .filter((name): name is string => Boolean(name?.startsWith("neighborwalk")));

    for (const databaseName of databaseNames) {
      const request = indexedDB.open(databaseName);
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        if (!database.objectStoreNames.contains("app_state")) continue;
        const read = database.transaction("app_state", "readonly").objectStore("app_state").get("demo");
        const data = await new Promise<DemoWorkspace | undefined>((resolve, reject) => {
          read.onsuccess = () => resolve(read.result as DemoWorkspace | undefined);
          read.onerror = () => reject(read.error);
        });
        if (!data) continue;

        const now = new Date();
        const parent = data.territories.find(({ name }) => name === "Oakwood East");
        const leader = data.volunteers.find(({ id }) => id === "volunteer_erica");
        if (!parent || !leader) throw new Error("The fictional parent zone or leader is unavailable.");
        const eventId = `event_zone_browser_${idSuffix}`;
        const firstTargetId = `target_zone_browser_${idSuffix}_north`;
        const secondTargetId = `target_zone_browser_${idSuffix}_south`;
        const firstTargetName = `Fictional north target ${idSuffix}`;
        const secondTargetName = `Fictional south target ${idSuffix}`;
        const eventName = `Fictional two-target walk ${idSuffix}`;
        const firstParcel = { countyFips: "47055", gislink: `browser-${idSuffix}-north` };
        const apartmentParcel = { countyFips: "47055", gislink: `browser-${idSuffix}-apartments` };
        const remainingParcel = { countyFips: "47055", gislink: `browser-${idSuffix}-remaining` };
        const targetParcel = (parcel: typeof firstParcel) => ({ ...parcel, datasetRevision: "fictional-browser-v1", inclusionSource: "manual_add" });
        const center = [-87.7824, 41.8856] as const;
        const rectangle = (south: number, north: number) => ({
          type: "Polygon",
          coordinates: [[
            [center[0] - 0.0025, south],
            [center[0] + 0.0025, south],
            [center[0] + 0.0025, north],
            [center[0] - 0.0025, north],
            [center[0] - 0.0025, south],
          ]],
        });
        const startsAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
        const endsAt = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
        const recordedAt = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
        const apartmentAddress = `Fictional Courtyard ${idSuffix}`;
        const outsideAddress = `Fictional North House ${idSuffix}`;
        const apartmentA = `property_zone_browser_${idSuffix}_apt_a`;
        const apartmentB = `property_zone_browser_${idSuffix}_apt_b`;
        const remainingHouse = `property_zone_browser_${idSuffix}_remaining`;

        data.events.push({ id: eventId, churchId: data.church.id, name: eventName, startsAt, endsAt, status: "active", timezone: "America/Chicago", purpose: "Practice exact target selection.", meetingPoint: "Fictional welcome table", leaderContact: "Erica" });
        data.outingParticipants = [
          ...(data.outingParticipants ?? []),
          { id: `participant_zone_browser_${idSuffix}`, churchId: data.church.id, eventId, volunteerId: leader.id, status: "checked_in" },
        ];
        data.walkTargets.push(
          { id: firstTargetId, churchId: data.church.id, eventId, territoryId: parent.id, name: firstTargetName, color: "#286c59", selectionKind: "rectangle", geometry: rectangle(41.8856, 41.888), parcels: [targetParcel(firstParcel)], rosterState: "frozen", frozenAt: now.toISOString() },
          { id: secondTargetId, churchId: data.church.id, eventId, territoryId: parent.id, name: secondTargetName, color: "#a9660d", selectionKind: "rectangle", geometry: rectangle(41.8832, 41.8855), parcels: [targetParcel(apartmentParcel), targetParcel(remainingParcel)], rosterState: "frozen", frozenAt: now.toISOString() },
        );
        const firstAssignmentId = `assignment_zone_browser_${idSuffix}_north`;
        const secondAssignmentId = `assignment_zone_browser_${idSuffix}_south`;
        data.assignments = [
          ...(data.assignments ?? []),
          { id: firstAssignmentId, churchId: data.church.id, eventId, territoryId: parent.id, targetId: firstTargetId, assignedVolunteerId: leader.id, status: "accepted" },
          { id: secondAssignmentId, churchId: data.church.id, eventId, territoryId: parent.id, targetId: secondTargetId, assignedVolunteerId: leader.id, status: "accepted" },
        ];
        const property = (id: string, address: string, unit: string | undefined, parcel: typeof firstParcel, coordinates: readonly [number, number]) => ({
          id, churchId: data.church.id, territoryId: parent.id, address, ...(unit ? { unit } : {}), parcel,
          coordinates: [...coordinates], currentOutcome: "unvisited", visitCount: 0, createdAt: recordedAt, updatedAt: recordedAt, source: "manual",
        });
        data.properties.push(
          property(`property_zone_browser_${idSuffix}_north`, outsideAddress, undefined, firstParcel, [center[0], 41.8865]),
          property(apartmentA, apartmentAddress, "Apartment A", apartmentParcel, [center[0] - 0.0002, 41.8844]),
          property(apartmentB, apartmentAddress, "Apartment B", apartmentParcel, [center[0] - 0.0001, 41.8844]),
          property(remainingHouse, `Fictional Remaining House ${idSuffix}`, undefined, remainingParcel, [center[0] + 0.001, 41.884]),
        );
        const visit = (id: string, propertyId: string, targetId: string, parcel: typeof firstParcel, corrections?: unknown[]) => ({
          id, churchId: data.church.id, eventId, territoryId: parent.id, targetId, targetParcel: parcel, propertyId,
          volunteerId: leader.id, outcome: "conversation", context: "door", recordedAt, deviceId: "fictional-browser", ...(corrections ? { corrections } : {}),
        });
        data.visits.unshift(
          visit(`visit_zone_browser_${idSuffix}_apt_a_1`, apartmentA, secondTargetId, apartmentParcel),
          visit(`visit_zone_browser_${idSuffix}_apt_a_2`, apartmentA, secondTargetId, apartmentParcel),
          visit(`visit_zone_browser_${idSuffix}_apt_b`, apartmentB, secondTargetId, apartmentParcel),
          visit(`visit_zone_browser_${idSuffix}_void`, remainingHouse, secondTargetId, remainingParcel, [{ id: `correction_zone_browser_${idSuffix}`, actorId: leader.id, createdAt: now.toISOString(), reason: "Fictional duplicate entry", outcome: "conversation", context: "door", voided: true }]),
        );
        data.updatedAt = now.toISOString();

        const write = database.transaction("app_state", "readwrite");
        write.objectStore("app_state").put(data, "demo");
        await new Promise<void>((resolve, reject) => {
          write.oncomplete = () => resolve();
          write.onerror = () => reject(write.error);
          write.onabort = () => reject(write.error);
        });
        return { eventId, eventName, parentId: parent.id, parentName: parent.name, firstTargetId, firstTargetName, firstAssignmentId, secondTargetId, secondTargetName, secondAssignmentId, apartmentAddress, apartmentParcel, outsideAddress };
      } finally {
        database.close();
      }
    }
    throw new Error("The fictional demo workspace was not found in IndexedDB.");
  }, suffix);

  await page.reload();
  await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
  return fixture;
}

async function plannedWalkState(page: Page, walkName: string, zoneName: string) {
  return page.evaluate(async ({ requestedWalk, requestedZone }) => {
    type DemoWorkspace = {
      events: Array<{ id: string; name: string; status: string }>;
      territories: Array<{ id: string; name: string }>;
      assignments?: Array<{ id: string; eventId: string; territoryId: string; targetId?: string; status: string }>;
      outingParticipants?: Array<{ id: string; eventId: string; volunteerId: string; status: string }>;
      walkTargets: Array<{ id: string; eventId: string; territoryId: string; name: string; rosterState: string; frozenAt?: string; parcels: unknown[] }>;
    };
    const databaseNames = (await indexedDB.databases()).map(({ name }) => name)
      .filter((name): name is string => Boolean(name?.startsWith("neighborwalk")));
    for (const databaseName of databaseNames) {
      const request = indexedDB.open(databaseName);
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        if (!database.objectStoreNames.contains("app_state")) continue;
        const stored = database.transaction("app_state", "readonly").objectStore("app_state").get("demo");
        const data = await new Promise<DemoWorkspace | undefined>((resolve, reject) => {
          stored.onsuccess = () => resolve(stored.result as DemoWorkspace | undefined);
          stored.onerror = () => reject(stored.error);
        });
        if (!data) continue;
        const events = data.events.filter(({ name }) => name === requestedWalk);
        const zones = data.territories.filter(({ name }) => name === requestedZone);
        const eventIds = new Set(events.map(({ id }) => id));
        const zoneIds = new Set(zones.map(({ id }) => id));
        const targets = data.walkTargets.filter(({ eventId, territoryId }) => eventIds.has(eventId) && zoneIds.has(territoryId));
        const targetIds = new Set(targets.map(({ id }) => id));
        const assignments = (data.assignments ?? []).filter(({ eventId, territoryId, targetId }) => eventIds.has(eventId) && zoneIds.has(territoryId) && Boolean(targetId && targetIds.has(targetId)));
        const participants = (data.outingParticipants ?? []).filter(({ eventId }) => eventIds.has(eventId));
        return { events, zones, targets, assignments, participants };
      } finally {
        database.close();
      }
    }
    throw new Error("The fictional demo workspace was not found in IndexedDB.");
  }, { requestedWalk: walkName, requestedZone: zoneName });
}

test("a leader can ready a whole-zone walk and start it from the card", async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const walkName = `Fictional drawn-zone walk ${suffix}`;
  const zoneName = `Fictional drawn zone ${suffix}`;
  const runtimeErrors = collectRuntimeErrors(page);
  const planningRequests = await openDemo(page);
  await page.getByRole("button", { name: "View map", exact: true }).click();
  await page.getByRole("button", { name: "Plan a walk", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Plan a walk" });
  await dialog.getByRole("textbox", { name: "Walk name", exact: true }).fill(walkName);
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(dialog.getByText("Streets: 3 sections", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Parcels: 6 residential parcels", { exact: true })).toBeVisible();
  const parcelRequestsBeforeCreator = planningRequests.filter(({ pathname }) => pathname === "public_map_parcels_for_boundary_v1").length;

  await dialog.getByRole("button", { name: "Draw and name a new zone", exact: true }).click();
  const creator = dialog.locator(".walk-parent-zone-creator");
  const createZone = creator.getByRole("button", { name: "Create and use this zone", exact: true });
  await creator.getByRole("textbox", { name: "Zone name", exact: true }).fill(zoneName);
  await expect(createZone).toBeDisabled();
  const map = creator.getByRole("region", { name: /Interactive map of/ });
  await expect(map).toBeVisible();
  await expect(creator.locator(".map-state")).toHaveCount(0);
  await expect.poll(() => planningRequests.filter(({ pathname }) => pathname === "public_map_parcels_for_boundary_v1").length)
    .toBeGreaterThan(parcelRequestsBeforeCreator);
  const creatorParcelRequest = planningRequests.filter(({ pathname }) => pathname === "public_map_parcels_for_boundary_v1").at(-1);
  expect(creatorParcelRequest?.boundary).toMatchObject({ type: "Polygon" });
  const creatorRing = (creatorParcelRequest?.boundary as { coordinates?: unknown[][][] }).coordinates?.[0];
  expect(creatorRing).toHaveLength(5);
  expect(creatorRing?.[0]).toEqual(creatorRing?.at(-1));
  expect(new Set(creatorRing?.slice(0, -1).map((point) => point.join(":"))).size).toBe(4);
  await expect(creator.getByText("6 residential parcels loaded. Draw your zone around the neighborhood.", { exact: true })).toBeVisible();
  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  await dragAcrossMap(page, map, [.15, .2], [.85, .8]);
  await expect(creator.getByText("Rectangle ready", { exact: true })).toBeVisible();
  await expect(createZone).toBeEnabled();
  await createZone.click();

  const parentZone = dialog.getByRole("combobox", { name: "Persistent parent zone", exact: true });
  await expect(parentZone.locator("option:checked")).toHaveText(zoneName);
  const planner = dialog.getByRole("region", { name: `Plan targets inside ${zoneName}`, exact: true });
  await expect(planner.getByRole("button", { name: "Streets", exact: true })).toBeEnabled();
  await planner.getByRole("button", { name: "Whole zone", exact: true }).click();
  await expect(planner.locator(".walk-target-list li")).toHaveCount(1);
  await captureDesktopAndMobile(page, `zones-${suffix}-where`);
  const continueToWho = dialog.getByRole("button", { name: "Continue", exact: true });
  await expect(continueToWho).toBeEnabled();
  await continueToWho.click();
  await expect(dialog.getByRole("heading", { name: "Invite people to the outing", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Invite Maya", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Remove Maya", exact: true })).toHaveAttribute("aria-pressed", "true");
  await captureDesktopAndMobile(page, `zones-${suffix}-who`);
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();

  const review = dialog.getByRole("region", { name: "Reviewed target plan", exact: true });
  await expect(review.locator(".walk-target-state")).toHaveCount(0);
  await expect(review).toContainText(zoneName);
  await expect(review).toContainText("Staff at check-in");
  await expect(dialog.locator(".walk-review-list")).toContainText("1 person");
  await dialog.getByRole("textbox", { name: "Purpose", exact: true }).fill("Practice a respectful fictional neighborhood walk.");
  await dialog.getByRole("textbox", { name: "Meeting point", exact: true }).fill("Fictional welcome table");
  await dialog.getByRole("textbox", { name: "Leader contact", exact: true }).fill("Erica");
  await captureDesktopAndMobile(page, `zones-${suffix}-review`);
  await dialog.getByRole("button", { name: "Save & mark ready", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: walkName, exact: true })).toBeVisible();

  const firstState = await plannedWalkState(page, walkName, zoneName);
  expect(firstState.events).toHaveLength(1);
  expect(firstState.events[0].status).toBe("ready");
  expect(firstState.zones).toHaveLength(1);
  expect(firstState.targets).toHaveLength(1);
  expect(firstState.targets[0]).toMatchObject({
    eventId: firstState.events[0].id,
    territoryId: firstState.zones[0].id,
    rosterState: "frozen",
  });
  expect(firstState.targets[0].frozenAt).toBeTruthy();
  expect(firstState.targets[0].parcels.length).toBeGreaterThan(0);
  expect(firstState.assignments).toHaveLength(0);
  expect(firstState.participants).toHaveLength(1);
  expect(firstState.participants[0]).toMatchObject({ eventId: firstState.events[0].id, status: "invited" });

  await page.reload();
  await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
  expect(await plannedWalkState(page, walkName, zoneName)).toEqual(firstState);
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("button", { name: "Walks", exact: true }).click();
  const readyCard = page.locator(".outing-card").filter({ hasText: walkName });
  const startWalk = readyCard.getByRole("button", { name: "Start walk", exact: true });
  await expect(startWalk).toBeVisible();
  await startWalk.click();
  await expect(readyCard.getByText("active", { exact: true })).toBeVisible();
  await expect(startWalk).toHaveCount(0);
  const startedState = await plannedWalkState(page, walkName, zoneName);
  expect(startedState.events[0].status).toBe("active");

  const completeWalk = readyCard.getByRole("button", { name: "Complete walk", exact: true });
  await expect(completeWalk).toBeVisible();
  page.once("dialog", async (confirmation) => {
    expect(confirmation.message()).toBe("Complete this walk? Encounters and follow-up responsibilities are preserved.");
    await confirmation.accept();
  });
  await completeWalk.click();
  await expect(readyCard).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Include completed, cancelled and archived outings", exact: true }).check();
  const completedCard = page.locator(".outing-card").filter({ hasText: walkName });
  await expect(completedCard.getByText("completed", { exact: true })).toBeVisible();
  await expect(completedCard.getByRole("button", { name: "Complete walk", exact: true })).toHaveCount(0);
  const completedState = await plannedWalkState(page, walkName, zoneName);
  expect(completedState.events[0].status).toBe("completed");
  await page.reload();
  await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
  expect(await plannedWalkState(page, walkName, zoneName)).toEqual(completedState);
  expect(runtimeErrors.errors).toEqual([]);
});

test("the planner starts from a persistent zone and offers area and street target modes", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "View map", exact: true }).click();
  await page.getByRole("button", { name: "Plan a walk", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Plan a walk" });
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();

  const parentZone = dialog.getByRole("combobox", { name: "Persistent parent zone", exact: true });
  await expect(parentZone).toBeVisible();
  await parentZone.selectOption({ label: "Oakwood East" });
  const planner = dialog.getByRole("region", { name: "Plan targets inside Oakwood East", exact: true });
  await expect(planner).toBeVisible();
  await expect(planner.getByRole("button", { name: "Whole zone", exact: true })).toBeEnabled();
  const map = planner.getByRole("application", { name: "Interactive target map", exact: true });
  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();

  await planner.getByRole("button", { name: "Polygon", exact: true }).click();
  const mapWrap = planner.locator(".walk-target-map-wrap");
  await expect(mapWrap).toHaveClass(/map-drawing-active/);
  await expect(mapWrap).toHaveCSS("touch-action", "none");
  await expect(map.locator(".maplibregl-canvas")).toHaveCSS("touch-action", "none");
  await expect(planner.getByText(/continue around the boundary/)).toBeVisible();
  await map.click({ position: { x: bounds!.width * .3, y: bounds!.height * .3 } });
  await map.click({ position: { x: bounds!.width * .7, y: bounds!.height * .35 } });
  await map.click({ position: { x: bounds!.width * .5, y: bounds!.height * .7 } });
  await expect(planner.getByText(/3 corners added/)).toBeVisible();
  await expect(planner.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  await planner.getByRole("button", { name: "Rectangle", exact: true }).click();
  await expect(planner.getByText(/Press and drag diagonally/)).toBeVisible();
  const clearSelection = planner.getByRole("button", { name: "Clear selection", exact: true });
  await expect(clearSelection).toBeDisabled();
  await map.click({ position: { x: bounds!.width * .3, y: bounds!.height * .3 } });
  await expect(clearSelection).toBeDisabled();
  await dragAcrossMap(page, map, [.3, .3], [.7, .7]);
  await expect(planner.getByText(/Rectangle ready/)).toBeVisible();
  await expect(clearSelection).toBeEnabled();
  await dragAcrossMap(page, map, [.7, .7], [.75, .65]);
  await expect(planner.getByText(/Rectangle ready/)).toBeVisible();
  await expect(clearSelection).toBeEnabled();
  await clearSelection.click();
  await expect(clearSelection).toBeDisabled();

  const streets = planner.getByRole("button", { name: "Streets", exact: true });
  await expect(streets).toBeEnabled();
  await streets.click();
  await expect(mapWrap).not.toHaveClass(/map-drawing-active/);
  const connectedSections = planner.getByRole("checkbox", { name: "Also select connected sections of the same named road", exact: true });
  await expect(connectedSections).not.toBeChecked();
  await connectedSections.check();
  await expect(connectedSections).toBeChecked();
  await expect(planner.getByRole("combobox", { name: "Side", exact: true })).toHaveCount(0);
  await expect(planner.locator(".walk-target-state")).toHaveCount(0);
  // Select Church Avenue directly, just above its intersection with Main Street.
  await map.click({ position: { x: bounds!.width / 2, y: bounds!.height / 2 - 24 } });
  await expect(planner.getByRole("button", { name: "Review parcels", exact: true })).toHaveCount(0);
  await expect(planner.getByText(/residential parcels? selected\. Tap a parcel to add or remove it\./)).toBeVisible();
  const addTarget = planner.getByRole("button", { name: "Add target", exact: true });
  await expect(addTarget).toBeEnabled();
  await expect(clearSelection).toBeEnabled();
  await clearSelection.click();
  await expect(addTarget).toBeDisabled();
  await expect(clearSelection).toBeDisabled();
  await map.click({ position: { x: bounds!.width / 2, y: bounds!.height / 2 - 24 } });
  await expect(addTarget).toBeEnabled();
  await addTarget.click();
  await expect(planner.locator(".walk-target-list li")).toHaveCount(1);
  await expect(planner.locator(".walk-target-list li").first()).toContainText("streets");
  await expect(planner.getByRole("button", { name: /^Remove / })).toBeEnabled();
});

test("real Lawrence parcels support a new zone and ready whole-zone walk without hosted writes", async ({ page }) => {
  // Fresh CI sandboxes contain only fictional parcels. Keep this real-inventory
  // check available for operator-loaded local GIS without pretending it ran in CI.
  const hasRealInventory = execFileSync("psql", ["postgresql://postgres:postgres@127.0.0.1:54322/postgres", "-X", "-Atq", "-v", "ON_ERROR_STOP=1", "-c",
    "select exists(select 1 from public.parcels where county_fips='47099' and gislink !~* 'demo|fictional|playwright-test') and exists(select 1 from public.outreach_street_releases where source='Overture transportation' and complete);"],
  { encoding: "utf8" }).trim() === "t";
  test.skip(!hasRealInventory, "Real Lawrence parcel and street inventory is not installed in this local sandbox.");
  const suffix = randomUUID().slice(0, 8);
  const zoneName = `Lawrence real-data zone ${suffix}`;
  const walkName = `Lawrence real-data walk ${suffix}`;
  const unexpectedRestRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.startsWith("/rest/v1/rpc/public_map_")) {
      unexpectedRestRequests.push(`${request.method()} ${url.pathname}`);
    }
  });

  await openDemo(page, { realPlanningGis: true });
  await installLawrenceDemoZone(page);
  await page.getByRole("button", { name: "View map", exact: true }).click();
  await page.getByRole("button", { name: "Plan a walk", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Plan a walk" });
  await dialog.getByRole("textbox", { name: "Walk name", exact: true }).fill(walkName);
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();

  const initialPlanner = dialog.locator(".walk-target-planner");
  await expect(initialPlanner.getByText("Streets: loading…", { exact: true })).toBeHidden({ timeout: 30_000 });
  await expect(initialPlanner.getByText("Parcels: loading…", { exact: true })).toBeHidden({ timeout: 30_000 });

  const baseStreetsPromise = page.waitForResponse((response) => response.url().includes("/rest/v1/rpc/public_map_streets_for_boundary_v1")
    && requestUsesLawrenceBoundary(response.request()));
  const baseParcelsPromise = page.waitForResponse((response) => response.url().includes("/rest/v1/rpc/public_map_parcels_for_boundary_v1")
    && requestUsesLawrenceBoundary(response.request()));
  await dialog.getByRole("combobox", { name: "Persistent parent zone", exact: true }).selectOption(LAWRENCE_ZONE.id);
  const [baseStreetsResponse, baseParcelsResponse] = await Promise.all([baseStreetsPromise, baseParcelsPromise]);
  expect(baseStreetsResponse.status()).toBe(200);
  expect(baseParcelsResponse.status()).toBe(200);

  const viewportParcelsPromise = page.waitForResponse((response) => response.url().includes("/rest/v1/rpc/public_map_parcels_for_boundary_v1"));
  await dialog.getByRole("button", { name: "Draw and name a new zone", exact: true }).click();
  const creator = dialog.locator(".walk-parent-zone-creator");
  const viewportParcelsResponse = await viewportParcelsPromise;
  expect(viewportParcelsResponse.status()).toBe(200);
  const viewportPayload = await viewportParcelsResponse.json() as {
    availability?: string;
    datasetRevision?: string;
    complete?: boolean;
    truncated?: boolean;
    features?: Array<{ county_fips?: string; gislink?: string; geometry?: { type?: string; coordinates?: unknown }; representative_point?: unknown }>;
  };
  expect(viewportPayload).toMatchObject({ availability: "available", complete: true, truncated: false });
  expect(viewportPayload.datasetRevision).toBeTruthy();
  expect(viewportPayload.features?.length).toBeGreaterThan(0);
  expect(viewportPayload.features?.every((feature) => feature.county_fips === "47099"
    && Boolean(feature.gislink) && !/demo|fictional|playwright-test/i.test(feature.gislink!)
    && (feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon")
    && Array.isArray(feature.geometry.coordinates)
    && hasGeoJsonPoint(feature.representative_point))).toBe(true);
  await expect(creator.getByText(`${viewportPayload.features?.length} residential parcels loaded. Draw your zone around the neighborhood.`, { exact: true })).toBeVisible();

  await creator.getByRole("textbox", { name: "Zone name", exact: true }).fill(zoneName);
  const creatorMap = creator.getByRole("region", { name: /Interactive map of/ });
  const creatorBounds = await creatorMap.boundingBox();
  expect(creatorBounds).not.toBeNull();
  await expect(creator.locator(".map-state")).toHaveCount(0);
  // Keep the gesture clear of the drawing controls overlaid at top left.
  await dragAcrossMap(page, creatorMap, [.42, .45], [.70, .73]);
  await expect(creator.getByText("Rectangle ready", { exact: true })).toBeVisible();

  const createdStreetsPromise = page.waitForResponse((response) => response.url().includes("/rest/v1/rpc/public_map_streets_for_boundary_v1"));
  const createdParcelsPromise = page.waitForResponse((response) => response.url().includes("/rest/v1/rpc/public_map_parcels_for_boundary_v1"));
  await creator.getByRole("button", { name: "Create and use this zone", exact: true }).click();
  const [createdStreetsResponse, createdParcelsResponse] = await Promise.all([createdStreetsPromise, createdParcelsPromise]);
  const streetPayload = await createdStreetsResponse.json() as {
    release?: string;
    source?: string;
    complete?: boolean;
    truncated?: boolean;
    features?: Array<{ id?: string; name?: string | null; geometry?: { type?: string; coordinates?: unknown } }>;
  };
  const parcelPayload = await createdParcelsResponse.json() as typeof viewportPayload;
  expect(createdStreetsResponse.status()).toBe(200);
  expect(createdParcelsResponse.status()).toBe(200);
  expect(streetPayload).toMatchObject({ complete: true, truncated: false });
  expect(streetPayload.features?.length).toBeGreaterThan(0);
  expect(streetPayload.features?.some(({ name }) => Boolean(name) && !/demo|fictional|playwright-test/i.test(name!))).toBe(true);
  expect(parcelPayload).toMatchObject({ availability: "available", complete: true, truncated: false });
  expect(parcelPayload.datasetRevision).toBeTruthy();
  expect(parcelPayload.features?.length).toBeGreaterThan(0);
  expect(parcelPayload.features?.every((feature) => feature.county_fips === "47099"
    && Boolean(feature.gislink) && !/demo|fictional|playwright-test/i.test(feature.gislink!)
    && (feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon")
    && Array.isArray(feature.geometry.coordinates)
    && hasGeoJsonPoint(feature.representative_point))).toBe(true);

  const parentZone = dialog.getByRole("combobox", { name: "Persistent parent zone", exact: true });
  await expect(parentZone.locator("option:checked")).toHaveText(zoneName);
  const planner = dialog.getByRole("region", { name: `Plan targets inside ${zoneName}`, exact: true });
  await expect(planner.getByText(`Streets: ${streetPayload.features?.length} sections`, { exact: true })).toBeVisible();
  await expect(planner.getByText(`Parcels: ${parcelPayload.features?.length} residential parcels`, { exact: true })).toBeVisible();
  await expect(planner.getByRole("button", { name: "Streets", exact: true })).toBeEnabled();
  const wholeZone = planner.getByRole("button", { name: "Whole zone", exact: true });
  await expect(wholeZone).toBeEnabled();
  await wholeZone.click();
  const target = planner.locator(".walk-target-list li").filter({ hasText: zoneName });
  await expect(target).toBeVisible();
  const rosterMatch = (await target.textContent())?.match(/(\d+) parcels/);
  expect(rosterMatch).not.toBeNull();
  const rosterCount = Number(rosterMatch![1]);
  expect(rosterCount).toBeGreaterThan(0);
  expect(rosterCount).toBeLessThanOrEqual(parcelPayload.features!.length);
  await captureDesktopAndMobile(page, `zones-lawrence-real-data-${suffix}-where`);

  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.getByRole("button", { name: "Invite Erica", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  const review = dialog.getByRole("region", { name: "Reviewed target plan", exact: true });
  await expect(review).toContainText(zoneName);
  await expect(review).toContainText("Staff at check-in");
  await expect(review).toContainText(`${rosterCount} residential ${rosterCount === 1 ? "property" : "properties"}`);
  await dialog.getByRole("textbox", { name: "Purpose", exact: true }).fill("Walk the newly mapped Lawrence zone.");
  await dialog.getByRole("textbox", { name: "Meeting point", exact: true }).fill("Lawrenceburg welcome point");
  await dialog.getByRole("textbox", { name: "Leader contact", exact: true }).fill("Erica");
  await expect(dialog.getByRole("button", { name: "Save & mark ready", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Save & mark ready", exact: true }).click();
  await expect(dialog).toBeHidden();

  const saved = await plannedWalkState(page, walkName, zoneName);
  expect(saved.events).toHaveLength(1);
  expect(saved.events[0].status).toBe("ready");
  expect(saved.zones).toHaveLength(1);
  expect(saved.targets).toHaveLength(1);
  expect(saved.targets[0]).toMatchObject({ rosterState: "frozen" });
  expect(saved.targets[0].frozenAt).toBeTruthy();
  expect(saved.targets[0].parcels).toHaveLength(rosterCount);
  const responseParcelIds = new Set(parcelPayload.features!.map(({ county_fips, gislink }) => `${county_fips}:${gislink}`));
  expect((saved.targets[0].parcels as Array<{ countyFips?: string; gislink?: string; geometry?: unknown }>).every((parcel) =>
    responseParcelIds.has(`${parcel.countyFips}:${parcel.gislink}`) && Boolean(parcel.geometry))).toBe(true);
  expect(saved.assignments).toHaveLength(0);
  expect(saved.participants).toHaveLength(1);
  expect(saved.participants[0]).toMatchObject({ eventId: saved.events[0].id, status: "invited" });
  expect(unexpectedRestRequests).toEqual([]);
});

test("a leader finishing a target below 100% also completes the walk", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const fixture = await installTargetFixture(page);
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("button", { name: "Walks", exact: true }).click();
  await page.locator(".outing-card").filter({ hasText: fixture.eventName }).click();

  const targetChoice = page.getByRole("combobox", { name: "Choose tonight’s target", exact: true });
  await expect(targetChoice).toBeVisible();
  await expect(targetChoice.locator("option")).toHaveText(["Select an assigned target", fixture.firstTargetName, fixture.secondTargetName]);
  const openWalk = page.getByRole("button", { name: "Open walk", exact: true });
  await expect(openWalk).toBeDisabled();
  await targetChoice.selectOption({ label: fixture.secondTargetName });
  await expect(openWalk).toBeEnabled();
  await openWalk.click();

  await expect(page.getByText("50%", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("target covered tonight", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Loading the neighborhood map", { exact: true })).toBeHidden();
  await captureDesktopAndMobile(page, `zones-${fixture.secondTargetId}-accepted-field`);
  const display = page.getByRole("group", { name: "Outreach display", exact: true });
  await display.getByRole("button", { name: "Address list", exact: true }).click();
  const roster = page.getByRole("region", { name: "Outreach address list", exact: true });
  await expect(roster.getByRole("combobox", { name: "Territory", exact: true })).toHaveCount(0);
  await expect(roster.getByRole("button", { name: "Print field worksheet", exact: true })).toBeVisible();
  await expect(roster.getByRole("button", { name: new RegExp(fixture.apartmentAddress) })).toHaveCount(2);
  await expect(roster.getByText(fixture.outsideAddress, { exact: false })).toHaveCount(0);
  await expect(roster.locator(".address-list-sequence")).toHaveText(["01", "02", "03"]);

  const listSearch = roster.getByRole("searchbox", { name: "Search", exact: true });
  await listSearch.fill("Apartment A");
  await expect(roster.locator(".address-rows > li")).toHaveCount(1);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".field-worksheet-packet")).toBeVisible();
  await expect(page.locator(".field-worksheet-sheet")).toHaveCount(1);
  await expect(page.locator(".field-worksheet-record")).toHaveCount(3);
  await expect(page.locator(".field-worksheet-stop.recorded")).toHaveCount(2);
  await expect(page.locator(".field-worksheet-packet")).toContainText("Confidential when completed.");
  await expect(page.locator(".field-worksheet-packet")).toContainText("Addresses 01–03 of 3");
  await expect(roster.locator(".address-rows")).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await listSearch.fill("");

  await roster.getByRole("button", { name: new RegExp(`${fixture.apartmentAddress}.*Apartment A`) }).click();
  const drawer = page.getByRole("dialog", { name: new RegExp(`Location details for ${fixture.apartmentAddress}`) });
  await drawer.locator(".outcome-options").getByRole("button", { name: "No answer", exact: true }).click();
  await drawer.getByRole("button", { name: "Save visit", exact: true }).click();
  await expect(drawer).toBeHidden();

  const afterVisit = await targetFixtureState(page, fixture);
  expect(afterVisit.targetVisits).toHaveLength(3);
  expect(afterVisit.targetVisits[0]).toMatchObject({ targetId: fixture.secondTargetId, targetParcel: fixture.apartmentParcel });
  await expect(page.getByText("50%", { exact: true }).first()).toBeVisible();

  const finish = page.getByRole("button", { name: "Finish for tonight", exact: true });
  page.once("dialog", (confirmation) => {
    expect(confirmation.message()).toContain("marks the whole walk complete");
    void confirmation.accept();
  });
  await finish.click();
  const statusControls = page.getByRole("region", { name: "Walk status controls", exact: true });
  await expect(statusControls).toContainText("completed");
  const assignment = page.locator(".assignment-list li").filter({ hasText: fixture.secondTargetName });
  await expect(assignment).toContainText("finished tonight");
  await expect(assignment).toContainText("1 of 2 residential properties visited tonight — 50%");

  await page.reload();
  await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("button", { name: "Walks", exact: true }).click();
  await page.getByRole("checkbox", { name: "Include completed, cancelled and archived outings", exact: true }).check();
  await page.locator(".outing-card").filter({ hasText: fixture.eventName }).click();
  const reloaded = page.locator(".assignment-list li").filter({ hasText: fixture.secondTargetName });
  await expect(reloaded).toContainText("finished tonight");
  await expect(reloaded).toContainText("1 of 2 residential properties visited tonight — 50%");
  const saved = await targetFixtureState(page, fixture);
  expect(saved.event?.status).toBe("completed");
  expect(saved.assignment?.status).toBe("completed");
  expect(saved.target?.finishedAt).toBeTruthy();
  expect(saved.targetVisits).toEqual(afterVisit.targetVisits);
  expect(runtimeErrors.parcelRpcRequests).toEqual([]);
  expect(runtimeErrors.errors).toEqual([]);
});

test("repeating a walk keeps preparation but requires fresh targets and acceptance", async ({ page }) => {
  const fixture = await installTargetFixture(page);
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("button", { name: "Walks", exact: true }).click();
  await page.locator(".outing-card").filter({ hasText: fixture.eventName }).click();
  await page.getByRole("button", { name: "Repeat walk", exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Repeat this walk", exact: true });
  await expect(dialog).toContainText("Tonight’s targets, owners, visits and tasks are not copied.");
  await dialog.getByRole("button", { name: "Create repeated draft", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: fixture.eventName, exact: true })).toBeVisible();
  await expect(page.getByText("draft", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".assignment-list li")).toHaveCount(0);

  const firstState = await targetFixtureState(page, fixture);
  expect(firstState.repeatedEvents).toHaveLength(1);
  expect(firstState.repeatedEvents[0].status).toBe("draft");
  expect(firstState.repeatedAssignmentCount).toBe(0);
  expect(firstState.repeatedTargetCount).toBe(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
  const reloaded = await targetFixtureState(page, fixture);
  expect(reloaded.repeatedEvents).toEqual(firstState.repeatedEvents);
  expect(reloaded.repeatedAssignmentCount).toBe(0);
  expect(reloaded.repeatedTargetCount).toBe(0);
});

test("replacing a frozen target preserves history and requires fresh acceptance", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const fixture = await installTargetFixture(page);
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("button", { name: "Walks", exact: true }).click();
  await page.locator(".outing-card").filter({ hasText: fixture.eventName }).click();

  const firstAssignment = page.locator(".assignment-list li").filter({ hasText: fixture.firstTargetName });
  await firstAssignment.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(firstAssignment).toContainText("No crew yet");

  const previousAssignment = page.locator(".assignment-list li").filter({ hasText: fixture.secondTargetName });
  await previousAssignment.getByRole("button", { name: "Replace target", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Replace frozen target", exact: true });
  await expect(dialog).toContainText(fixture.secondTargetName);
  const planner = dialog.getByRole("region", { name: `Plan targets inside ${fixture.parentName}`, exact: true });
  await planner.getByRole("button", { name: "Whole zone", exact: true }).click();
  await expect(planner.locator(".walk-target-list li")).toHaveCount(1);
  await expect(planner.getByRole("button", { name: /^Remove / })).toBeEnabled();
  await expect(dialog).toContainText("Crew carries over");
  await expect(dialog).toContainText("Erica");
  const confirmReplacement = dialog.getByRole("button", { name: "Confirm replacement", exact: true });
  await expect(confirmReplacement).toBeEnabled();
  page.once("dialog", (confirmation) => confirmation.accept());
  await confirmReplacement.click();
  await expect(dialog).toBeHidden();

  await expect(previousAssignment).toContainText("No crew yet");
  const replacementAssignment = page.locator(".assignment-list li").filter({ hasText: fixture.parentName });
  await expect(replacementAssignment).toContainText("assigned");
  await expect(replacementAssignment.getByRole("button", { name: "I can join", exact: true })).toHaveCount(0);
  await expect(replacementAssignment.getByRole("button", { name: "I can’t make it", exact: true })).toHaveCount(0);

  const replaced = await targetFixtureState(page, fixture);
  expect(replaced.eventAssignments).toHaveLength(3);
  expect(replaced.eventAssignments.find(({ id }) => id === fixture.firstAssignmentId)?.status).toBe("cancelled");
  expect(replaced.eventAssignments.find(({ id }) => id === fixture.secondAssignmentId)?.status).toBe("cancelled");
  const freshAssignment = replaced.eventAssignments.find(({ id }) => ![fixture.firstAssignmentId, fixture.secondAssignmentId].includes(id));
  expect(freshAssignment).toMatchObject({ status: "assigned" });
  expect(freshAssignment?.targetId).not.toBe(fixture.secondTargetId);
  expect(replaced.eventTargets.map(({ id }) => id)).toContain(fixture.secondTargetId);
  expect(replaced.eventTargets.find(({ id }) => id === fixture.secondTargetId)).toMatchObject({ rosterState: "frozen" });
  expect(replaced.eventTargets.find(({ id }) => id === freshAssignment?.targetId)).toMatchObject({
    territoryId: fixture.parentId,
    name: fixture.parentName,
  });

  await page.getByRole("navigation", { name: "Main sections" }).getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Can you join?", exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: `Your response for ${fixture.parentName} on ${fixture.eventName}`, exact: true })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("button", { name: "Walks", exact: true }).click();
  await page.locator(".outing-card").filter({ hasText: fixture.eventName }).click();
  const openWalk = page.getByRole("button", { name: "Open walk", exact: true });
  await expect(openWalk).toBeEnabled();
  await openWalk.click();
  await expect(page.getByRole("button", { name: new RegExp(`^${fixture.parentName}`) })).toBeVisible();
  const opened = await targetFixtureState(page, fixture);
  expect(opened.eventAssignments.find(({ id }) => id === freshAssignment?.id)?.status).toBe("assigned");

  await page.reload();
  await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
  const reloaded = await targetFixtureState(page, fixture);
  expect(reloaded.eventAssignments).toEqual(opened.eventAssignments);
  expect(reloaded.eventTargets).toEqual(opened.eventTargets);
  expect(runtimeErrors.errors).toEqual([]);
});
