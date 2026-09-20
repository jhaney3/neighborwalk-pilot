import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/invitation-browser", workers: 1,
  use: { baseURL: "http://127.0.0.1:4174", viewport: { width: 393, height: 852 }, launchOptions: process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : undefined },
  webServer: { command: "npm run mobile:dev -- --port 4174", url: "http://127.0.0.1:4174", env: { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-key", NEXT_PUBLIC_PHONE_AUTH_ENABLED: "true", NEXT_PUBLIC_INVITE_ORIGIN: "https://invite.example.test" } },
});
