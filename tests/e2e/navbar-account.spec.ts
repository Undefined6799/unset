// Book P1.22m (ADR 0116 points 8 and 9): with script, the account menu is the stock shadcn-svelte Dropdown Menu over
// Bits UI 2.20.6, for its keyboard handling, focus return and roles. The server still draws the native popover, which
// is the menu with no script (nojs.spec.ts account_menu_fits_without_js, cards-nojs.spec.ts) and until the client is
// ready; a press in that time is carried over, never lost. What the keys do is the library's
// (node_modules/bits-ui/dist/bits/menu/menu.svelte.js and menu/utils.js); these tests hold that our rows get it.
import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { AXE_ALLOWANCE, unallowedViolations } from "./allow.ts";
import { accountButton, accountMenu, openAccountMenu, settled } from "./navbar.ts";
import { AXE_TAGS, addPageCookies, openPage, pageNoise, undersizedTargets, watch } from "./observe.ts";
import { ACCOUNT, type PageFixture, TEST_ORIGIN } from "./pages.ts";
import { phone } from "./phone.ts";

const OWN_PAGE: PageFixture = {
  path: `/${ACCOUNT.did}`,
  route: "/[did=did]",
  group: "app",
  expectJs: true,
  member: "account",
};
const SETTINGS: PageFixture = {
  path: "/settings/profile",
  route: "/settings/profile",
  group: "app",
  expectJs: true,
  member: "account",
};

const HOME: PageFixture = { path: "/", route: "/", group: "public", expectJs: true, member: "account" };

const today = new Date().toISOString().slice(0, 10);

/** The background colour an element is drawn with. */
const background = (locator: Locator): Promise<string> =>
  locator.evaluate(
    (element) =>
      (globalThis as unknown as { getComputedStyle: (of: unknown) => { backgroundColor: string } }).getComputedStyle(
        element,
      ).backgroundColor,
  );

async function ready(page: Page, fixture: PageFixture): Promise<void> {
  expect((await openPage(page, fixture))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  // The client took the server's button over: the stock trigger says what it opens.
  await expect(accountButton(page)).toHaveAttribute("aria-haspopup", "menu");
}

test("the_keyboard_walks_the_account_menu_and_escape_gives_focus_back", async ({ page }) => {
  const watched = watch(page);
  await ready(page, SETTINGS);
  const button = accountButton(page);
  const menu = accountMenu(page);
  await expect(menu).toHaveCount(0);

  await button.press("Enter");
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  // Every row is a menu item, in the order drawn; the page the member is on is marked.
  await expect(menu.getByRole("menuitem")).toHaveText(["Your profile", "Settings", "Sign out"]);
  await expect(menu.getByRole("menuitemradio")).toHaveText(["Dark", "System", "Light"]);
  await expect(menu.getByRole("menuitem", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  // Opened by a key, focus is on the first row; the arrows, Home and End move it, and a letter jumps to a row.
  await expect(menu.getByRole("menuitem", { name: "Your profile" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Settings" })).toBeFocused();
  // The row the keys are on is drawn apart from the menu's own surface, a link row and a theme row alike (the
  // theme's accent colour is the surface's, so the library's own mark would not show).
  expect(await background(menu.getByRole("menuitem", { name: "Settings" }))).not.toBe(await background(menu));
  expect(await background(menu.getByRole("menuitem", { name: "Your profile" }))).not.toBe(
    await background(menu.getByRole("menuitem", { name: "Settings" })),
  );
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemradio", { name: "Dark" })).toBeFocused();
  expect(await background(menu.getByRole("menuitemradio", { name: "Dark" }))).not.toBe(await background(menu));
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(menu.getByRole("menuitem", { name: "Your profile" })).toBeFocused();
  await page.keyboard.press("d");
  await expect(menu.getByRole("menuitemradio", { name: "Dark" })).toBeFocused();

  // Nothing the open menu did broke the page's policy: its place on screen is set through the style object.
  const noise = await pageNoise(page, watched);
  expect([...noise.csp, ...noise.consoleErrors, ...watched.pageErrors]).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "false");
});

test("enter_on_a_row_follows_its_link_in_place_and_the_menu_is_closed", async ({ page }) => {
  await ready(page, OWN_PAGE);
  let documents = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest()) documents += 1;
  });
  await accountButton(page).press("Enter");
  const settings = accountMenu(page).getByRole("menuitem", { name: "Settings" });
  await expect(settings).toHaveAttribute("href", "/settings/profile");
  await page.keyboard.press("ArrowDown");
  await expect(settings).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${TEST_ORIGIN}/settings/profile`);
  await expect(page.locator("main h1").first()).toContainText("Profile");
  await expect(accountMenu(page)).toHaveCount(0);
  // The client followed the link: no new document was asked for.
  expect(documents).toBe(0);
});

test("a_press_outside_closes_the_account_menu", async ({ page }) => {
  await ready(page, SETTINGS);
  const menu = await openAccountMenu(page);
  // By the mouse at a point of the page, not through a locator: while a menu is open the library takes the pointer
  // off the page behind it (bits-ui dismissible layer), so the first press outside only closes the menu.
  const box = await page.locator("main h1").first().boundingBox();
  await page.mouse.click((box?.x ?? 0) + 5, (box?.y ?? 0) + 5);
  await expect(menu).toHaveCount(0);
  await expect(page).toHaveURL(`${TEST_ORIGIN}/settings/profile`);
});

// Space on a theme row saves it in the background and applies it in place, and the menu stays open (Alex, 2026-10-23
// 02:15Z). navigation.spec.ts holds the same by the pointer and across a reload.
test("space_on_a_theme_row_applies_it_and_the_menu_stays_open", async ({ page }) => {
  await ready(page, SETTINGS);
  await accountButton(page).press("Enter");
  const menu = accountMenu(page);
  const light = menu.getByRole("menuitemradio", { name: "Light" });
  await expect(light).toHaveAttribute("aria-checked", "false");
  // By the arrows, not by its letter: while a typed letter is still being matched, Space is part of the search.
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowUp");
  await expect(light).toBeFocused();
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/prefs/theme"));
  await page.keyboard.press("Space");
  expect((await saved).request().postData()).toContain("theme=light");
  await expect(light).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(menu).toBeVisible();
  const system = menu.getByRole("menuitemradio", { name: "System" });
  await system.click();
  await expect(system).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
});

// Sign out is the same plain form as with no script: a navigation, not a fetch. The browser is offline when the row
// is chosen, so the session every other test uses stays (Playwright BrowserContext.setOffline; nothing is intercepted).
test("sign_out_in_the_menu_posts_the_sign_out_form", async ({ page, context }) => {
  await ready(page, SETTINGS);
  const menu = await openAccountMenu(page);
  await context.setOffline(true);
  const failed = page.waitForEvent("requestfailed", (request) => request.url().endsWith("/logout"));
  await menu.getByRole("menuitem", { name: "Sign out" }).click();
  const request = await failed;
  expect(request.method()).toBe("POST");
  expect(request.isNavigationRequest()).toBe(true);
});

test.describe("before the client is ready", () => {
  /** Holds every script file back until `release` is called, so the page is the server's until then. */
  async function holdScripts(page: Page): Promise<() => void> {
    const held = Promise.withResolvers<void>();
    await page.route("**/_app/**/*.js", async (route) => {
      await held.promise;
      await route.continue();
    });
    return held.resolve;
  }

  /**
   * Opens the settings page without waiting for its load event: WebKit holds that event back for the script files
   * the page preloads, which these tests are holding. The checks that follow wait for the server's markup themselves.
   */
  async function openHeld(page: Page): Promise<number | undefined> {
    await addPageCookies(page.context(), SETTINGS);
    return (await page.goto(`${TEST_ORIGIN}${SETTINGS.path}`, { waitUntil: "commit" }))?.status();
  }

  test("a_press_on_the_native_menu_is_carried_over_to_the_stock_one", async ({ page }) => {
    const watched = watch(page);
    const release = await holdScripts(page);
    expect(await openHeld(page)).toBe(200);
    const button = accountButton(page);
    await expect(button).toHaveAttribute("popovertarget", "account-menu");
    await button.click();
    // The server's menu: a native popover whose rows are plain links and a plain form.
    const native = page.locator("section#account-menu");
    await expect(native.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(native.getByRole("button", { name: "Sign out" })).toBeVisible();

    release();
    // The client is ready: the open menu is now the stock one, still open, and Escape gives focus back to its button.
    await expect(accountMenu(page)).toBeVisible();
    await expect(native).toHaveCount(0);
    await expect(accountMenu(page).getByRole("menuitem", { name: "Settings" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(accountMenu(page)).toHaveCount(0);
    await expect(accountButton(page)).toBeFocused();
    expect(watched.pageErrors).toEqual([]);
  });

  test("focus_on_the_button_stays_on_it_when_the_client_takes_over", async ({ page }) => {
    const release = await holdScripts(page);
    expect(await openHeld(page)).toBe(200);
    await accountButton(page).focus();
    await expect(accountButton(page)).toBeFocused();
    release();
    await expect(accountButton(page)).toHaveAttribute("aria-haspopup", "menu");
    await expect(accountButton(page)).toBeFocused();
    await expect(accountMenu(page)).toHaveCount(0);
  });

  // The client runs, but the stock menu's file does not arrive (a tab older than the deploy): the native menu is the
  // menu, and a link in it is followed in place. It is closed after that navigation, as every header panel is
  // (Codex review of #2017).
  test("the_native_menu_is_closed_after_a_navigation_when_the_stock_file_is_refused", async ({ page }) => {
    await page.route("**/_app/**/*.js", async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      // The stock menu's own pieces carry this name (ui/dropdown-menu); nothing the home page starts with does.
      if (body.includes("dropdown-menu-content")) {
        await route.fulfill({ status: 404, contentType: "text/plain", body: "" });
      } else await route.fulfill({ response, body });
    });
    expect((await openPage(page, HOME))?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    let documents = 0;
    page.on("request", (request) => {
      if (request.isNavigationRequest()) documents += 1;
    });
    const button = accountButton(page);
    await expect(button).toHaveAttribute("popovertarget", "account-menu");
    await button.click();
    const native = page.locator("section#account-menu");
    await native.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(`${TEST_ORIGIN}${SETTINGS.path}`);
    // The client followed the link: the document is the same one, and its native menu is closed.
    expect(documents).toBe(0);
    await expect(native).toBeHidden();
    await expect(accountButton(page)).toHaveAttribute("popovertarget", "account-menu");
  });

  // With its script files refused the menu stays the server's, and works (csp.spec.ts app_page_works_without_its_script).
  test("the_native_menu_stays_when_the_script_files_are_refused", async ({ page }) => {
    await page.route("**/_app/**/*.js", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "" }));
    expect((await openPage(page, SETTINGS))?.status()).toBe(200);
    await accountButton(page).click();
    const native = page.locator("section#account-menu");
    await expect(native.getByRole("link", { name: "Your profile" })).toHaveAttribute("href", `/${ACCOUNT.did}`);
    await expect(native.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(accountMenu(page)).toHaveCount(0);
  });
});

for (const scheme of ["light", "dark"] as const) {
  test(`the_open_account_menu_passes_axe_${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await ready(page, SETTINGS);
    await settled(await openAccountMenu(page));
    const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
    expect(unallowedViolations(results.violations, AXE_ALLOWANCE, today)).toEqual([]);
  });
}

test.describe("phone", () => {
  test.use(phone({ width: 320, height: 700 }));

  test("the_account_menu_fits_a_phone_and_its_rows_are_touch_sized", async ({ page }) => {
    await ready(page, SETTINGS);
    await accountButton(page).tap();
    const menu = accountMenu(page);
    await expect(menu).toBeVisible();
    // Each row is a 44px target on touch, as the header's own controls are (Clean tabs handoff). Polled, because the
    // menu opens with a short zoom and a box read during it is smaller.
    for (const row of await menu.locator('[role="menuitem"], [role="menuitemradio"]').all()) {
      await expect.poll(async () => (await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
    expect(await page.evaluate(undersizedTargets)).toEqual([]);
    await menu.getByRole("menuitem", { name: "Your profile" }).tap();
    await expect(page).toHaveURL(`${TEST_ORIGIN}/${ACCOUNT.did}`);
    await expect(accountMenu(page)).toHaveCount(0);
  });
});
