// The member page laid out as the profile-card mockup (Alex 2026-11-17): the side column left of the cards on a wide
// screen and above them on a phone, with nothing scrolling sideways at 320px; each card's controls sit at its top
// right and show when the keyboard reaches them; the add buttons close the grid.
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

/** Adds one Text card as a plain form post and returns its controls' group. */
async function withReadme(page: Page) {
  const status = await page.evaluate(async () => {
    const body = new URLSearchParams({ kind: "readme", width: "full", text: "# Layout check" });
    const init = { method: "POST", body, headers: { accept: "text/html" }, redirect: "manual" } as const;
    const answer = await fetch("?/create", init);
    return answer.type === "opaqueredirect" ? 303 : answer.status;
  });
  expect(status).toBe(303);
  await page.reload();
  await page.waitForLoadState("networkidle");
  return page.getByRole("group", { name: "Text card" });
}

/** Deletes the Text card added through its menu's Delete, so the member page is as the other specs expect it. */
async function removeReadme(page: Page) {
  const card = page.getByRole("group", { name: "Text card" });
  await card.getByRole("button", { name: "More for Text card" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  // Staging audit 2026-11-19: the confirm names the card it deletes.
  await expect(page.getByRole("dialog").getByRole("heading")).toHaveText("Delete Text card?");
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(card).toHaveCount(0);
}

// The card's controls are always shown, not only on hover (Alex 2026-11-18: phones have no hover).
test("the_side_column_sits_left_of_the_cards_and_controls_are_always_shown", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const card = await withReadme(page);
  try {
    const name = await page.getByRole("heading", { level: 1 }).boundingBox();
    const readme = await page.getByRole("heading", { level: 2, name: "Layout check" }).boundingBox();
    expect(name !== null && readme !== null && name.x + name.width <= readme.x).toBe(true);
    await expect(page.getByRole("link", { name: "Add card" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit profile" })).toHaveAttribute("href", "/settings/profile");
    const edit = card.getByRole("link", { name: "Edit" });
    await page.mouse.move(0, 0);
    await expect(card).toHaveCSS("opacity", "1");
    await expect(edit).toBeVisible();
    await expect(edit).toHaveCSS("height", "32px");
    await expect(card.getByRole("button", { name: "More for Text card" })).toBeVisible();
    const editBox = await edit.boundingBox();
    expect(editBox !== null && readme !== null && editBox.x > readme.x).toBe(true);
  } finally {
    await removeReadme(page);
  }
});

test.describe("phone", () => {
  test.use(phone({ width: 320, height: 800 }));

  test("the_phone_context_has_a_coarse_pointer_and_touch", async ({ page }) => {
    const coarse = await page.evaluate(() => {
      const view = globalThis as unknown as { matchMedia: (query: string) => { matches: boolean } };
      return view.matchMedia("(pointer: coarse)").matches;
    });
    expect(coarse).toBe(true);
    await page.setContent(
      '<meta name="viewport" content="width=device-width,initial-scale=1"><button type="button">Touch target</button>',
    );
    const target = page.getByRole("button", { name: "Touch target" });
    await target.evaluate((element) => {
      element.addEventListener("touchstart", () => element.setAttribute("data-touched", "true"), { once: true });
    });
    await target.tap();
    await expect(target).toHaveAttribute("data-touched", "true");
  });

  test("the_side_column_sits_above_the_cards_and_nothing_scrolls_sideways", async ({ page }) => {
    expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    const card = await withReadme(page);
    try {
      await expect(card.getByRole("link", { name: "Edit" })).toHaveCSS("height", "44px");
      const name = await page.getByRole("heading", { level: 1 }).boundingBox();
      const readme = await page.getByRole("heading", { level: 2, name: "Layout check" }).boundingBox();
      expect(name !== null && readme !== null && name.y + name.height <= readme.y).toBe(true);
      const width = await page.evaluate(() => {
        const root = (globalThis as unknown as { document: { documentElement: { scrollWidth: number } } }).document;
        return root.documentElement.scrollWidth;
      });
      expect(width).toBeLessThanOrEqual(320);
      // P1.21p: the Text card has no file-name bar and no heading of its own; the member's # is the card's h2.
      await expect(page.getByText("README.md")).toHaveCount(0);
      await expect(card.getByRole("heading", { level: 2 })).toHaveText("Layout check");
    } finally {
      await removeReadme(page);
    }
  });
});

// Alex, 2026-11-18 staging review: the side column sits at the left, under the header's menu button, not centred.
test("the_avatar_lines_up_under_the_menu_button_on_a_wide_screen", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  const menu = await page.locator('header button[popovertarget="core-menu"]').boundingBox();
  const avatar = await page.getByRole("link", { name: "Change picture shape" }).boundingBox();
  expect(Math.abs((avatar?.x ?? -99) - (menu?.x ?? 99))).toBeLessThanOrEqual(2);
});

// The avatar's shape (sh.unset.profile avatarShape) is saved from the avatar's own dialog and shown on the page.
test("the_owner_sets_the_avatar_shape_from_the_avatar", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const avatar = page.getByRole("link", { name: "Change picture shape" });
  const dialog = page.getByRole("dialog");
  const choose = async (shape: string) => {
    await avatar.click();
    await dialog.getByRole("radio", { name: shape, exact: true }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
  };
  await choose("Rounded square");
  await page.reload();
  await avatar.click();
  await expect(dialog.getByRole("radio", { name: "Rounded square" })).toBeChecked();
  await page.keyboard.press("Escape");
  await choose("Round");
});
