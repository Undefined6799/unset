import { AxeBuilder } from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { AXE_ALLOWANCE, expiredAllowances, unallowedViolations } from "./allow.ts";
import { AXE_TAGS, addPageCookies, openPage, pageNoise, undersizedTargets, watch } from "./observe.ts";
import { ALL_PAGES, cellName, colorSchemeOf, originOf, type PageFixture, type ThemeCell, themeCells } from "./pages.ts";

const today = new Date().toISOString().slice(0, 10);

/** A context in the cell's system scheme, with the page's cookies: the session, and the theme on a cookie cell. */
async function openCell(browser: Browser, fixture: PageFixture, cell: ThemeCell): Promise<Page> {
  const context = await browser.newContext({ colorScheme: colorSchemeOf(cell) });
  await addPageCookies(context, fixture, cell);
  return context.newPage();
}

async function expectTheme(page: Page, fixture: PageFixture, cell: ThemeCell): Promise<void> {
  const theme = await page.locator("html").getAttribute("data-theme");
  const scheme = await page.locator('meta[name="color-scheme"]').getAttribute("content");
  expect(await page.locator("html").getAttribute("lang")).toBe("en");
  if (fixture.group === "app" && cell.kind === "cookie") {
    expect(theme).toBe(cell.theme);
    expect(scheme).toBe(cell.theme);
    return;
  }
  expect(theme).toBeNull();
  expect(scheme).toBe("dark light");
}

for (const fixture of ALL_PAGES) {
  for (const cell of themeCells(fixture)) {
    test(`axe_matrix_green ${fixture.path} ${cellName(cell)}`, async ({ browser }) => {
      expect(expiredAllowances(AXE_ALLOWANCE, today)).toEqual([]);
      const page = await openCell(browser, fixture, cell);
      const watched = watch(page);
      try {
        const response = await page.goto(`${originOf(fixture)}${fixture.path}`);
        expect(response?.status()).toBe(200);
        // Path and query: /join's fixture carries its invite code in the query (P2.10).
        const opened = new URL(page.url());
        expect(opened.pathname + opened.search).toBe(fixture.path);
        await page.waitForLoadState("networkidle");
        await expectTheme(page, fixture, cell);
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

// The checker's own check: an input with no label is reported.
test("axe_detects_violation", async ({ page }) => {
  await page.setContent('<!doctype html><html lang="en"><title>t</title><main><input type="text"></main></html>');
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
  expect(results.violations.some((violation) => violation.id === "label")).toBe(true);
});

test.describe("once per page", () => {
  for (const fixture of ALL_PAGES) {
    test(`reflow_320 ${fixture.path}`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      const response = await openPage(page, fixture);
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
      const response = await openPage(page, fixture);
      expect(response?.status()).toBe(200);
      const small = await page.evaluate(undersizedTargets);
      expect(small).toEqual([]);
    });
  }
});

// Staging walkthrough 2026-11-19: a focused link drew the browser's own outline while a focused button drew the
// design's 3px ring; a link draws the same 3px ring now.
test("a_focused_link_draws_the_design_ring", async ({ page }) => {
  await page.goto("/");
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
  expect(focus).toEqual({ tag: "A", outlineStyle: "solid", outlineWidth: "3px" });
});

test.describe("forced colours", () => {
  test.use({ forcedColors: "active" });
  for (const fixture of ALL_PAGES) {
    test(`forced_colors_focus ${fixture.path}`, async ({ page }) => {
      await openPage(page, fixture);
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
  for (const fixture of ALL_PAGES) {
    test(`reduced_motion ${fixture.path}`, async ({ page }) => {
      await openPage(page, fixture);
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

// Every app page starts SvelteKit's client over the server's markup with no hydration mismatch (Svelte 5 reports one
// as a console warning, "hydration_mismatch") and no error, in every engine.
for (const fixture of ALL_PAGES.filter((entry) => entry.expectJs)) {
  test(`hydration_errors_all_engines ${fixture.path}`, async ({ page }) => {
    const watched = watch(page);
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (/hydrat/i.test(message.text())) warnings.push(message.text());
    });
    expect((await openPage(page, fixture))?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    const noise = await pageNoise(page, watched);
    expect(warnings).toEqual([]);
    expect(noise.consoleErrors).toEqual([]);
    expect(watched.pageErrors).toEqual([]);
  });
}
