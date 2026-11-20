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
  await editor.press("ArrowUp");
  await dialog.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Heading" }).click();
  await expect(postedText(dialog)).toHaveValue("## Title\n\n**a word**");
  await writeText(editor, ["- one", "two"]);
  await expect(postedText(dialog)).toHaveValue("- one\n- two");
  await page.keyboard.press("Escape");
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});

async function paste(editor: Locator, html: string) {
  await editor.click();
  await editor.evaluate((area, markup) => {
    // No DOM lib in this project: the browser's own constructors, typed as far as this test uses them.
    type Data = { setData: (type: string, value: string) => void };
    const browser = globalThis as unknown as {
      DataTransfer: new () => Data;
      ClipboardEvent: new (
        type: string,
        init: { clipboardData: Data; bubbles: boolean; cancelable: boolean },
      ) => object;
    };
    const data = new browser.DataTransfer();
    data.setData("text/html", markup);
    data.setData("text/plain", "plain");
    const paste = new browser.ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    (area as unknown as { dispatchEvent: (event: object) => boolean }).dispatchEvent(paste);
  }, html);
}

test("pasted_html_becomes_markdown_with_no_policy_violation", async ({ page }) => {
  const watched = watch(page);
  const { dialog, editor } = await openNewText(page);
  await paste(editor, "<p><strong>pasted</strong> text</p>");
  await expect(postedText(dialog)).toHaveValue("**pasted** text");
  await page.keyboard.press("Escape");
  expect(watched.pageErrors).toEqual([]);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});

// What a flaw in paste handling could reach (ADR 0073): markup with a script in it is parsed in a detached document
// through the one policy, and the page's script-src still refuses the inline handler, so nothing of it runs.
test("a_script_in_pasted_html_does_not_run", async ({ page }) => {
  const watched = watch(page);
  const { dialog, editor } = await openNewText(page);
  await paste(
    editor,
    '<p>hi <img src="/none" onerror="document.title=\'pwned\'"><script>document.title="pwned"</script></p>',
  );
  await expect(postedText(dialog)).toHaveValue(/^hi/);
  await page.keyboard.press("Escape");
  expect(await page.title()).not.toBe("pwned");
  expect(watched.pageErrors).toEqual([]);
  expect((await pageNoise(page, watched)).csp.every((text) => /inline event handler|img-src/i.test(text))).toBe(true);
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
