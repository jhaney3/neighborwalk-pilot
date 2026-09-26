// Captures the screens shown before a church opens (sign-in, invitations,
// loading and problems), EN1–EN16. They aren't in the walkthrough; compare
// built/ with before/ and read build plan decision 75.
//
// Run from the worktree root with a dev server wired to a mocked sign-in
// service (the same setup as playwright.invitation.config.ts):
//   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-key \
//   NEXT_PUBLIC_PHONE_AUTH_ENABLED=true NEXT_PUBLIC_INVITE_ORIGIN=https://invite.example.test \
//   npm run mobile:dev -- --port 4174 --strictPort
//   node docs/design/entry-screens/capture.mjs            # light, into built/
//   ENTRY_THEME=dark node docs/design/entry-screens/capture.mjs
//   ENTRY_WIDTH=320 ENTRY_OUT=/tmp/entry-320 node docs/design/entry-screens/capture.mjs
// Real flows are driven against mocked service responses. States no flow can
// reach on demand (loading, a failed church, a crash, offline) render through
// harness.tsx, which is never imported by the app.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.ENTRY_OUT ? resolve(process.env.ENTRY_OUT) : join(here, process.env.ENTRY_THEME === "dark" ? "built-dark" : "built");
const BASE = process.env.ENTRY_URL ?? "http://127.0.0.1:4174";
const WIDTH = Number(process.env.ENTRY_WIDTH ?? 393);
const THEME = process.env.ENTRY_THEME ?? "light";
const only = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const token = "b".repeat(64);
const user = { id: "00000000-0000-4000-8000-000000000002", aud: "authenticated", role: "authenticated", email: "dee@example.test", email_confirmed_at: new Date().toISOString(), confirmed_at: new Date().toISOString(), created_at: new Date().toISOString(), app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [] };
const session = { access_token: "test-access-token", refresh_token: "test-refresh-token", token_type: "bearer", expires_in: 3600, user };

// Every request to the sign-in service is answered here; `extra` overrides paths.
const mock = (page, extra = {}) => page.route("http://127.0.0.1:54321/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (extra[path]) return extra[path](route);
  if (path === "/auth/v1/token") return route.fulfill({ json: session });
  if (path === "/auth/v1/user") return route.fulfill({ json: user });
  if (path === "/rest/v1/rpc/shared_invitation") return route.fulfill({ json: { joined: false, churchName: "Grace Harbor Church", role: "volunteer" } });
  return route.fulfill({ json: [] });
});
const signIn = async (page) => {
  await page.getByRole("textbox", { name: "Email address", exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("sample-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForTimeout(1200);
};
const harness = async (page, state) => {
  await page.goto(`${BASE}/login`);
  await page.waitForTimeout(600);
  await page.evaluate((name) => { window.__entryState = name; }, state);
  await page.addScriptTag({ type: "module", url: `/@fs/${process.cwd()}/docs/design/entry-screens/harness.tsx` });
  await page.waitForTimeout(900);
};

const steps = {
  EN1: async (p) => { await mock(p); await p.goto(`${BASE}/login`); },
  EN2: async (p) => { await mock(p); await p.goto(`${BASE}/login`); await p.getByRole("button", { name: "Sign in", exact: true }).click(); },
  EN3: async (p) => { await mock(p); await p.goto(`${BASE}/login`); await p.getByRole("button", { name: "Create an account" }).click(); },
  EN4: async (p) => { await mock(p, { "/auth/v1/otp": (r) => r.fulfill({ json: {} }) }); await p.goto(`${BASE}/login`); await p.getByRole("textbox", { name: "Email address", exact: true }).fill(user.email); await p.getByRole("button", { name: "Email me a sign-in link" }).click(); },
  EN5: async (p) => { await mock(p, { "/auth/v1/otp": (r) => r.fulfill({ json: {} }) }); await p.goto(`${BASE}/login`); await p.getByText("Sign in with your phone number", { exact: true }).click(); await p.getByLabel("Phone number with country code").fill("+1 (615) 555-0123"); await p.getByRole("button", { name: "Text me a code" }).click(); },
  EN6: async (p) => { await mock(p); await p.goto(`${BASE}/login`); await p.getByText("Have a church invitation?", { exact: true }).click(); },
  EN7: async (p) => { await harness(p, "recovery"); },
  EN8: async (p) => { await mock(p); await p.goto(`${BASE}/invite#join=${token}`); await signIn(p); },
  EN9: async (p) => { await mock(p); await p.goto(`${BASE}/login`); await signIn(p); },
  EN10: async (p) => { await mock(p); await p.goto(`${BASE}/login`); await signIn(p); await p.getByRole("button", { name: "Delete account", exact: true }).click(); },
  EN11: async (p) => { await harness(p, "loading"); },
  EN12: async (p) => { await harness(p, "failure"); },
  EN13: async (p) => { await harness(p, "connection"); },
  EN14: async (p) => { await harness(p, "offline"); },
  EN15: async (p) => { await harness(p, "crash"); },
  EN16: async (p) => { await harness(p, "unavailable"); },
};

const browser = await chromium.launch();
for (const [id, step] of Object.entries(steps)) {
  if (only.length && !only.includes(id)) continue;
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 852 }, deviceScaleFactor: 2, colorScheme: THEME });
  try {
    await step(page);
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(out, `${id}.jpg`), type: "jpeg", quality: 82 });
    console.log(`${id} ✓`);
  } catch (error) { console.log(`${id} ✗ ${error.message.split("\n")[0]}`); }
  await page.close();
}
await browser.close();
