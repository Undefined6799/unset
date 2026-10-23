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

  // P2.05m: the sign-in page is one box over the scrim, with nothing behind it to tab into; with no Referer, Close goes home.
  test("login_box_without_js", async ({ page }) => {
    await page.goto("/login?next=/did");
    const dialog = page.getByRole("region", { name: "Sign in" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Sign in with AtProto" })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Close" })).toHaveAttribute("href", "/");
    await expect(page.locator("header, footer")).toHaveCount(0);
  });

  // P2.05n: the browser's own Referer (Referrer-Policy same-origin) brings Close back to the page the visitor left.
  test("login_close_returns_to_the_page_before", async ({ page }) => {
    await page.goto("/legal/terms");
    await page.locator('footer a[href="/login"]').click();
    await expect(page).toHaveURL(/\/login$/);
    const close = page.getByRole("region", { name: "Sign in" }).getByRole("link", { name: "Close" });
    await expect(close).toHaveAttribute("href", "/legal/terms");
    await close.click();
    await expect(page).toHaveURL(/\/legal\/terms$/);
  });

  // P1.25f: both menus work with no script. The Navigation panel and the folded Header menu show only on a phone.
  test.describe("phone", () => {
    test.use({ viewport: { width: 375, height: 800 } });

    // The native popover closes on Escape and gives focus back to the button that opened it (HTML "hide popover
    // algorithm", focusPreviousElement for a close request).
    test("navigation_popover_without_js", async ({ page }) => {
      await page.goto("/");
      const toggle = page.locator('button[popovertargetaction="toggle"]');
      const panel = page.locator("[popover]");
      await expect(panel).toBeHidden();
      await toggle.press("Enter");
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("link", { name: "Settings" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(toggle).toBeFocused();
    });

    test("default_shell_details_menu_without_js", async ({ page }) => {
      await page.goto("/signed-out");
      const menu = page.locator("header details");
      const summary = menu.locator("summary");
      await expect(summary).toBeVisible();
      await expect(menu.getByRole("link", { name: "Sign in" })).toBeHidden();
      await summary.press("Enter");
      await expect(menu).toHaveAttribute("open", "");
      await expect(menu.getByRole("link", { name: "Sign in" })).toBeVisible();
      await summary.press("Enter");
      await expect(menu).not.toHaveAttribute("open");
    });
  });

  // P1.22's test, its theme half (the French half is P1.22b's): the footer form on an app page sets the theme.
  test("prefs_forms_work_without_js", async ({ page, browserName }) => {
    await page.goto("/signed-out");
    const form = page.locator('footer form[action="/prefs/theme"]');
    await form.getByLabel("Light").check();
    // The POST itself is the proof the form submitted, in every browser: its 303 carries the cookie.
    const posted = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/prefs/theme"));
    await form.getByRole("button", { name: "Save theme" }).click();
    const response = await posted;
    expect(response.status()).toBe(303);
    expect(response.request().postData()).toBe("theme=light&return=%2Fsigned-out");
    await expect(page).toHaveURL(/\/signed-out$/);
    // WebKit will not store a Secure __Host- cookie on http (a11y.spec.ts), so it keeps the system theme.
    const expected = browserName === "webkit" ? null : "light";
    expect(await page.locator("html").getAttribute("data-theme")).toBe(expected);
    await expect(form.getByLabel(browserName === "webkit" ? "System" : "Light")).toBeChecked();
  });
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
