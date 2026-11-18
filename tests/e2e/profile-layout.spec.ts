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

/** Deletes the README added through its own Delete, so the member page is as the other specs expect it. */
async function removeReadme(page: Page) {
  const card = page.getByRole("group", { name: "README card" });
  await card.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(card).toHaveCount(0);
}

test("the_side_column_sits_left_of_the_cards_and_controls_show_on_focus", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const card = await withReadme(page);
  try {
    const name = await page.getByRole("heading", { level: 1 }).boundingBox();
    const readme = await page.getByText("README.md", { exact: true }).boundingBox();
    expect(name !== null && readme !== null && name.x + name.width <= readme.x).toBe(true);
    expect(await page.getByRole("heading", { name: "Add a card" }).isVisible()).toBe(true);
    const edit = card.getByRole("button", { name: "Edit" });
    await edit.focus();
    await expect(card).toHaveCSS("opacity", "1");
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
    } finally {
      await removeReadme(page);
    }
  });
});
