import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: "work/browser-results",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3013",
    browserName: "chromium",
    serviceWorkers: "allow",
    headless: true,
    trace: "off",
    launchOptions: !process.env.CI && existsSync("/usr/bin/chromium") ? { executablePath: "/usr/bin/chromium" } : {},
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3013",
    url: "http://127.0.0.1:3013/login",
    timeout: 30_000,
    reuseExistingServer: false,
  },
});
