// The member page laid out as the profile-card mockup (Alex 2026-11-17): the side column left of the cards on a wide
// screen and above them on a phone, with nothing scrolling sideways at 320px; each card's controls sit at its top
// right and show when the keyboard reaches them; the add buttons close the grid.
import { expect, type Page, test } from "@playwright/test";
import { openPage } from "./observe.ts";
import { ACCOUNT, type PageFixture } from "./pages.ts";

const OWN_PAGE: PageFixture = {
  path: `/${ACCOUNT.did}`,
  route: "/:did",
  group: "app",
  expectJs: true,
  member: "account",
};

/** Adds one README card as a plain form post and returns its controls' group. */
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
  return page.getByRole("group", { name: "README card" });
}

/** Deletes the README added through its menu's Delete, so the member page is as the other specs expect it. */
async function removeReadme(page: Page) {
  const card = page.getByRole("group", { name: "README card" });
  await card.getByRole("button", { name: "More for README card" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
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
    const readme = await page.getByText("README.md", { exact: true }).boundingBox();
    expect(name !== null && readme !== null && name.x + name.width <= readme.x).toBe(true);
    await expect(page.getByRole("link", { name: "Add card" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit profile" })).toHaveAttribute("href", "/settings/profile");
    const edit = card.getByRole("link", { name: "Edit" });
    await page.mouse.move(0, 0);
    await expect(card).toHaveCSS("opacity", "1");
    await expect(edit).toBeVisible();
    await expect(card.getByRole("button", { name: "More for README card" })).toBeVisible();
    const editBox = await edit.boundingBox();
    expect(editBox !== null && readme !== null && editBox.x > readme.x).toBe(true);
  } finally {
    await removeReadme(page);
  }
});

test.describe("phone", () => {
  test.use({ viewport: { width: 320, height: 800 } });

  test("the_side_column_sits_above_the_cards_and_nothing_scrolls_sideways", async ({ page }) => {
    expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    await withReadme(page);
    try {
      const name = await page.getByRole("heading", { level: 1 }).boundingBox();
      const readme = await page.getByText("README.md", { exact: true }).boundingBox();
      expect(name !== null && readme !== null && name.y + name.height <= readme.y).toBe(true);
      const width = await page.evaluate(() => {
        const root = (globalThis as unknown as { document: { documentElement: { scrollWidth: number } } }).document;
        return root.documentElement.scrollWidth;
      });
      expect(width).toBeLessThanOrEqual(320);
      // Staging walkthrough 2026-11-19: with a handle and the card's controls in the bar, a phone broke the file name
      // ("READM", "E.md"). This member has no verified handle, so the card is narrowed to leave the name as little
      // room; it stays on one line and the bar's other parts give way.
      const file = page.getByText("README.md", { exact: true });
      await file.evaluate((element) => {
        type Box = { closest: (selector: string) => { style: { width: string } } | null };
        const card = (element as unknown as Box).closest('[data-slot="card"]');
        if (card !== null) card.style.width = "120px";
      });
      const lineHeight = Number.parseFloat(
        await file.evaluate((element) => {
          const view = globalThis as unknown as { getComputedStyle: (node: object) => { lineHeight: string } };
          return view.getComputedStyle(element).lineHeight;
        }),
      );
      expect((await file.boundingBox())?.height).toBeLessThan(lineHeight * 1.5);
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
