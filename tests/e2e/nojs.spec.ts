import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { AXE_ALLOWANCE, expiredAllowances, unallowedViolations } from "./allow.ts";
import { AXE_TAGS, pageNoise, watch } from "./observe.ts";
import { FIXTURES, PAGES, TEST_ORIGIN } from "./pages.ts";

const today = new Date().toISOString().slice(0, 10);

test.describe("javascript disabled", () => {
  test.use({ javaScriptEnabled: false });

  for (const fixture of PAGES) {
    test(`nojs ${fixture.path}`, async ({ page }) => {
      const response = await page.goto(fixture.path);
      expect(response?.status()).toBe(200);
      await expect(page.locator("main")).toBeVisible();
    });
  }
});

// axe-core's injection uses page.evaluate, which does not finish when JavaScript is disabled.
// Aborting script requests keeps the server markup (these pages ship no island) and lets axe run.
test.describe("server markup", () => {
  for (const fixture of PAGES) {
    test(`nojs_axe ${fixture.path}`, async ({ page }) => {
      expect(expiredAllowances(AXE_ALLOWANCE, today)).toEqual([]);
      await page.route("**/*", (route) => {
        if (route.request().resourceType() === "script") return route.abort();
        return route.continue();
      });
      const watched = watch(page);
      const response = await page.goto(fixture.path);
      expect(response?.status()).toBe(200);
      await expect(page.locator("main")).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
      expect(unallowedViolations(results.violations, AXE_ALLOWANCE, today)).toEqual([]);
      const noise = await pageNoise(page, watched);
      expect(noise.csp).toEqual([]);
      expect(watched.pageErrors).toEqual([]);
    });
  }
});

test("zero_js_detected", async ({ page }) => {
  const watched = watch(page);
  const response = await page.goto(`${TEST_ORIGIN}${FIXTURES.script}`);
  expect(response?.status()).toBe(200);
  expect(watched.scripts.length).toBeGreaterThan(0);
});
