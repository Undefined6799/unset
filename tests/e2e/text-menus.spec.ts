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

/** Discards the card's changes (when it has any the saved text would hold) and deletes it. */
async function discardAndRemove(page: Page, word: string, { changed = true } = {}) {
  if (changed) await page.locator("[data-unsaved-bar]").getByRole("button", { name: "Discard" }).click();
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
  await page.keyboard.press("Shift+Enter");
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
  // The playground's bar, in its order: Strikethrough after Italic (Crepe 7.23.0 toolbar).
  const names = await floating.getByRole("button").evaluateAll((all) => all.map((b) => b.getAttribute("aria-label")));
  expect(names).toEqual(["Bold", "Italic", "Strikethrough", "Inline code", "Link"]);
  const strike = floating.getByRole("button", { name: "Strikethrough" });
  await strike.click();
  await expect(editor.locator("strong del, del strong")).toHaveText(`${word} start`);
  await expect(strike).toHaveAttribute("aria-pressed", "true");
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
  // Crepe's handle is six dots; ours draws Lucide's grip-vertical (ADR 0087), one path per dot.
  await expect(grip.locator("svg path")).toHaveCount(6);
  await drag(page, grip, first);
  await expect(editor.locator("p")).toHaveText(["third line", `${word} one`, "new line", "second line"]);
  await discardAndRemove(page, word);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});

test("selected_words_become_a_link_from_the_floating_bar_which_shows_edits_and_removes_it", async ({ page }) => {
  const watched = watch(page);
  const word = `links${Date.now()}`;
  const { card, editor } = await cardWithCaret(page, word, `${word} start`);
  const floating = page.getByRole("toolbar", { name: "Format the selected words" }).filter({ visible: true });
  const linkButton = floating.getByRole("button", { name: "Link" });
  await editor.getByText(`${word} start`).selectText();
  await expect(linkButton).toHaveAttribute("aria-pressed", "false");
  await linkButton.click();
  // The link editor opens over the words, its field focused, as Crepe's link-edit does.
  const address = card.getByRole("textbox", { name: "Link address" });
  await expect(address).toBeFocused();
  // An address the page would not show as a link is refused, and nothing changes.
  await address.fill("javascript:alert(1)");
  await page.keyboard.press("Enter");
  await expect(card.getByText("Use an address that starts with https:// or http://")).toBeVisible();
  await expect(editor.locator("a")).toHaveCount(0);
  await address.fill("https://example.com/a");
  await page.keyboard.press("Enter");
  await expect(address).toBeHidden();
  await expect(editor.locator("a")).toHaveAttribute("href", "https://example.com/a");
  await expect(editor.locator("a")).toHaveText(`${word} start`);
  await expect(editor).toBeFocused();

  // A pointer over the link shows its address, with Copy, Edit and Remove.
  await page.keyboard.press("ControlOrMeta+End");
  await editor.locator("a").hover();
  const preview = card.getByRole("group", { name: "Link" });
  await expect(preview.getByRole("link", { name: "https://example.com/a" })).toBeVisible();
  await expect(preview.getByRole("button", { name: "Copy link" })).toBeVisible();
  await preview.getByRole("button", { name: "Edit link" }).click();
  await expect(address).toBeFocused();
  await expect(address).toHaveValue("https://example.com/a");
  await address.fill("https://example.org/b");
  await page.keyboard.press("Enter");
  await expect(editor.locator("a")).toHaveAttribute("href", "https://example.org/b");
  await expect(editor.locator("a")).toHaveText(`${word} start`);
  // Escape closes the editor and changes nothing.
  await editor.locator("a").hover();
  await preview.getByRole("button", { name: "Edit link" }).click();
  await address.fill("https://example.net/c");
  await page.keyboard.press("Escape");
  await expect(address).toBeHidden();
  await expect(editor.locator("a")).toHaveAttribute("href", "https://example.org/b");
  await editor.locator("a").hover();
  await preview.getByRole("button", { name: "Remove link" }).click();
  await expect(editor.locator("a")).toHaveCount(0);
  await expect(editor).toContainText(`${word} start`);

  // Linked words selected again: the bar's Link is on, and pressing it takes the link off (Crepe's toggle).
  await editor.getByText(`${word} start`).selectText();
  await linkButton.click();
  await address.fill("https://example.com/d");
  await page.keyboard.press("Enter");
  await editor.getByText(`${word} start`).selectText();
  await expect(linkButton).toHaveAttribute("aria-pressed", "true");
  await linkButton.click();
  await expect(editor.locator("a")).toHaveCount(0);
  // The words are as they were, so there is nothing to discard.
  await discardAndRemove(page, word, { changed: false });
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});

test("an_empty_line_with_the_caret_says_to_type_a_slash", async ({ page }) => {
  const watched = watch(page);
  const word = `hint${Date.now()}`;
  const { editor } = await cardWithCaret(page, word, `${word} start`);
  const hint = editor.locator("[data-placeholder]");
  await expect(hint).toHaveCount(0);
  await page.keyboard.press("Shift+Enter");
  await expect(hint).toHaveCount(1);
  await expect(hint).toHaveAttribute("data-placeholder", "Type / to choose a block, Shift+Enter for a new one");
  // The hint is drawn by the page, not typed: the words and the saved Markdown do not hold it.
  await expect(editor).not.toContainText("Type /");
  await page.keyboard.type("x");
  await expect(hint).toHaveCount(0);
  await page.keyboard.press("Backspace");
  await expect(hint).toHaveCount(1);
  // Only the line with the caret shows it.
  await page.keyboard.press("ArrowUp");
  await expect(hint).toHaveCount(0);
  // An empty line is not saved (milkdown.ts stored), so there is nothing to discard.
  await discardAndRemove(page, word, { changed: false });
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});

// Alex, 2026-11-21: "swap the enter and shift enter everywhere". Enter breaks the line inside a paragraph (a Markdown
// hard break) and Shift+Enter starts a new block. A heading is one line in Markdown and a list item's line break does
// not show on the page (parse.ts), so there Enter keeps starting the next block; Shift+Enter leaves a code block.
test("enter_breaks_the_line_and_shift_enter_starts_a_new_block", async ({ page }) => {
  const watched = watch(page);
  const word = `keys${Date.now()}`;
  const { editor } = await cardWithCaret(page, word, `${word} start`);
  const blocks = editor.locator(":scope > *");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("two");
  await expect(blocks).toHaveCount(2);
  await page.keyboard.press("Enter");
  await page.keyboard.type("three");
  await expect(blocks).toHaveCount(2);
  await expect(editor.locator("p").last().locator("[data-type='hardbreak']")).toHaveCount(1);
  // Enter twice at the end of a line starts a new block (Milkdown's InsertHardbreak turns a trailing break into one).
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("## Title");
  await expect(blocks).toHaveCount(3);
  await expect(editor.locator("[data-type='hardbreak']")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await page.keyboard.type("- a");
  await expect(blocks.nth(3)).toHaveText("a");
  await page.keyboard.press("Enter");
  await page.keyboard.type("b");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("c");
  await expect(editor.locator("ul > li")).toHaveText(["a", "b", "c"]);
  await expect(editor.locator("li [data-type='hardbreak']")).toHaveCount(0);
  // Shift+Enter twice ends the list, as Enter twice did: the second, on an empty item, lifts it out.
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("``` ");
  await page.keyboard.type("x = 1");
  await page.keyboard.press("Enter");
  await page.keyboard.type("y = 2");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("after");
  await expect(editor.locator("pre")).toHaveText("x = 1\ny = 2");
  await expect(editor.locator("ul > li")).toHaveCount(3);
  await expect(blocks.last()).toHaveText("after");
  // The empty line's hint says how to start one.
  await page.keyboard.press("Shift+Enter");
  await expect(editor.locator("[data-placeholder]")).toHaveAttribute(
    "data-placeholder",
    "Type / to choose a block, Shift+Enter for a new one",
  );
  await discardAndRemove(page, word);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});

test("a_block_moves_up_and_down_by_keys_with_the_caret_kept_in_it", async ({ page }) => {
  const watched = watch(page);
  const word = `moves${Date.now()}`;
  const { editor } = await cardWithCaret(page, word, `${word} one\n\nsecond line\n\n- first item\n- second item`);
  const lines = editor.locator(":scope > p");
  // From the second line: up goes above the first line, down twice goes below the list.
  await editor.getByText("second line").click();
  await page.keyboard.press("ControlOrMeta+Shift+ArrowUp");
  await expect(lines).toHaveText(["second line", `${word} one`]);
  await page.keyboard.type("!");
  await expect(lines.first()).toContainText("!");
  await page.keyboard.press("ControlOrMeta+Shift+ArrowDown");
  await page.keyboard.press("ControlOrMeta+Shift+ArrowDown");
  await expect(editor.locator(":scope > *").last()).toContainText("second line!");
  // In a list, an item moves within its list.
  await editor.getByText("second item").click();
  await page.keyboard.press("ControlOrMeta+Shift+ArrowUp");
  await expect(editor.locator("li")).toHaveText(["second item", "first item"]);
  // At the top there is nowhere to go, and nothing changes.
  await page.keyboard.press("ControlOrMeta+Shift+ArrowUp");
  await expect(editor.locator("li")).toHaveText(["second item", "first item"]);
  await discardAndRemove(page, word);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});

// Staging, 2026-11-21: pressing the grip gave its paragraph a class, so the page's margin for a bare paragraph (main
// :where(p):not([class])) went and the words jumped up 24 px under the pointer; dropped on the lower half of the last
// block, the pointer was then below the editor and nothing moved. The tester's gesture: the first block, pressed and
// moved in steps onto the middle of the last one. A line shows where it will land (prosemirror-dropcursor, as Crepe).
test("a_block_dragged_down_onto_the_last_one_lands_with_a_line_shown_and_nothing_jumps", async ({ page }) => {
  const watched = watch(page);
  const word = `drops${Date.now()}`;
  const { card, editor } = await cardWithCaret(page, word, `${word} one\n\nsecond line\n\nthird line`);
  const lines = editor.locator("p");
  await lines.first().hover();
  const grip = card.locator("[data-block-handle]").getByRole("img", { name: "Drag to move this block" });
  await expect(grip).toBeVisible();
  const before = await lines.first().boundingBox();
  const start = await grip.boundingBox();
  const end = await lines.last().boundingBox();
  if (before === null || start === null || end === null) throw new Error("nothing to drag");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  expect((await lines.first().boundingBox())?.y).toBe(before.y);
  const point = { x: end.x + end.width / 2, y: end.y + end.height / 2 };
  if (page.context().browser()?.browserType().name() !== "webkit") {
    await page.mouse.move(point.x, point.y, { steps: 10 });
    await expect(page.locator(".prosemirror-dropcursor-block")).toBeVisible();
    await page.mouse.up();
  } else {
    // Playwright's WebKit starts no HTML drag from a mouse press (see drag() above): the browser's own drag events,
    // sent in two steps so the line can be seen between the drag over the last block and the drop.
    const sent = (types: readonly string[]) =>
      grip.evaluate(
        (source, { at, types: names }) => {
          type Target = { dispatchEvent: (event: unknown) => boolean };
          const g = globalThis as unknown as {
            DataTransfer: new () => unknown;
            DragEvent: new (type: string, init: Record<string, unknown>) => unknown;
            document: { elementFromPoint: (x: number, y: number) => Target | null };
            dragData?: unknown;
          };
          g.dragData ??= new g.DataTransfer();
          const init = { bubbles: true, cancelable: true, dataTransfer: g.dragData, clientX: at.x, clientY: at.y };
          const handle = (source as unknown as { closest: (s: string) => Target }).closest("[data-block-handle]");
          for (const name of names) {
            const target =
              name === "dragstart" || name === "dragend" ? handle : g.document.elementFromPoint(at.x, at.y);
            target?.dispatchEvent(new g.DragEvent(name, init));
          }
        },
        { at: point, types },
      );
    await sent(["dragstart", "dragover"]);
    await expect(page.locator(".prosemirror-dropcursor-block")).toBeVisible();
    await sent(["drop", "dragend"]);
    await page.mouse.up();
  }
  await expect(lines).toHaveText(["second line", "third line", `${word} one`]);
  await expect(page.locator(".prosemirror-dropcursor-block")).toHaveCount(0);
  await discardAndRemove(page, word);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});

// Staging, 2026-11-21: the floating bar showed for a selected space, the block menu's chosen row looked like the rest
// (the theme's accent is the popover's colour), and a 3 px ring hugged the words while editing: now a light outline
// 8 px out, kept because every field shows where the keys go. An arrow down at the end of a last code block leaves it.
test("the_bar_skips_a_space_the_menu_marks_its_row_no_ring_and_an_arrow_leaves_a_code_block", async ({ page }) => {
  const watched = watch(page);
  const word = `marks${Date.now()}`;
  const { editor } = await cardWithCaret(page, word, `${word} alpha beta`);
  await expect(editor).toHaveCSS("box-shadow", /^(none|(rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(, )?)+)$/);
  await expect(editor).toHaveCSS("outline-offset", "8px");
  for (let i = 0; i < 4; i += 1) await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  const floating = page.getByRole("toolbar", { name: "Format the selected words" });
  await page.waitForTimeout(100);
  await expect(floating).toBeHidden();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("/");
  const menu = page.getByRole("listbox", { name: "Blocks" }).filter({ visible: true });
  const chosen = menu.locator("[aria-selected=true]");
  type Styles = { getComputedStyle: (element: unknown) => { backgroundColor: string } };
  const background = (locator: typeof chosen) =>
    locator.evaluate((el) => (globalThis as unknown as Styles).getComputedStyle(el).backgroundColor);
  expect(await background(chosen)).not.toBe(await background(menu.locator("[aria-selected=false]").first()));
  // Enter straight after the typing, as an impatient member presses it, before the menu has filtered.
  await page.keyboard.type("code");
  await page.keyboard.press("Enter");
  await page.keyboard.type("x = 1");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("after");
  await expect(editor.locator(":scope > *").last()).toHaveText("after");
  await expect(editor.locator("pre")).toHaveText("x = 1");
  await discardAndRemove(page, word);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  // Staging, 2026-11-21: on a line near the bottom of the screen the block menu opened below it, off the screen: it
  // was placed before its items were drawn, so it measured empty and did not flip above the line.
  test("the_block_menu_opened_near_the_bottom_stays_on_the_screen", async ({ page }) => {
    const watched = watch(page);
    const word = `phone${Date.now()}`;
    const filler = Array.from({ length: 12 }, (_, n) => `line ${n}`).join("\n\n");
    const { editor } = await cardWithCaret(page, word, `${word} start\n\n${filler}\n\nlast`);
    const last = editor.locator("p").last();
    await last.scrollIntoViewIfNeeded();
    const box = await last.boundingBox();
    if (box === null) throw new Error("no line");
    // The last line 60 px above the bottom of the screen, as a member typing at the end of a long card sees it.
    type Scroller = { scrollBy: (x: number, y: number) => void };
    await page.evaluate((y) => (globalThis as unknown as Scroller).scrollBy(0, y), box.y + box.height - (844 - 60));
    await last.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Enter");
    const line = await editor.locator("p").last().boundingBox();
    await page.keyboard.type("/");
    // The first change brings the unsaved bar, which takes its room above the cards: the line typed on stays where it
    // was (WebKit has no scroll anchoring, and there it jumped down by the bar's height, off the screen).
    expect((await editor.locator("p").last().boundingBox())?.y).toBe(line?.y);
    const menu = page.getByRole("listbox", { name: "Blocks" }).filter({ visible: true });
    await expect(menu).toBeVisible();
    // plugin-slash 7.23.0 shows the menu at once and moves it when floating-ui's computePosition settles (a promise), so
    // the box is read once it has; WebKit on CI drew it a frame before it moved.
    await expect
      .poll(async () => {
        const placed = await menu.boundingBox();
        return placed !== null && placed.y >= 0 && placed.y + placed.height <= 844;
      })
      .toBe(true);
    await page.keyboard.press("Escape");
    await discardAndRemove(page, word);
    expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
  });
});
