import { expect, test } from "@playwright/test";

test("all primary tabs work and marketing content is excluded", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Hello, Erica." })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Walks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Walks", exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "People", exact: true }).click();
  await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
  await nav.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("button", { name: "Settings & device" }).click();
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
  await expect(page.locator(".site-shell, .site-header, .site-hero")).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const width of [320, 393, 768]) {
  test(`workspace fits ${width}px and touch navigation stays accessible`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await page.goto("/demo");
    await expect(page.getByRole("heading", { name: "Hello, Erica." })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    for (const button of await nav.getByRole("button").all()) {
      const bounds = await button.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(bounds?.width).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("button", { name: "View map", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Search any address", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Plan a walk", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const modal = await page.getByRole("dialog").boundingBox();
    expect(modal!.x).toBeGreaterThanOrEqual(0);
    expect(modal!.x + modal!.width).toBeLessThanOrEqual(width + 1);
  });
}
