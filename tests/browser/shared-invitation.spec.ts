import { expect, test } from "@playwright/test";

const token = "b".repeat(64);
const user = {
  id: "00000000-0000-4000-8000-000000000002",
  aud: "authenticated",
  role: "authenticated",
  email: "different@privaterelay.appleid.com",
  email_confirmed_at: new Date().toISOString(),
  confirmed_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  app_metadata: { provider: "apple", providers: ["apple"] },
  user_metadata: {},
};
const session = { access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600, user };

test("local test shows Apple and Google with a safe configuration message", async ({ page }) => {
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Continue with Apple", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "sandbox does not have local OAuth credentials" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("a verified account explicitly accepts a private shared invitation", async ({ page }) => {
  let accepted = false;
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/v1/token") return route.fulfill({ json: session });
    if (path === "/auth/v1/user") return route.fulfill({ json: user });
    if (path === "/rest/v1/rpc/shared_invitation") {
      if (route.request().postDataJSON()?.accept_invitation) accepted = true;
      return route.fulfill({ json: { joined: accepted, churchName: "Oak Grove Church", role: "volunteer" } });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto(`/invite#join=${token}`);
  await expect(page).not.toHaveURL(/join=/);
  await page.getByRole("textbox", { name: "Email address", exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("sample-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Oak Grove Church" })).toBeVisible();
  await expect(page.getByText(`Signed in as ${user.email}`, { exact: false })).toBeVisible();
  expect(accepted).toBe(false);
  await page.getByRole("button", { name: "Join church", exact: true }).click();
  await expect.poll(() => accepted).toBe(true);
  await page.waitForURL("**/app/today");
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.includes("pending-invitation")).length)).toBe(0);
});
