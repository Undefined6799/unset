// A Text card's tables in the in-place editor have the table tools the Milkdown playground (Crepe 7.23.0) has
// (target-look decision 7, Alex 2026-11-22 00:22Z "tabletools is a must"): a pointer over a cell shows a handle above
// its column and one beside its row; a handle opens its menu, and the menu adds, aligns and deletes, writing plain GFM.
// All under the app's real CSP. Each card added is deleted again, and nothing is saved.
import { expect, type Page, test } from "@playwright/test";
import { addCard, OWN_PAGE } from "./cards.ts";
import { openPage } from "./observe.ts";

test.use({ viewport: { width: 1280, height: 1400 } });

const TABLE = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";

async function tableCard(page: Page, word: string) {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} start\n\n${TABLE}` });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const card = page.locator('[data-slot="card"]', { hasText: word });
  const editor = card.locator("[data-text-in-place] .ProseMirror");
  await expect(editor).toBeVisible();
  return { card, editor };
}

/** The card's words as stored, read from its Markdown field, which is then closed again. */
async function markdown(page: Page, word: string): Promise<string> {
  const card = page.locator('[data-slot="card"]', { hasText: word });
  await card.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show Markdown" }).click();
  await page.keyboard.press("Escape");
  const field = page.locator('textarea[aria-label^="Text of the"]');
  const value = await field.inputValue();
  const shown = page.locator('[data-slot="card"]', { has: field });
  await shown.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show Markdown" }).click();
  await page.keyboard.press("Escape");
  return value;
}

async function discardAndRemove(page: Page, word: string) {
  await page.locator("[data-unsaved-bar]").getByRole("button", { name: "Discard" }).click();
  const card = page.locator('[data-slot="card"]', { hasText: word });
  await card.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(card).toHaveCount(0);
  await page.waitForTimeout(5_000);
}

test("a_column_handle_adds_aligns_and_deletes_a_column_in_plain_markdown", async ({ page }) => {
  const word = `columns${Date.now()}`;
  const { card, editor } = await tableCard(page, word);
  const column = card.getByRole("button", { name: "Column options" });
  const row = card.getByRole("button", { name: "Row options" });
  await expect(column).toBeHidden();
  // Over the second column's first data cell: the handles are for its column and its row.
  await editor.getByRole("cell", { name: "2", exact: true }).hover();
  await expect(column).toBeVisible();
  await expect(row).toBeVisible();
  const head = await editor.getByRole("columnheader", { name: "b" }).boundingBox();
  const handle = await column.boundingBox();
  if (head === null || handle === null) throw new Error("no box");
  // Above the column, centred on it.
  expect(handle.y + handle.height).toBeLessThanOrEqual(head.y + 1);
  expect(Math.abs(handle.x + handle.width / 2 - (head.x + head.width / 2))).toBeLessThanOrEqual(2);
  await column.click();
  const menu = page.getByRole("menu", { name: "Column options" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Align centre" }).click();
  await expect(menu).toBeHidden();
  await expect(editor.getByRole("columnheader", { name: "b" })).toHaveClass(/text-center/);
  await editor.getByRole("cell", { name: "2", exact: true }).hover();
  await column.click();
  await menu.getByRole("menuitem", { name: "Add column right" }).click();
  await expect(editor.getByRole("columnheader")).toHaveCount(3);
  await editor.getByRole("cell", { name: "1", exact: true }).hover();
  await column.click();
  // A second press closes the menu, as the dots' does (decision 12).
  await column.click();
  await expect(menu).toBeHidden();
  await column.click();
  await menu.getByRole("menuitem", { name: "Delete column" }).click();
  await expect(editor.getByRole("columnheader")).toHaveCount(2);
  // A column the tools add is left-aligned (`:-`): preset-gfm 7.23.0 cellAttributes alignment defaults to "left"
  // (node_modules/@milkdown/preset-gfm/lib/index.js:101).
  expect(await markdown(page, word)).toBe(`${word} start\n\n| b | |\n| :-: | :- |\n| 2 | |\n| 4 | |`);
  await discardAndRemove(page, word);
});

test("a_row_handle_adds_and_deletes_rows_and_never_the_header_row", async ({ page }) => {
  const word = `rows${Date.now()}`;
  const { card, editor } = await tableCard(page, word);
  const row = card.getByRole("button", { name: "Row options" });
  await editor.getByRole("cell", { name: "1", exact: true }).hover();
  await row.click();
  const menu = page.getByRole("menu", { name: "Row options" });
  await menu.getByRole("menuitem", { name: "Add row below" }).click();
  await expect(editor.locator("tr")).toHaveCount(4);
  await editor.getByRole("cell", { name: "3", exact: true }).hover();
  await row.click();
  await menu.getByRole("menuitem", { name: "Delete row" }).click();
  await expect(editor.locator("tr")).toHaveCount(3);
  // The header row's menu holds only Add row below: GFM's table has one header row, first.
  await editor.getByRole("columnheader", { name: "a" }).hover();
  await row.click();
  await expect(menu.getByRole("menuitem")).toHaveText(["Add row below"]);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  // The pointer leaving the card leaves nothing shown (decision 10).
  await page.mouse.move(2, 2);
  await expect(row).toBeHidden();
  expect(await markdown(page, word)).toBe(`${word} start\n\n| a | b |\n| - | - |\n| 1 | 2 |\n| | |`);
  await discardAndRemove(page, word);
});

/** Drags `handle` to the point (x, y) in small steps, as a hand does, so the drop line follows it. */
async function drag(page: Page, handle: { x: number; y: number; width: number; height: number }, x: number, y: number) {
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 });
}

// Decision 7: dragging a handle moves its column or row, with a line where it lands; the header row is never moved
// and nothing lands above it. The move is preset-gfm 7.23.0's moveRowCommand / moveColCommand (prosemirror-tables
// 1.8.5 moveTableRow / moveTableColumn), so the words stay plain GFM.
test("dragging_a_handle_moves_its_row_or_column_and_never_above_the_header", async ({ page }) => {
  const word = `drag${Date.now()}`;
  const { card, editor } = await tableCard(page, word);
  const row = card.getByRole("button", { name: "Row options" });
  const column = card.getByRole("button", { name: "Column options" });
  const line = card.locator("[data-table-drop]");
  // The last row's handle, dragged up over the first data row's top half: it lands above it, under the header.
  await editor.getByRole("cell", { name: "3", exact: true }).hover();
  const first = await editor.getByRole("cell", { name: "1", exact: true }).boundingBox();
  const rowHandle = await row.boundingBox();
  if (first === null || rowHandle === null) throw new Error("no box");
  await drag(page, rowHandle, first.x + 4, first.y + 2);
  await expect(line).toBeVisible();
  await page.mouse.up();
  await expect(line).toBeHidden();
  await expect(editor.locator("tr").nth(1)).toHaveText("34");
  // Dragged on up over the header: it still lands under it.
  await editor.getByRole("cell", { name: "1", exact: true }).hover();
  const head = await editor.getByRole("columnheader", { name: "a" }).boundingBox();
  const again = await row.boundingBox();
  if (head === null || again === null) throw new Error("no box");
  await drag(page, again, head.x + 4, head.y + 2);
  await page.mouse.up();
  await expect(editor.locator("tr").first()).toHaveText("ab");
  await expect(editor.locator("tr").nth(1)).toHaveText("12");
  // The second column's handle, dragged over the first column's left half: the columns swap.
  await editor.getByRole("cell", { name: "2", exact: true }).hover();
  const left = await editor.getByRole("columnheader", { name: "a" }).boundingBox();
  const columnHandle = await column.boundingBox();
  if (left === null || columnHandle === null) throw new Error("no box");
  await drag(page, columnHandle, left.x + 2, left.y + left.height / 2);
  await expect(line).toBeVisible();
  await page.mouse.up();
  await expect(editor.locator("tr").first()).toHaveText("ba");
  // A press with no drag still opens the menu.
  await editor.getByRole("cell", { name: "2", exact: true }).hover();
  await row.click();
  await expect(page.getByRole("menu", { name: "Row options" })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await markdown(page, word)).toBe(`${word} start\n\n| b | a |\n| - | - |\n| 2 | 1 |\n| 4 | 3 |`);
  await discardAndRemove(page, word);
});
