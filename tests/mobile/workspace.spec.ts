import { expect, test, type Page } from "@playwright/test";

const nav = (page: Page) => page.getByRole("navigation", { name: "Main navigation" });

/** Your avatar on Today opens More. */
async function openMore(page: Page) {
  await page.getByRole("button", { name: /profile, settings and more/ }).click();
  await expect(page.getByRole("heading", { name: "More", exact: true })).toBeVisible();
}

async function openSettings(page: Page) {
  await openMore(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
}

/** The map lives under Walks: open the Walks tab, then its Map or List view. */
async function openWalksView(page: Page, view: "Map" | "List") {
  await nav(page).getByRole("button", { name: /^Walks/ }).click();
  await page.getByRole("group", { name: "Walks view" }).getByRole("button", { name: view, exact: true }).click();
}

/** A home from the list opens its sheet (MP9). */
async function openHome(page: Page, address: string) {
  await openWalksView(page, "List");
  // List rows use the short street ("118 Crockett St"); the sheet has the full address.
  await page.getByRole("button", { name: new RegExp(address) }).first().click();
  const sheet = page.getByRole("dialog", { name: new RegExp(address) });
  await expect(sheet).toBeVisible();
  return sheet;
}

test("all primary tabs work and marketing content is excluded", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await nav(page).getByRole("button", { name: /^Walks/ }).click();
  await expect(nav(page).getByRole("button", { name: /^Walks/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("group", { name: "Walks view" })).toBeVisible();
  await nav(page).getByRole("button", { name: /^Follow-ups/ }).click();
  await expect(page.getByRole("heading", { name: "Follow-ups", exact: true })).toBeVisible();
  await nav(page).getByRole("button", { name: /^People/ }).click();
  await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
  await nav(page).getByRole("button", { name: "Today", exact: true }).click();
  await openSettings(page);
  await expect(page.getByRole("button", { name: "Install app", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Return to website" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Church profile/ }).click();
  await page.getByRole("textbox", { name: "Church name", exact: true }).fill("Sample iPhone Church");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.reload();
  await openMore(page);
  await expect(page.locator(".more-profile")).toContainText("Sample iPhone Church");
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Apple", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  await expect(page.locator(".site-shell, .site-header, .site-hero")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("appearance can be set to dark in Settings and persists on this device", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/demo");
  await openSettings(page);

  const appearance = page.getByRole("group", { name: "Appearance" });
  await expect(appearance.getByRole("button", { name: "Auto", exact: true })).toHaveAttribute("aria-pressed", "true");
  await appearance.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#121714");

  await page.reload();
  await openSettings(page);
  await expect(page.getByRole("group", { name: "Appearance" }).getByRole("button", { name: "Dark", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("Done releases focus from single-line inputs", async ({ page }) => {
  await page.goto("/demo");
  await openSettings(page);
  await page.getByRole("button", { name: /^Church profile/ }).click();
  const churchName = page.getByRole("textbox", { name: "Church name", exact: true });
  await churchName.focus();
  await expect(churchName).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(churchName).not.toBeFocused();

  await nav(page).getByRole("button", { name: "Today", exact: true }).click();
  await openWalksView(page, "Map");
  await page.getByRole("button", { name: "Search an address", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search an address" });
  await search.fill("708 Shelby Ave");
  await page.keyboard.press("Enter");
  await expect(search).not.toBeFocused();
});

test("keyboard focus remains visible in the native shell", async ({ page }) => {
  await page.goto("/demo");
  await nav(page).getByRole("button", { name: "Today", exact: true }).focus();
  await page.keyboard.press("Tab");
  const walks = nav(page).getByRole("button", { name: /^Walks/ });
  await expect(walks).toBeFocused();
  expect(await walks.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
});

test.describe("touch focus treatment", () => {
  test.use({ hasTouch: true });

  test("touch-opened sheets and controls avoid focus rings until keyboard navigation", async ({ page }) => {
    await page.goto("/demo");
    await page.getByRole("button", { name: "Log a conversation", exact: true }).tap();
    const sheet = page.getByRole("dialog", { name: "Log a conversation" });
    await expect(sheet).toBeVisible();
    const close = sheet.getByRole("button", { name: "Close", exact: true });
    await expect(sheet).toHaveCSS("outline-style", "none");

    const change = sheet.getByRole("button", { name: "Change", exact: true });
    await change.tap();
    await expect(sheet.getByRole("button", { name: "Done", exact: true })).toHaveCSS("outline-style", "none");

    await close.focus();
    await expect(close).toHaveCSS("outline-style", "none");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(close).toBeFocused();
    expect(await close.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
  });
});

test("a conversation can include several people and a place, and shows under People", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Log a conversation", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Log a conversation" });
  await sheet.getByRole("button", { name: "Change", exact: true }).click();
  await sheet.getByRole("group", { name: "Where" }).getByRole("button", { name: "Service day", exact: true }).click();
  await sheet.getByRole("textbox", { name: "Place name (optional)" }).fill("Saturday yard cleanup");
  const partOfWalk = sheet.getByRole("checkbox", { name: /^Part of/ });
  if (await partOfWalk.count()) await partOfWalk.uncheck();
  const search = sheet.getByRole("combobox", { name: "Find or add a person" });
  await search.fill("Tasha");
  await sheet.getByRole("option").getByRole("button", { name: "Tasha", exact: true }).click();
  await search.fill("Mobile Neighbor Friend");
  await sheet.getByRole("button", { name: "Add “Mobile Neighbor Friend” as someone new" }).click();
  await expect(sheet.getByRole("list", { name: "People in this conversation" }).getByRole("listitem")).toHaveCount(2);
  await sheet.getByRole("group", { name: "What happened" }).getByRole("button", { name: /^Talked/ }).click();
  const details = page.getByRole("dialog", { name: "Anything to add?" });
  await expect(details.getByText("With Tasha, Mobile Neighbor Friend")).toBeVisible();
  await details.getByRole("button", { name: "Done", exact: true }).click();
  await expect(details).toBeHidden();

  await nav(page).getByRole("button", { name: /^People/ }).click();
  await page.getByRole("button", { name: /Conversations away from doors/ }).click();
  const list = page.getByRole("list", { name: "Conversations away from doors" });
  await expect(list.getByRole("button", { name: /Tasha · Saturday yard cleanup/ })).toBeVisible();
  await expect(list.getByText("Mobile Neighbor Friend · Saturday yard cleanup")).toBeVisible();
});

test("a home's outcomes save behind Undo", async ({ page }) => {
  await page.goto("/demo");
  const sheet = await openHome(page, "118 Crockett");
  const outcomes = sheet.getByRole("group", { name: "What happened?" });
  await outcomes.getByRole("button", { name: /^No answer/ }).click();
  const saved = page.getByRole("status").filter({ hasText: "Saved" });
  await expect(saved).toBeVisible();
  await saved.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(saved).toHaveCount(0);
});

test("native compact controls retain 44 point hit targets", async ({ page }) => {
  await page.goto("/demo");
  for (const control of [
    page.getByRole("button", { name: /profile, settings and more/ }),
    page.getByRole("button", { name: "Log a conversation", exact: true }),
  ]) {
    const bounds = await control.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
  const sheet = await openHome(page, "118 Crockett");
  for (const control of [
    sheet.getByRole("button", { name: /^Options for/ }),
    sheet.getByRole("button", { name: "+ Add", exact: true }),
    sheet.getByRole("group", { name: "What happened?" }).getByRole("button", { name: /^Talked/ }),
  ]) {
    const bounds = await control.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
});

for (const width of [320, 393]) {
  test(`visit outcome choices fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await page.goto("/demo");
    const sheet = await openHome(page, "118 Crockett");
    const choices = sheet.getByRole("group", { name: "What happened?" }).getByRole("button");
    await expect(choices).toHaveCount(4);
    const sizes = await choices.evaluateAll((buttons) => buttons.map((button) => {
      const bounds = button.getBoundingClientRect();
      const label = button.querySelector(".walk-outcome-label") as HTMLElement;
      return { label: label.textContent?.trim(), width: bounds.width, height: bounds.height, fits: label.scrollWidth <= label.clientWidth + 1 };
    }));
    expect(sizes.map((choice) => choice.label)).toEqual(["Talked", "No answer", "Come back", "Not now"]);
    for (const choice of sizes) {
      expect(choice.height).toBeGreaterThanOrEqual(56);
      expect(choice.fits).toBe(true);
    }
    expect(Math.abs(sizes[0].width - sizes[1].width)).toBeLessThanOrEqual(1);
  });
}

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
    await expect(page.locator(".app-shell")).toHaveCSS("padding-top", "24px");
    const body = await page.locator(".app-body").boundingBox();
    expect(body).not.toBeNull();
    expect(body!.y).toBeGreaterThanOrEqual(24);
    expect(body!.y + body!.height).toBeLessThanOrEqual(880);
    // iPad uses the sidebar instead of the tab bar.
    const sidebar = await page.getByRole("navigation", { name: "Main sections" }).boundingBox();
    expect(sidebar!.x).toBeGreaterThanOrEqual(8);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("a new neighborhood is drawn on the map, then named", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/demo");
  await openWalksView(page, "Map");
  await page.getByRole("button", { name: "Map options", exact: true }).click();
  await page.getByRole("button", { name: "New neighborhood", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel drawing", exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  for (const [x, y] of [[80, 300], [300, 280], [320, 560], [190, 620], [70, 540], [80, 300]]) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(250);
  }
  const naming = page.getByRole("dialog", { name: "Name it" });
  await expect(naming).toBeVisible();
  const zoneName = `Mobile zone ${Date.now()}`;
  await naming.getByRole("textbox", { name: "Name", exact: true }).fill(zoneName);
  await naming.getByRole("button", { name: "Save neighborhood", exact: true }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^${zoneName}`) })).toBeVisible();
});

test("a follow-up's home opens the map with a contextual return", async ({ page }) => {
  await page.goto("/demo");
  await openWalksView(page, "Map");
  await expect(page.getByRole("button", { name: "Follow-ups", exact: true })).toHaveCount(0);

  const followUps = nav(page).getByRole("button", { name: /^Follow-ups/ });
  await followUps.click();
  await page.getByRole("button", { name: /^Tasha\./ }).click();
  const title = page.getByRole("heading", { name: "Tasha", level: 1 });
  await expect(title).toBeVisible();
  await page.getByRole("button", { name: /215 Gaines Street.*Home and visits/ }).click();
  const back = page.getByRole("button", { name: "Follow-ups", exact: true });
  await expect(back).toBeVisible();
  await expect(page.getByRole("dialog", { name: /215 Gaines Street/ })).toBeVisible();

  await back.click();
  await expect(followUps).toHaveAttribute("aria-current", "page");
  await expect(title).toBeVisible();
  await expect(back).toHaveCount(0);
});

test("the person page's follow-up card opens the follow-up", async ({ page }) => {
  await page.goto("/demo");
  await nav(page).getByRole("button", { name: /^People/ }).click();
  await page.getByRole("button", { name: /^Tasha/ }).click();
  await expect(page.getByRole("heading", { name: "Tasha", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /Open follow-up/ }).click();
  await expect(nav(page).getByRole("button", { name: /^Follow-ups/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Log check-in", exact: true })).toBeVisible();
});

for (const width of [320, 393, 768]) {
  test(`workspace fits ${width}px and touch navigation stays accessible`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await page.goto("/demo");
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of await nav(page).getByRole("button").all()) {
      const bounds = await button.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
    }
    await openWalksView(page, "Map");
    await expect(page.getByRole("button", { name: "Search an address", exact: true })).toBeVisible();
    await page.getByRole("group", { name: "Walks view" }).getByRole("button", { name: "Walks", exact: true }).click();
    await page.getByRole("button", { name: "Plan a walk", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Where are you walking/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const people of [false, true]) {
      if (people) { await page.goto("/demo"); await nav(page).getByRole("button", { name: /^People/ }).click(); await page.getByRole("button", { name: /^Tasha/ }).click(); }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}

test("the home sheet opens part way and grows to full height as it scrolls", async ({ page }) => {
  await page.goto("/demo");
  const sheet = await openHome(page, "118 Crockett");
  await sheet.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
  const bounds = () => sheet.evaluate((element) => { const box = element.getBoundingClientRect(); return { top: Math.round(box.top), bottom: Math.round(box.bottom) }; });
  const medium = await bounds();
  expect(medium.bottom).toBe(852);
  expect(medium.top).toBeGreaterThan(100);
  await sheet.locator(".sheet-body").evaluate((element) => { element.scrollTop = 40; element.dispatchEvent(new Event("scroll")); });
  await expect.poll(async () => (await bounds()).top).toBeLessThan(medium.top);
});

test("a person can be added to a home from its sheet", async ({ page }) => {
  await page.goto("/demo");
  const sheet = await openHome(page, "144 Crockett");
  await sheet.getByRole("button", { name: "+ Add", exact: true }).click();
  const form = page.getByRole("dialog", { name: "New person" });
  await expect(form.getByText("144 Crockett Street")).toBeVisible();
  await form.getByRole("textbox", { name: "Name", exact: true }).fill("Mobile Test Neighbor");
  await form.getByRole("button", { name: "Add person", exact: true }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole("dialog", { name: /144 Crockett Street/ }).getByRole("button", { name: /Mobile Test Neighbor/ })).toBeVisible();
});

test("the conversation's second page pairs a phone with the person it belongs to", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Log a conversation", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Log a conversation" });
  const search = sheet.getByRole("combobox", { name: "Find or add a person" });
  await search.fill("Tasha");
  await sheet.getByRole("option").getByRole("button", { name: "Tasha", exact: true }).click();
  await search.fill("Ray Ortiz");
  await sheet.getByRole("button", { name: "Add “Ray Ortiz” as someone new" }).click();
  await sheet.getByRole("group", { name: "What happened" }).getByRole("button", { name: /^Talked/ }).click();
  const details = page.getByRole("dialog", { name: "Anything to add?" });
  // Tasha already has a phone on file, so only Ray is asked, starting on No.
  await expect(details.getByRole("group", { name: "Whose contact" })).toHaveCount(0);
  await expect(details.getByText("Contact · Ray Ortiz")).toBeVisible();
  await expect(details.getByRole("button", { name: "No", exact: true })).toHaveAttribute("aria-pressed", "true");
  await details.getByRole("button", { name: "Yes", exact: true }).click();
  await details.getByPlaceholder("(555) 000-0000").fill("(555) 013-8840");
  await details.getByRole("button", { name: "Call", exact: true }).click();
  await details.getByRole("button", { name: "Done", exact: true }).click();
  await expect(details).toBeHidden();

  await nav(page).getByRole("button", { name: /^People/ }).click();
  await page.getByRole("button", { name: /^Ray Ortiz/ }).click();
  await expect(page.getByRole("link", { name: "Call", exact: true })).toHaveAttribute("href", /5550138840|555\) 013-8840/);
});

test("walk mode keeps the tab bar and the + button", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Resume walk", exact: true }).click();
  await expect(page.getByRole("button", { name: /Crockett north.*Open the walk page/ })).toBeVisible();
  await expect(nav(page)).toBeVisible();
  await expect(nav(page).getByRole("button", { name: /^Walks/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Log a conversation", exact: true })).toBeVisible();
});

test("Plan a walk can draw a new neighborhood", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/demo");
  await nav(page).getByRole("button", { name: /^Walks/ }).click();
  await page.getByRole("button", { name: "Plan a walk", exact: true }).click();
  await page.getByRole("button", { name: /^New neighborhood/ }).click();
  const flow = page.getByRole("dialog", { name: "New neighborhood" });
  await expect(flow.getByRole("button", { name: "Cancel drawing", exact: true })).toBeVisible();
  // Taps before the map is ready are dropped, so wait for it to settle first.
  await expect(flow.locator(".maplibregl-canvas")).toBeVisible();
  await page.waitForTimeout(3000);
  for (const [x, y] of [[80, 300], [300, 280], [320, 560], [190, 620], [70, 540], [80, 300]]) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(250);
  }
  const naming = page.getByRole("dialog", { name: "Name it" });
  await naming.getByRole("textbox", { name: "Name", exact: true }).fill("Riverside");
  await naming.getByRole("button", { name: "Save neighborhood", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Which streets?" })).toBeVisible();
});

test("Done on the conversation's second page stays tappable and says what's missing", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Log a conversation", exact: true }).click();
  await page.getByRole("dialog", { name: "Log a conversation" }).getByRole("group", { name: "What happened" }).getByRole("button", { name: /^Follow up/ }).click();
  const details = page.getByRole("dialog", { name: "Who did you meet?" });
  const done = details.getByRole("button", { name: "Done", exact: true });
  await expect(done).toBeEnabled();
  await done.click();
  await expect(details.getByRole("alert")).toContainText("what should happen next");
  await details.getByRole("textbox", { name: /What should happen next/ }).fill("Bring the pantry schedule");
  await done.click();
  await expect(details).toBeHidden();
});
