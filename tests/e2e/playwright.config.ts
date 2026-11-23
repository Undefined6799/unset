// Browser harness (P1.26). Playwright 1.64.0: https://playwright.dev/docs/test-configuration
// Header and CSP checks are Chromium only. WebKit does not implement Trusted Types, so a CSP
// console check there would not see the violation the app policy is written to produce.

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import { STOP_ALL_MS } from "../support/postgres.ts";
import { INNER, PROD_ORIGIN, PROXY } from "./pages.ts";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const chrome = { ...devices["Desktop Chrome"] };
const firefox = { ...devices["Desktop Firefox"] };
const webkit = { ...devices["Desktop Safari"] };
// Each server removes its Postgres container as it exits on SIGTERM (fixtures/servers.ts). Without gracefulShutdown
// Playwright 1.64.1 SIGKILLs the process group (types/test.d.ts, TestConfigWebServer gracefulShutdown), no exit
// listener runs and the container stays; the timeout gives the removal its full budget before the SIGKILL.
const gracefulShutdown = { signal: "SIGTERM", timeout: STOP_ALL_MS } as const;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: join(root, "test-results"),
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  // One worker. fixtures/servers.ts names each TLS connection its own client address, so the rate limit
  // (interfaces/web/src/lib/server/limits.ts) sees each test as its own visitor.
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
    // Both origins are https://unset.test (pages.ts): the CONNECT proxy reaches them, and their certificate is the
    // run's own self-signed one (https://playwright.dev/docs/api/class-testoptions#test-options-proxy and
    // #test-options-ignore-https-errors, 1.64.1).
    proxy: { server: PROXY },
    ignoreHTTPSErrors: true,
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
      url: `http://127.0.0.1:${INNER.prod}/health`,
      // tests/support/postgres.ts waits up to 90s for init. The book's 30s health timeout is shorter than that.
      timeout: 180_000,
      reuseExistingServer: true,
      gracefulShutdown,
    },
    {
      command: "node tests/e2e/fixtures/servers.ts test",
      cwd: root,
      url: `http://127.0.0.1:${INNER.test}/health`,
      timeout: 180_000,
      reuseExistingServer: true,
      gracefulShutdown,
    },
  ],
});
