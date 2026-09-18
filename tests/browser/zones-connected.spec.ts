import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// This story has no configurable remote target. Browser and SQL traffic are
// restricted to the root-approved local preview and local Supabase sandbox.
const origin = "http://127.0.0.1:3013";
const database = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const suffix = randomUUID();
const walkName = `Fictional connected map walk ${suffix}`;
const zoneName = `Fictional connected Giles zone ${suffix}`;
const parcelIds = [1, 2, 3].map((number) => `nw-connected-${suffix}-${number}`);
const gilesBoundary = [
  [-86.87, 35.25],
  [-86.83, 35.25],
  [-86.83, 35.30],
  [-86.87, 35.30],
] as const;
const overview = { center: [-87.43, 35.35] as const, zoom: 8.4 };

type InventoryState = { count: number; revision: string; fixtureCount: number };
type PlanningResponse = {
  complete: boolean;
  truncated: boolean;
  datasetRevision: string;
  features: Array<{ county_fips: string; gislink: string }>;
};
type StreetResponse = { complete: boolean; truncated: boolean; features: unknown[] };
type SavedState = {
  eventCount: number;
  eventId: string;
  eventStatus: string;
  territoryCount: number;
  territoryId: string;
  boundaryCount: number;
  boundaryOpen: boolean;
  targetCount: number;
  targetId: string;
  targetStatus: string;
  targetFrozen: boolean;
  selectionKind: string;
  targetMatchesParent: boolean;
  targetParcelIds: string[];
  assignmentCount: number;
  assignmentId: string;
  assignmentStatus: string;
  assigneeId: string | null;
  teamId: string | null;
};

function safeLiteral(value: string) {
  if (!/^[A-Za-z0-9 _-]+$/.test(value)) throw new Error("Connected browser fixture identifiers must remain fictional and generated.");
  return `'${value}'`;
}

function sql(statement: string) {
  return execFileSync("psql", [database, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", statement], { encoding: "utf8" }).trim();
}

function inventoryState(): InventoryState {
  return JSON.parse(sql(`select jsonb_build_object(
    'count',count(*),
    'revision',coalesce(to_char(max(imported_at),'YYYY-MM-DD"T"HH24:MI:SS.USOF'),'empty'),
    'fixtureCount',count(*) filter(where county_fips='47055' and gislink in (${parcelIds.map(safeLiteral).join(",")}))
  ) from public.parcels;`)) as InventoryState;
}

function installFictionalParcels() {
  const values = [
    [parcelIds[0], -86.861, 35.260, -86.859, 35.262],
    [parcelIds[1], -86.851, 35.270, -86.849, 35.272],
    [parcelIds[2], -86.841, 35.280, -86.839, 35.282],
  ];
  sql(`with revision as (select coalesce(max(imported_at),now()) imported_at from public.parcels)
    insert into public.parcels(county_fips,gislink,situs_address,property_class,land_use,is_residential,geometry,imported_at)
    select '47055',fixture.gislink,'Fictional connected browser parcel','Fictional test parcel','Test fixture',true,
      extensions.st_multi(extensions.st_makeenvelope(fixture.min_x,fixture.min_y,fixture.max_x,fixture.max_y,4326)),revision.imported_at
    from (values ${values.map(([id, ...coordinates]) => `(${safeLiteral(String(id))},${coordinates.join(",")})`).join(",")})
      fixture(gislink,min_x,min_y,max_x,max_y) cross join revision;`);
}

function cleanupFictionalRecords() {
  sql(`begin;
    create temp table fixture_events on commit drop as
      select church_id,id from public.outreach_outings where name=${safeLiteral(walkName)};
    create temp table fixture_zones on commit drop as
      select church_id,id from public.outreach_territories where name=${safeLiteral(zoneName)};
    create temp table fixture_targets on commit drop as
      select target.church_id,target.id from public.outreach_walk_targets target
      join fixture_events event on event.church_id=target.church_id and event.id=target.outing_id;
    create temp table fixture_assignments on commit drop as
      select assignment.church_id,assignment.id from public.outreach_assignments assignment
      join fixture_events event on event.church_id=assignment.church_id and event.id=assignment.outing_id;
    create temp table fixture_commands on commit drop as
      select distinct audit.church_id,audit.actor_id,audit.command_id from public.outreach_audit audit
      where exists(select 1 from fixture_events item where item.church_id=audit.church_id and item.id=audit.entity_id)
        or exists(select 1 from fixture_zones item where item.church_id=audit.church_id and item.id=audit.entity_id)
        or exists(select 1 from fixture_targets item where item.church_id=audit.church_id and item.id=audit.entity_id)
        or exists(select 1 from fixture_assignments item where item.church_id=audit.church_id and item.id=audit.entity_id);
    delete from public.outreach_assignments assignment using fixture_assignments fixture
      where assignment.church_id=fixture.church_id and assignment.id=fixture.id;
    delete from public.outreach_walk_target_parcels parcel using fixture_targets fixture
      where parcel.church_id=fixture.church_id and parcel.target_id=fixture.id;
    delete from public.outreach_walk_targets target using fixture_targets fixture
      where target.church_id=fixture.church_id and target.id=fixture.id;
    delete from public.outreach_outings event using fixture_events fixture
      where event.church_id=fixture.church_id and event.id=fixture.id;
    delete from public.outreach_territories zone using fixture_zones fixture
      where zone.church_id=fixture.church_id and zone.id=fixture.id;
    delete from public.outreach_audit audit using fixture_commands fixture
      where audit.church_id=fixture.church_id and audit.actor_id=fixture.actor_id and audit.command_id=fixture.command_id;
    delete from private.outreach_receipts receipt using fixture_commands fixture
      where receipt.church_id=fixture.church_id and receipt.actor_id=fixture.actor_id and receipt.command_id=fixture.command_id;
    delete from public.parcels where county_fips='47055' and gislink in (${parcelIds.map(safeLiteral).join(",")});
    commit;`);
}

async function isolate(context: BrowserContext) {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if ([origin, "http://127.0.0.1:54321"].includes(url.origin)) return route.continue();
    if (url.protocol === "https:" && (/\/styles?\//.test(url.pathname) || url.pathname.endsWith("/style.json"))) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ version: 8, sources: {}, layers: [] }) });
    }
    return route.abort();
  });
}

async function signIn(page: Page) {
  await page.goto(origin + "/login");
  await page.getByRole("textbox", { name: "Email address" }).fill("leader@neighborwalk.test");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("NeighborWalk-test-123!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Hello,/ })).toBeVisible({ timeout: 60_000 });
}

async function queued(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("neighborwalk:sandbox:http://127.0.0.1:54321", 1);
    const indexedDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const store = indexedDatabase.transaction("app_state").objectStore("app_state");
      const keysRequest = store.getAllKeys();
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        keysRequest.onsuccess = () => resolve(keysRequest.result);
        keysRequest.onerror = () => reject(keysRequest.error);
      });
      const key = keys.find((candidate) => typeof candidate === "string" && candidate.startsWith('["account",'));
      if (!key) return -1;
      const dataRequest = indexedDatabase.transaction("app_state").objectStore("app_state").get(key);
      return await new Promise<number>((resolve, reject) => {
        dataRequest.onsuccess = () => resolve(dataRequest.result?.sync?.commands?.length ?? -1);
        dataRequest.onerror = () => reject(dataRequest.error);
      });
    } finally {
      indexedDatabase.close();
    }
  });
}

function mercatorPoint(coordinates: readonly [number, number], width: number, height: number) {
  const project = ([longitude, latitude]: readonly [number, number]) => {
    const worldSize = 512 * 2 ** overview.zoom;
    const sine = Math.sin(latitude * Math.PI / 180);
    return {
      x: (longitude + 180) / 360 * worldSize,
      y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * worldSize,
    };
  };
  const center = project(overview.center);
  const point = project(coordinates);
  return { x: point.x - center.x + width / 2, y: point.y - center.y + height / 2 };
}

function savedState(): SavedState {
  return JSON.parse(sql(`with event as (
      select church_id,id,status from public.outreach_outings where name=${safeLiteral(walkName)}
    ), zone as (
      select territory.* from public.outreach_territories territory
      join event on event.church_id=territory.church_id where territory.name=${safeLiteral(zoneName)}
    ), target as (
      select item.* from public.outreach_walk_targets item join event on event.church_id=item.church_id and event.id=item.outing_id
    ), assignment as (
      select item.* from public.outreach_assignments item join event on event.church_id=item.church_id and event.id=item.outing_id
    ) select jsonb_build_object(
      'eventCount',(select count(*) from event),'eventId',coalesce((select min(id) from event),''),'eventStatus',coalesce((select min(status) from event),''),
      'territoryCount',(select count(*) from zone),'territoryId',coalesce((select min(id) from zone),''),
      'boundaryCount',coalesce((select jsonb_array_length(boundary) from zone limit 1),0),
      'boundaryOpen',coalesce((select boundary->0 is distinct from boundary->-1 from zone limit 1),false),
      'targetCount',(select count(*) from target),'targetId',coalesce((select min(id) from target),''),
      'targetStatus',coalesce((select min(roster_state) from target),''),'targetFrozen',coalesce((select bool_and(frozen_at is not null) from target),false),
      'selectionKind',coalesce((select min(selection_kind) from target),''),
      'targetMatchesParent',coalesce((select extensions.st_equals(target.geometry,private.outreach_boundary_polygon(zone.boundary)) from target join zone using(church_id) limit 1),false),
      'targetParcelIds',coalesce((select jsonb_agg(parcel.gislink order by parcel.gislink) from public.outreach_walk_target_parcels parcel join target on target.church_id=parcel.church_id and target.id=parcel.target_id),'[]'::jsonb),
      'assignmentCount',(select count(*) from assignment),'assignmentId',coalesce((select min(id) from assignment),''),
      'assignmentStatus',coalesce((select min(status) from assignment),''),'assigneeId',(select min(assignee_id::text) from assignment),'teamId',(select min(team_id) from assignment)
    );`)) as SavedState;
}

test("a connected leader draws a Giles parent and saves one whole-zone target ready", async ({ context, page }) => {
  const baseline = inventoryState();
  expect(baseline.fixtureCount).toBe(0);
  installFictionalParcels();
  expect(inventoryState()).toEqual({ count: baseline.count + parcelIds.length, revision: baseline.revision, fixtureCount: parcelIds.length });

  try {
    await isolate(context);
    await signIn(page);
    await page.goto(origin + "/app/outreach?plan=1");
    const dialog = page.getByRole("dialog", { name: "Plan a walk" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "Walk name", exact: true }).fill(walkName);
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();

    await dialog.getByRole("combobox", { name: "Persistent parent zone", exact: true }).selectOption("");
    await dialog.getByRole("button", { name: "Draw and name a new zone", exact: true }).click();
    const creator = dialog.locator(".walk-parent-zone-creator");
    await creator.getByRole("textbox", { name: "Zone name", exact: true }).fill(zoneName);
    const map = creator.getByRole("region", { name: /Interactive map of/ });
    await expect(map).toBeVisible();
    await expect(creator.locator(".map-state")).toHaveCount(0);
    const bounds = await map.boundingBox();
    expect(bounds).not.toBeNull();
    const start = mercatorPoint(gilesBoundary[0], bounds!.width, bounds!.height);
    const opposite = mercatorPoint(gilesBoundary[2], bounds!.width, bounds!.height);
    for (const point of [start, opposite]) {
      expect(point.x).toBeGreaterThan(0); expect(point.x).toBeLessThan(bounds!.width);
      expect(point.y).toBeGreaterThan(0); expect(point.y).toBeLessThan(bounds!.height);
    }
    await page.mouse.move(bounds!.x + start.x, bounds!.y + start.y);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + opposite.x, bounds!.y + opposite.y, { steps: 8 });
    await page.mouse.up();
    await expect(creator.getByText("Rectangle ready", { exact: true })).toBeVisible();

    const parcelRpcPromise = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/rpc/planning_parcels_for_boundary_v1"));
    const streetRpcPromise = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/rpc/street_segments_for_boundary_v1"));
    await creator.getByRole("button", { name: "Create and use this zone", exact: true }).click();
    const [parcelRpc, streetRpc] = await Promise.all([parcelRpcPromise, streetRpcPromise]);
    expect(parcelRpc.status()).toBe(200); expect(streetRpc.status()).toBe(200);
    const planning = await parcelRpc.json() as PlanningResponse;
    const streets = await streetRpc.json() as StreetResponse;
    expect(planning).toMatchObject({ complete: true, truncated: false, datasetRevision: baseline.revision });
    expect(planning.features.map((feature) => feature.gislink).sort()).toEqual([...parcelIds].sort());
    expect(streets.complete).toBe(true); expect(streets.truncated).toBe(false); expect(streets.features.length).toBeGreaterThan(0);

    const planner = dialog.getByRole("region", { name: `Plan targets inside ${zoneName}`, exact: true });
    const wholeZone = planner.getByRole("button", { name: "Whole zone", exact: true });
    await expect(wholeZone).toBeEnabled();
    await wholeZone.click();
    await expect(planner.locator(".walk-target-list li")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();

    const owner = dialog.getByRole("combobox", { name: `Owner for ${zoneName}`, exact: true });
    const individual = await owner.locator('option[value^="volunteer:"]').first().getAttribute("value");
    expect(individual).toBeTruthy();
    await owner.selectOption(individual!);
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Purpose", exact: true }).fill("Fictional connected map-first verification.");
    await dialog.getByRole("textbox", { name: "Meeting point", exact: true }).fill("Fictional Giles meeting point");
    await dialog.getByRole("textbox", { name: "Leader contact", exact: true }).fill("Test Leader");
    await dialog.getByRole("button", { name: "Save & mark ready", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => queued(page), { timeout: 60_000 }).toBe(0);

    const saved = savedState();
    expect(saved).toMatchObject({
      eventCount: 1, eventStatus: "ready", territoryCount: 1, boundaryCount: 4, boundaryOpen: true,
      targetCount: 1, targetStatus: "frozen", targetFrozen: true, selectionKind: "whole_zone", targetMatchesParent: true,
      assignmentCount: 1, assignmentStatus: "assigned", teamId: null,
    });
    expect(saved.eventId).toMatch(/^outing_/); expect(saved.territoryId).toMatch(/^territory_/);
    expect(saved.targetId).toMatch(/^target_/); expect(saved.assignmentId).toMatch(/^assignment_/);
    expect(saved.assigneeId).toBeTruthy();
    expect(saved.targetParcelIds).toEqual([...parcelIds].sort());
  } finally {
    await page.close().catch(() => undefined);
    cleanupFictionalRecords();
    expect(inventoryState()).toEqual(baseline);
  }
});
