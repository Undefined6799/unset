// Book P1.22m part 2 (ADR 0116 points 8 and 9): with script, the three-line menu and the Create menu are the stock
// shadcn-svelte Dropdown Menu over Bits UI 2.20.6, as the account menu is (navbar-account.spec.ts). The server still
// draws each as a native popover: the menu with no script (nojs.spec.ts) and until the client is ready, and a press
// in that time is carried over. A row whose feature does not exist yet is a disabled menu item that says so; the
// library skips it (node_modules/bits-ui/dist/bits/menu/menu.svelte.js, the candidates leave out [data-disabled]).
// On a phone Create is a row of More actions, which still opens the native panel until that menu's own part.
import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { AXE_ALLOWANCE, unallowedViolations } from "./allow.ts";
import { CREATE_MENU, type HeaderMenu, MAIN_MENU, menuButton, openMenu, settled, stockMenu } from "./navbar.ts";
import { AXE_TAGS, addPageCookies, openPage, pageNoise, undersizedTargets, watch } from "./observe.ts";
import { ACCOUNT, PAGES, type PageFixture, TEST_ORIGIN } from "./pages.ts";
import { phone } from "./phone.ts";

const SETTINGS: PageFixture = {
  path: "/settings/profile",
  route: "/settings/profile",
  group: "app",
  expectJs: true,
  member: "account",
};
const HOME = PAGES.find((entry) => entry.path === "/");
if (HOME === undefined) throw new Error("the home page is not among the pages under test");

const today = new Date().toISOString().slice(0, 10);
const SOON = {
  [MAIN_MENU.native]: ["Saved", "Your communities", "Help"],
  [CREATE_MENU.native]: ["New post", "Share a link", "Ask a question"],
} as const;

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
  await expect(menuButton(page, MAIN_MENU)).toHaveAttribute("aria-haspopup", "menu");
}

/** The rows that say their feature is coming: each a menu item, named in one string, and disabled. */
async function expectSoonRows(menu: Locator, which: HeaderMenu): Promise<void> {
  for (const label of SOON[which.native] ?? []) {
    const row = menu.getByRole("menuitem", { name: `${label}, coming soon`, exact: true });
    await expect(row).toHaveAttribute("aria-disabled", "true");
  }
  await expect(menu.getByRole("menuitem", { disabled: true })).toHaveCount(3);
}

test("the_three_line_menu_is_a_menu_and_escape_gives_focus_back", async ({ page }) => {
  const watched = watch(page);
  await ready(page, SETTINGS);
  const button = menuButton(page, MAIN_MENU);
  const menu = stockMenu(page, MAIN_MENU);
  await expect(menu).toHaveCount(0);

  await button.press("Enter");
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  // Nothing in it runs yet: three rows that say so, none a link, and the keys land on none of them.
  await expectSoonRows(menu, MAIN_MENU);
  await expect(menu.getByRole("menuitem")).toHaveCount(3);
  await expect(menu.getByRole("link")).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expect(menu.locator("[data-highlighted]")).toHaveCount(0);

  const noise = await pageNoise(page, watched);
  expect([...noise.csp, ...noise.consoleErrors, ...watched.pageErrors]).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "false");
});

test("the_create_menu_opens_on_its_working_row_and_enter_follows_it_in_place", async ({ page }) => {
  const watched = watch(page);
  await ready(page, SETTINGS);
  let documents = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest()) documents += 1;
  });
  const button = menuButton(page, CREATE_MENU);
  const menu = stockMenu(page, CREATE_MENU);

  await button.press("Enter");
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expectSoonRows(menu, CREATE_MENU);
  await expect(menu.getByRole("menuitem")).toHaveCount(4);
  // Opened by a key, focus is on the one row that runs today, and the arrows stay on it: the other rows are skipped.
  const add = menu.getByRole("menuitem", { name: "Add a profile card" });
  await expect(add).toBeFocused();
  await expect(add).toHaveAttribute("href", `/${ACCOUNT.did}?add#card-editor`);
  await page.keyboard.press("ArrowUp");
  await expect(add).toBeFocused();
  await page.keyboard.press("Home");
  await expect(add).toBeFocused();
  // The row the keys are on is drawn apart from the menu's own surface (navbar-account.spec.ts says why).
  expect(await background(add)).not.toBe(await background(menu));

  const noise = await pageNoise(page, watched);
  expect([...noise.csp, ...noise.consoleErrors, ...watched.pageErrors]).toEqual([]);

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${TEST_ORIGIN}/${ACCOUNT.did}?add#card-editor`);
  await expect(page.locator("#card-editor")).toBeInViewport();
  await expect(menu).toHaveCount(0);
  // The client followed the link: no new document was asked for.
  expect(documents).toBe(0);
});

for (const which of [MAIN_MENU, CREATE_MENU]) {
  test(`escape_and_a_press_outside_close_${which.native}`, async ({ page }) => {
    await ready(page, SETTINGS);
    const menu = await openMenu(page, which);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(menuButton(page, which)).toBeFocused();

    await openMenu(page, which);
    // By the mouse at a point of the page, not through a locator (navbar-account.spec.ts says why).
    const box = await page.locator("main h1").first().boundingBox();
    await page.mouse.click((box?.x ?? 0) + 5, (box?.y ?? 0) + 5);
    await expect(menu).toHaveCount(0);
    await expect(page).toHaveURL(`${TEST_ORIGIN}/settings/profile`);
  });
}

// A visitor has the same header on the pages that show it, so the same menus: Add a card leads to sign-in by /me.
test("a_visitor_gets_the_stock_menus_on_the_home_page", async ({ page }) => {
  const watched = watch(page);
  expect((await openPage(page, HOME))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await expect(menuButton(page, MAIN_MENU)).toHaveAttribute("aria-haspopup", "menu");
  await expectSoonRows(await openMenu(page, MAIN_MENU), MAIN_MENU);
  await page.keyboard.press("Escape");
  const create = await openMenu(page, CREATE_MENU);
  await expect(create.getByRole("menuitem", { name: "Add a profile card" })).toHaveAttribute("href", "/me");
  const noise = await pageNoise(page, watched);
  expect([...noise.csp, ...noise.consoleErrors, ...watched.pageErrors]).toEqual([]);
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

  /** Opens the settings page without waiting for its load event, which WebKit holds back for the held files. */
  async function openHeld(page: Page): Promise<number | undefined> {
    await addPageCookies(page.context(), SETTINGS);
    return (await page.goto(`${TEST_ORIGIN}${SETTINGS.path}`, { waitUntil: "commit" }))?.status();
  }

  for (const which of [MAIN_MENU, CREATE_MENU]) {
    test(`a_press_on_native_${which.native}_is_carried_over_to_the_stock_one`, async ({ page }) => {
      const watched = watch(page);
      const release = await holdScripts(page);
      expect(await openHeld(page)).toBe(200);
      const button = menuButton(page, which);
      await expect(button).toHaveAttribute("popovertarget", which.native);
      await button.click();
      // The server's menu: a native popover with a title and a close button.
      const native = page.locator(`section#${which.native}`);
      await expect(native.getByRole("heading", { name: which.menu })).toBeVisible();

      release();
      // The client is ready: the open menu is now the stock one, the native one is not shown, and Escape gives focus
      // back to the stock button.
      await expect(stockMenu(page, which)).toBeVisible();
      await expect(native).toBeHidden();
      await page.keyboard.press("Escape");
      await expect(stockMenu(page, which)).toHaveCount(0);
      await expect(menuButton(page, which)).toBeFocused();
      expect(watched.pageErrors).toEqual([]);
    });
  }

  test("focus_on_the_menu_button_stays_on_it_when_the_client_takes_over", async ({ page }) => {
    const release = await holdScripts(page);
    expect(await openHeld(page)).toBe(200);
    const button = menuButton(page, MAIN_MENU);
    await button.focus();
    await expect(button).toBeFocused();
    release();
    await expect(button).toHaveAttribute("aria-haspopup", "menu");
    await expect(button).toBeFocused();
    await expect(stockMenu(page, MAIN_MENU)).toHaveCount(0);
  });

  // With its script files refused each menu stays the server's, and works.
  test("the_native_menus_stay_when_the_script_files_are_refused", async ({ page }) => {
    await page.route("**/_app/**/*.js", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "" }));
    expect((await openPage(page, SETTINGS))?.status()).toBe(200);
    await menuButton(page, CREATE_MENU).click();
    const native = page.locator(`section#${CREATE_MENU.native}`);
    await expect(native.getByRole("link", { name: "Add a profile card" })).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(0);
  });
});

for (const scheme of ["light", "dark"] as const) {
  for (const which of [MAIN_MENU, CREATE_MENU]) {
    test(`open_${which.native}_passes_axe_${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await ready(page, SETTINGS);
      await settled(await openMenu(page, which));
      const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
      expect(unallowedViolations(results.violations, AXE_ALLOWANCE, today)).toEqual([]);
    });
  }
}

test.describe("phone", () => {
  test.use(phone({ width: 320, height: 700 }));

  test("the_three_line_menu_fits_a_phone", async ({ page }) => {
    await ready(page, SETTINGS);
    await menuButton(page, MAIN_MENU).tap();
    const menu = stockMenu(page, MAIN_MENU);
    await expect(menu).toBeVisible();
    await settled(menu);
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
    expect(await page.evaluate(undersizedTargets)).toEqual([]);
  });

  // Create is a row of More actions on a phone, and that menu is still the native one: its Create row opens the native
  // Create panel after the client is ready too (navigation.spec.ts holds Escape and focus there).
  test("create_from_more_actions_still_opens_the_native_panel", async ({ page }) => {
    await ready(page, SETTINGS);
    await page
      .locator("header")
      .getByRole("button", { name: /^More actions/ })
      .tap();
    await page.locator("#actions-menu").getByRole("button", { name: "Create", exact: true }).tap();
    const native = page.locator(`section#${CREATE_MENU.native}`);
    await expect(native.getByRole("link", { name: "Add a profile card" })).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(0);
  });
});
