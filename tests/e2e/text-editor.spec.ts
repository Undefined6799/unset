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
  await dialog.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Heading" }).click();
  await expect(postedText(dialog)).toHaveValue("## Title\n\n**a word**");
  await writeText(editor, ["- one", "two"]);
  await expect(postedText(dialog)).toHaveValue("- one\n- two");
  await page.keyboard.press("Escape");
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});

// A real copy and paste, by keyboard, from another page with no CSP, as a member copies from another site: Firefox
// gives a paste event made by script empty clipboard data, and the app's own Trusted Types refuse to build the hostile
// markup on its page, so only this reaches ProseMirror's clipboard parser in every engine.
async function paste(page: Page, editor: Locator, html: string) {
  const elsewhere = await page.context().newPage();
  await elsewhere.setContent(`<div id="copy" contenteditable="true">${html}</div>`);
  await elsewhere.locator("#copy").focus();
  await elsewhere.keyboard.press("ControlOrMeta+a");
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
  const heading = dialog.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Heading" });
  await heading.evaluate((button) => {
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
  await expect(postedText(dialog)).toHaveValue("## plain");
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
  await quote.click();
  await expect(postedText(dialog)).toHaveValue("- one\n- two");
  await writeText(editor, ["## Title"]);
  await editor.press("ControlOrMeta+a");
  await quote.click();
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
