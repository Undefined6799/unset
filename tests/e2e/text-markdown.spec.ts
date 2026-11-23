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
  // Enter twice at a line's end in a quote starts the quote's next paragraph; Shift+Enter would leave the quote
  // (Alex 2026-11-22 00:02Z, for lists; quotes the same).
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("> first");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
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

// Staging, 2026-11-21: headings pasted from another site changed level (h1 and h2 both stored as "#", h3 as "##"),
// while a copy inside the editor kept them. A pasted heading keeps its level; the editor and the page draw each one
// a level down, under the page's own h1, and the editor's own drawn headings say their level so a copy keeps it.
test("headings_pasted_from_another_site_keep_their_level", async ({ page }) => {
  const word = `levels${Date.now()}`;
  const { card } = await cardWithCaret(page, word);
  // At the end of the line, whose words the paste's first paragraph joins, as a paste does.
  await paste(page, {
    "text/html": "<p>, intro</p><h1>Top</h1><h2>Second</h2><h3>Third</h3><p>words</p>",
    "text/plain": ", intro\n\nTop\n\nSecond\n\nThird\n\nwords",
  });
  await expect(card).toContainText("Third");
  await card.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show Markdown" }).click();
  await page.keyboard.press("Escape");
  const field = page.locator('textarea[aria-label^="Text of the"]');
  await expect(field).toHaveValue(`${word} start, intro\n\n# Top\n\n## Second\n\n### Third\n\nwords`);
  const shown = page.locator('[data-slot="card"]', { has: field });
  await shown.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show Markdown" }).click();
  await page.keyboard.press("Escape");
  await bar(page).getByRole("button", { name: "Discard" }).click();
  await removeCard(page, word);
  await giveBackWrites(page, 2);
});
