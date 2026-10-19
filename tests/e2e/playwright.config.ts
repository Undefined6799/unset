// Browser harness (P1.26). Playwright 1.64.0: https://playwright.dev/docs/test-configuration
// Header and CSP checks are Chromium only. WebKit does not implement Trusted Types, so a CSP
// console check there would not see the violation the app policy is written to produce.

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { PROD_ORIGIN, TEST_ORIGIN } from "./pages.ts";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const chrome = { ...devices["Desktop Chrome"] };
const firefox = { ...devices["Desktop Firefox"] };
const webkit = { ...devices["Desktop Safari"] };

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: join(root, "test-results"),
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  // interfaces/http/limits.ts allows 60 requests per IP on the default bucket. One worker stays inside it.
  workers: 1,
  timeout: 60_000,
  reporter: [
    ["list"],
    ["json", { outputFile: join(root, "tests/e2e/report.json") }],
    ["html", { open: "never", outputFolder: join(root, "playwright-report") }],
  ],
  use: {
    baseURL: PROD_ORIGIN,
    extraHTTPHeaders: { "accept-language": "en" },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: chrome },
    // clipboard permissions and forced-colors emulation are Chromium-only.
    { name: "firefox", use: firefox, testIgnore: [/headers\.spec\.ts/, /csp\.spec\.ts/, /chromium\.spec\.ts/] },
    { name: "webkit", use: webkit, testIgnore: [/headers\.spec\.ts/, /csp\.spec\.ts/, /chromium\.spec\.ts/] },
  ],
  webServer: [
    {
      command: "node tests/e2e/fixtures/servers.ts prod",
      cwd: root,
      url: `${PROD_ORIGIN}/health`,
      // tests/support/postgres.ts waits up to 90s for init. The book's 30s health timeout is shorter than that.
      timeout: 180_000,
      reuseExistingServer: true,
    },
    {
      command: "node tests/e2e/fixtures/servers.ts test",
      cwd: root,
      url: `${TEST_ORIGIN}/health`,
      // The fixture server loads the kit showcase through Vite before it listens.
      timeout: 120_000,
      reuseExistingServer: true,
    },
  ],
});
