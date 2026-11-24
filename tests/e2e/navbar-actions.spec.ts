// Book P1.22m part 4 (ADR 0116 points 8 and 9): under 640px the header has no room for Create, Messages and the bell,
// so More actions holds them. With script it is the stock shadcn-svelte Dropdown Menu over Bits UI 2.20.6: Create's
// rows as a group, then a row each for Messages and Notifications. A row closes the menu and opens its panel, the
// same stock Popover the wide header has (navbar-panels.spec.ts), under More actions' button, and closing the panel
// gives focus back to that button. The server still draws More actions as a native popover whose rows open the
// native panels, and the bell's row as a link to its page; a press before the client is ready is carried over.
import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { AXE_ALLOWANCE, unallowedViolations } from "./allow.ts";
import {
  ACTIONS_MENU,
  actionsRow,
  BELL_PANEL,
  CREATE_MENU,
  MESSAGES_PANEL,
  menuButton,
  openMenu,
  openPanel,
  settled,
  stockMenu,
  stockPanel,
} from "./navbar.ts";
import { AXE_TAGS, addPageCookies, openPage, pageNoise, undersizedTargets, watch } from "./observe.ts";
import { BELL_SIZE, PAGES, type PageFixture, TEST_ORIGIN } from "./pages.ts";
import { phone } from "./phone.ts";

const WIDTH = 320;
test.use(phone({ width: WIDTH, height: 700 }));

const SETTINGS: PageFixture = {
  path: "/settings/profile",
  route: "/settings/profile",
  group: "app",
  expectJs: true,
  member: "account",
};
// The "bell" member has BELL_SIZE entries nobody has seen (bell-panel.spec.ts says why they must stay unseen).
const BELL_HOME: PageFixture = { path: "/", route: "/", group: "public", expectJs: true, member: "bell" };
const HOME = PAGES.find((entry) => entry.path === "/");
if (HOME === undefined) throw new Error("the home page is not among the pages under test");

const today = new Date().toISOString().slice(0, 10);

async function ready(page: Page, fixture: PageFixture): Promise<void> {
  expect((await openPage(page, fixture))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  // The client took the server's button over: the stock trigger says what it opens.
  await expect(menuButton(page, ACTIONS_MENU)).toHaveAttribute("aria-haspopup", "menu");
}

test("more_actions_is_a_menu_of_create_s_rows_then_messages_and_notifications", async ({ page }) => {
  const watched = watch(page);
  await ready(page, SETTINGS);
  const button = menuButton(page, ACTIONS_MENU);
  const menu = stockMenu(page, ACTIONS_MENU);
  await expect(menu).toHaveCount(0);

  await button.press("Enter");
  await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  // Create's rows are a group named Create: three whose feature is coming, then the one that runs today.
  const create = menu.getByRole("group", { name: "Create", exact: true });
  await expect(create.getByRole("menuitem", { disabled: true })).toHaveCount(3);
  for (const label of ["New post", "Share a link", "Ask a question"]) {
    await expect(create.getByRole("menuitem", { name: `${label}, coming soon`, exact: true })).toBeVisible();
  }
  const addCard = create.getByRole("menuitem", { name: "Add a profile card", exact: true });
  await expect(addCard).toHaveAttribute("href", /\?add#/);
  await expect(menu.getByRole("menuitem")).toHaveCount(6);

  // The keys skip the rows that are coming: focus opens on the first row that runs, then Messages, then the bell.
  await expect(addCard).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(actionsRow(menu, "Messages")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(actionsRow(menu, "Notifications")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(addCard).toBeFocused();

  const noise = await pageNoise(page, watched);
  expect([...noise.csp, ...noise.consoleErrors, ...watched.pageErrors]).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();
  // No native twin is left in the document once the client is ready.
  for (const id of [ACTIONS_MENU.native, CREATE_MENU.native, MESSAGES_PANEL.native, BELL_PANEL.native]) {
    await expect(page.locator(`section#${id}`)).toHaveCount(0);
  }
});

test("a_row_opens_its_panel_under_more_actions_by_the_keys", async ({ page }) => {
  const watched = watch(page);
  await ready(page, SETTINGS);
  const button = menuButton(page, ACTIONS_MENU);
  await button.press("Enter");
  const menu = stockMenu(page, ACTIONS_MENU);
  await expect(menu).toBeVisible();
  await actionsRow(menu, "Messages").press("Enter");

  const panel = stockPanel(page, MESSAGES_PANEL);
  await expect(panel).toBeVisible();
  await expect(menu).toHaveCount(0);
  // Nothing in the panel runs yet, so focus is on its Close button and stays inside.
  const close = panel.getByRole("button", { name: "Close Messages" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  // The panel is on screen, below the button that opened the menu.
  await settled(panel);
  const box = await panel.boundingBox();
  const under = await button.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(WIDTH);
  expect(box?.y ?? 0).toBeGreaterThanOrEqual((under?.y ?? 0) + (under?.height ?? 0));
  expect(await page.evaluate(undersizedTargets)).toEqual([]);

  const noise = await pageNoise(page, watched);
  expect([...noise.csp, ...noise.consoleErrors, ...watched.pageErrors]).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();
  // Enter on the button opens More actions again, not the panel.
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await expect(panel).toHaveCount(0);
});

test("a_press_on_more_actions_closes_the_panel_and_opens_the_menu", async ({ page }) => {
  await ready(page, SETTINGS);
  await actionsRow(await openMenu(page, ACTIONS_MENU), "Messages").tap();
  const panel = stockPanel(page, MESSAGES_PANEL);
  await expect(panel).toBeVisible();
  await settled(panel);
  // The panel sits under More actions' button. A press on that button is a press outside the panel, and it opens
  // More actions as it always does.
  await menuButton(page, ACTIONS_MENU).tap();
  await expect(panel).toHaveCount(0);
  const menu = stockMenu(page, ACTIONS_MENU);
  await expect(menu).toBeVisible();

  // A press on the page closes a panel too.
  await actionsRow(menu, "Messages").tap();
  await expect(panel).toBeVisible();
  await settled(panel);
  await page.touchscreen.tap(20, 600);
  await expect(panel).toHaveCount(0);
});

test("add_a_profile_card_is_followed_in_place_from_more_actions", async ({ page }) => {
  await ready(page, SETTINGS);
  let documents = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest()) documents += 1;
  });
  const menu = await openMenu(page, ACTIONS_MENU);
  await menu.getByRole("menuitem", { name: "Add a profile card", exact: true }).tap();
  await expect(page).toHaveURL(/\?add#card-editor$/);
  await expect(stockMenu(page, ACTIONS_MENU)).toHaveCount(0);
  // The client followed the link: no new document was asked for.
  expect(documents).toBe(0);
});

// The bell's row carries the count, and opening its panel from More actions posts the mark, as the bell does on a
// wide screen. The browser is offline for the press, so nothing is stored (bell-panel.spec.ts).
test("the_bell_s_row_carries_the_count_and_its_panel_posts_the_mark", async ({ page, context }) => {
  await ready(page, BELL_HOME);
  const button = page.locator("header").getByRole("button", {
    name: `More actions, Notifications, ${BELL_SIZE} waiting`,
    exact: true,
  });
  await button.tap();
  const menu = stockMenu(page, ACTIONS_MENU);
  await expect(menu).toBeVisible();
  const row = menu.getByRole("menuitem", { name: `Notifications, ${BELL_SIZE} waiting`, exact: true });
  await expect(row).toBeVisible();

  await context.setOffline(true);
  const failed = page.waitForEvent("requestfailed", (request) => request.url().endsWith("/notifications?/seen"));
  await row.tap();
  expect((await failed).method()).toBe("POST");
  await expect(stockPanel(page, BELL_PANEL).locator('a[href^="/notifications?n="]')).toHaveCount(BELL_SIZE);
  await context.setOffline(false);
});

test("a_visitor_s_more_actions_has_the_same_rows_and_the_bell_says_to_sign_in", async ({ page }) => {
  expect((await openPage(page, HOME))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await expect(menuButton(page, ACTIONS_MENU)).toHaveAttribute("aria-haspopup", "menu");
  const menu = await openMenu(page, ACTIONS_MENU);
  await expect(menu.getByRole("menuitem", { name: "Add a profile card", exact: true })).toHaveAttribute("href", "/me");
  await actionsRow(menu, "Notifications").tap();
  await expect(stockPanel(page, BELL_PANEL)).toContainText("Sign in to see your notifications.");
});

// The header draws other buttons on the other side of 640px, so a control left open across that line loses the
// button it sits under (a phone turned on its side). The library then hides the control and does not always close
// it, and an open menu keeps the pointer off the page. So the control is closed: it is looked for here by its
// attribute, which a hidden one still has. navbar-panels.spec.ts holds the other direction.
test("widening_past_640px_closes_an_open_more_actions", async ({ page }) => {
  await ready(page, SETTINGS);
  await openMenu(page, ACTIONS_MENU);
  await page.setViewportSize({ width: 700, height: WIDTH });
  await expect(page.locator('[role="menu"]')).toHaveCount(0);
  await expect(menuButton(page, ACTIONS_MENU)).toBeHidden();
  // The page takes the next press.
  await openPanel(page, MESSAGES_PANEL);
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

  const nativeActions = (page: Page) => page.locator(`section#${ACTIONS_MENU.native}`);

  test("a_press_on_native_more_actions_is_carried_over_to_the_stock_menu", async ({ page }) => {
    const watched = watch(page);
    const release = await holdScripts(page);
    expect(await openHeld(page)).toBe(200);
    const button = menuButton(page, ACTIONS_MENU);
    await expect(button).toHaveAttribute("popovertarget", ACTIONS_MENU.native);
    await button.tap();
    await expect(nativeActions(page).getByRole("heading", { name: "More actions" })).toBeVisible();

    release();
    await expect(stockMenu(page, ACTIONS_MENU)).toBeVisible();
    await expect(nativeActions(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(stockMenu(page, ACTIONS_MENU)).toHaveCount(0);
    await expect(menuButton(page, ACTIONS_MENU)).toBeFocused();
    expect(watched.pageErrors).toEqual([]);
  });

  // The native Create panel opened from More actions sits on top of it; the stock More actions holds Create's rows.
  test("native_create_from_more_actions_is_carried_over_to_the_stock_menu", async ({ page }) => {
    const release = await holdScripts(page);
    expect(await openHeld(page)).toBe(200);
    await menuButton(page, ACTIONS_MENU).tap();
    await nativeActions(page).getByRole("button", { name: "Create", exact: true }).tap();
    await expect(page.locator(`section#${CREATE_MENU.native}`).getByRole("link")).toBeVisible();

    release();
    const menu = stockMenu(page, ACTIONS_MENU);
    await expect(menu.getByRole("menuitem", { name: "Add a profile card", exact: true })).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(menuButton(page, ACTIONS_MENU)).toBeFocused();
  });

  test("native_messages_from_more_actions_is_carried_over_to_the_stock_panel", async ({ page }) => {
    const watched = watch(page);
    const release = await holdScripts(page);
    expect(await openHeld(page)).toBe(200);
    await menuButton(page, ACTIONS_MENU).tap();
    await nativeActions(page).getByRole("button", { name: "Messages", exact: true }).tap();
    await expect(page.locator(`section#${MESSAGES_PANEL.native}`)).toContainText("Messages are coming soon.");

    release();
    // The open panel is the stock one, More actions is closed, and Escape gives focus to More actions' button.
    await expect(stockPanel(page, MESSAGES_PANEL)).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.locator(`section#${MESSAGES_PANEL.native}`)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(stockPanel(page, MESSAGES_PANEL)).toHaveCount(0);
    await expect(menuButton(page, ACTIONS_MENU)).toBeFocused();
    expect(watched.pageErrors).toEqual([]);
  });

  // Until the stock controls are in, the bell's row is the link to its page, as the bell is on a wide screen.
  test("native_more_actions_stays_and_works_when_the_script_files_are_refused", async ({ page }) => {
    await page.route("**/_app/**/*.js", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "" }));
    expect((await openPage(page, SETTINGS))?.status()).toBe(200);
    await menuButton(page, ACTIONS_MENU).tap();
    await expect(nativeActions(page).locator('a[href="/notifications"]')).toBeVisible();
    await nativeActions(page).getByRole("button", { name: "Messages", exact: true }).tap();
    await expect(page.locator(`section#${MESSAGES_PANEL.native}`)).toContainText("Messages are coming soon.");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

for (const scheme of ["light", "dark"] as const) {
  test(`open_more_actions_passes_axe_${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await ready(page, BELL_HOME);
    await menuButton(page, ACTIONS_MENU).tap();
    const menu = stockMenu(page, ACTIONS_MENU);
    await expect(menu).toBeVisible();
    await settled(menu);
    const box = await menu.boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(WIDTH);
    expect(await page.evaluate(undersizedTargets)).toEqual([]);
    const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
    expect(unallowedViolations(results.violations, AXE_ALLOWANCE, today)).toEqual([]);
  });
}
