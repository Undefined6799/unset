// Every page with JavaScript off (P1.26; on the SvelteKit shell since P1.20k): it renders, its links and plain forms
// work, and the menu drawer is a native popover. axe runs on the server markup with scripts refused.
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { AXE_ALLOWANCE, expiredAllowances, unallowedViolations } from "./allow.ts";
import { AXE_TAGS, openPage, pageNoise, watch } from "./observe.ts";
import { ALL_PAGES, type PageFixture } from "./pages.ts";

const today = new Date().toISOString().slice(0, 10);
const SETTINGS: PageFixture = {
  path: "/settings/profile",
  route: "/settings/profile",
  group: "app",
  expectJs: true,
  member: "account",
};

test.describe("javascript disabled", () => {
  test.use({ javaScriptEnabled: false });

  for (const fixture of ALL_PAGES) {
    test(`nojs ${fixture.path}`, async ({ page }) => {
      const response = await openPage(page, fixture);
      expect(response?.status()).toBe(200);
      await expect(page.locator("main")).toBeVisible();
    });
  }

  // P2.05m: the sign-in page is one box; with no Referer, Close goes home.
  test("login_box_without_js", async ({ page }) => {
    await page.goto("/login?next=/me");
    const box = page.getByRole("region", { name: "Sign in" });
    await expect(box).toBeVisible();
    await expect(box.getByRole("button", { name: "Sign in with AtProto" })).toBeVisible();
    await expect(box.getByRole("link", { name: "Close" })).toHaveAttribute("href", "/");
    await expect(box.locator('input[name="next"]')).toHaveValue("/me");
  });

  // P2.05n: the browser's own Referer (Referrer-Policy same-origin) brings Close back to the page the visitor left.
  test("login_close_returns_to_the_page_before", async ({ page }) => {
    await page.goto("/legal/terms");
    await page.locator('footer a[href="/login?next=%2Flegal%2Fterms"]').click();
    await expect(page).toHaveURL(/\/login\?next=%2Flegal%2Fterms$/);
    const close = page.getByRole("region", { name: "Sign in" }).getByRole("link", { name: "Close" });
    await expect(close).toHaveAttribute("href", "/legal/terms");
    await close.click();
    await expect(page).toHaveURL(/\/legal\/terms$/);
  });

  // P1.25f, P2.13e, Clean tabs: on a 320px phone the header's menu button opens the drawer and the account button its
  // menu, with no script, and nothing scrolls sideways. A native popover closes on Escape and gives focus back to the
  // button that opened it (HTML "hide popover algorithm", focusPreviousElement).
  test.describe("phone", () => {
    test.use({ viewport: { width: 320, height: 800 } });

    test("navigation_popover_without_js", async ({ page }) => {
      await page.goto("/");
      const toggle = page.locator('header button[popovertarget="core-menu"]');
      const panel = page.locator("#core-menu");
      await expect(panel).toBeHidden();
      await toggle.press("Enter");
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("link", { name: "Terms" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(toggle).toBeFocused();
      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    test("account_menu_fits_without_js", async ({ page }) => {
      await openPage(page, SETTINGS);
      const toggle = page.locator('header button[popovertarget="account-menu"]');
      const menu = page.locator("#account-menu");
      await toggle.press("Enter");
      await expect(menu.getByRole("link", { name: "Your profile" })).toBeFocused();
      await expect(menu.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
      await expect(menu.getByRole("button", { name: "Sign out" })).toBeVisible();
      const width = await page.evaluate(() => {
        const root = (globalThis as unknown as { document: { documentElement: { scrollWidth: number } } }).document;
        return root.documentElement.scrollWidth;
      });
      expect(width).toBeLessThanOrEqual(320);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(toggle).toBeFocused();
    });
  });

  // P2.13e: on desktop the header's menu button opens the drawer and its X closes it, with no script.
  test("navigation_drawer_without_js", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator("#core-menu");
    await page.locator('header button[popovertarget="core-menu"]').click();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("link", { name: "Privacy" })).toBeVisible();
    await panel.getByRole("button", { name: "Close menu" }).click();
    await expect(panel).toBeHidden();
  });

  // P2.05s: "No thanks" on the signed-out box is a form, so it works with no script, and it goes home.
  test("signed_out_no_thanks_posts_home", async ({ page }) => {
    await page.goto("/signed-out");
    const posted = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/signed-out"));
    await page.getByRole("button", { name: "No thanks" }).click();
    expect((await posted).status()).toBe(303);
    await expect(page).toHaveURL(/\/$/);
  });

  // P1.22's test, its theme half (the French half is P1.22b's): the footer form on an app page sets the theme.
  test("prefs_forms_work_without_js", async ({ page }) => {
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
    expect(await page.locator("html").getAttribute("data-theme")).toBe("light");
    await expect(form.getByLabel("Light")).toBeChecked();
  });

  // P2.13e: the account menu's picker is three buttons that each post their choice, so it works with no script.
  test("account_menu_theme_picker_without_js", async ({ page }) => {
    await openPage(page, SETTINGS);
    await page.locator('header button[popovertarget="account-menu"]').click();
    const posted = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/prefs/theme"));
    await page.locator("#account-menu").getByRole("button", { name: "Dark" }).click();
    expect((await posted).status()).toBe(303);
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.locator('header button[popovertarget="account-menu"]').click();
    await expect(page.locator("#account-menu").getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

// axe-core's injection uses page.evaluate, which does not finish when JavaScript is disabled. Refusing script requests
// keeps the server markup and lets axe run.
test.describe("server markup", () => {
  for (const fixture of ALL_PAGES) {
    test(`nojs_axe ${fixture.path}`, async ({ page }) => {
      expect(expiredAllowances(AXE_ALLOWANCE, today)).toEqual([]);
      await page.route("**/*", (route) => {
        if (route.request().resourceType() === "script") return route.abort();
        return route.continue();
      });
      const watched = watch(page);
      const response = await openPage(page, fixture);
      expect(response?.status()).toBe(200);
      await expect(page.locator("main")).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
      expect(unallowedViolations(results.violations, AXE_ALLOWANCE, today)).toEqual([]);
      const noise = await pageNoise(page, watched);
      expect(noise.csp).toEqual([]);
    });
  }
});

// The watcher's own check: a page that asks for a script is seen asking.
test("zero_js_detected", async ({ page }) => {
  const watched = watch(page);
  const signedOut = ALL_PAGES.find((entry) => entry.path === "/signed-out");
  if (signedOut === undefined) throw new Error("/signed-out is not in PAGES");
  expect((await openPage(page, signedOut))?.status()).toBe(200);
  expect(watched.scripts.length).toBeGreaterThan(0);
});
