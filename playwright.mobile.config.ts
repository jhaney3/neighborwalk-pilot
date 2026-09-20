import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/mobile",
  projects: [{ name: "chromium", use: { browserName: "chromium" } }, { name: "webkit", use: { browserName: "webkit", launchOptions: {} } }],
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 393, height: 852 },
    launchOptions: process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run mobile:dev",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
