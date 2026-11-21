// Markdown in a Text card's in-place editor (P1.21s, staging test 2026-11-21): pasted Markdown becomes formatting as
// on the Milkdown playground, an empty line saves as nothing visible, Enter in a quote and Shift+Enter break as
// CommonMark allows and the page shows them, and pasted HTML loads nothing from elsewhere.
// All under the app's real CSP. Each card added is deleted again.
import { expect, type Page, test } from "@playwright/test";
import { addCard, OWN_PAGE } from "./cards.ts";
import { openPage, pageNoise, watch } from "./observe.ts";

async function openOwnPage(page: Page) {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
}

/** The card holding `word`, after a fresh load, with the caret at the end of its words. */
async function caretAtEnd(page: Page, word: string) {
  await openOwnPage(page);
  const card = page.locator('[data-slot="card"]', { hasText: word });
  const editor = card.locator("[data-text-in-place] .ProseMirror");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  // The editor mounts hidden; a click before it shows is an early press, carried later.
  await expect(editor).toBeVisible();
  await editor.click();
  // prosemirror-view 1.42.9's focus handler redraws the selection it holds 20 ms after the editor takes focus
  // (editHandlers.focus, setTimeout(..., 20)); a key pressed before the press's caret has been read back is undone by
  // it. No person types within 20 ms of a click, so the test waits past it rather than racing it.
  await expect(editor).toBeFocused();
  await page.waitForTimeout(50);
  await page.keyboard.press("End");
  return { card, editor };
}

/** A fresh card holding `word start`, its editor, and the caret at the end of its words. */
async function cardWithCaret(page: Page, word: string) {
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} start` });
  return caretAtEnd(page, word);
}

const bar = (page: Page) => page.locator("[data-unsaved-bar]");

async function saveAndReopen(page: Page, word: string) {
  await bar(page).getByRole("button", { name: "Save" }).click();
  await expect(bar(page)).not.toContainText("unsaved changes");
  await openOwnPage(page);
  const card = page.locator('[data-slot="card"]', { hasText: word });
  const editor = card.locator("[data-text-in-place] .ProseMirror");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  // The editor mounts hidden; a click before it shows is an early press, carried later.
  await expect(editor).toBeVisible();
  return { card, editor };
}

async function removeCard(page: Page, word: string) {
  const card = page.locator('[data-slot="card"]', { hasText: word });
  await card.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(card).toHaveCount(0);
}

/**
 * Pastes `data` into the focused editor. Firefox hands a page's own paste event an empty DataTransfer, so there the
 * clipboard is written and the paste key pressed, as in WebKit. Chromium parses HTML written to the clipboard under
 * the page's CSP and reports its styles as refused, noise no real paste makes, so there the browser's own paste event
 * is sent with the data.
 */
async function paste(page: Page, data: Record<string, string>) {
  const synthetic = page.context().browser()?.browserType().name() === "chromium";
  await page.evaluate(
    async ({ items, synthetic }) => {
      // The spec's types have no DOM, so the browser's own classes are named by their shape.
      const g = globalThis as unknown as {
        document: { activeElement: { dispatchEvent: (event: unknown) => boolean } | null };
        navigator: { clipboard: { write: (items: unknown[]) => Promise<void> } };
        ClipboardItem: new (parts: Record<string, unknown>) => unknown;
        Blob: new (parts: string[], options: { type: string }) => unknown;
        DataTransfer: new () => { setData: (type: string, value: string) => void };
        ClipboardEvent: new (type: string, init: Record<string, unknown>) => unknown;
      };
      if (synthetic) {
        const transfer = new g.DataTransfer();
        for (const [type, value] of Object.entries(items)) transfer.setData(type, value);
        const event = new g.ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true });
        g.document.activeElement?.dispatchEvent(event);
        return;
      }
      const parts = Object.fromEntries(
        Object.entries(items).map(([type, value]) => [type, new g.Blob([value], { type })]),
      );
      await g.navigator.clipboard.write([new g.ClipboardItem(parts)]);
    },
    { items: data, synthetic },
  );
  if (!synthetic) await page.keyboard.press("ControlOrMeta+V");
}

// Card writes count against the member's 30 a minute (cards.ts), so each test adds one card and checks several things
// on it: the pastes are discarded, and what is typed is saved once. Each test then waits for its writes to come back
// (one every two seconds, limits.ts `profile`), as cards-stale.spec.ts does, so the next spec starts with them.
async function giveBackWrites(page: Page, used: number) {
  await page.waitForTimeout(used * 2_000 + 1_000);
}

test("pasted_markdown_becomes_formatting_and_pasted_html_loads_nothing", async ({ page }) => {
  const watched = watch(page);
  const word = `paste${Date.now()}`;
  const { editor } = await cardWithCaret(page, word);
  await page.keyboard.press("Shift+Enter");
  await paste(page, { "text/plain": "## Title\n\n- item\n\n**bold** and [site](https://example.com)" });
  // "##" is the card's second level, an h3 under the card's h2, as the page shows it.
  await expect(editor.locator("h3")).toHaveText("Title");
  await expect(editor.locator("ul li")).toHaveText("item");
  await expect(editor.locator("strong")).toHaveText("bold");
  await expect(editor.locator("a")).toHaveAttribute("href", /^https:\/\/example\.com\/?$/);
  await bar(page).getByRole("button", { name: "Discard" }).click();
  await caretAtEnd(page, word);
  await page.keyboard.press("Shift+Enter");
  await paste(page, {
    "text/html":
      // Styled HTML (a sheet or style attributes) is refused by the CSP and reported, a known item while Crepe is weighed.
      '<p>styled <img src="https://example.com/x.png" alt="pic"> words</p>',
    "text/plain": "styled words",
  });
  const card = page.locator('[data-slot="card"]', { hasText: word });
  await expect(card).toContainText("styled");
  // The image shows as its alt text; nothing loads from elsewhere and the CSP refuses nothing.
  await expect(card.locator("[data-image]")).toHaveText("[pic]");
  await expect(card.locator("img")).toHaveCount(0);
  await bar(page).getByRole("button", { name: "Discard" }).click();
  await removeCard(page, word);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
  await giveBackWrites(page, 2);
});

test("typed_markdown_is_stored_as_written_and_the_page_shows_it", async ({ page }) => {
  const word = `typed${Date.now()}`;
  const { editor } = await cardWithCaret(page, word);
  // An empty line.
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("after");
  // Enter breaks the line inside the paragraph.
  await page.keyboard.press("Enter");
  await page.keyboard.type("next line");
  await expect(editor.locator("[data-type='hardbreak']")).toHaveCount(1);
  // Shift+Enter in a quote starts the quote's next paragraph.
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("> first");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("second");
  await expect(editor.locator("blockquote p")).toHaveCount(2);
  const { card, editor: reopened } = await saveAndReopen(page, word);
  await expect(reopened.locator("[data-type='hardbreak']")).toHaveCount(1);
  await expect(reopened.locator("blockquote p")).toHaveCount(2);
  // The page as the server draws it, the words every visitor sees before any script.
  const html = await (await page.request.get(page.url())).text();
  expect(html).toContain("after");
  expect(html).not.toContain("&lt;br");
  // And the Markdown as stored.
  await card.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show Markdown" }).click();
  await page.keyboard.press("Escape");
  // A field's value is no text the card's filter finds, so the card is found by its field.
  const field = page.locator('textarea[aria-label^="Text of the"]');
  await expect(field).toHaveValue(`${word} start\n\nafter\\\nnext line\n\n> first\n>\n> second`);
  const shown = page.locator('[data-slot="card"]', { has: field });
  await shown.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show Markdown" }).click();
  await page.keyboard.press("Escape");
  await removeCard(page, word);
  await giveBackWrites(page, 3);
});

// Alex, 2026-11-21: all of GFM. Struck words, tasks and tables stored in the card open as themselves in the editor
// (Milkdown's preset-gfm 7.23.0), an edit elsewhere keeps their Markdown, and the page shows them.
test("gfm_in_the_text_opens_as_itself_and_an_edit_elsewhere_keeps_it", async ({ page }) => {
  const watched = watch(page);
  const word = `gfm${Date.now()}`;
  const gfm = "~~gone~~ kept\n\n- [ ] open\n- [x] done\n\n| a | b |\n| - | :-: |\n| 1 | 2 |";
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} start\n\n${gfm}` });
  const { editor } = await caretAtEnd(page, word);
  await expect(editor.locator("del")).toHaveText("gone");
  await expect(editor.locator("li[data-item-type='task']")).toHaveCount(2);
  await expect(editor.locator("li[data-checked='true']")).toHaveText("done");
  await expect(editor.locator("table td")).toHaveText(["1", "2"]);
  // Aligned by a class, as the page is: the CSP refuses a style attribute (preset-gfm draws text-align in one).
  await expect(editor.locator("table [style]")).toHaveCount(0);
  await expect(editor.locator("table td").last()).toHaveCSS("text-align", "center");
  await editor.getByText(`${word} start`).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" more");
  // A task's box is shown where its bullet was, and a press on it ticks the task.
  const open = editor.locator("li[data-item-type='task']").first();
  const box = await open.boundingBox();
  if (box === null) throw new Error("no task");
  await page.mouse.click(box.x + 6, box.y + box.height / 2);
  await expect(open).toHaveAttribute("data-checked", "true");
  const { card } = await saveAndReopen(page, word);
  const html = await (await page.request.get(page.url())).text();
  expect(html).toContain("<del");
  expect(html).toContain('type="checkbox"');
  expect(html).toContain("<table");
  await card.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show Markdown" }).click();
  await page.keyboard.press("Escape");
  const field = page.locator('textarea[aria-label^="Text of the"]');
  await expect(field).toHaveValue(`${word} start more\n\n${gfm.replace("[ ] open", "[x] open")}`);
  const shown = page.locator('[data-slot="card"]', { has: field });
  await shown.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show Markdown" }).click();
  await page.keyboard.press("Escape");
  await removeCard(page, word);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
  await giveBackWrites(page, 3);
});

// Alex 2026-11-21: "bare addresses become https". A bare address in the text is a link on the page and in the editor,
// a www name over https in both; a bare address pasted is a link; one typed in the link editor without https:// gets it.
test("bare_addresses_are_links_and_a_www_name_opens_over_https", async ({ page }) => {
  const watched = watch(page);
  const word = `bare${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, {
    kind: "readme",
    width: "full",
    surface: "filled",
    text: `${word} start\n\nsee https://example.com/a and www.example.org.`,
  });
  const html = await (await page.request.get(page.url())).text();
  expect(html).toContain('href="https://example.com/a"');
  expect(html).toContain('href="https://www.example.org/"');
  const { editor } = await caretAtEnd(page, word);
  const links = editor.locator("a");
  await expect(links).toHaveText(["https://example.com/a", "www.example.org"]);
  await expect(links.last()).toHaveAttribute("href", "https://www.example.org");
  await editor.getByText(`${word} start`).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("these and ");
  await paste(page, { "text/plain": "https://example.net/x" });
  await expect(editor.locator("a[href='https://example.net/x']")).toHaveText("https://example.net/x");
  await page.keyboard.press("Home");
  for (const _ of "these") await page.keyboard.press("Shift+ArrowRight");
  const floating = page.getByRole("toolbar", { name: "Format the selected words" }).filter({ visible: true });
  await floating.getByRole("button", { name: "Link" }).click();
  await page.getByRole("textbox", { name: "Link address" }).fill("example.com/b");
  await page.keyboard.press("Enter");
  await expect(editor.getByRole("link", { name: "these" })).toHaveAttribute("href", "https://example.com/b");
  const { card } = await saveAndReopen(page, word);
  await card.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show Markdown" }).click();
  await page.keyboard.press("Escape");
  const field = page.locator('textarea[aria-label^="Text of the"]');
  await expect(field).toHaveValue(
    `${word} start\n\n[these](https://example.com/b) and <https://example.net/x>\n\nsee <https://example.com/a> and [www.example.org](https://www.example.org).`,
  );
  const shown = page.locator('[data-slot="card"]', { has: field });
  await shown.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show Markdown" }).click();
  await page.keyboard.press("Escape");
  await removeCard(page, word);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
  await giveBackWrites(page, 3);
});

// The page reads no footnotes and no line break inside a table cell (GFM cells hold one line), so the editor takes
// neither: a pasted footnote is refused whole, and Shift+Enter in a cell does nothing. A pasted table is a table.
test("a_pasted_table_is_a_table_and_what_the_page_cannot_show_is_refused", async ({ page }) => {
  const word = `nofoot${Date.now()}`;
  const { editor } = await cardWithCaret(page, word);
  await page.keyboard.press("Enter");
  await paste(page, { "text/plain": "| x | y |\n| - | - |\n| 1 | 2 |" });
  await expect(editor.locator("table td")).toHaveText(["1", "2"]);
  await editor.locator("table td").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("z");
  await expect(editor.locator("table td").first()).toHaveText("1z");
  await expect(editor.locator("table br")).toHaveCount(0);
  await editor.getByText(`${word} start`).click();
  await page.keyboard.press("End");
  await paste(page, { "text/plain": "a[^1]\n\n[^1]: note" });
  await expect(editor.locator("[data-type^='footnote']")).toHaveCount(0);
  await expect(editor).not.toContainText("note");
  await bar(page).getByRole("button", { name: "Discard" }).click();
  await removeCard(page, word);
  await giveBackWrites(page, 2);
});
