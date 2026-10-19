import { AxeBuilder } from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { AXE_ALLOWANCE, expiredAllowances, unallowedViolations } from "./allow.ts";
import { AXE_TAGS, expectHeaderMenuCloses, pageNoise, undersizedTargets, watch } from "./observe.ts";
import {
  cellName,
  colorSchemeOf,
  FIXTURES,
  PAGES,
  type PageFixture,
  requestHeaders,
  TEST_ORIGIN,
  type ThemeCell,
  themeCells,
  WELCOME_FIXTURES,
} from "./pages.ts";

const today = new Date().toISOString().slice(0, 10);

async function openCell(browser: Browser, cell: ThemeCell): Promise<Page> {
  const context = await browser.newContext({
    colorScheme: colorSchemeOf(cell),
    extraHTTPHeaders: requestHeaders(cell),
  });
  return context.newPage();
}

async function expectTheme(page: Page, fixture: PageFixture, cell: ThemeCell, browserName: string): Promise<void> {
  const theme = await page.locator("html").getAttribute("data-theme");
  const scheme = await page.locator('meta[name="color-scheme"]').getAttribute("content");
  expect(await page.locator("html").getAttribute("lang")).toBe("en");
  // WebKit does not send a Cookie header supplied by Playwright on http, and it will not
  // store a Secure __Host- cookie there, so the server correctly renders the system theme.
  if (browserName === "webkit" && cell.kind === "cookie") {
    expect(theme).toBeNull();
    expect(scheme).toBe("dark light");
    return;
  }
  if (fixture.group === "app" && cell.kind === "cookie") {
    expect(theme).toBe(cell.theme);
    expect(scheme).toBe(cell.theme);
    return;
  }
  expect(theme).toBeNull();
  expect(scheme).toBe("dark light");
}

for (const fixture of PAGES) {
  for (const cell of themeCells(fixture)) {
    test(`axe_matrix_green ${fixture.path} ${cellName(cell)}`, async ({ browser, browserName }) => {
      expect(expiredAllowances(AXE_ALLOWANCE, today)).toEqual([]);
      const page = await openCell(browser, cell);
      const watched = watch(page);
      try {
        const response = await page.goto(fixture.path);
        expect(response?.status()).toBe(200);
        expect(new URL(page.url()).pathname).toBe(fixture.path);
        await expectTheme(page, fixture, cell, browserName);
        const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
        expect(unallowedViolations(results.violations, AXE_ALLOWANCE, today)).toEqual([]);
        const noise = await pageNoise(page, watched);
        expect(noise.consoleErrors).toEqual([]);
        expect(noise.csp).toEqual([]);
        expect(watched.pageErrors).toEqual([]);
        if (!fixture.expectJs) expect(watched.scripts).toEqual([]);
      } finally {
        await page.context().close();
      }
    });
  }
}

// P2.12a: the welcome screens that need a session at their real paths, in both themes. English only until P1.22b.
for (const fixture of WELCOME_FIXTURES) {
  for (const cell of themeCells(fixture)) {
    test(`welcome.axe ${fixture.path} ${cellName(cell)}`, async ({ browser, browserName }) => {
      const page = await openCell(browser, cell);
      const watched = watch(page);
      try {
        const response = await page.goto(`${TEST_ORIGIN}${fixture.path}`);
        expect(response?.status()).toBe(200);
        await expectTheme(page, fixture, cell, browserName);
        const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
        expect(unallowedViolations(results.violations, AXE_ALLOWANCE, today)).toEqual([]);
        expect(watched.pageErrors).toEqual([]);
        expect(watched.scripts).toEqual([]);
      } finally {
        await page.context().close();
      }
    });
  }
}

test("axe_detects_violation", async ({ page }) => {
  await page.goto(`${TEST_ORIGIN}${FIXTURES.unlabeled}`);
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
  expect(results.violations.some((violation) => violation.id === "label")).toBe(true);
});

test.describe("once per page", () => {
  for (const fixture of PAGES) {
    test(`reflow_320 ${fixture.path}`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      const response = await page.goto(fixture.path);
      expect(response?.status()).toBe(200);
      const overflow = await page.evaluate(() => {
        const doc = (
          globalThis as unknown as { document: { documentElement: { scrollWidth: number; clientWidth: number } } }
        ).document.documentElement;
        return doc.scrollWidth - doc.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test(`target_size ${fixture.path}`, async ({ page }) => {
      const response = await page.goto(fixture.path);
      expect(response?.status()).toBe(200);
      const small = await page.evaluate(undersizedTargets);
      expect(small).toEqual([]);
    });
  }
});

test.describe("forced colours", () => {
  test.use({ forcedColors: "active" });
  for (const fixture of PAGES) {
    test(`forced_colors_focus ${fixture.path}`, async ({ page }) => {
      await page.goto(fixture.path);
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const view = globalThis as unknown as {
          document: { activeElement: { tagName: string } | null };
          getComputedStyle: (element: object) => { outlineStyle: string; outlineWidth: string };
        };
        const element = view.document.activeElement;
        if (element === null) return null;
        const style = view.getComputedStyle(element);
        return { tag: element.tagName, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
      });
      expect(focus?.outlineStyle).not.toBe("none");
      expect(Number.parseFloat(focus?.outlineWidth ?? "0")).toBeGreaterThan(0);
    });
  }
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  for (const fixture of PAGES) {
    test(`reduced_motion ${fixture.path}`, async ({ page }) => {
      await page.goto(fixture.path);
      const running = await page.evaluate(() => {
        const view = globalThis as unknown as {
          document: { querySelectorAll: (selector: string) => Iterable<object> };
          getComputedStyle: (element: object) => { animationName: string; animationDuration: string };
        };
        let count = 0;
        for (const element of view.document.querySelectorAll("*")) {
          const style = view.getComputedStyle(element);
          const names = style.animationName.split(",");
          const durations = style.animationDuration.split(",");
          const alive = names.some(
            (name, index) => name.trim() !== "none" && Number.parseFloat(durations[index] ?? "0") > 0,
          );
          if (alive) count += 1;
        }
        return count;
      });
      expect(running).toBe(0);
    });
  }
});

test("hydration_errors_all_engines", async ({ page }) => {
  const watched = watch(page);
  const response = await page.goto(`${TEST_ORIGIN}${FIXTURES.app}`);
  expect(response?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const noise = await pageNoise(page, watched);
  const hydration = noise.consoleErrors.filter((text) => /hydrat|react error #41[89]|react error #42[235]/i.test(text));
  expect(hydration).toEqual([]);
  expect(noise.consoleErrors).toEqual([]);
  expect(watched.pageErrors).toEqual([]);
});

test("toast_close_focuses_main", async ({ page }) => {
  await page.goto(`${TEST_ORIGIN}${FIXTURES.app}`);
  const close = page.locator("[data-island='toast'] a");
  await close.focus();
  await close.click();
  await expect(page.locator("#notice")).toBeHidden();
  await expect(page.locator("#main")).toBeFocused();
});

test("header_menu_escape_closes", async ({ page }) => {
  await page.goto(`${TEST_ORIGIN}${FIXTURES.app}`);
  await expectHeaderMenuCloses(page);
});
