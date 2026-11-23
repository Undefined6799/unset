// Every page with JavaScript off (P1.26; on the SvelteKit shell since P1.20k): it renders, its links and plain forms
// work, and the menu drawer is a native popover. axe runs on the server markup with scripts refused.
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { AXE_ALLOWANCE, expiredAllowances, unallowedViolations } from "./allow.ts";
import { AXE_TAGS, openPage, pageNoise, watch } from "./observe.ts";
import { ALL_PAGES, type PageFixture } from "./pages.ts";
import { phone } from "./phone.ts";

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

  test.describe("phone search", () => {
    test.use(phone({ width: 375, height: 800 }));

    // Staging walkthrough 2026-11-19: on a phone the search icon was disabled and said nothing to a finger; it opens a
    // panel that says search is coming, as Messages and Notifications do, with no script.
    test("the_phone_search_button_says_search_is_coming", async ({ page }) => {
      await page.goto("/");
      await page.locator('header button[popovertarget="search-menu"]').tap();
      await expect(page.locator("#search-menu")).toBeVisible();
      await expect(page.locator("#search-menu")).toContainText("Search is coming soon.");
    });
  });

  // Outside audit of staging, 2026-11-19: after an empty submit, a real date's confirm view still said "That date is
  // not a real calendar date", because the form posted back to the URL that carried the error.
  test("the_age_step_drops_an_old_error_once_the_date_is_real", async ({ page }) => {
    const age = ALL_PAGES.find((fixture) => fixture.path === "/welcome/age");
    expect(age).toBeDefined();
    await openPage(page, age as PageFixture);
    const error = page.getByText("That date is not a real calendar date.");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(error).toBeVisible();
    await page.getByLabel("Day").fill("1");
    await page.getByLabel("Month").fill("2");
    await page.getByLabel("Year").fill("1990");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Is this date right?" })).toBeVisible();
    await expect(error).toHaveCount(0);
  });

  // P2.12b: the changed privacy notice banner's Dismiss is a plain form; once posted, the banner is gone for good.
  test("privacy_notice_dismiss_without_js", async ({ page }) => {
    const fixture: PageFixture = {
      path: "/test-routes/members",
      route: "/test-routes/members",
      group: "app",
      expectJs: true,
      member: "notice",
    };
    await openPage(page, fixture);
    const banner = page.locator("main").getByText("Privacy notice updated");
    await expect(banner).toBeVisible();
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page).toHaveURL(/\/test-routes\/members$/);
    await expect(banner).toBeHidden();
    await page.reload();
    await expect(banner).toBeHidden();
  });

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
    await page.locator('header a[href="/login?next=%2Flegal%2Fterms"]').click();
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
    test.use(phone({ width: 320, height: 800 }));

    test("navigation_popover_without_js", async ({ page }) => {
      await page.goto("/");
      const toggle = page.locator('header button[popovertarget="core-menu"]');
      const panel = page.locator("#core-menu");
      await expect(panel).toBeHidden();
      await toggle.press("Enter");
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("button", { name: "Close More on unset.sh" })).toBeFocused();
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

  // P2.13e, P1.20k: on desktop each header button opens its panel and the panel's X closes it, with no script. The
  // legal links live in the footer, not the menu (Alex, 2026-11-18 05:02Z).
  test("header_panels_without_js", async ({ page }) => {
    await page.goto("/");
    for (const [id, title] of [
      ["core-menu", "More on unset.sh"],
      ["create-menu", "Create"],
      ["messages-menu", "Messages"],
    ] as const) {
      const panel = page.locator(`#${id}`);
      await page.locator(`header button[popovertarget="${id}"]`).click();
      await expect(panel, id).toBeVisible();
      await expect(panel.getByRole("heading", { name: title }), id).toBeVisible();
      await panel.getByRole("button", { name: `Close ${title}` }).click();
      await expect(panel, id).toBeHidden();
    }
    await expect(page.locator("#core-menu").getByRole("link")).toHaveCount(0);
    // ADR 0108 point 3: a page with no script cannot mark what a panel showed, so the bell is a link to the page.
    await expect(page.locator("header").getByRole("link", { name: "Notifications", exact: true })).toHaveAttribute(
      "href",
      "/notifications",
    );
    await expect(page.locator("#notifications-menu")).toHaveCount(0);
    await expect(page.locator("footer").getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/legal/privacy",
    );
  });

  // Alex, 2026-11-18 12:59Z: the footer sits below the first screen, seen only on scrolling, on short pages too. Home
  // draws the core shell and the signed-out page the site shell.
  for (const path of ["/", "/signed-out"]) {
    test(`the_footer_starts_below_the_first_screen ${path}`, async ({ page }) => {
      await page.goto(path);
      const top = await page.locator("footer").evaluate((footer) => footer.getBoundingClientRect().top);
      expect(top).toBeGreaterThanOrEqual(page.viewportSize()?.height ?? Number.POSITIVE_INFINITY);
      await page.locator("footer").scrollIntoViewIfNeeded();
      await expect(page.locator("footer")).toBeInViewport();
    });
  }

  // Clean tabs (Alex, 2026-11-18): features not built yet are shown greyed and disabled, never as links; the menus
  // open, but their rows for unbuilt features are disabled, and only Add a profile card is a link.
  test("coming_soon_items_are_disabled_not_links", async ({ page }) => {
    await page.goto("/");
    const main = page.getByRole("navigation", { name: "Main" });
    await expect(main.getByRole("link")).toHaveCount(1);
    await expect(main).toContainText("Community, coming soon");
    await expect(main).toContainText("Explore, coming soon");
    await expect(
      page.locator("header").getByRole("button", { name: "Search unset.sh, coming soon" }).first(),
    ).toBeDisabled();
    const soon = {
      "core-menu": ["Saved", "Your communities", "Help"],
      "create-menu": ["New post", "Share a link", "Ask a question"],
      "messages-menu": ["Open inbox"],
    };
    for (const [id, names] of Object.entries(soon)) {
      for (const name of names)
        await expect(
          page.locator(`#${id}`).getByRole("button", { name: `${name}, coming soon`, includeHidden: true }),
          name,
        ).toBeDisabled();
    }
    const create = page.locator("#create-menu");
    await expect(create.getByRole("link", { includeHidden: true })).toHaveCount(1);
    await expect(create.getByRole("link", { name: "Add a profile card", includeHidden: true })).toHaveAttribute(
      "href",
      "/me",
    );
    // P2.27, ADR 0108: on a page with no script the bell is a link to the page, which asks a visitor to sign in.
    await expect(page.locator("#notifications-menu")).toHaveCount(0);
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
