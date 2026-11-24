// Math in a Text card's in-place editor (P1.21v, the coordinator's relay of 2026-11-23 20:13Z): a formula between
// dollars and a `$$` block open as math, drawn as MathML the way the page draws them (lib/profile/math.ts), and
// save back as the dollars they were. The block menu adds a math block and the floating bar makes selected words a
// formula, as Milkdown's Crepe 7.23.0 does (src/feature/latex). Single dollars follow the page's rule, so prices
// stay words. All under the app's real CSP. Each card added is deleted again.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { addCard, OWN_PAGE, paceWrites } from "./cards.ts";
import { openPage, pageNoise, watch } from "./observe.ts";

paceWrites(test);
test.use({ viewport: { width: 1280, height: 1400 } });

const MATHML = "http://www.w3.org/1998/Math/MathML";

async function openOwnPage(page: Page) {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
}

/** A fresh card holding `text`, its editor, and the caret at the end of its first line. */
async function cardWithCaret(page: Page, word: string, text: string) {
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text });
  await openOwnPage(page);
  const card = page.locator('[data-slot="card"]', { hasText: word });
  const editor = card.locator("[data-text-in-place] .ProseMirror");
  await expect(editor).toBeVisible();
  await editor.getByText(word).click();
  // prosemirror-view 1.42.9 redraws the selection 20 ms after the editor takes focus (editHandlers.focus).
  await expect(editor).toBeFocused();
  await page.waitForTimeout(50);
  await page.keyboard.press("End");
  return { card, editor };
}

/** The card's text as it would be saved now, from its Show Markdown field. */
async function markdownOf(page: Page, card: Locator) {
  await card.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show Markdown" }).click();
  await page.keyboard.press("Escape");
  // A field's value is no text the card's filter finds, so the card is found by its field.
  const field = page.locator('textarea[aria-label^="Text of the"]');
  const value = await field.inputValue();
  const shown = page.locator('[data-slot="card"]', { has: field });
  await shown.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show Markdown" }).click();
  await page.keyboard.press("Escape");
  return value;
}

/** Discards the card's changes and deletes it. */
async function discardAndRemove(page: Page, word: string) {
  await page.locator("[data-unsaved-bar]").getByRole("button", { name: "Discard" }).click();
  const card = page.locator('[data-slot="card"]', { hasText: word });
  await card.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(card).toHaveCount(0);
  // Two card writes, back at one every two seconds (limits.ts `profile`), as text-menus.spec.ts waits.
  await page.waitForTimeout(5_000);
}

/** The MathML elements under `where`, each as its namespace and name, and the links and styles among them. */
const mathIn = (where: Locator) =>
  where.evaluate((root) => {
    // The spec's types have no DOM, so the browser's own nodes are named by their shape.
    type Element = { namespaceURI: string | null; localName: string; hasAttribute: (name: string) => boolean };
    const all = [...(root as unknown as { querySelectorAll: (s: string) => Iterable<Element> }).querySelectorAll("*")];
    const math = all.filter((element) => element.localName === "math");
    return {
      formulas: math.map((element) => element.namespaceURI),
      linked: all.filter((element) => element.hasAttribute("href")).length,
      styled: all.filter((element) => element.hasAttribute("style")).length,
    };
  });

test("math_in_the_text_opens_as_formulas_and_an_edit_elsewhere_keeps_its_dollars", async ({ page }) => {
  const watched = watch(page);
  const word = `math${Date.now()}`;
  const text = `${word} start, so $x^2$ grows\n\n$$\n\\frac{1}{2}\n$$`;
  const { card, editor } = await cardWithCaret(page, word, text);
  // The formula in the line and the block's preview, each drawn as MathML with no link or style attribute.
  await expect(editor.locator("[data-math-inline] math")).toHaveCount(1);
  await expect(editor.locator("[data-math-preview] math")).toHaveCount(1);
  expect(await mathIn(editor)).toEqual({ formulas: [MATHML, MATHML], linked: 0, styled: 0 });
  // The block's TeX is edited as code.
  await expect(editor.locator(".cm-editor .cm-content")).toHaveText("\\frac{1}{2}");
  await page.keyboard.type(" more");
  expect(await markdownOf(page, card)).toBe(`${word} start, so $x^2$ grows more\n\n$$\n\\frac{1}{2}\n$$`);
  await discardAndRemove(page, word);
  expect(watched.pageErrors).toEqual([]);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});

test("typed_dollars_make_a_formula_and_prices_stay_words", async ({ page }) => {
  const watched = watch(page);
  const word = `dollars${Date.now()}`;
  const { card, editor } = await cardWithCaret(page, word, `${word} start`);
  await page.keyboard.type(" so $y_1$ and $5 or $10");
  await expect(editor.locator("[data-math-inline]")).toHaveCount(1);
  await expect(editor.locator("[data-math-inline] math")).toHaveCount(1);
  await expect(editor).toContainText("and $5 or $10");
  // remark-math 6.0.0 writes a dollar that is text with a backslash (mdast-util-math 3.0.0 unsafe), which the page
  // reads back as a dollar.
  expect(await markdownOf(page, card)).toBe(`${word} start so $y_1$ and \\$5 or \\$10`);
  await discardAndRemove(page, word);
  expect(watched.pageErrors).toEqual([]);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});

// Reviewer on #2020: micromark takes "$5 **each** or $" as one span before the price rule refuses it; read back as
// one piece of text, the first save wrote the bold as "\*\*each\*\*". The words between two prices keep their
// Markdown, in the editor and through a save.
test("bold_between_two_prices_stays_bold_through_a_save", async ({ page }) => {
  const watched = watch(page);
  const word = `between${Date.now()}`;
  const { card, editor } = await cardWithCaret(page, word, `${word} costs $5 **each** or $10`);
  await expect(editor.locator("strong")).toHaveText("each");
  await expect(editor.locator("[data-math-inline]")).toHaveCount(0);
  await page.keyboard.type(" now");
  expect(await markdownOf(page, card)).toBe(`${word} costs \\$5 **each** or \\$10 now`);
  await discardAndRemove(page, word);
  expect(watched.pageErrors).toEqual([]);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});

test("the_block_menu_adds_a_math_block_and_the_bar_makes_words_a_formula", async ({ page }) => {
  const watched = watch(page);
  const word = `menu${Date.now()}`;
  const { card, editor } = await cardWithCaret(page, word, `${word} start`);
  // Selected words become a formula from the floating bar, after Inline code as in Crepe 7.23.0's toolbar.
  await page.keyboard.type(" a+b");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  const floating = page.getByRole("toolbar", { name: "Format the selected words" }).filter({ visible: true });
  const names = await floating.getByRole("button").evaluateAll((all) => all.map((b) => b.getAttribute("aria-label")));
  expect(names).toEqual(["Bold", "Italic", "Strikethrough", "Inline code", "Inline math", "Link"]);
  const inlineMath = floating.getByRole("button", { name: "Inline math" });
  await inlineMath.click();
  await expect(editor.locator("[data-math-inline] math")).toHaveCount(1);
  // A press on the formula selects it, and the same button turns it back into its TeX to edit.
  await editor.locator("[data-math-inline]").click();
  await expect(inlineMath).toHaveAttribute("aria-pressed", "true");
  await inlineMath.click();
  await expect(editor.locator("[data-math-inline]")).toHaveCount(0);
  // The press gave the editor its focus back; prosemirror-view 1.42.9 redraws the selection 20 ms after that
  // (editHandlers.focus), and a key pressed sooner is undone by it, as cardWithCaret waits.
  await page.waitForTimeout(50);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("c");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await inlineMath.click();
  await expect(editor.locator("[data-math-inline] math")).toHaveCount(1);
  // The block menu's Math, after Table as in Crepe's menu, makes a math block whose TeX shows drawn below it.
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("/math");
  const menu = page.getByRole("listbox", { name: "Blocks" }).filter({ visible: true });
  await expect(menu.getByRole("option")).toHaveText(["Math"]);
  await expect(menu.getByRole("option").locator("svg")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await page.keyboard.type("\\sqrt{2}");
  await expect(editor.locator("[data-math-preview] msqrt")).toHaveCount(1);
  expect(await markdownOf(page, card)).toBe(`${word} start $a+c$\n\n$$\n\\sqrt{2}\n$$`);
  await discardAndRemove(page, word);
  expect(watched.pageErrors).toEqual([]);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});
