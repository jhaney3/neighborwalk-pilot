import { defineConfig } from "@playwright/test";

const port = process.env.MOBILE_TEST_PORT ?? "4173";

export default defineConfig({
  outputDir: "test-results/mobile",
  testDir: "./tests/mobile",
  projects: [{ name: "chromium", use: { browserName: "chromium" } }, { name: "webkit", use: { browserName: "webkit", launchOptions: {} } }],
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 393, height: 852 },
    launchOptions: process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run mobile:dev -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
