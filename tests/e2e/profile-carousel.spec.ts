// The profile's carousel and grid cards as their layout draws them (Alex's staging report 2026-11-18; the staging
// walkthrough the same day; review of #1718). A carousel's Previous and Next buttons scroll it a tile at a time, show
// only while its tiles overflow and script runs, step from where it is after the person scrolls it, and jump when
// motion is reduced; a grid of three or more fills its row, one or two keep the tile width. In its own file, apart
// from cards.spec.ts, so their card writes do not crowd the member's 30 a minute.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { addCard, deleteCard, OWN_PAGE, paceWrites } from "./cards.ts";
import { openPage } from "./observe.ts";
import { phone, phoneContext } from "./phone.ts";

paceWrites(test);

/** Opens the member page with a full-width collection card of `titles`, laid out as `layout`. */
async function withCollection(page: Page, title: string, layout: string, titles: string[]) {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  const entries = Object.fromEntries(titles.map((entry, i) => [`items.${i}.title`, entry]));
  await addCard(page, { kind: "collection", width: "full", title, layout, ...entries });
  await page.reload();
  await page.waitForLoadState("networkidle");
}

const scrollLeft = (region: Locator) =>
  region.evaluate((node) => Math.round((node as unknown as { scrollLeft: number }).scrollLeft));
/** Where tile `n` (from 0) starts, measured from the first tile: the scroll position that shows it first. */
const tileAt = (region: Locator, n: number) =>
  region.evaluate((node, i) => {
    const tiles = (
      node as unknown as { querySelectorAll(s: string): ArrayLike<{ offsetLeft: number }> }
    ).querySelectorAll("li");
    return Math.round((tiles[i]?.offsetLeft ?? 0) - (tiles[0]?.offsetLeft ?? 0));
  }, n);

/** The person's own scrolling: Left arrow presses on the region until it is back at its start. */
async function backToStart(page: Page, region: Locator) {
  await region.focus();
  await expect(async () => {
    await page.keyboard.press("ArrowLeft");
    expect(await scrollLeft(region)).toBe(0);
  }).toPass({ timeout: 10_000 });
}

test.describe("phone carousel", () => {
  test.use(phone({ width: 390, height: 900 }));

  test("a_carousel_has_previous_and_next_buttons", async ({ browser, browserName, page }) => {
    await withCollection(page, "Shelf", "carousel", ["Entry 1", "Entry 2", "Entry 3", "Entry 4"]);
    try {
      const shelf = page.getByRole("region", { name: "Shelf, scrolls sideways" });
      const previous = page.getByRole("button", { name: "Previous in Shelf" });
      const next = page.getByRole("button", { name: "Next in Shelf" });

      // Each is off at its own end, and the keyboard reaches both.
      await expect(previous).toBeDisabled();
      await expect(next).toBeEnabled();
      await next.focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => scrollLeft(shelf)).toBeGreaterThan(0);
      await expect(previous).toBeEnabled();

      // Review of #1718: presses heading for a tile are dropped once the person scrolls it themselves, so the next
      // press steps from where the carousel is (here two quick presses, then arrow keys back to the start). The arrow
      // keys run before the carousel reaches its end: in Firefox, Left from the very end did not move it in CI.
      await backToStart(page, shelf);
      await next.click();
      await next.click();
      await backToStart(page, shelf);
      await next.click();
      const second = await tileAt(shelf, 1);
      await expect.poll(() => scrollLeft(shelf)).toBe(second);

      // Codex on #1718: with reduced motion a press jumps; a smooth scroll would still be near where it started.
      await backToStart(page, shelf);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await next.click();
      expect(await scrollLeft(shelf)).toBe(second);

      // Next until it is off at the end, with the last entry in view. A press can turn it off while a click is on its
      // way, so each try gives up quickly and the next one looks again.
      await expect(async () => {
        if (await next.isEnabled()) await next.click({ timeout: 500 });
        await expect(next).toBeDisabled({ timeout: 500 });
      }).toPass({ timeout: 10_000 });
      await expect(page.getByRole("heading", { name: "Entry 4" })).toBeInViewport({ ratio: 0.9 });

      // Without script the buttons could not scroll, so they are not drawn; the region still scrolls by keyboard.
      const plain = await browser.newContext({
        ...phoneContext(browserName, { width: 390, height: 900 }),
        javaScriptEnabled: false,
      });
      try {
        const noScript = await plain.newPage();
        expect((await openPage(noScript, OWN_PAGE))?.status()).toBe(200);
        await expect(noScript.getByRole("region", { name: "Shelf, scrolls sideways" })).toBeVisible();
        await expect(noScript.getByRole("button", { name: /^(Previous|Next) in Shelf$/ })).toHaveCount(0);
      } finally {
        await plain.close();
      }
    } finally {
      await deleteCard(page, "Shelf card");
    }
  });

  // Review of #1718: in Firefox CI, Left from a carousel's very end did not move it. Someone on the keyboard must be able
  // to go back from the end as well as reach it, with script and without (WCAG 2.1.1).
  test("a_carousel_scrolls_back_from_its_end_by_keyboard", async ({ browser, browserName, page }) => {
    await withCollection(page, "Shelf", "carousel", ["Entry 1", "Entry 2", "Entry 3", "Entry 4"]);
    const plain = await browser.newContext({
      ...phoneContext(browserName, { width: 390, height: 900 }),
      javaScriptEnabled: false,
    });
    try {
      const noScript = await plain.newPage();
      expect((await openPage(noScript, OWN_PAGE))?.status()).toBe(200);
      for (const view of [page, noScript]) {
        const shelf = view.getByRole("region", { name: "Shelf, scrolls sideways" });
        const end = await shelf.evaluate((node) => {
          const region = node as unknown as { scrollWidth: number; clientWidth: number };
          return region.scrollWidth - region.clientWidth;
        });
        await shelf.focus();
        await expect(async () => {
          await view.keyboard.press("ArrowRight");
          expect(await scrollLeft(shelf)).toBeGreaterThanOrEqual(end - 1);
        }).toPass({ timeout: 10_000 });
        await view.keyboard.press("ArrowLeft");
        await expect.poll(() => scrollLeft(shelf)).toBeLessThan(end - 1);
        await backToStart(view, shelf);
      }
    } finally {
      await plain.close();
      await deleteCard(page, "Shelf card");
    }
  });
});

test("a_carousel_that_fits_shows_no_buttons", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await withCollection(page, "Pair", "carousel", ["One", "Two"]);
  try {
    await expect(page.getByRole("region", { name: "Pair, scrolls sideways" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Previous|Next) in Pair$/ })).toHaveCount(0);
  } finally {
    await deleteCard(page, "Pair card");
  }
});

test.describe("phone editor", () => {
  test.use(phone({ width: 390, height: 900 }));

  // Codex on #1718: a carousel edited in place from one entry to several shows its buttons without a scroll or resize.
  test("a_carousel_edited_to_overflow_shows_its_buttons", async ({ page }) => {
    await withCollection(page, "Grow", "carousel", ["A"]);
    try {
      const next = page.getByRole("button", { name: "Next in Grow" });
      await expect(next).toHaveCount(0);
      await page.getByRole("group", { name: "Grow card" }).getByRole("link", { name: "Edit" }).click();
      const dialog = page.getByRole("dialog");
      for (const n of [2, 3]) {
        await dialog.getByRole("button", { name: "Add entry" }).click();
        const row = dialog.getByRole("group", { name: `Entry ${n}`, exact: true });
        await row.getByRole("textbox", { name: "Title" }).fill(String.fromCharCode(64 + n));
      }
      await dialog.getByRole("button", { name: "Save" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "C", exact: true })).toHaveCount(1);
      await expect(next).toBeEnabled();
    } finally {
      await deleteCard(page, "Grow card");
    }
  });
});

/** How far the last tile of the grid holding `heading` stops short of the grid's right edge, and its width. */
async function lastTile(page: Page, heading: string) {
  const list = page.locator("ul", { has: page.getByRole("heading", { name: heading }) });
  const [row, tile] = await Promise.all([list.boundingBox(), list.locator("li").last().boundingBox()]);
  if (row === null || tile === null) throw new Error("the grid was not drawn");
  return { gap: row.x + row.width - (tile.x + tile.width), width: tile.width };
}

// Staging walkthrough 2026-11-18: a full-width grid of three entries left an empty fourth column.
test("a_full_width_grid_of_three_fills_its_row", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await withCollection(page, "Trio", "grid", ["Tile 1", "Tile 2", "Tile 3"]);
  try {
    expect((await lastTile(page, "Tile 3")).gap).toBeLessThan(2);
  } finally {
    await deleteCard(page, "Trio card");
  }
});

// Review of #1718: one or two grid entries keep their tile width rather than stretching into banners.
test("a_grid_of_one_keeps_its_tile_width", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await withCollection(page, "Solo", "grid", ["Only"]);
  try {
    expect((await lastTile(page, "Only")).width).toBeLessThan(300);
  } finally {
    await deleteCard(page, "Solo card");
  }
});
