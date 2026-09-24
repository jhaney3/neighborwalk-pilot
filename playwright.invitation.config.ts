import { defineConfig } from "@playwright/test";
const port = process.env.INVITATION_TEST_PORT ?? "4174";
export default defineConfig({
  outputDir: "test-results/invitations",
  testDir: "./tests/invitation-browser", workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 393, height: 852 }, launchOptions: process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : undefined },
  webServer: { command: `npm run mobile:dev -- --port ${port}`, url: `http://127.0.0.1:${port}`, env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-key", NEXT_PUBLIC_PHONE_AUTH_ENABLED: "true", NEXT_PUBLIC_INVITE_ORIGIN: "https://invite.example.test" } },
});
