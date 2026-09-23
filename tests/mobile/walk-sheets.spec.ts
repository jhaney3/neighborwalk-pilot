import { expect, test } from "@playwright/test";

for (const width of [320, 393]) test(`walk options release taps and sheets fit at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 852 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/demo");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Walks", exact: true }).click();
  await page.locator(".walk-list .outing-card").first().click();
  const options = page.getByRole("button", { name: "Options", exact: true });
  for (let repeat = 0; repeat < 2; repeat++) {
    await options.click();
    await expect(page.getByRole("menu", { name: "Walk options" })).toBeVisible();
    await page.getByRole("button", { name: "Close options", exact: true }).click({ position: { x: 5, y: 400 } });
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.locator(".outing-status-options-backdrop")).toHaveCount(0);
    const invitations = page.getByRole("button", { name: "Manage invitations", exact: true });
    await invitations.scrollIntoViewIfNeeded();
    expect((await invitations.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await invitations.click();
    const sheet = page.getByRole("dialog", { name: "Invitations", exact: true });
    await expect(sheet).toBeVisible();
    expect(await sheet.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const bounds = (await sheet.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    await sheet.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
    await page.screenshot({ path: `outputs/ios/invitations-${test.info().project.name}-${width}.png` });
    await sheet.getByRole("button", { name: "Close dialog" }).click();
    await expect(sheet).toHaveCount(0);
    await page.getByRole("button", { name: "Edit teams", exact: true }).click();
    const crews = page.getByRole("dialog", { name: "Teams", exact: true });
    await expect(crews).toBeVisible();
    expect(await crews.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await crews.getByRole("button", { name: "Close dialog" }).click();
  }
  await options.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(options).toBeFocused();
  expect(errors).toEqual([]);
});

test("opening a walk defaults to your crew assignment and allows a leader override", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Walks", exact: true }).click();
  await page.locator(".walk-list .outing-card").first().click();
  const target = page.getByRole("combobox", { name: "Route" });
  await expect(target.locator("option:checked")).toHaveText("Crockett north");
  await expect(page.getByText("Your route is selected.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open walk", exact: true })).toBeEnabled();
  await target.selectOption({ label: "Crockett south" });
  await expect(target.locator("option:checked")).toHaveText("Crockett south");
  await expect(page.getByText("Your route is selected.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open walk", exact: true })).toBeEnabled();
});
