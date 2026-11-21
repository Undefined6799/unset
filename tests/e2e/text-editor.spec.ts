// The Text card's rich editor (P1.21u, ADR 0073): Milkdown over the plain field, which is what the form posts. Its
// toolbar and markdown shortcuts write the app's markdown; pasted HTML goes through ProseMirror's one Trusted Types
// policy under the app's real CSP with no violation; text the member opens and saves untouched is stored as it was;
// on a phone the editor fills the screen with its formatting bar at the top. The cards added are deleted again.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { addCard, deleteCard, OWN_PAGE, postedText, writeText } from "./cards.ts";
import { openPage, pageNoise, watch } from "./observe.ts";
import { phone } from "./phone.ts";

async function openNewText(page: Page) {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Add card" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Text/ }).click();
  const editor = dialog.getByRole("textbox", { name: "Text" });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  return { dialog, editor };
}

/** Picks a text style (Normal text, Heading 1 to 3) from the bar's Heading menu. */
async function chooseStyle(page: Page, dialog: Locator, style: string) {
  await dialog.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Heading" }).click();
  await page.getByRole("menuitemcheckbox", { name: style }).click();
}

test("the_toolbar_and_shortcuts_write_markdown_into_the_posted_field", async ({ page }) => {
  const watched = watch(page);
  const { dialog, editor } = await openNewText(page);
  await expect(postedText(dialog)).toHaveAttribute("aria-hidden", "true");
  await writeText(editor, ["Title", "a word"]);
  await editor.press("Home");
  await editor.press("Shift+End");
  await dialog.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Bold" }).click();
  await expect(postedText(dialog)).toHaveValue("Title\n\n**a word**");
  // A click puts the caret in the first line, as a member does; an arrow key raced WebKit's restored selection in CI.
  await editor.getByText("Title", { exact: true }).click();
  await chooseStyle(page, dialog, "Heading 2");
  await expect(postedText(dialog)).toHaveValue("## Title\n\n**a word**");
  await writeText(editor, ["- one", "two"]);
  await expect(postedText(dialog)).toHaveValue("- one\n- two");
  await page.keyboard.press("Escape");
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});

// Alex 2026-11-20 on staging: the buttons "kind of work" and he could not pick a heading size. Each block button now
// shows when it is on and takes the text back to a plain paragraph when pressed again, and the Heading menu offers
// every size the page shows.
test("each_block_button_shows_it_is_on_and_turns_off_again", async ({ page }) => {
  const { dialog, editor } = await openNewText(page);
  const bar = dialog.getByRole("toolbar", { name: "Formatting" });
  const blocks = [
    ["List", "- one two"],
    ["Numbered list", "1. one two"],
    ["Quote", "> one two"],
    ["Code block", "```\none two\n```"],
  ] as const;
  for (const [name, written] of blocks) {
    await writeText(editor, ["one two"]);
    const button = bar.getByRole("button", { name, exact: true });
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await button.click();
    await expect(postedText(dialog)).toHaveValue(written);
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await button.click();
    await expect(postedText(dialog)).toHaveValue("one two");
    await expect(button).toHaveAttribute("aria-pressed", "false");
  }
  await page.keyboard.press("Escape");
});

test("the_heading_menu_sets_each_size_and_back_to_normal_text", async ({ page }) => {
  const { dialog, editor } = await openNewText(page);
  await writeText(editor, ["Title"]);
  for (const [style, written] of [
    ["Heading 1", "# Title"],
    ["Heading 2", "## Title"],
    ["Heading 3", "### Title"],
    ["Normal text", "Title"],
  ] as const) {
    await chooseStyle(page, dialog, style);
    await expect(postedText(dialog)).toHaveValue(written);
    await dialog.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Heading" }).click();
    await expect(page.getByRole("menuitemcheckbox", { name: style })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
  }
  // Focus is back in the text, so typing goes on where it was.
  await editor.press("End");
  await page.keyboard.type("!");
  await expect(postedText(dialog)).toHaveValue("Title!");
  await page.keyboard.press("Escape");
});

test("bold_italic_and_code_show_they_are_on_for_the_selected_words", async ({ page }) => {
  const { dialog, editor } = await openNewText(page);
  const bar = dialog.getByRole("toolbar", { name: "Formatting" });
  await writeText(editor, ["one two"]);
  await editor.getByText("one two").dblclick({ position: { x: 4, y: 8 } });
  for (const [name, written] of [
    ["Bold", "**one** two"],
    ["Italic", "_**one**_ two"],
  ] as const) {
    const button = bar.getByRole("button", { name, exact: true });
    await button.click();
    await expect(postedText(dialog)).toHaveValue(written);
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  await page.keyboard.press("Escape");
});

// A press the page could not show (a quote around a heading, a list inside a quote) used to do nothing at all; the
// button is now unavailable instead, and switching a list's kind changes the list rather than nesting a new one.
test("a_button_the_page_could_not_show_is_unavailable_and_lists_switch_kind", async ({ page }) => {
  const { dialog, editor } = await openNewText(page);
  const bar = dialog.getByRole("toolbar", { name: "Formatting" });
  await writeText(editor, ["one"]);
  await chooseStyle(page, dialog, "Heading 2");
  await expect(bar.getByRole("button", { name: "Quote", exact: true })).toBeDisabled();
  await chooseStyle(page, dialog, "Normal text");
  await expect(bar.getByRole("button", { name: "Quote", exact: true })).toBeEnabled();
  await bar.getByRole("button", { name: "List", exact: true }).click();
  await expect(postedText(dialog)).toHaveValue("- one");
  await bar.getByRole("button", { name: "Numbered list", exact: true }).click();
  await expect(postedText(dialog)).toHaveValue("1. one");
  await expect(bar.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(bar.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
});

// Impatient members: five quick presses leave the text as an odd number of presses would.
test("rapid_presses_on_a_block_button_end_where_one_press_would", async ({ page }) => {
  const { dialog, editor } = await openNewText(page);
  await writeText(editor, ["one"]);
  const list = dialog.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "List", exact: true });
  for (let i = 0; i < 5; i += 1) await list.click({ delay: 0 });
  await expect(postedText(dialog)).toHaveValue("- one");
  await page.keyboard.press("Escape");
});

// A real copy and paste, by keyboard, from another page with no CSP, as a member copies from another site: Firefox
// gives a paste event made by script empty clipboard data, and the app's own Trusted Types refuse to build the hostile
// markup on its page, so only this reaches ProseMirror's clipboard parser in every engine.
async function paste(page: Page, editor: Locator, html: string) {
  const elsewhere = await page.context().newPage();
  await elsewhere.setContent(`<div id="copy" contenteditable="true">${html}</div>`);
  // Playwright's selectText selects the element's contents with a range (playwright-core 1.64.1 injected selectText),
  // since select-all inside a quote copies only its paragraphs in Chromium.
  await elsewhere.locator("#copy").selectText();
  await elsewhere.keyboard.press("ControlOrMeta+c");
  await elsewhere.close();
  await page.bringToFront();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+v");
}

// Chromium copies computed styles as inline style attributes; the app's style-src-attr refuses them while ProseMirror
// parses the paste, which is the CSP working (markdown keeps no styles). No other message may appear.
const STYLE_ATTR = /style-src-attr/;
const TRUSTED_TYPES = /trusted.?types|TrustedHTML/i;

test("pasted_html_becomes_markdown_with_no_policy_violation", async ({ page }) => {
  const watched = watch(page);
  const { dialog, editor } = await openNewText(page);
  await paste(page, editor, "<p><strong>pasted</strong> text</p>");
  await expect(postedText(dialog)).toHaveValue("**pasted** text");
  await page.keyboard.press("Escape");
  expect(watched.pageErrors).toEqual([]);
  const noise = await pageNoise(page, watched);
  expect([...noise.consoleErrors, ...noise.csp].filter((text) => !STYLE_ATTR.test(text))).toEqual([]);
});

// What a flaw in paste handling could reach (ADR 0073): markup with a script in it is parsed in a detached document
// through the one policy, and the page's script-src still refuses the inline handler, so nothing of it runs.
test("a_script_in_pasted_html_does_not_run", async ({ page }) => {
  const watched = watch(page);
  const { dialog, editor } = await openNewText(page);
  await paste(
    page,
    editor,
    '<p>hi <img src="/none" onerror="document.title=\'pwned\'"><script>document.title="pwned"</script></p>',
  );
  await expect(postedText(dialog)).toHaveValue(/^hi/);
  await page.keyboard.press("Escape");
  expect(await page.title()).not.toBe("pwned");
  expect(watched.pageErrors).toEqual([]);
  expect((await pageNoise(page, watched)).csp.filter((text) => TRUSTED_TYPES.test(text))).toEqual([]);
});

test("text_opened_and_saved_untouched_is_stored_as_it_was", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  const stored = "* star bullet\n\n1) first\n\n~~~\ncode\n~~~";
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: stored });
  await page.reload();
  await page.waitForLoadState("networkidle");
  const card = page.getByRole("group", { name: "Text card" });
  await card.getByRole("link", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "Text" })).toHaveAttribute("contenteditable", "true");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await card.getByRole("link", { name: "Edit" }).click();
  await expect(postedText(dialog)).toHaveValue(stored);
  await page.keyboard.press("Escape");
  await deleteCard(page, "Text card");
});

// Codex review of #1827: the editor turns its text into markdown once per frame. A save sent in the same moment as an
// edit, before that frame, still posts the edit.
test("a_save_sent_in_the_same_moment_as_an_edit_posts_it", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: "plain" });
  await page.reload();
  await page.waitForLoadState("networkidle");
  const card = page.getByRole("group", { name: "Text card" });
  await card.getByRole("link", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "Text" })).toHaveAttribute("contenteditable", "true");
  const quote = dialog.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Quote" });
  await quote.evaluate((button) => {
    // No DOM lib in this project: the two calls this test makes, in one task so no frame runs between them.
    type Form = { requestSubmit: () => void };
    const area = button as unknown as {
      click: () => void;
      closest: (selector: string) => { querySelector: (s: string) => { form: Form } } | null;
    };
    area.click();
    area.closest("[role=dialog]")?.querySelector('textarea[name="text"]').form.requestSubmit();
  });
  await expect(dialog).toBeHidden();
  await card.getByRole("link", { name: "Edit" }).click();
  await expect(postedText(dialog)).toHaveValue("> plain");
  await page.keyboard.press("Escape");
  await deleteCard(page, "Text card");
});

// Codex review of #1827: the page shows a quote as one paragraph of text (parse.ts), so Quote wraps only paragraphs;
// on a heading or a list it does nothing, and the editor never shows formatting the saved card would lose.
test("quote_wraps_paragraphs_and_leaves_headings_and_lists_alone", async ({ page }) => {
  const { dialog, editor } = await openNewText(page);
  const quote = dialog.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Quote" });
  await writeText(editor, ["- one", "two"]);
  await editor.press("ControlOrMeta+a");
  await expect(quote).toBeDisabled();
  await expect(postedText(dialog)).toHaveValue("- one\n- two");
  await writeText(editor, ["## Title"]);
  await editor.press("ControlOrMeta+a");
  await expect(quote).toBeDisabled();
  await expect(postedText(dialog)).toHaveValue("## Title");
  await writeText(editor, ["plain"]);
  await quote.click();
  await expect(postedText(dialog)).toHaveValue("> plain");
  await page.keyboard.press("Escape");
});

// Stored text the page shows flat (a list in a quote, a quote or heading in a list item) still opens in full, and an
// edit elsewhere keeps it: the editor refuses to add such nesting but never drops it.
test("stored_text_the_page_shows_flat_opens_whole_and_is_kept", async ({ page }) => {
  const watched = watch(page);
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  const stored = "> - one\n> - two\n\n- a\n\n  > q\n\n- b\n\n  ## h";
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: stored });
  await page.reload();
  await page.waitForLoadState("networkidle");
  const card = page.getByRole("group", { name: "Text card" });
  await card.getByRole("link", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  const editor = dialog.getByRole("textbox", { name: "Text" });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(editor).toContainText("two");
  await editor.getByText("one", { exact: true }).click();
  await editor.press("End");
  await editor.pressSequentially("!");
  await expect(postedText(dialog)).toHaveValue(/one!/);
  for (const kept of ["two", "q", "h"]) await expect(postedText(dialog)).toHaveValue(new RegExp(kept));
  await page.keyboard.press("Escape");
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
  await deleteCard(page, "Text card");
});

// Codex review of #1827: Undo goes back to what the member had, even to a shape the editor would not let them add.
test("undo_brings_back_deleted_text_the_page_shows_flat", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: "> - one\n> - two" });
  await page.reload();
  await page.waitForLoadState("networkidle");
  const card = page.getByRole("group", { name: "Text card" });
  await card.getByRole("link", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  const editor = dialog.getByRole("textbox", { name: "Text" });
  await writeText(editor, ["gone"]);
  await expect(postedText(dialog)).toHaveValue("gone");
  const bar = dialog.getByRole("toolbar", { name: "Formatting" });
  // Undo as often as it takes, as a member does: how many steps typing makes is the browser's to decide.
  const undo = bar.getByRole("button", { name: "Undo" });
  await expect(async () => {
    if (await undo.isEnabled()) await undo.click();
    await expect(postedText(dialog)).toHaveValue("> - one\n> - two", { timeout: 500 });
  }).toPass();
  await page.keyboard.press("Escape");
  await deleteCard(page, "Text card");
});

// Codex review of #1827: the page reads one paragraph per list item, so a paste that puts two in one item is refused.
test("a_paste_with_two_paragraphs_in_a_list_item_is_refused", async ({ page }) => {
  const { dialog, editor } = await openNewText(page);
  await paste(page, editor, "<ul><li><p>one</p><p>two</p></li></ul>");
  await editor.pressSequentially("typed");
  await expect(postedText(dialog)).toHaveValue("typed");
  await page.keyboard.press("Escape");
});

// Codex review of #1827: a line break in a list item is written as a continuation line the page moves out of the
// list, so it is refused there.
test("a_line_break_in_a_list_item_is_refused", async ({ page }) => {
  const { dialog, editor } = await openNewText(page);
  await writeText(editor, ["- one"]);
  await expect(postedText(dialog)).toHaveValue("- one");
  await editor.press("Shift+Enter");
  await editor.pressSequentially("two");
  await expect(postedText(dialog)).toHaveValue("- onetwo");
  await page.keyboard.press("Escape");
});

// Codex review of #1827: the page shows a quote as one paragraph and a line break as a space, so neither a second
// paragraph in a quote nor a line break in a paragraph is added.
test("a_quote_keeps_one_paragraph_and_no_line_break_is_added", async ({ page }) => {
  const { dialog, editor } = await openNewText(page);
  await paste(page, editor, "<p>a</p><blockquote><p>one</p><p>two</p></blockquote><p>b</p>");
  await editor.pressSequentially("typed");
  await expect(postedText(dialog)).toHaveValue("typed");
  await editor.press("Shift+Enter");
  await editor.pressSequentially("more");
  await expect(postedText(dialog)).toHaveValue("typedmore");
  await page.keyboard.press("Escape");
});

// Codex review of #1827: the page nests lists three deep and shows a fourth level beside the third, so a paste that
// nests deeper is refused.
test("a_paste_nesting_lists_deeper_than_the_page_shows_is_refused", async ({ page }) => {
  const { dialog, editor } = await openNewText(page);
  await paste(
    page,
    editor,
    "<p>a</p><ul><li>one<ul><li>two<ul><li>three<ul><li>four</li></ul></li></ul></li></ul></li></ul><p>b</p>",
  );
  await editor.pressSequentially("typed");
  await expect(postedText(dialog)).toHaveValue("typed");
  await paste(page, editor, "<p>a</p><ul><li>one<ul><li>two<ul><li>three</li></ul></li></ul></li></ul><p>b</p>");
  await expect(postedText(dialog)).toHaveValue(/ {4}- three/);
  await page.keyboard.press("Escape");
});

// Codex review of #1827: bold and italic together are written so the page reads both, "***word***" it reads wrongly.
// The second press also acts on the words the first one did.
test("bold_and_italic_together_are_written_so_the_page_reads_both", async ({ page }) => {
  const { dialog, editor } = await openNewText(page);
  await writeText(editor, ["word"]);
  await editor.press("Home");
  await editor.press("Shift+End");
  const bar = dialog.getByRole("toolbar", { name: "Formatting" });
  await bar.getByRole("button", { name: "Bold" }).click();
  await expect(postedText(dialog)).toHaveValue("**word**");
  await bar.getByRole("button", { name: "Italic" }).click();
  await expect(postedText(dialog)).toHaveValue("_**word**_");
  await page.keyboard.press("Escape");
});

// Codex review of #1827: an italic stored or typed with "*" inside bold is written with "_" once edited.
test("an_italic_with_stars_inside_bold_is_written_so_the_page_reads_it", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: "**a *b***" });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.getByRole("group", { name: "Text card" }).getByRole("link", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  const editor = dialog.getByRole("textbox", { name: "Text" });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.getByText("a", { exact: true }).click();
  await editor.press("Home");
  await editor.pressSequentially("z ");
  await expect(postedText(dialog)).toHaveValue("**z a _b_**");
  await page.keyboard.press("Escape");
  await deleteCard(page, "Text card");
});

// Codex review of #1827: a new card's field is required and starts empty. A save sent in the same moment as the first
// edit, before the editor's next frame, must not be stopped by the browser as an empty field.
test("a_new_text_saved_in_the_same_moment_as_its_first_edit_is_added", async ({ page }) => {
  const { dialog, editor } = await openNewText(page);
  await editor.click();
  await editor.evaluate(async (area) => {
    // No DOM lib in this project: the calls this test makes. ProseMirror reads typed text from its DOM watcher, a
    // microtask after the input; the save follows that, with no frame in between.
    type Doc = { execCommand: (command: string, ui: boolean, value: string) => boolean };
    type Field = { form: { requestSubmit: () => void } };
    const box = area as unknown as {
      ownerDocument: Doc;
      closest: (selector: string) => { querySelector: (s: string) => Field } | null;
    };
    box.ownerDocument.execCommand("insertText", false, "first");
    await Promise.resolve();
    await Promise.resolve();
    box.closest("[role=dialog]")?.querySelector('textarea[name="text"]').form.requestSubmit();
  });
  await expect(dialog).toBeHidden();
  await page.getByRole("group", { name: "Text card" }).getByRole("link", { name: "Edit" }).click();
  await expect(postedText(dialog)).toHaveValue("first");
  await page.keyboard.press("Escape");
  await deleteCard(page, "Text card");
});

// Impatient member: the editor's file loads when the dialog opens (ADR 0069 split). Text typed into the plain field
// before it arrives is carried into the editor and still posted.
test("text_typed_before_the_editor_loads_is_kept", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  await page.route("**/_app/immutable/chunks/*.js", async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole("link", { name: "Add card" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Text/ }).click();
  await postedText(dialog).fill("typed early");
  release();
  const editor = dialog.getByRole("textbox", { name: "Text" });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(editor).toHaveText("typed early");
  await expect(postedText(dialog)).toHaveValue("typed early");
  await page.keyboard.press("Escape");
});

// Review of #1843: opened in place (?edit=, the page's own panel, not a dialog), the formatting bar sticks under the
// sticky site header, so it stays usable while a long text scrolls.
test("the_in_place_toolbar_sticks_below_the_site_header", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} of a long text.`).join("\n\n");
  await addCard(page, { kind: "readme", width: "full", text: `# Long text\n\n${long}` });
  await page.reload();
  try {
    const href = await page
      .getByRole("group", { name: "Text card" })
      .getByRole("link", { name: "Edit" })
      .getAttribute("href");
    await page.goto(new URL(href ?? "", page.url()).toString());
    // Exact: the page's own in-place editor for the card is "Text of the Text card" (ADR 0074 item 4).
    const editor = page.getByRole("textbox", { name: "Text", exact: true });
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await editor.getByText("Paragraph 30 of a long text.").scrollIntoViewIfNeeded();
    const header = await page.locator("[data-site-header]").boundingBox();
    const bar = await page.getByRole("toolbar", { name: "Formatting" }).boundingBox();
    expect(header !== null && bar !== null && bar.y >= header.y + header.height - 0.5).toBe(true);
    await openPage(page, OWN_PAGE);
  } finally {
    await deleteCard(page, "Text card");
  }
});

test.describe("on a phone", () => {
  test.use(phone({ width: 375, height: 800 }));
  test("the_editor_fills_the_screen_with_its_bar_at_the_top", async ({ page }) => {
    const { dialog, editor } = await openNewText(page);
    const shown = page.getByRole("dialog", { name: "Add text" });
    // Measured once the stock zoom-in has ended.
    await expect
      .poll(async () => {
        const box = await shown.boundingBox();
        return box === null ? null : [box.x, box.y, box.width, box.height].map(Math.round);
      })
      .toEqual([0, 0, 375, 800]);
    const bar = await dialog.getByRole("toolbar", { name: "Formatting" }).boundingBox();
    const area = await editor.boundingBox();
    expect(bar !== null && area !== null && bar.y < area.y).toBe(true);
    await page.keyboard.press("Escape");
  });
});
