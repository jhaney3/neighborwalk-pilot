import { expect, test, type Locator, type Page } from "@playwright/test";

/** The map lives under Walks: open the Walks tab, then its Map view. */
async function openMap(page: Page) {
  await page.getByRole("navigation").getByRole("button", { name: /^Walks/ }).click();
  await page.getByRole("group", { name: "Walks view" }).getByRole("button", { name: "Map", exact: true }).click();
}

async function dragAcrossMap(page: Page, map: Locator) {
  const bounds = await map.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width * .2, bounds!.y + bounds!.height * .3);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * .72, bounds!.y + bounds!.height * .58, { steps: 8 });
  await page.mouse.up();
}

test("all primary tabs work and marketing content is excluded", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Erica$/ })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Walks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Walks", exact: true })).toBeVisible();
  await nav.getByRole("button", { name: /^People/ }).click();
  await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Install app", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Return to website" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Church name", exact: true }).fill("Sample iPhone Church");
  await page.getByRole("button", { name: "Save church profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Church profile saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Open NeighborWalk Home" })).toContainText("Sample iPhone Church");
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Apple", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  await expect(page.locator(".site-shell, .site-header, .site-hero")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("appearance can be set to dark in iOS settings and persists on this device", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/demo");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  const appearance = page.getByRole("combobox", { name: "Color appearance" });
  await expect(appearance).toHaveValue("system");
  await appearance.selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(18, 23, 20)");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#121714");

  await page.reload();
  await nav.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Color appearance" })).toHaveValue("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("Done releases focus from single-line inputs", async ({ page }) => {
  await page.goto("/demo");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();

  const churchName = page.getByRole("textbox", { name: "Church name", exact: true });
  await churchName.focus();
  await expect(churchName).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(churchName).not.toBeFocused();

  await nav.getByRole("button", { name: "Home", exact: true }).click();
  await openMap(page);
  const search = page.getByRole("combobox", { name: "Search any address", exact: true });
  await search.fill("708 Shelby Ave");
  await page.keyboard.press("Enter");
  await expect(search).not.toBeFocused();
});

test("keyboard focus remains visible in the native shell", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/demo");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Home", exact: true }).focus();
  await page.keyboard.press("Tab");
  const walks = nav.getByRole("button", { name: "Walks", exact: true });
  await expect(walks).toBeFocused();
  expect(await walks.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
});

test.describe("touch focus treatment", () => {
  test.use({ hasTouch: true });

  test("touch-opened sheets and controls avoid focus rings until keyboard navigation", async ({ page }) => {
    await page.goto("/demo");
    await page.getByRole("button", { name: "Log a conversation", exact: true }).tap();
    const close = page.getByRole("button", { name: "Close dialog" });
    await expect(close).toBeFocused();
    await expect(close).toHaveCSS("outline-style", "none");

    const details = page.getByRole("button", { name: /optional details|Add a person or note/ });
    await details.tap();
    await expect(details).toHaveCSS("outline-style", "none");

    await page.getByRole("textbox", { name: "Brief factual note (optional)" }).tap();
    await page.keyboard.type("A brief note");
    await close.focus();
    await expect(close).toHaveCSS("outline-style", "none");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(close).toBeFocused();
    expect(await close.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
  });
});

test("map filters and visit outcomes expose their selected state", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/demo");
  await openMap(page);

  const all = page.getByRole("button", { name: "All", exact: true });
  const followUp = page.getByRole("button", { name: "Follow-up", exact: true });
  await expect(all).toHaveAttribute("aria-pressed", "true");
  await followUp.click();
  await expect(followUp).toHaveAttribute("aria-pressed", "true");
  await expect(all).toHaveAttribute("aria-pressed", "false");

  await page.getByRole("group", { name: "Walks view" }).getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("button", { name: /118 Crockett Street/ }).click();
  const sheet = page.getByRole("dialog", { name: /Home details for 118 Crockett Street/ });
  const talked = sheet.getByRole("button", { name: "Talked", exact: true });
  const noAnswer = sheet.getByRole("button", { name: "No answer", exact: true });
  await expect(talked).toHaveAttribute("aria-pressed", "true");
  await noAnswer.click();
  await expect(noAnswer).toHaveAttribute("aria-pressed", "true");
  await expect(talked).toHaveAttribute("aria-pressed", "false");
});

test("native compact controls retain 44 point hit targets", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/demo");
  await openMap(page);
  await page.getByRole("group", { name: "Walks view" }).getByRole("button", { name: "List", exact: true }).click();
  const addAddressBounds = await page.getByRole("button", { name: "Add address manually" }).boundingBox();
  expect(addAddressBounds).not.toBeNull();
  expect(addAddressBounds!.width).toBeGreaterThanOrEqual(44);
  expect(Math.abs(addAddressBounds!.width - addAddressBounds!.height)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: /118 Crockett Street/ }).click();
  const sheet = page.getByRole("dialog", { name: /Home details for 118 Crockett Street/ });
  for (const control of [
    sheet.getByRole("button", { name: "Close", exact: true }),
    sheet.getByRole("tab", { name: /Record visit/ }),
    sheet.getByRole("button", { name: "Talked", exact: true }),
  ]) {
    const bounds = await control.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
});

for (const width of [834, 1024]) {
  test(`iPad shell respects simulated safe areas at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/demo");
    await page.locator("html").evaluate((element) => {
      element.style.setProperty("--top-inset", "24px");
      element.style.setProperty("--right-inset", "8px");
      element.style.setProperty("--bottom-inset", "20px");
      element.style.setProperty("--left-inset", "8px");
    });

    const shell = page.locator(".app-shell");
    const header = page.locator(".app-header");
    const body = page.locator(".app-body");
    await expect(shell).toHaveCSS("padding-top", "24px");
    const [headerBounds, bodyBounds] = await Promise.all([header.boundingBox(), body.boundingBox()]);
    expect(headerBounds).not.toBeNull();
    expect(bodyBounds).not.toBeNull();
    expect(headerBounds!.x).toBeGreaterThanOrEqual(8);
    expect(headerBounds!.x + headerBounds!.width).toBeLessThanOrEqual(width - 8);
    expect(headerBounds!.y).toBeGreaterThanOrEqual(24);
    expect(bodyBounds!.y + bodyBounds!.height).toBeLessThanOrEqual(880);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("drawing a lasting zone uses a full-screen two-stage flow", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo");
  await openMap(page);
  await page.getByRole("group", { name: "Walks view" }).getByRole("button", { name: "Walks", exact: true }).click();
  await page.getByRole("button", { name: "Plan a walk", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Plan a walk" });
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  const originalZone = await dialog.getByRole("combobox", { name: "Neighborhood", exact: true }).inputValue();
  const launch = dialog.getByRole("button", { name: "New neighborhood", exact: true });
  await launch.click();

  const creator = dialog.locator(".walk-parent-zone-creator");
  await expect(creator.getByRole("heading", { name: "Draw it", exact: true })).toBeFocused();
  const creatorBounds = await creator.boundingBox();
  expect(creatorBounds).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
  await expect(dialog.getByRole("heading", { name: "Where are you going?", exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const map = creator.getByRole("region", { name: /Interactive map of/ });
  const mapBounds = await map.boundingBox();
  expect(mapBounds?.height).toBeGreaterThan(800);
  await dragAcrossMap(page, map);
  await expect(creator.getByText("Rectangle ready", { exact: true })).toBeVisible();
  const review = creator.getByRole("button", { name: "Next", exact: true });
  await expect(review).toBeEnabled();
  await review.click();

  await expect(creator.getByRole("heading", { name: "Name it", exact: true })).toBeFocused();
  await expect(creator.getByRole("textbox", { name: "Neighborhood name", exact: true })).toBeVisible();
  await creator.getByRole("button", { name: "Back", exact: true }).click();
  await expect(creator.getByText("Rectangle ready", { exact: true })).toBeVisible();
  await expect(review).toBeEnabled();
  await creator.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(creator).toHaveCount(0);
  await expect(launch).toBeFocused();
  await expect(dialog.getByRole("combobox", { name: "Neighborhood", exact: true })).toHaveValue(originalZone);

  await launch.click();
  const reopenedCreator = dialog.locator(".walk-parent-zone-creator");
  await dragAcrossMap(page, reopenedCreator.getByRole("region", { name: /Interactive map of/ }));
  await reopenedCreator.getByRole("button", { name: "Next", exact: true }).click();
  const zoneName = `Mobile zone ${Date.now()}`;
  await reopenedCreator.getByRole("textbox", { name: "Neighborhood name", exact: true }).fill(zoneName);
  await reopenedCreator.getByRole("button", { name: "Create neighborhood", exact: true }).click();
  await expect(reopenedCreator).toHaveCount(0);
  await expect(dialog.getByRole("combobox", { name: "Neighborhood", exact: true }).locator("option:checked")).toHaveText(zoneName);
});

test("zone creation stays inline above the phone breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/demo");
  await openMap(page);
  await page.getByRole("group", { name: "Walks view" }).getByRole("button", { name: "Walks", exact: true }).click();
  await page.getByRole("button", { name: "Plan a walk", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Plan a walk" });
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.getByRole("button", { name: "New neighborhood", exact: true }).click();

  const creator = dialog.locator(".walk-parent-zone-creator");
  await expect(creator.getByText("Draw a neighborhood", { exact: true })).toBeVisible();
  await expect(creator.getByRole("textbox", { name: "Neighborhood name", exact: true })).toBeVisible();
  await expect(creator.getByRole("button", { name: "Next", exact: true })).toBeHidden();
  await expect(creator.getByRole("heading", { name: "Draw it", exact: true })).toBeHidden();
  const creatorBounds = await creator.boundingBox();
  expect(creatorBounds?.y).toBeGreaterThan(0);
  expect(creatorBounds?.height).toBeLessThan(900);
});

test("a People location opens a map with a contextual return", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/demo");

  await openMap(page);
  await expect(page.getByRole("button", { name: "Back to People" })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /^People/ }).click();
  const workspace = page.locator(".people-workspace");
  const search = workspace.getByRole("searchbox", { name: "Search", exact: true });
  await search.fill("Tasha");
  await workspace.locator(".followup-filter-disclosure summary").click();
  await workspace.getByRole("combobox", { name: "Responsibility", exact: true }).selectOption("all");
  await workspace.getByRole("combobox", { name: "Status", exact: true }).selectOption("overdue");
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await workspace.evaluate((element) => { element.scrollTop = 120; });
  const location = page.getByRole("button", { name: "Location", exact: true }).first();
  await location.scrollIntoViewIfNeeded();
  const scrollTop = await workspace.evaluate((element) => element.scrollTop);
  await location.click();
  await expect(page.getByRole("button", { name: "Back to People" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: /Home details/ })).toBeVisible();

  await page.getByRole("button", { name: "Back to People" }).click();
  await expect(page.getByRole("tab", { name: "Needs follow-up", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(search).toHaveValue("Tasha");
  await expect(workspace.getByRole("combobox", { name: "Responsibility", exact: true })).toHaveValue("all");
  await expect(workspace.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("overdue");
  await expect(workspace.getByRole("button", { name: "More actions", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => workspace.evaluate((element) => element.scrollTop)).toBe(scrollTop);
  await expect(page.getByRole("button", { name: "Back to People" })).toHaveCount(0);
});

test("the person Next step card opens and scrolls to their follow-ups", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/demo");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /^People/ }).click();
  await page.getByRole("tab", { name: "All people", exact: true }).click();
  await page.getByRole("button", { name: /Tasha.*215 Gaines Street/ }).click();

  const workspace = page.locator(".people-workspace");
  const followUpsTab = page.getByRole("tab", { name: /Follow-ups/ });
  await page.getByRole("tab", { name: /Activity/ }).click();
  await page.getByRole("button", { name: "Open follow-ups for Tasha", exact: true }).click();

  await expect(followUpsTab).toHaveAttribute("aria-selected", "true");
  await expect(followUpsTab).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: /Follow-ups/ })).toBeVisible();
  await expect.poll(() => workspace.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

for (const width of [320, 393, 768]) {
  test(`workspace fits ${width}px and touch navigation stays accessible`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await page.goto("/demo");
    await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Erica$/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    for (const button of await nav.getByRole("button").all()) {
      const bounds = await button.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
    }
    await openMap(page);
    await expect(page.getByRole("combobox", { name: "Search any address", exact: true })).toBeVisible();
    await page.getByRole("group", { name: "Walks view" }).getByRole("button", { name: "Walks", exact: true }).click();
    await page.getByRole("button", { name: "Plan a walk", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const modal = await page.getByRole("dialog").boundingBox();
    expect(modal!.x).toBeGreaterThanOrEqual(0);
    expect(modal!.x + modal!.width).toBeLessThanOrEqual(width + 1);
  });
}

test("location details keep the same sheet height across record, people and history", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/demo");
  await openMap(page);
  await page.getByRole("group", { name: "Walks view" }).getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("button", { name: /118 Crockett Street/ }).click();

  const sheet = page.getByRole("dialog", { name: /Home details for 118 Crockett Street/ });
  await expect(sheet).toBeVisible();
  await sheet.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
  const bounds = async () => sheet.evaluate((element) => {
    const rectangle = element.getBoundingClientRect();
    return { top: rectangle.top, height: rectangle.height, bottom: rectangle.bottom };
  });
  const recordBounds = await bounds();

  await sheet.getByRole("tab", { name: /People 1/ }).click();
  await expect.poll(bounds).toEqual(recordBounds);
  const addPersonHeight = await sheet.getByRole("button", { name: "Add person", exact: true }).evaluate((element) => element.getBoundingClientRect().height);
  const residentCard = sheet.locator(".resident-card");
  const residentCardHeight = await residentCard.evaluate((element) => element.getBoundingClientRect().height);
  expect(addPersonHeight).toBeGreaterThanOrEqual(44);
  expect(addPersonHeight).toBeLessThanOrEqual(60);
  expect(residentCardHeight).toBeLessThan(160);

  const editPerson = residentCard.getByRole("button", { name: "Edit", exact: true });
  const deletePerson = residentCard.getByRole("button", { name: /^Delete / });
  await residentCard.locator("strong").evaluate((element) => { element.textContent = "A resident with an exceptionally long name that must fit"; });
  const [editBounds, deleteBounds] = await Promise.all([editPerson.boundingBox(), deletePerson.boundingBox()]);
  expect(editBounds).not.toBeNull();
  expect(deleteBounds).not.toBeNull();
  expect(Math.abs(editBounds!.y - deleteBounds!.y)).toBeLessThanOrEqual(1);
  expect(deleteBounds!.height).toBeGreaterThanOrEqual(44);

  await sheet.getByRole("tab", { name: /History 1/ }).click();
  await expect.poll(bounds).toEqual(recordBounds);
  const historyItemHeight = await sheet.locator(".history-item").evaluate((element) => element.getBoundingClientRect().height);
  expect(historyItemHeight).toBeLessThan(160);

  await sheet.getByRole("tab", { name: /Record visit/ }).click();
  await expect.poll(bounds).toEqual(recordBounds);

  const panel = sheet.getByRole("tabpanel");
  await expect(panel).toHaveCSS("overflow-y", "auto");
  expect(recordBounds.bottom).toBe(852);
});

test("a new person can be created from the visit person selector", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/demo");
  await openMap(page);
  await page.getByRole("group", { name: "Walks view" }).getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("button", { name: /144 Crockett Street/ }).click();

  const sheet = page.getByRole("dialog", { name: /Home details for 144 Crockett Street/ });
  await sheet.getByRole("button", { name: "Add a person or note", exact: true }).click();
  const person = sheet.getByRole("combobox", { name: /^Person/ });
  await expect(person.getByRole("option", { name: "Add a new person…", exact: true })).toBeAttached();
  await person.selectOption({ label: "Add a new person…" });

  await expect(sheet.getByRole("tab", { name: "People 0", exact: true })).toHaveAttribute("aria-selected", "true");
  await sheet.getByRole("textbox", { name: "Name", exact: true }).fill("Mobile Test Neighbor");
  await sheet.getByRole("button", { name: "Save person", exact: true }).click();

  await expect(sheet.getByRole("tab", { name: "Record visit", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(person.locator("option:checked")).toHaveText("Mobile Test Neighbor");
  await expect(sheet.getByText("Saved and added to this visit.", { exact: true })).toBeVisible();
  await expect(sheet.getByRole("tab", { name: "People 1", exact: true })).toBeVisible();
});
