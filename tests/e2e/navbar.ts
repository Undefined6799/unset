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
