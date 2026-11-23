// A Text card as the page reads it (P1.21k): the page reads Markdown with micromark, the reader the editor uses, so
// what the editor writes is what the page draws, and a text written to stall the reader costs the page its limit and
// no more. The owner's own page shows a Text card in the editor, so the card as the server draws it is read with
// script off. The cards added are deleted again.
import { type Browser, expect, type Page, test } from "@playwright/test";
import { addCard, OWN_PAGE, paceWrites, spendsWrites } from "./cards.ts";
import { openPage, pageNoise, watch } from "./observe.ts";

paceWrites(test);

/** Adds a Text card holding `stored` and reloads: the newest Text card is the last one. */
async function addStored(page: Page, stored: string) {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: stored });
  await page.reload();
  await page.waitForLoadState("networkidle");
}

/** A Text card with its words: they sit beside the card's group of controls, not in it. */
const textCards = (page: Page) =>
  page.locator("[data-slot='card']", { has: page.getByRole("group", { name: "Text card" }) });

/** The same page for the same member with script off: the cards as the server draws them. */
async function withoutScript(browser: Browser, page: Page): Promise<Page> {
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    javaScriptEnabled: false,
  });
  spendsWrites(context);
  const quiet = await context.newPage();
  expect((await quiet.goto(page.url()))?.status()).toBe(200);
  return quiet;
}

/** Deletes the newest Text card, the one this test added. */
async function deleteNewest(page: Page) {
  const cards = page.getByRole("group", { name: "Text card" });
  const before = await cards.count();
  await cards.last().getByRole("button", { name: "More for Text card" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(cards).toHaveCount(before - 1);
}

// The three texts the old reader drew differently from the editor: a table straight after a paragraph line, two list
// items with an empty line between, and a line of pipes over dashes (a heading in GFM, not a one-column table).
test("a_table_after_a_paragraph_a_loose_list_and_a_setext_heading_are_drawn_as_the_editor_shows_them", async ({
  browser,
  page,
}) => {
  const watched = watch(page);
  const stored = ["words", "| a | b |", "| - | - |", "| 1 | 2 |", "", "- one", "", "- two", "", "| x |", "---"];
  await addStored(page, stored.join("\n"));
  const quiet = await withoutScript(browser, page);
  for (const card of [textCards(quiet).last(), textCards(page).last().getByRole("textbox")]) {
    await expect(card.getByRole("table")).toHaveCount(1);
    await expect(card.getByRole("columnheader")).toHaveText(["a", "b"]);
    await expect(card.getByRole("cell")).toHaveText(["1", "2"]);
    await expect(card.getByRole("list")).toHaveCount(1);
    await expect(card.getByRole("listitem")).toHaveText(["one", "two"]);
    await expect(card.getByRole("heading", { level: 3, name: "| x |" })).toBeVisible();
  }
  await expect(textCards(quiet).last().locator("p")).toHaveText(["words"]);
  await quiet.context().close();
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
  await deleteNewest(page);
});

// micromark 4.0.3 takes seconds over this text and then runs out of stack (interfaces/web/src/lib/server/
// text-reader.ts). The page stops reading it at limits.ts TEXT_READ_LIMITS and shows it as written. The bar is far
// from both: a stopped read answers in a fraction of a second, an unstopped one in several.
test("text_written_to_stall_the_reader_is_shown_as_written_and_the_page_answers_in_time", async ({ browser, page }) => {
  const stored = "+ ".repeat(5_000).trim();
  await addStored(page, stored);
  const started = Date.now();
  const answer = await page.request.get(page.url());
  expect(answer.status()).toBe(200);
  expect(Date.now() - started).toBeLessThan(1_500);
  const quiet = await withoutScript(browser, page);
  await expect(textCards(quiet).last().locator("p")).toHaveText([stored]);
  await quiet.context().close();
  await deleteNewest(page);
});
