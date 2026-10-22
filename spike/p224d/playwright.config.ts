// P2.24d spike only. Playwright 1.64.0 (https://playwright.dev/docs/test-configuration).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"], ["json", { outputFile: "p224d-report.json" }]],
  use: { baseURL: "https://pds.test", ignoreHTTPSErrors: true, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
