// The compact profile layout (ADR 0072, P1.21o): chosen in Settings › Profile, it puts the avatar, name and handle
// above the cards, and the avatar opens the profile's details in a native popover under it. The popover works with
// no script (the public page runs none), so the same checks run with the client and without it. Every test puts the
// layout back to the side column, since the other specs expect it.
import { expect, type Page, test } from "@playwright/test";
import { openPage } from "./observe.ts";
import { ACCOUNT, type PageFixture } from "./pages.ts";
import { phone } from "./phone.ts";

const OWN_PAGE: PageFixture = {
  path: `/${ACCOUNT.did}`,
  route: "/:did",
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

/** Chooses a layout in Settings › Profile and saves it, as a member would. */
async function chooseLayout(page: Page, label: "Compact header" | "Side column"): Promise<void> {
  expect((await openPage(page, SETTINGS))?.status()).toBe(200);
  await page.getByRole("radio", { name: label }).check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
}

async function ownPage(page: Page): Promise<void> {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
}

const avatar = (page: Page) => page.getByRole("button", { name: /^About / });
const details = (page: Page) => page.getByRole("region", { name: "About" });

test("the_compact_header_opens_its_details_and_keeps_editing_separate", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await chooseLayout(page, "Compact header");
  try {
    await ownPage(page);
    // The name and handle stay in the header; the details wait in the panel.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(details(page)).toBeHidden();
    await expect(page.getByRole("link", { name: "Edit profile" })).toHaveAttribute("href", "/settings/profile");
    await expect(page.getByRole("link", { name: "Change picture shape" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add card" })).toBeVisible();

    // A click opens it under the avatar, Escape closes it and focus is back on the avatar.
    await avatar(page).click();
    await expect(details(page)).toBeVisible();
    const from = await avatar(page).boundingBox();
    const panel = await details(page).boundingBox();
    expect(from !== null && panel !== null && panel.y >= from.y + from.height).toBe(true);
    await expect(details(page).getByText("DID", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(details(page)).toBeHidden();
    await expect(avatar(page)).toBeFocused();

    // Enter opens it, its Close button closes it, and a click outside closes it too.
    await page.keyboard.press("Enter");
    await expect(details(page)).toBeVisible();
    await details(page).getByRole("button", { name: "Close details" }).click();
    await expect(details(page)).toBeHidden();
    await avatar(page).click();
    await page.mouse.click(1200, 880);
    await expect(details(page)).toBeHidden();

    // The avatar's editor is its own control, and opens the same dialog as before.
    await page.getByRole("link", { name: "Change picture shape" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await chooseLayout(page, "Side column");
  }
});

test.describe("no script", () => {
  test.use({ javaScriptEnabled: false });

  test("the_compact_details_work_with_no_script", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await chooseLayout(page, "Compact header");
    try {
      await ownPage(page);
      await avatar(page).click();
      await expect(details(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(details(page)).toBeHidden();
      await avatar(page).focus();
      await page.keyboard.press(" ");
      await expect(details(page)).toBeVisible();
      await details(page).getByRole("button", { name: "Close details" }).click();
      await expect(details(page)).toBeHidden();
    } finally {
      await chooseLayout(page, "Side column");
    }
  });
});

test.describe("phone", () => {
  test.use(phone({ width: 320, height: 800 }));

  test("the_compact_details_stay_on_screen_and_nothing_scrolls_sideways", async ({ page }) => {
    await chooseLayout(page, "Compact header");
    try {
      await ownPage(page);
      await avatar(page).tap();
      await expect(details(page)).toBeVisible();
      const box = await details(page).boundingBox();
      expect(box !== null && box.x >= 0 && box.x + box.width <= 320).toBe(true);
      const width = await page.evaluate(() => {
        const root = (globalThis as unknown as { document: { documentElement: { scrollWidth: number } } }).document;
        return root.documentElement.scrollWidth;
      });
      expect(width).toBeLessThanOrEqual(320);
    } finally {
      await chooseLayout(page, "Side column");
    }
  });
});
