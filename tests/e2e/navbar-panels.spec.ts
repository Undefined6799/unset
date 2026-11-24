// Book P1.22m part 3 (ADR 0116 points 8 and 9): with script, the header's panels (Messages, the bell's, and Search on
// a phone) are the stock shadcn-svelte Popover over Bits UI 2.20.6: a dialog named by its title that holds focus while
// it is open, closes on Escape, its Close button or a press outside, and gives focus back to its button
// (node_modules/bits-ui/dist/bits/popover/components/popover-content.svelte, trapFocus). The server still draws
// Messages and Search as native popovers and the bell as a link to its page (bell-panel.spec.ts); a press before the
// client is ready is carried over. On a phone Messages and the bell are rows of More actions, which opens the same
// panels under its own button (navbar-actions.spec.ts).
import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { AXE_ALLOWANCE, unallowedViolations } from "./allow.ts";
import {
  ACTIONS_MENU,
  actionsRow,
  BELL_PANEL,
  MAIN_MENU,
  MESSAGES_PANEL,
  menuButton,
  openMenu,
  openPanel,
  panelButton,
  SEARCH_PANEL,
  settled,
  stockPanel,
} from "./navbar.ts";
import { AXE_TAGS, addPageCookies, openPage, pageNoise, undersizedTargets, watch } from "./observe.ts";
import { type PageFixture, TEST_ORIGIN } from "./pages.ts";
import { phone } from "./phone.ts";

const SETTINGS: PageFixture = {
  path: "/settings/profile",
  route: "/settings/profile",
  group: "app",
  expectJs: true,
  member: "account",
};
// The "inbox" member's list is read already, so opening the bell posts nothing and other specs' counts stay.
const INBOX_HOME: PageFixture = { path: "/", route: "/", group: "public", expectJs: true, member: "inbox" };

const today = new Date().toISOString().slice(0, 10);

async function ready(page: Page, fixture: PageFixture): Promise<void> {
  expect((await openPage(page, fixture))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  // The client took the server's controls over: a stock trigger says what it opens.
  await expect(menuButton(page, MAIN_MENU)).toHaveAttribute("aria-haspopup", "menu");
}

test("the_messages_panel_is_a_dialog_that_holds_focus_and_gives_it_back", async ({ page }) => {
  const watched = watch(page);
  await ready(page, SETTINGS);
  const button = panelButton(page, MESSAGES_PANEL);
  const panel = stockPanel(page, MESSAGES_PANEL);
  await expect(panel).toHaveCount(0);
  await expect(button).toHaveAttribute("aria-haspopup", "dialog");

  await button.press("Enter");
  await expect(panel).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toContainText("Messages are coming soon.");
  // Nothing in it runs yet, so focus is on its Close button, and Tab stays inside the panel.
  const close = panel.getByRole("button", { name: "Close Messages" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();

  const noise = await pageNoise(page, watched);
  expect([...noise.csp, ...noise.consoleErrors, ...watched.pageErrors]).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute("aria-expanded", "false");
});

test("close_and_a_press_outside_close_the_messages_panel", async ({ page }) => {
  await ready(page, SETTINGS);
  const panel = await openPanel(page, MESSAGES_PANEL);
  await panel.getByRole("button", { name: "Close Messages" }).click();
  await expect(panel).toHaveCount(0);
  await expect(panelButton(page, MESSAGES_PANEL)).toBeFocused();

  await openPanel(page, MESSAGES_PANEL);
  const box = await page.locator("main h1").first().boundingBox();
  await page.mouse.click((box?.x ?? 0) + 5, (box?.y ?? 0) + 5);
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(`${TEST_ORIGIN}/settings/profile`);
});

// bell-panel.spec.ts holds what the bell's panel lists and that opening it posts the mark; here, that it is the dialog.
test("the_bell_s_panel_is_a_dialog_and_a_row_is_followed_in_place", async ({ page }) => {
  const watched = watch(page);
  await ready(page, INBOX_HOME);
  const bell = panelButton(page, BELL_PANEL);
  const panel = stockPanel(page, BELL_PANEL);
  await bell.press("Enter");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Close Notifications" })).toBeFocused();
  const noise = await pageNoise(page, watched);
  expect([...noise.csp, ...noise.consoleErrors, ...watched.pageErrors]).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(bell).toBeFocused();

  // The page's link is followed by the client, and the panel is closed once the page is in.
  let documents = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest()) documents += 1;
  });
  await bell.click();
  await panel.getByRole("link", { name: "View all notifications" }).click();
  await expect(page).toHaveURL(`${TEST_ORIGIN}/notifications`);
  await expect(panel).toHaveCount(0);
  expect(documents).toBe(0);
});

// The native panel scrolled inside a window too short for it (the browser's own rule for a popover). The stock one
// takes the height the library measured under its button (bits-ui 2.20.6
// dist/internal/floating-svelte/floating-utils.svelte.js, --bits-popover-content-available-height) and scrolls.
test("a_panel_taller_than_the_window_stays_inside_it_and_scrolls", async ({ page }) => {
  const SHORT = 220;
  await page.setViewportSize({ width: 1280, height: SHORT });
  await ready(page, INBOX_HOME);
  const panel = await openPanel(page, BELL_PANEL);
  await settled(panel);
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.y).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? SHORT)).toBeLessThanOrEqual(SHORT);
  // Its last row is reached by scrolling the panel.
  const viewAll = panel.getByRole("link", { name: "View all notifications" });
  await viewAll.scrollIntoViewIfNeeded();
  await expect(viewAll).toBeInViewport({ ratio: 1 });
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

// Under 640px the header does not draw a panel's own button, so a panel left open across that line loses the button
// it sits under (navbar-actions.spec.ts says what the library does then). It is closed, and looked for here by its
// attribute, which a hidden one still has.
test("narrowing_under_640px_closes_an_open_panel", async ({ page }) => {
  await ready(page, SETTINGS);
  await openPanel(page, MESSAGES_PANEL);
  await page.setViewportSize({ width: 500, height: 700 });
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  // The page takes the next press: More actions is drawn now, and opens.
  await openMenu(page, ACTIONS_MENU);
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

  /** Opens a page without waiting for its load event, which WebKit holds back for the held files. */
  async function openHeld(page: Page, fixture: PageFixture): Promise<number | undefined> {
    await addPageCookies(page.context(), fixture);
    return (await page.goto(`${TEST_ORIGIN}${fixture.path}`, { waitUntil: "commit" }))?.status();
  }

  test("a_press_on_the_native_messages_panel_is_carried_over_to_the_stock_one", async ({ page }) => {
    const watched = watch(page);
    const release = await holdScripts(page);
    expect(await openHeld(page, SETTINGS)).toBe(200);
    const button = panelButton(page, MESSAGES_PANEL);
    await expect(button).toHaveAttribute("popovertarget", MESSAGES_PANEL.native);
    await button.click();
    const native = page.locator(`section#${MESSAGES_PANEL.native}`);
    await expect(native.getByRole("heading", { name: "Messages" })).toBeVisible();

    release();
    // The client is ready: the open panel is now the stock one, the native one is not shown, and Escape gives focus
    // back to the stock button.
    await expect(stockPanel(page, MESSAGES_PANEL)).toBeVisible();
    await expect(native).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(stockPanel(page, MESSAGES_PANEL)).toHaveCount(0);
    await expect(panelButton(page, MESSAGES_PANEL)).toBeFocused();
    expect(watched.pageErrors).toEqual([]);
  });

  // Book P1.22g left this for here: the server's bell is a link, and when it becomes the panel's button, focus that
  // was on the link is on the button.
  test("focus_on_the_bell_s_link_is_on_the_bell_when_the_client_takes_over", async ({ page }) => {
    const release = await holdScripts(page);
    expect(await openHeld(page, INBOX_HOME)).toBe(200);
    const link = page.locator("header").getByRole("link", { name: /^Notifications/ });
    await link.focus();
    await expect(link).toBeFocused();
    release();
    await expect(panelButton(page, BELL_PANEL)).toBeFocused();
    await expect(link).toHaveCount(0);
    await expect(stockPanel(page, BELL_PANEL)).toHaveCount(0);
  });

  // With its script files refused the Messages panel stays the server's, and works; the bell stays the link
  // (bell-panel.spec.ts until_the_client_is_ready_the_bell_is_the_link_to_the_page).
  test("the_native_messages_panel_stays_when_the_script_files_are_refused", async ({ page }) => {
    await page.route("**/_app/**/*.js", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "" }));
    expect((await openPage(page, SETTINGS))?.status()).toBe(200);
    await panelButton(page, MESSAGES_PANEL).click();
    await expect(page.locator(`section#${MESSAGES_PANEL.native}`)).toContainText("Messages are coming soon.");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

for (const scheme of ["light", "dark"] as const) {
  for (const [name, which, fixture] of [
    ["messages", MESSAGES_PANEL, SETTINGS],
    ["bell", BELL_PANEL, INBOX_HOME],
  ] as const) {
    test(`the_open_${name}_panel_passes_axe_${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await ready(page, fixture);
      await settled(await openPanel(page, which));
      const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
      expect(unallowedViolations(results.violations, AXE_ALLOWANCE, today)).toEqual([]);
    });
  }
}

test.describe("phone", () => {
  test.use(phone({ width: 320, height: 700 }));

  test("the_search_panel_fits_a_phone_and_says_search_is_coming", async ({ page }) => {
    await ready(page, SETTINGS);
    await panelButton(page, SEARCH_PANEL).tap();
    const panel = stockPanel(page, SEARCH_PANEL);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Search is coming soon.");
    await settled(panel);
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
    expect(await page.evaluate(undersizedTargets)).toEqual([]);
    await panel.getByRole("button", { name: "Close Search unset.sh" }).tap();
    await expect(panel).toHaveCount(0);
  });

  // On a phone Messages is a row of More actions, which opens the same stock panel (navbar-actions.spec.ts); no
  // native panel is left once the client is ready.
  test("messages_from_more_actions_opens_the_stock_panel", async ({ page }) => {
    await ready(page, SETTINGS);
    await actionsRow(await openMenu(page, ACTIONS_MENU), "Messages").tap();
    await expect(stockPanel(page, MESSAGES_PANEL)).toContainText("Messages are coming soon.");
    await expect(page.locator(`section#${MESSAGES_PANEL.native}`)).toHaveCount(0);
  });
});
