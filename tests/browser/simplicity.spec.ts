import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { DEMO_CENTER } from "../../lib/seed";

/** The map lives under Walks: open the Walks tab, then its Map view. */
async function openMap(page: Page) {
  await page.getByRole("navigation").getByRole("button", { name: /^Walks/ }).click();
  await page.getByRole("group", { name: "Walks view" }).getByRole("button", { name: "Map", exact: true }).click();
}

// The phone tab bar has four destinations; wider screens add More to the sidebar
// (on phones it sits behind the avatar).
const phoneDestinations = ["Today", "Walks", "Follow-ups", "People"] as const;
const sidebarDestinations = [...phoneDestinations, "More"] as const;

async function openDemo(page: Page) {
  const center = DEMO_CENTER;
  const parcels = Array.from({ length: 6 }, (_, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const left = center[0] - 0.0022 + column * 0.0015;
    const bottom = center[1] - 0.00135 + row * 0.0015;
    return { county_fips: "47099", gislink: `playwright-test-parcel-${index + 1}`,
      representative_point: [left + 0.00055, bottom + 0.0005], geometry: { type: "Polygon", coordinates: [[
        [left, bottom], [left + 0.0011, bottom], [left + 0.0011, bottom + 0.001],
        [left, bottom + 0.001], [left, bottom],
      ]] } };
  });
  await page.route("**/rest/v1/rpc/public_map_parcels_for_boundary_v1", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ datasetRevision: "playwright-test-parcels-v1", complete: true, truncated: false, features: parcels }),
  }));
  await page.route("**/rest/v1/rpc/public_map_streets_for_boundary_v1", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ release: "playwright-test-streets-v1", source: "Playwright test GIS fixture", complete: true, truncated: false, features: [
      { id: "playwright-test-main-west", name: "Test Main Street", road_class: "residential", subclass: null,
        geometry: { type: "LineString", coordinates: [[center[0] - 0.0025, center[1]], [center[0], center[1]]] } },
      { id: "playwright-test-main-east", name: "Test Main Street", road_class: "residential", subclass: null,
        geometry: { type: "LineString", coordinates: [[center[0], center[1]], [center[0] + 0.0025, center[1]]] } },
      { id: "playwright-test-cross", name: "Test Church Avenue", road_class: "residential", subclass: null,
        geometry: { type: "LineString", coordinates: [[center[0], center[1] - 0.0018], [center[0], center[1] + 0.0018]] } },
    ] }),
  }));
  await page.route(/https:\/\/api\.maptiler\.com\/maps\/streets-v4\/style\.json.*/, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
  }));
  await page.goto("/demo");
  await expect(page.getByText(/Practice with a sample church/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
}

async function exerciseNavigation(page: Page, navigation: Locator, destinations: readonly string[]) {
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("button")).toHaveCount(destinations.length);

  for (const destination of destinations) {
    // Destinations may carry an attention count in their accessible name.
    const button = navigation.getByRole("button", { name: new RegExp(`^${destination}`) });
    await button.click();
    await expect(button).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: destination, exact: true })).toBeVisible();
  }
}

async function demoSnapshot(page: Page, filters: { walkName?: string; targetName?: string; address?: string }) {
  return page.evaluate(async ({ requestedWalk, requestedTarget, requestedAddress }) => {
    type DemoData = {
      events?: Array<{ id: string; name: string }>;
      walkTargets?: Array<{
        id: string;
        eventId: string;
        territoryId: string;
        name: string;
        selectionKind: string;
        parcels: Array<{ countyFips: string; gislink: string }>;
        rosterState: string;
        frozenAt?: string;
      }>;
      properties?: Array<{ id: string; address: string }>;
      assignments?: Array<{
        id: string;
        eventId: string;
        territoryId: string;
        targetId?: string;
        assignedVolunteerId?: string;
        assignedTeamId?: string;
        status: string;
      }>;
      teams?: Array<{ id: string; eventId?: string; memberIds: string[] }>;
      outingParticipants?: Array<{ id: string; eventId: string; volunteerId: string; status: string }>;
      visits?: Array<{
        id: string;
        propertyId?: string;
        outcome: string;
        residentId?: string;
        objectiveNote?: string;
      }>;
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
        const storedRequest = database.transaction("app_state", "readonly").objectStore("app_state").get("demo");
        const data = await new Promise<DemoData | undefined>((resolve, reject) => {
          storedRequest.onsuccess = () => resolve(storedRequest.result as DemoData | undefined);
          storedRequest.onerror = () => reject(storedRequest.error);
        });
        if (!data) continue;

        const eventIds = requestedWalk
          ? (data.events ?? []).filter(({ name }) => name === requestedWalk).map(({ id }) => id).sort()
          : [];
        const selectedTargets = requestedTarget
          ? (data.walkTargets ?? []).filter(({ name, eventId }) => name === requestedTarget && eventIds.includes(eventId))
          : [];
        const targetIds = selectedTargets.map(({ id }) => id).sort();
        const territoryIds = [...new Set(selectedTargets.map(({ territoryId }) => territoryId))].sort();
        const walkTargets = selectedTargets.map(({ id, eventId, territoryId, name, selectionKind, parcels, rosterState, frozenAt }) => ({
          id,
          eventId,
          territoryId,
          name,
          selectionKind,
          parcelKeys: parcels.map(({ countyFips, gislink }) => `${countyFips}:${gislink}`).sort(),
          rosterState,
          frozenAt: frozenAt ?? null,
        })).sort((left, right) => left.id.localeCompare(right.id));
        const propertyIds = requestedAddress
          ? (data.properties ?? []).filter(({ address }) => address === requestedAddress).map(({ id }) => id).sort()
          : [];
        const assignments = (data.assignments ?? [])
          .filter(({ eventId, territoryId, targetId }) => eventIds.includes(eventId)
            && territoryIds.includes(territoryId)
            && (!targetIds.length || targetIds.includes(targetId ?? "")))
          .map(({ id, eventId, territoryId, targetId, assignedVolunteerId, assignedTeamId, status }) => ({
            id,
            eventId,
            territoryId,
            targetId: targetId ?? null,
            assignedVolunteerId: assignedVolunteerId ?? null,
            assignedTeamId: assignedTeamId ?? null,
            status,
          }))
          .sort((left, right) => left.id.localeCompare(right.id));
        const assignedTeamIds = new Set(assignments.map(({ assignedTeamId }) => assignedTeamId).filter(Boolean));
        const crews = (data.teams ?? []).filter(({ id }) => assignedTeamIds.has(id)).map(({ id, eventId, memberIds }) => ({
          id,
          eventId: eventId ?? null,
          memberIds: [...memberIds].sort(),
        })).sort((left, right) => left.id.localeCompare(right.id));
        const participants = (data.outingParticipants ?? []).filter(({ eventId }) => eventIds.includes(eventId))
          .map(({ id, eventId, volunteerId, status }) => ({ id, eventId, volunteerId, status }))
          .sort((left, right) => left.volunteerId.localeCompare(right.volunteerId));
        const visits = (data.visits ?? [])
          .filter(({ propertyId }) => Boolean(propertyId && propertyIds.includes(propertyId)))
          .map(({ id, propertyId, outcome, residentId, objectiveNote }) => ({
            id,
            propertyId: propertyId!,
            outcome,
            residentId: residentId ?? null,
            objectiveNote: objectiveNote ?? null,
          }))
          .sort((left, right) => left.id.localeCompare(right.id));

        return { eventIds, targetIds, territoryIds, walkTargets, propertyIds, assignments, crews, participants, visits };
      } finally {
        database.close();
      }
    }

    throw new Error("The fictional demo workspace was not found in IndexedDB.");
  }, {
    requestedWalk: filters.walkName,
    requestedTarget: filters.targetName,
    requestedAddress: filters.address,
  });
}

test("the primary destinations work on desktop and mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openDemo(page);
  await exerciseNavigation(page, page.getByRole("navigation", { name: "Main sections" }), sidebarDestinations);

  await page.setViewportSize({ width: 390, height: 844 });
  await exerciseNavigation(page, page.getByRole("navigation", { name: "Main navigation" }), phoneDestinations);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("Follow-ups and People are separate destinations and task links stay in Follow-ups", async ({ page }) => {
  await openDemo(page);
  const navigation = page.getByRole("navigation", { name: "Main sections" });
  const followUps = navigation.getByRole("button", { name: /^Follow-ups/ });
  await followUps.click();
  await expect(page.getByRole("heading", { name: "Follow-ups", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Everyone", exact: true })).toHaveCount(0);
  const lists = page.getByRole("group", { name: "Whose follow-ups" });
  await expect(lists.getByRole("button", { name: /^Mine/ })).toHaveAttribute("aria-pressed", "true");

  // A follow-up opens its own page and Back returns to the list, both in Follow-ups.
  await page.locator(".fu-row-open").first().click();
  await expect(page.getByRole("button", { name: "Log check-in", exact: true })).toBeVisible();
  await expect(followUps).toHaveAttribute("aria-current", "page");
  await page.locator(".fu-back").click();
  await expect(lists).toBeVisible();
  await expect(followUps).toHaveAttribute("aria-current", "page");

  await navigation.getByRole("button", { name: /^People/ }).click();
  await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
  const allPeople = page.getByRole("tab", { name: "Everyone", exact: true });
  const conversations = page.getByRole("tab", { name: "Conversations", exact: true });
  await expect(allPeople).toHaveAttribute("aria-selected", "true");
  await allPeople.focus();
  await allPeople.press("ArrowRight");
  await expect(conversations).toBeFocused();
  await expect(conversations).toHaveAttribute("aria-selected", "true");
  await conversations.press("ArrowLeft");
  await expect(allPeople).toBeFocused();
  await expect(allPeople).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("searchbox", { name: "Search people", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add person", exact: true })).toBeVisible();

  await page.getByRole("button", { name: /^Elena/ }).click();
  const profileTabs = page.getByRole("tablist", { name: "Profile sections" });
  const profileFollowUps = profileTabs.getByRole("tab", { name: /Follow-ups/ });
  const profileActivity = profileTabs.getByRole("tab", { name: /Activity/ });
  const profileDetails = profileTabs.getByRole("tab", { name: "Details", exact: true });
  await expect(profileFollowUps).toHaveAttribute("aria-selected", "true");
  await profileFollowUps.focus();
  await profileFollowUps.press("ArrowRight");
  await expect(profileActivity).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Care note" })).toBeVisible();
  await profileActivity.press("ArrowRight");
  await expect(profileDetails).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Status" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".person-profile").getByRole("button", { name: /^People/ })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search people", exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("map-first walk setup resumes assigned drafts and keeps leader responses out of Home", async ({ page }) => {
  const suffix = randomUUID().slice(0, 8);
  const walkName = `Fictional simplicity walk ${suffix}`;
  const parentName = "Crockett Heights";

  await openDemo(page);
  await openMap(page);
  await expect(page.getByRole("combobox", { name: "Search any address", exact: true })).toBeVisible();
  await page.getByRole("group", { name: "Walks view" }).getByRole("button", { name: "Walks", exact: true }).click();
  await page.getByRole("button", { name: "Plan a walk", exact: true }).click();
  await page.getByRole("dialog", { name: "Plan a walk" }).getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("button", { name: "Today", exact: true }).click();
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("button", { name: /^Walks/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Plan a walk", exact: true }).click();

  let dialog = page.getByRole("dialog", { name: "Plan a walk" });
  const progress = dialog.getByRole("list", { name: "Walk setup progress" });
  await expect(progress.getByRole("listitem")).toHaveText(["Where", "When", "Who"]);

  // Where first: pick the neighborhood, then its routes.
  await expect(dialog.getByRole("heading", { name: "Where are you walking?", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
  await dialog.getByRole("radiogroup", { name: "Neighborhood" }).getByRole("radio", { name: new RegExp(`^${parentName}`) }).click();
  const planner = dialog.getByRole("region", { name: `Routes in ${parentName}`, exact: true });
  await expect(planner.getByRole("button", { name: "Streets", exact: true })).toBeEnabled();
  await planner.getByRole("button", { name: "Whole zone", exact: true }).click();
  await expect(planner.locator(".walk-target-list li").filter({ hasText: parentName })).toContainText("Whole zone");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(dialog.getByRole("heading", { name: "When?", exact: true })).toBeVisible();
  await dialog.getByRole("group", { name: "Start" }).getByRole("button", { name: "9:30 AM", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(dialog.getByRole("heading", { name: "Who’s coming?", exact: true })).toBeVisible();
  // The summary card holds the name; it defaults from the place and day.
  const walkNameField = dialog.getByRole("textbox", { name: "Walk name", exact: true });
  await expect(walkNameField).toHaveValue(new RegExp(`^${parentName} · `));
  await walkNameField.fill("");
  await dialog.getByRole("button", { name: "Invite everyone", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Send invites", exact: true })).toBeDisabled();
  await walkNameField.fill(walkName);
  await expect(dialog.getByText("7 invited", { exact: true })).toBeVisible();
  const summary = dialog.locator(".walk-summary");
  await expect(summary).toContainText(walkName);
  await expect(summary).toContainText(parentName);
  await expect(summary).toContainText(/1 route · \d+ homes · 7 invited/);
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: walkName, exact: true })).toBeVisible();

  const draftSnapshot = await demoSnapshot(page, { walkName, targetName: parentName });
  expect(draftSnapshot.eventIds).toHaveLength(1);
  expect(draftSnapshot.targetIds).toHaveLength(1);
  expect(draftSnapshot.territoryIds).toHaveLength(1);
  expect(draftSnapshot.walkTargets).toHaveLength(1);
  expect(draftSnapshot.walkTargets[0]).toMatchObject({
    eventId: draftSnapshot.eventIds[0],
    territoryId: draftSnapshot.territoryIds[0],
    name: parentName,
    selectionKind: "whole_zone",
    rosterState: "draft",
    frozenAt: null,
  });
  expect(draftSnapshot.walkTargets[0].parcelKeys.length).toBeGreaterThan(0);
  expect(draftSnapshot.assignments).toHaveLength(0);
  expect(draftSnapshot.crews).toHaveLength(0);
  expect(draftSnapshot.participants).toHaveLength(7);
  expect(draftSnapshot.participants.every(({ status }) => status === "invited")).toBe(true);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("button", { name: /^Walks/ }).click();
  const walkCard = page.locator(".outing-card").filter({ hasText: walkName });
  await expect(walkCard).toHaveCount(1);
  await expect(walkCard).not.toContainText("Prepare the purpose and plan together.");
  await walkCard.click();
  await page.getByRole("button", { name: "Resume setup", exact: true }).click();

  dialog = page.getByRole("dialog", { name: "Resume walk setup" });
  await expect(dialog.getByText("Routes are set", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("radiogroup", { name: "Neighborhood" }).getByRole("radio", { checked: true })).toHaveAttribute("data-territory-id", draftSnapshot.territoryIds[0]);
  const resumedPlanner = dialog.getByRole("region", { name: `Routes in ${parentName}`, exact: true });
  await expect(resumedPlanner.locator(".walk-target-list li")).toHaveCount(1);
  await expect(resumedPlanner.getByRole("button", { name: `Remove ${parentName}`, exact: true })).toBeDisabled();
  await expect(resumedPlanner.getByText(/Saved routes can’t be removed here\..*walk page/)).toBeVisible();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Who’s coming?", exact: true })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Walk name", exact: true })).toHaveValue(walkName);
  await dialog.getByRole("button", { name: "Remove Maya", exact: true }).click();
  await dialog.getByRole("button", { name: "Invite Maya", exact: true }).click();
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(dialog).toBeHidden();

  const retriedDraft = await demoSnapshot(page, { walkName, targetName: parentName });
  expect(retriedDraft).toEqual(draftSnapshot);
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Walk invitations", exact: true })).toHaveCount(0);
  await expect(page.getByRole("group", { name: `Your response for ${parentName} on ${walkName}`, exact: true })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("button", { name: /^Walks/ }).click();
  await page.locator(".outing-card").filter({ hasText: walkName }).click();
  const assignmentCard = page.locator(".assignment-list li").filter({ hasText: parentName });
  await expect(assignmentCard).toContainText("No team yet");
  await expect(assignmentCard.getByRole("button", { name: "Going", exact: true })).toHaveCount(0);
  await expect(assignmentCard.getByRole("button", { name: "Can’t go", exact: true })).toHaveCount(0);
  await expect(assignmentCard.getByRole("button", { name: "Finished for tonight", exact: true })).toHaveCount(0);
  const finalDraftSnapshot = await demoSnapshot(page, { walkName, targetName: parentName });
  expect(finalDraftSnapshot).toEqual(draftSnapshot);

  await page.getByRole("button", { name: "Edit teams", exact: true }).click();
  let crewDialog = page.getByRole("dialog", { name: "Teams", exact: true });
  await crewDialog.getByRole("button", { name: "Everyone is here", exact: true }).click();
  const firstCrewTarget = crewDialog.locator(".walk-crew-target").filter({ hasText: parentName });
  await firstCrewTarget.locator("summary").click();
  await firstCrewTarget.getByRole("button", { name: "Assign everyone waiting", exact: true }).click();
  await crewDialog.getByRole("button", { name: "Save teams", exact: true }).click();
  await expect(crewDialog).toBeHidden();
  await expect(assignmentCard).toContainText("Erica, Maya, Jordan, Sam, Noah, Ruth, Eli");

  await page.getByRole("button", { name: "Edit teams", exact: true }).click();
  crewDialog = page.getByRole("dialog", { name: "Teams", exact: true });
  await crewDialog.getByRole("group", { name: "People here tonight", exact: true }).getByRole("button", { name: "Jordan", exact: true }).click();
  await crewDialog.getByRole("button", { name: "Save teams", exact: true }).click();
  await expect(assignmentCard).not.toContainText("Jordan");

  await page.getByRole("button", { name: "Edit teams", exact: true }).click();
  crewDialog = page.getByRole("dialog", { name: "Teams", exact: true });
  await crewDialog.getByRole("group", { name: "People here tonight", exact: true }).getByRole("button", { name: "Jordan", exact: true }).click();
  const liveCrewTarget = crewDialog.locator(".walk-crew-target").filter({ hasText: parentName });
  await liveCrewTarget.locator("summary").click();
  await liveCrewTarget.getByRole("group", { name: `Team for ${parentName}`, exact: true }).getByRole("button", { name: /Jordan/ }).click();
  await crewDialog.getByRole("button", { name: "Save teams", exact: true }).click();
  await expect(assignmentCard).toContainText("Jordan");
  const staffedSnapshot = await demoSnapshot(page, { walkName, targetName: parentName });
  expect(staffedSnapshot.assignments).toHaveLength(1);
  expect(staffedSnapshot.crews[0].memberIds).toHaveLength(7);
  expect(staffedSnapshot.participants.every(({ status }) => status === "checked_in")).toBe(true);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("button", { name: /^Walks/ }).click();
  await page.locator(".outing-card").filter({ hasText: walkName }).click();
  await page.getByRole("button", { name: "Resume setup", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Resume walk setup" });
  await expect(dialog.getByText("Routes are set", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("radiogroup", { name: "Neighborhood" }).getByRole("radio", { checked: true })).toHaveAttribute("data-territory-id", draftSnapshot.territoryIds[0]);
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  expect(await demoSnapshot(page, { walkName, targetName: parentName })).toEqual(staffedSnapshot);
});

test("recording no answer never asks for a person", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("button", { name: /^Walks/ }).click();
  await page.getByRole("group", { name: "Walks view" }).getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("button", { name: /^118 Crockett Street/ }).click();

  const before = await demoSnapshot(page, { address: "118 Crockett Street" });
  expect(before.propertyIds).toHaveLength(1);
  const drawer = page.getByRole("dialog", { name: "Home details for 118 Crockett Street" });
  await drawer.getByRole("button", { name: "Add a person or note", exact: true }).click();
  await expect(drawer.getByRole("combobox", { name: /^Person/ })).toBeVisible();
  await drawer.locator(".outcome-options").getByRole("button", { name: "No answer", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByText("No answer saved", { exact: true })).toBeVisible();

  const after = await demoSnapshot(page, { address: "118 Crockett Street" });
  const beforeIds = new Set(before.visits.map(({ id }) => id));
  const savedVisits = after.visits.filter(({ id }) => !beforeIds.has(id));
  expect(savedVisits).toHaveLength(1);
  expect(savedVisits[0]).toMatchObject({
    propertyId: before.propertyIds[0],
    outcome: "no_answer",
    residentId: null,
    objectiveNote: null,
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  const reloaded = await demoSnapshot(page, { address: "118 Crockett Street" });
  expect(reloaded.visits.find(({ id }) => id === savedVisits[0].id)).toEqual(savedVisits[0]);
});

test("a person’s follow-up can be completed in their profile", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("button", { name: /^People/ }).click();
  await page.getByRole("button", { name: /Tasha.*215 Gaines Street/ }).click();
  const followUps = page.getByRole("region", { name: "Tasha", exact: true });
  await followUps.locator(".followup-actions-outcome").getByRole("button", { name: "Mark done", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark done", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Tasha", exact: true })).toBeVisible();
  await expect(followUps.locator(".followup-actions-outcome").getByRole("button", { name: "Mark done", exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole("navigation", { name: "Main sections" }).getByRole("button", { name: /^Follow-ups/ }).click();
  await expect(page.getByRole("button", { name: /^Tasha\./ })).toHaveCount(0);
});

test("an advance invitation becomes field access only after check-in and crew assignment", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const walkName = `Fictional advance invitation ${randomUUID().slice(0, 8)}`;
  const parentName = "Crockett Heights";

  await openDemo(page);
  await page.getByRole("navigation").getByRole("button", { name: /^Walks/ }).click();
  await page.getByRole("button", { name: "Plan a walk", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Plan a walk", exact: true });
  await dialog.getByRole("radiogroup", { name: "Neighborhood" }).getByRole("radio", { name: new RegExp(`^${parentName}`) }).click();
  await dialog.getByRole("region", { name: `Routes in ${parentName}`, exact: true })
    .getByRole("button", { name: "Whole zone", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Meeting point", exact: true }).fill("Church welcome table");
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Walk name", exact: true }).fill(walkName);
  await dialog.getByRole("button", { name: "Invite Maya", exact: true }).click();
  await dialog.locator(".walk-extra-preparation > summary").filter({ hasText: "Details for volunteers" }).click();
  await dialog.getByRole("textbox", { name: "Purpose", exact: true }).fill("Prepare a respectful neighborhood visit.");
  await dialog.getByRole("textbox", { name: "Leader contact", exact: true }).fill("Erica");
  await dialog.getByRole("button", { name: "Send invites", exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Open your profile, settings and more", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: /^Preview identity/ }).selectOption({ label: "Maya · volunteer" });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Today", exact: true }).click();
  const walks = page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /^Walks/ });
  const response = page.getByRole("group", { name: `Your invitation for ${walkName}`, exact: true });
  await response.getByRole("button", { name: "Going", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Walk invitations", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Review \d+ saved walk responses?/ })).toBeVisible();
  await walks.click();
  await page.locator(".outing-card").filter({ hasText: walkName }).click();
  const openWalk = page.getByRole("button", { name: "Open walk", exact: true });
  await expect(openWalk).toBeDisabled();

  await page.getByRole("button", { name: "Open your profile, settings and more", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: /^Preview identity/ }).selectOption({ label: "Erica · leader" });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /^Walks/ }).click();
  await page.locator(".outing-card").filter({ hasText: walkName }).click();
  await page.getByRole("button", { name: "Edit teams", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Teams", exact: true });
  await dialog.getByRole("group", { name: "People here tonight", exact: true })
    .getByRole("button", { name: "Maya", exact: true }).click();
  const target = dialog.locator(".walk-crew-target").filter({ hasText: parentName });
  await target.locator("summary").click();
  await target.getByRole("group", { name: `Team for ${parentName}`, exact: true })
    .getByRole("button", { name: /Maya/ }).click();
  await dialog.getByRole("button", { name: "Save teams", exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Open your profile, settings and more", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("combobox", { name: /^Preview identity/ }).selectOption({ label: "Maya · volunteer" });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /^Walks/ }).click();
  await page.locator(".outing-card").filter({ hasText: walkName }).click();
  await expect(openWalk).toBeEnabled();
  await openWalk.click();
  await page.getByRole("button", { name: "Show list", exact: true }).click();
  const addressList = page.getByRole("region", { name: "Outreach address list", exact: true });
  await expect(addressList.getByRole("combobox", { name: "Neighborhood", exact: true })).toHaveCount(0);
  await expect(addressList.getByRole("button", { name: /Address unavailable Crockett Heights Not knocked yet/ })).toHaveCount(6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
