// The navbar's controls as a test finds them (book P1.22m, ADR 0116 points 8 and 9). The server draws each control as
// a native one and the client swaps the stock component in once it has started, so a control is found by its name,
// which both versions carry, and the stock menu by its role, which only the stock one has.
import { expect, type Locator, type Page } from "@playwright/test";

/** The account menu's button: the native popover button before the client is ready, the stock menu's trigger after. */
export const accountButton = (page: Page): Locator =>
  page.locator("header").getByRole("button", { name: "Account menu" });

/** The stock account menu. It is in the document only while it is open. */
export const accountMenu = (page: Page): Locator => page.locator('#account-menu[role="menu"]');

/** Opens the stock account menu by a press on its button. A press the native button took is carried over. */
export async function openAccountMenu(page: Page): Promise<Locator> {
  await accountButton(page).click();
  const menu = accountMenu(page);
  await expect(menu).toBeVisible();
  return menu;
}

/** A header menu as a test names it: its button, the stock menu's own name, and the id of its native twin. */
export type HeaderMenu = { readonly button: string; readonly menu: string; readonly native: string };
/** The three-line menu at the header's left edge. */
export const MAIN_MENU: HeaderMenu = { button: "Menu", menu: "More on unset.sh", native: "core-menu" };
/** The Create menu, a header button from 640px up. On a phone More actions opens its native twin (nojs.spec.ts). */
export const CREATE_MENU: HeaderMenu = { button: "Create", menu: "Create", native: "create-menu" };

/** A header menu's button: the native popover button before the client is ready, the stock menu's trigger after. */
export const menuButton = (page: Page, which: HeaderMenu): Locator =>
  page.locator("header").getByRole("button", { name: which.button, exact: true });

/** A stock header menu. It is in the document only while it is open. */
export const stockMenu = (page: Page, which: HeaderMenu): Locator =>
  page.getByRole("menu", { name: which.menu, exact: true });

/** Opens a stock header menu by a press on its button. */
export async function openMenu(page: Page, which: HeaderMenu): Promise<Locator> {
  await menuButton(page, which).click();
  const menu = stockMenu(page, which);
  await expect(menu).toBeVisible();
  return menu;
}

/** A header panel as a test names it: its button, the stock panel's title, and the id of its native twin. */
export type HeaderPanel = { readonly button: string | RegExp; readonly title: string; readonly native: string };
export const MESSAGES_PANEL: HeaderPanel = { button: "Messages", title: "Messages", native: "messages-menu" };
/** The bell: its name carries the count ("Notifications, 3 waiting"). */
export const BELL_PANEL: HeaderPanel = {
  button: /^Notifications/,
  title: "Notifications",
  native: "notifications-menu",
};
/** Search on a phone: an icon whose panel says search is coming. */
export const SEARCH_PANEL: HeaderPanel = {
  button: "Search unset.sh, coming soon",
  title: "Search unset.sh",
  native: "search-menu",
};

/** A header panel's button: the native popover button before the client is ready, the stock trigger after. */
export const panelButton = (page: Page, which: HeaderPanel): Locator =>
  page.locator("header").getByRole("button", { name: which.button, exact: true });

/** A stock header panel: a dialog named by its title. It is in the document only while it is open. */
export const stockPanel = (page: Page, which: HeaderPanel): Locator =>
  page.getByRole("dialog", { name: which.title, exact: true });

/** Opens a stock header panel by a press on its button. */
export async function openPanel(page: Page, which: HeaderPanel): Promise<Locator> {
  await panelButton(page, which).click();
  const panel = stockPanel(page, which);
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * Waits until the menu's opening animation has ended. Until then the library draws it smaller and part see-through
 * (the stock classes' fade and zoom), so a colour read then is of the blend, not of the menu.
 */
export async function settled(menu: Locator): Promise<void> {
  await expect
    .poll(() =>
      menu.evaluate(
        (element) =>
          (element as unknown as { getAnimations: () => { playState: string }[] })
            .getAnimations()
            .filter((animation) => animation.playState === "running").length,
      ),
    )
    .toBe(0);
}
