// A Text card as the page reads it (P1.21k): the page reads Markdown with micromark, the reader the editor uses, so
// what the editor writes is what the page draws; a text written to stall the reader costs the page its limit and no
// more; and reading in the browser (the editor, and its Preview tab) keeps the Trusted Types rule. The owner's own page
// shows a Text card in the editor, so the card as the server draws it is read with script off. The cards added are
// deleted again.
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { addCard, OWN_PAGE, paceWrites, postedText, spendsWrites, writeText } from "./cards.ts";
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
// text-reader.ts). The page stops reading it at limits.ts TEXT_READ_LIMITS and shows it as written. The load timed is
// the first after the card is added, the one that reads the text; the bar is far from both outcomes: a stopped read
// answers in a fraction of a second, an unstopped one in several.
test("text_written_to_stall_the_reader_is_shown_as_written_and_the_page_answers_in_time", async ({ browser, page }) => {
  const stored = "+ ".repeat(5_000).trim();
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: stored });
  const started = Date.now();
  const answer = await page.request.get(page.url());
  expect(answer.status()).toBe(200);
  expect(Date.now() - started).toBeLessThan(1_500);
  await page.reload();
  await page.waitForLoadState("networkidle");
  const quiet = await withoutScript(browser, page);
  await expect(textCards(quiet).last().locator("p")).toHaveText([stored]);
  await quiet.context().close();
  await deleteNewest(page);
});

// Reading in the browser: micromark's browser build decodes a named character ("&amp;") by writing it into an
// element, which the page's Trusted Types rule refuses, so the editor did not load on such a text. The build takes the
// table lookup the server uses instead (interfaces/web/vite.config.ts).
test("a_named_character_shows_on_the_page_in_the_editor_and_in_the_preview", async ({ browser, page }) => {
  const watched = watch(page);
  const shown = "Fish & chips \u00a9 2026";
  await addStored(page, "Fish &amp; chips &copy; 2026");
  const quiet = await withoutScript(browser, page);
  await expect(textCards(quiet).last().locator("p")).toHaveText([shown]);
  await quiet.context().close();
  const card = textCards(page).last();
  await expect(card.getByRole("textbox")).toHaveText(shown);
  await card.getByRole("link", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "Text" })).toHaveText(shown);
  await dialog.getByRole("tab", { name: "Preview" }).click();
  await expect(dialog.getByRole("textbox", { name: "Text" })).toBeHidden();
  await expect(dialog.getByRole("tabpanel", { name: "Preview" }).getByText(shown)).toBeVisible();
  await page.keyboard.press("Escape");
  expect(watched.pageErrors).toEqual([]);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
  await deleteNewest(page);
});

// The Preview draws code in the page's colours (P1.21v). The colouring and its languages arrive with the first
// Preview too, after the reader, so the code is plain for a moment and then coloured; nothing is refused on the way.
test("the_preview_shows_code_in_the_pages_colours", async ({ page }) => {
  const watched = watch(page);
  await addStored(page, "```js\nconst a = 1;\n```");
  await textCards(page).last().getByRole("link", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Preview" }).click();
  const code = dialog.getByRole("tabpanel", { name: "Preview" }).locator("pre code");
  await expect(code).toHaveText("const a = 1;");
  await expect(code.locator(".code-keyword")).toHaveText("const");
  await page.keyboard.press("Escape");
  expect(watched.pageErrors).toEqual([]);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
  await deleteNewest(page);
});

const MATHML = "http://www.w3.org/1998/Math/MathML";

/** The namespace of every formula element under `where`. */
const mathNamespaces = (where: Locator) =>
  where
    .locator("math, mrow, mfrac, msup")
    .evaluateAll((all) => all.map((el) => (el as unknown as { namespaceURI: string }).namespaceURI));

// Math in GitHub's syntax is drawn by the server as MathML (apps/web/lib/profile/math.ts), which the browser draws
// itself: no math script, stylesheet or font, nothing the CSP refuses. A colour or a link written in a formula is
// dropped. The Preview reads it in the browser the same way.
test("math_is_drawn_as_mathml_by_the_server_and_in_the_preview", async ({ browser, page }) => {
  const watched = watch(page);
  await addStored(page, "so $x^2$ grows\n\n$$\n\\frac{a}{b}\n$$\n\n$\\color{red}{y}\\href{https://example.com}{z}$");
  const quiet = await withoutScript(browser, page);
  const card = textCards(quiet).last();
  await expect(card.locator("math")).toHaveCount(3);
  expect(new Set(await mathNamespaces(card))).toEqual(new Set([MATHML]));
  // Drawn as a fraction, one part over the other, so taller than the line of text above it.
  const fraction = await card.locator("mfrac").boundingBox();
  const line = await card.locator("p").first().boundingBox();
  expect(fraction?.height ?? 0).toBeGreaterThan(line?.height ?? Number.POSITIVE_INFINITY);
  await expect(card.locator("math [mathcolor], math [style], math [href], math a")).toHaveCount(0);
  await quiet.context().close();
  await textCards(page).last().getByRole("link", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Preview" }).click();
  // Made by the client this time (svelte:element), each element in the MathML namespace all the same.
  const preview = dialog.getByRole("tabpanel", { name: "Preview" });
  await expect(preview.locator("math")).toHaveCount(3);
  expect(new Set(await mathNamespaces(preview))).toEqual(new Set([MATHML]));
  await page.keyboard.press("Escape");
  expect(watched.pageErrors).toEqual([]);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
  await deleteNewest(page);
});

// The Preview's reader is its own file, asked for when Preview first opens, so the page's first load carries no
// Markdown parser. When the file does not arrive the tab says so, and Write still holds the text.
test("a_preview_whose_reader_does_not_arrive_says_so_and_write_keeps_the_text", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const dialog = page.getByRole("dialog");
  await page.getByRole("link", { name: "Add card" }).click();
  await dialog.getByRole("button", { name: /^Text/ }).click();
  await writeText(dialog.getByRole("textbox", { name: "Text" }), ["kept words"]);
  await page.route("**/_app/immutable/**", (route) => route.abort());
  await dialog.getByRole("tab", { name: "Preview" }).click();
  await expect(dialog.getByText("The preview could not load. Reload the page to see it.")).toBeVisible();
  await dialog.getByRole("tab", { name: "Write" }).click();
  await expect(postedText(dialog)).toHaveValue("kept words");
  await page.unroute("**/_app/immutable/**");
  await page.keyboard.press("Escape");
});
