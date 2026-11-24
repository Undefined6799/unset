// A Text card's table lines (ADR 0110 point 2; target-look decision 16, Alex 2026-11-22 00:37Z "Per card, in Edit"):
// four boxes in the card's Edit form, one per line, for every table in the card. Our look with none changed is a line
// under the header and between rows. Checked boxes are saved beside the Markdown, which stays as it was, and the page
// draws them, with script and without. Each card added is deleted again.
import { expect, type Locator, test } from "@playwright/test";
import { addCard, OWN_PAGE, paceWrites, postedText } from "./cards.ts";
import { openPage } from "./observe.ts";

paceWrites(test);

const TABLE = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";
/** A Text card whose words start with `word`, so a card a failed run left behind is never the one a test reads. */
const textOf = (word: string) => `${word}\n\n${TABLE}`;

/**
 * Each side's line as the page draws it, in CSS pixels, read with toHaveCSS: it retries while the in-place editor takes
 * the drawn table's place once its script loads, and it needs no script in the page (a page.evaluate with script off
 * never returns in Firefox).
 */
async function expectLines(cell: Locator, lines: { top?: string; bottom?: string; left?: string; right?: string }) {
  for (const [side, width] of Object.entries(lines)) {
    await expect(cell).toHaveCSS(`border-${side}-width`, width);
  }
}

async function expectOurLook(table: Locator) {
  await expectLines(table.locator("th").first(), { bottom: "1px" });
  await expectLines(table.locator("td").first(), { bottom: "1px" });
  await expectLines(table.locator("td").nth(1), { left: "0px" });
  await expectLines(table, { top: "0px" });
}

async function expectChanged(table: Locator) {
  await expectLines(table.locator("th").first(), { bottom: "1px" });
  await expectLines(table.locator("td").first(), { bottom: "0px", left: "1px" });
  await expectLines(table.locator("td").nth(1), { left: "1px" });
  // The outline is drawn on the outer cells (ADR 0110 point 5), so the table draws none of its own.
  await expectLines(table.locator("th").first(), { top: "1px", left: "1px" });
  await expectLines(table.locator("th").last(), { top: "1px", right: "1px" });
  await expectLines(table.locator("td").last(), { bottom: "1px", right: "1px" });
  await expectLines(table, { top: "0px", left: "0px" });
}

test("the_edit_form_sets_a_text_cards_table_lines_and_the_page_and_preview_draw_them", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: textOf("LinesWithScript") });
  await page.reload();
  await page.waitForLoadState("networkidle");
  const shown = page.locator('[data-slot="card"]', { hasText: "LinesWithScript" });
  const card = shown.getByRole("group", { name: "Text card" });
  await expectOurLook(shown.locator("table"));

  await card.getByRole("link", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  const lines = dialog.getByRole("group", { name: "Table lines" });
  await expect(lines.getByRole("checkbox", { name: "Under the header" })).toBeChecked();
  await expect(lines.getByRole("checkbox", { name: "Between rows" })).toBeChecked();
  await expect(lines.getByRole("checkbox", { name: "Between columns" })).not.toBeChecked();
  await expect(lines.getByRole("checkbox", { name: "Around the table" })).not.toBeChecked();
  // A choice closed without saving is gone when Edit opens again (Codex on #2026).
  await lines.getByRole("checkbox", { name: "Around the table" }).check();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await card.getByRole("link", { name: "Edit" }).click();
  await expect(lines.getByRole("checkbox", { name: "Around the table" })).not.toBeChecked();

  await lines.getByRole("checkbox", { name: "Between rows" }).uncheck();
  await lines.getByRole("checkbox", { name: "Between columns" }).check();
  await lines.getByRole("checkbox", { name: "Around the table" }).check();
  await dialog.getByRole("tab", { name: "Preview" }).click();
  await expectChanged(dialog.getByRole("tabpanel").locator("table"));
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expectChanged(shown.locator("table"));

  // Stored, not only drawn: after a reload the page and the form still have them, and the Markdown is as it was.
  await page.reload();
  await expectChanged(shown.locator("table"));
  await card.getByRole("link", { name: "Edit" }).click();
  await expect(postedText(dialog)).toHaveValue(textOf("LinesWithScript"));
  await expect(lines.getByRole("checkbox", { name: "Between rows" })).not.toBeChecked();
  await expect(lines.getByRole("checkbox", { name: "Around the table" })).toBeChecked();
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(shown).toHaveCount(0);
});

test.describe("without script", () => {
  test.use({ javaScriptEnabled: false });

  test("the_edit_form_sets_a_text_cards_table_lines_with_plain_boxes", async ({ page }) => {
    expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
    const panel = page.locator("#card-editor");
    await page.getByRole("link", { name: "Add card" }).click();
    await panel.getByRole("link", { name: /^Text/ }).click();
    await panel.getByRole("textbox", { name: "Text" }).fill(textOf("PlainBoxes"));
    await panel.getByRole("button", { name: "Add" }).click();
    await expect(panel).toHaveCount(0);
    const shown = page.locator('[data-slot="card"]', { hasText: "PlainBoxes" });
    const card = shown.getByRole("group", { name: "Text card" });
    await expectOurLook(shown.locator("table"));

    await card.getByRole("link", { name: "Edit" }).click();
    const lines = panel.getByRole("group", { name: "Table lines" });
    await lines.getByRole("checkbox", { name: "Between rows" }).uncheck();
    await lines.getByRole("checkbox", { name: "Between columns" }).check();
    await lines.getByRole("checkbox", { name: "Around the table" }).check();
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(panel).toHaveCount(0);
    await expectChanged(shown.locator("table"));

    // Back to our look: the boxes as they started write no table lines at all.
    await card.getByRole("link", { name: "Edit" }).click();
    await expect(lines.getByRole("checkbox", { name: "Between rows" })).not.toBeChecked();
    await lines.getByRole("checkbox", { name: "Between rows" }).check();
    await lines.getByRole("checkbox", { name: "Between columns" }).uncheck();
    await lines.getByRole("checkbox", { name: "Around the table" }).uncheck();
    await panel.getByRole("button", { name: "Save" }).click();
    await expect(panel).toHaveCount(0);
    await expectOurLook(shown.locator("table"));

    await card.getByRole("link", { name: "Delete" }).click();
    await page.locator("#card-editor").getByRole("button", { name: "Delete" }).click();
    await expect(shown).toHaveCount(0);
  });
});
