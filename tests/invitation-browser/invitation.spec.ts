import { expect, test } from "@playwright/test";
const token = "b".repeat(64);
const user = { id: "00000000-0000-4000-8000-000000000002", aud: "authenticated", role: "authenticated", email: "different@privaterelay.appleid.com", email_confirmed_at: new Date().toISOString(), confirmed_at: new Date().toISOString(), created_at: new Date().toISOString(), app_metadata: { provider: "apple", providers: ["apple"] }, user_metadata: {} };
const session = { access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600, user };

for (const provider of ["apple", "google"]) test(`${provider} account with a different email can explicitly accept an invitation`, async ({ page }) => {
  const providerUser = { ...user, email: provider === "google" ? "different@gmail.com" : user.email, app_metadata: { provider, providers: [provider] } };
  let accepted = false;
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/v1/token") return route.fulfill({ json: { ...session, user: providerUser } });
    if (path === "/auth/v1/user") return route.fulfill({ json: providerUser });
    if (path === "/rest/v1/rpc/shared_invitation") {
      if (route.request().postDataJSON()?.accept_invitation) accepted = true;
      return route.fulfill({ json: { joined: accepted, churchName: "Oak Grove Church", role: "volunteer" } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(`/invite#join=${token}`);
  await expect(page.getByRole("button", { name: "Continue with Apple", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Email address", exact: true }).fill(providerUser.email);
  await page.getByLabel("Password", { exact: true }).fill("sample-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Oak Grove Church" })).toBeVisible();
  await expect(page.getByText(`Signed in as ${providerUser.email}`, { exact: false })).toBeVisible();
  expect(accepted).toBe(false);
  await expect(page).not.toHaveURL(/join=/);
  await page.getByRole("button", { name: "Join church", exact: true }).click();
  await expect.poll(() => accepted).toBe(true);
  await expect(page).toHaveURL(/\/app\/today$/);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.includes("pending-invitation")).length)).toBe(0);
});

test("phone signup sends normalized number and verifies the one-time code", async ({ page }) => {
  let phone = "", code = "";
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    if (route.request().url().includes("/otp")) { phone = route.request().postDataJSON().phone; return route.fulfill({ json: {} }); }
    if (route.request().url().includes("/verify")) { code = route.request().postDataJSON().token; return route.fulfill({ status: 400, json: { msg: "Code expired. Request another code." } }); }
    return route.fulfill({ json: [] });
  });
  await page.goto("/login");
  await page.getByText("More options", { exact: true }).click();
  await page.getByText("Sign in with your phone number", { exact: true }).click();
  await page.getByLabel("Phone number with country code").fill("+1 (615) 555-0123");
  await page.getByRole("button", { name: "Text me a code" }).click();
  await expect(page.getByText("Code sent to +16155550123.")).toBeVisible();
  expect(phone).toBe("+16155550123");
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect.poll(() => code).toBe("123456");
  await expect(page.getByRole("alert")).toContainText("Code expired");
});

test("pasted links use the dedicated invite host and fit a small iPhone", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/login");
  await page.getByText("More options", { exact: true }).click();
  await page.getByText("Have a church invitation?", { exact: true }).click();
  await page.getByLabel("Invitation link", { exact: true }).fill(`https://invite.example.test/invite#join=${token}`);
  await page.getByRole("button", { name: "Use invitation" }).click();
  await expect.poll(() => page.evaluate(() => Object.values(sessionStorage).some((value) => value.includes('"kind":"join"')))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "outputs/ios/apple-sign-in.png", fullPage: true });
});

test("leaders can address, copy and revoke a phone invitation", async ({ page }) => {
  let creation: Record<string, unknown> | null = null;
  let revoked = false;
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("create_shared_invitation")) { creation = route.request().postDataJSON(); return route.fulfill({ json: { id: "test-invite", token } }); }
    if (path.endsWith("list_shared_invitations")) return route.fulfill({ json: creation && !revoked ? [{ id: "test-invite", contactKind: "phone", contact: "+16155550123", name: "Sam", role: "volunteer", expiresAt: new Date(Date.now()+604800000).toISOString() }] : [] });
    if (path.endsWith("revoke_shared_invitation")) { revoked = true; return route.fulfill({ json: true }); }
    return route.fulfill({ json: [] });
  });
  await page.goto("/login");
  await page.addScriptTag({ type: "module", url: "/@fs/" + process.cwd() + "/tests/invitation-browser/leader-harness.tsx" });
  await page.getByRole("textbox", { name: "Name (optional)" }).fill("Sam");
  await page.getByRole("textbox", { name: "Phone number with country code", exact: true }).fill("+1 (615) 555-0123");
  await page.getByRole("button", { name: "Create invitation", exact: true }).click();
  await expect(page.getByText("Ready for Sam")).toBeVisible();
  expect(creation).toEqual({ contact_kind: "phone", contact_value: "+16155550123", recipient_name: "Sam", invitation_role: "volunteer" });
  await expect(page.getByRole("link", { name: "Messages", exact: true })).toHaveAttribute("href", /^sms:\+16155550123&body=/);
  await expect(page.getByRole("textbox", { name: "Invitation link", exact: true })).toHaveValue(`https://invite.example.test/invite#join=${token}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "outputs/ios/leader-invitations.png", fullPage: true });
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(page.getByText("Invitation revoked.")).toBeVisible();
  expect(revoked).toBe(true);
  await expect(page.getByRole("textbox", { name: "Invitation link", exact: true })).toHaveCount(0);
});

// Browser preview cannot launch Apple's system authentication sheet.
test("Google button handles browser preview without losing an invitation", async ({ page }) => {
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: [] }));
  await page.goto(`/invite#join=${token}`);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("iPhone or iPad");
  expect(await page.evaluate(() => Object.values(sessionStorage).some(value => value.includes('"kind":"join"')))).toBe(true);
  await page.screenshot({ path: "outputs/ios/google-sign-in.png", fullPage: true });
});

test('an account without a workspace can request deletion and retry a service failure', async ({ page }) => {
  const emailUser = { ...user, email: 'reviewer@example.test', app_metadata: { provider: 'email', providers: ['email'] }, identities: [] };
  let attempts = 0;
  await page.route('http://127.0.0.1:54321/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/auth/v1/token') return route.fulfill({ json: { ...session, user: emailUser } });
    if (path === '/auth/v1/user') return route.fulfill({ json: emailUser });
    if (path === '/functions/v1/account-deletion') {
      attempts += 1;
      if (attempts === 1) return route.fulfill({ status: 503, json: { error: 'unavailable' } });
      return route.fulfill({ json: { request_id: 'fictional-request', requested_at: new Date().toISOString(), due_at: new Date(Date.now()+30*86400000).toISOString() } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email address', exact: true }).fill(emailUser.email);
  await page.getByLabel('Password', { exact: true }).fill('sample-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Delete account', exact: true }).click();
  const submit = page.getByRole('button', { name: 'Request account deletion', exact: true });
  await expect(submit).toBeDisabled();
  await expect(page.getByText('If you use Sign in with Apple', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'outputs/ios/deletion-confirmation.png', fullPage: true });
  await page.getByRole('checkbox').check();
  await submit.click();
  await expect(page.getByRole('alert').filter({ hasText: 'could not be confirmed' })).toBeVisible();
  await submit.click();
  await expect(page.getByRole('heading', { name: 'Deletion requested', exact: true })).toBeVisible();
  await expect(page.getByText('fictional-request', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'outputs/ios/deletion-requested.png', fullPage: true });
  expect(attempts).toBe(2);
});
