// A Text card's in-place editor on a large screen works as the Milkdown playground (Crepe 7.23.0) does, on Milkdown's
// own plugins (P1.21v slice 3; Alex 2026-11-21: "it better work the same"): "/" opens the block menu, read by keys and
// named for screen readers; selected words show the floating bar; a pointer over a block shows the side handle, whose
// "+" adds a line with the block menu open and whose grip drags the block. All under the app's real CSP. Each card
// added is deleted again, and nothing is saved.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { addCard, OWN_PAGE } from "./cards.ts";
import { openPage, pageNoise, watch } from "./observe.ts";

// A large screen, tall enough that a card's blocks and its handle are all in view while one is dragged.
test.use({ viewport: { width: 1280, height: 1400 } });

async function openOwnPage(page: Page) {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
}

/** A fresh card holding `text`, its editor, and the caret at the end of its words. */
async function cardWithCaret(page: Page, word: string, text: string) {
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text });
  await openOwnPage(page);
  const card = page.locator('[data-slot="card"]', { hasText: word });
  const editor = card.locator("[data-text-in-place] .ProseMirror");
  await expect(editor).toBeVisible();
  await editor.click();
  // prosemirror-view 1.42.9 redraws the selection 20 ms after the editor takes focus (editHandlers.focus).
  await expect(editor).toBeFocused();
  await page.waitForTimeout(50);
  await page.keyboard.press("ControlOrMeta+End");
  return { card, editor };
}

async function discardAndRemove(page: Page, word: string) {
  await page.locator("[data-unsaved-bar]").getByRole("button", { name: "Discard" }).click();
  const card = page.locator('[data-slot="card"]', { hasText: word });
  await card.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(card).toHaveCount(0);
  // Two card writes, back at one every two seconds (limits.ts `profile`), as cards-stale.spec.ts waits.
  await page.waitForTimeout(5_000);
}

/**
 * Drags `from` onto the top of `to`. Playwright's WebKit starts no HTML drag from a mouse press (no dragstart fires),
 * so there the browser's own drag events are sent, with the data a real drag carries, as paste() does in
 * text-markdown.spec.ts; Chromium and Firefox drag with the mouse.
 */
async function drag(page: Page, from: Locator, to: Locator) {
  if (page.context().browser()?.browserType().name() !== "webkit") {
    await from.dragTo(to, { targetPosition: { x: 4, y: 2 } });
    return;
  }
  const start = await from.boundingBox();
  const end = await to.boundingBox();
  if (start === null || end === null) throw new Error("drag: nothing to drag");
  await page.mouse.move(start.x + 4, start.y + 4);
  await page.mouse.down();
  await from.evaluate(
    (source, point) => {
      // The spec's types have no DOM, so the browser's own classes are named by their shape.
      type Target = { dispatchEvent: (event: unknown) => boolean };
      const g = globalThis as unknown as {
        DataTransfer: new () => unknown;
        DragEvent: new (type: string, init: Record<string, unknown>) => unknown;
        document: { elementFromPoint: (x: number, y: number) => Target | null };
      };
      const dataTransfer = new g.DataTransfer();
      const handle = (source as unknown as { closest: (s: string) => Target }).closest("[data-block-handle]");
      const init = { bubbles: true, cancelable: true, dataTransfer, clientX: point.x, clientY: point.y };
      handle.dispatchEvent(new g.DragEvent("dragstart", init));
      const target = g.document.elementFromPoint(point.x, point.y);
      target?.dispatchEvent(new g.DragEvent("dragover", init));
      target?.dispatchEvent(new g.DragEvent("drop", init));
      handle.dispatchEvent(new g.DragEvent("dragend", init));
    },
    { x: end.x + 4, y: end.y + 2 },
  );
  await page.mouse.up();
}

test("a_slash_opens_the_block_menu_and_selected_words_show_the_floating_bar", async ({ page }) => {
  const watched = watch(page);
  const word = `menus${Date.now()}`;
  const { editor } = await cardWithCaret(page, word, `${word} start`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  const menu = page.getByRole("listbox", { name: "Blocks" }).filter({ visible: true });
  await expect(menu).toBeVisible();
  await page.keyboard.type("head");
  await expect(menu.getByRole("option")).toHaveText(["Heading 1", "Heading 2", "Heading 3"]);
  await expect(menu.getByRole("option", { name: "Heading 1" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  const second = menu.getByRole("option", { name: "Heading 2" });
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(editor).toHaveAttribute("aria-activedescendant", (await second.getAttribute("id")) ?? "");
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  // "##" is the card's second level, an h3 under the card's h2; the typed "/head" is gone.
  await expect(editor.locator("h3")).toHaveText("");
  await expect(editor).not.toContainText("/head");
  await page.keyboard.type("Title");
  await expect(editor.locator("h3")).toHaveText("Title");
  // Escape closes the menu and leaves the "/" typed.
  await page.keyboard.press("Enter");
  await page.keyboard.type("/");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(editor).not.toHaveAttribute("aria-activedescendant");
  await expect(editor).toContainText("/");
  // A pointer press on an option runs it, as Enter does.
  await page.keyboard.press("Backspace");
  await page.keyboard.type("/");
  await menu.getByRole("option", { name: "Quote" }).click();
  await expect(editor.locator("blockquote")).toHaveCount(1);

  // Selected words show the floating bar; its buttons say whether they are on.
  // The first line's words, selected.
  await editor.getByText(`${word} start`).selectText();
  const floating = page.getByRole("toolbar", { name: "Format the selected words" }).filter({ visible: true });
  await expect(floating).toBeVisible();
  const bold = floating.getByRole("button", { name: "Bold" });
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  await bold.click();
  await expect(editor.locator("strong")).toHaveText(`${word} start`);
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  await expect(floating).toBeHidden();
  await discardAndRemove(page, word);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});

test("the_side_handle_adds_a_line_with_the_block_menu_and_drags_a_block", async ({ page }) => {
  const watched = watch(page);
  const word = `handle${Date.now()}`;
  const { card, editor } = await cardWithCaret(page, word, `${word} one\n\nsecond line\n\nthird line`);
  const handle = card.locator("[data-block-handle]");
  await expect(handle).toBeHidden();
  const first = editor.locator("p").first();
  await first.hover();
  await expect(handle).toBeVisible();
  await expect(handle.getByRole("button", { name: "Add a block below" })).toBeVisible();
  await handle.getByRole("button", { name: "Add a block below" }).click();
  await expect(editor.locator("p")).toHaveCount(4);
  await expect(card.getByRole("listbox", { name: "Blocks" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.type("new line");
  await expect(editor.locator("p").nth(1)).toHaveText("new line");

  // The grip drags its block: the third line goes above the first.
  await editor.locator("p").nth(3).hover();
  const grip = handle.getByRole("img", { name: "Drag to move this block" });
  await expect(grip).toBeVisible();
  await drag(page, grip, first);
  await expect(editor.locator("p")).toHaveText(["third line", `${word} one`, "new line", "second line"]);
  await discardAndRemove(page, word);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});
