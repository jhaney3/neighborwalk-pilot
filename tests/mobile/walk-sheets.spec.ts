import { expect, test, type Page } from "@playwright/test";

async function openLiveWalk(page: Page) {
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: /^Walks/ }).click();
  await page.getByRole("button", { name: /Saturday outreach/ }).first().click();
  await expect(page.getByRole("heading", { name: "Saturday outreach", level: 1 })).toBeVisible();
}

for (const width of [320, 393]) test(`walk options release taps and sheets fit at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 852 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo");
  await openLiveWalk(page);
  const options = page.getByRole("button", { name: "Walk options", exact: true });
  for (let repeat = 0; repeat < 2; repeat++) {
    await options.click();
    const menu = page.getByRole("dialog", { name: /Saturday outreach|Options/ });
    await expect(menu).toBeVisible();
    await menu.getByRole("button", { name: "Cancel", exact: true }).or(menu.getByRole("button", { name: "Close", exact: true })).first().click();
    await expect(page.locator(".action-sheet")).toHaveCount(0);

    await options.click();
    await page.getByRole("button", { name: "Edit walk", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Saturday outreach" });
    await edit.locator(".summary-row", { hasText: "invited" }).getByRole("button", { name: "Change", exact: true }).click();
    const invitations = page.getByRole("dialog", { name: "Who’s invited?" });
    await expect(invitations).toBeVisible();
    expect(await invitations.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const bounds = (await invitations.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    await invitations.getByRole("button", { name: "Close", exact: true }).click();
    await expect(invitations).toHaveCount(0);
    await page.getByRole("dialog", { name: "Saturday outreach" }).getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: "Edit teams", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: /^Back|^Close|^Done/ }).first().click();
    await expect(page.getByRole("heading", { name: "Saturday outreach", level: 1 })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("Resume walk opens your crew's route, and a leader can walk another route", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Resume walk", exact: true }).click();
  const pill = page.getByRole("button", { name: /Crockett north.*Open the walk page/ });
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(page.getByRole("heading", { name: "Saturday outreach", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /^Crockett south/ }).click();
  const routeSheet = page.getByRole("dialog", { name: "Crockett south" });
  await expect(routeSheet).toBeVisible();
  await expect(routeSheet.getByRole("button", { name: "Cancel route", exact: true })).toBeVisible();
});
