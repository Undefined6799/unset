// A Text card's code block (P1.21v, Alex 2026-11-23 03:51Z): the editor shows it in CodeMirror (apps/web/lib/editor/
// code-block.ts), the stored text stays a fenced Markdown block, and the app's CSP and Trusted Types rule stay as they
// are, with nothing refused. Code that looks like markup, a script, an event handler or a
// javascript: link is only ever text: in the editor and on the page, with no element made from it and nothing run.
// The cards added are deleted again.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { addCard, OWN_PAGE, paceWrites, postedText } from "./cards.ts";
import { openPage, pageNoise, watch } from "./observe.ts";

paceWrites(test);

const PWNED = "pwned";
// Each line would run or load something if it were ever read as HTML.
const HOSTILE_LINES = [
  `<script>document.title="${PWNED}"</script>`,
  `<img src="/none" onerror="document.title='${PWNED}'">`,
  `<a href="javascript:document.title='${PWNED}'">link</a>`,
  `<b onclick="document.title='${PWNED}'">bold</b>`,
];
// A language name is the fence's info string, which another app can write as anything.
const HOSTILE_LANGUAGE = `"><img/src=/none/onerror=document.title='${PWNED}'>`;

async function openStored(page: Page, stored: string) {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: stored });
  await page.reload();
  await page.waitForLoadState("networkidle");
  // The newest card: one a failed test left behind stays above it until the run's database is dropped.
  return page.getByRole("group", { name: "Text card" }).last();
}

async function openEditor(page: Page, card: Locator) {
  await card.getByRole("link", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  const editor = dialog.getByRole("textbox", { name: "Text" });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  return { dialog, editor };
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

/** Elements the hostile code would make if it were read as HTML, inside `where` and any shadow root in it. */
async function madeFromCode(where: Locator) {
  return where.evaluate((root) => {
    // The spec's types have no DOM, so the browser's own nodes are named by their shape.
    type Node = {
      localName: string;
      shadowRoot: Root | null;
      getAttribute: (name: string) => string | null;
      getAttributeNames: () => string[];
    };
    type Root = { querySelectorAll: (selector: string) => Iterable<Node> };
    const all: Node[] = [];
    const walk = (from: Root) => {
      for (const element of from.querySelectorAll("*")) {
        all.push(element);
        if (element.shadowRoot) walk(element.shadowRoot);
      }
    };
    walk(root as unknown as Root);
    const named = (tag: string) => all.filter((element) => element.localName === tag);
    return {
      scripts: named("script").length,
      images: named("img").length,
      bold: named("b").length,
      scriptLinks: named("a").filter((a) =>
        (a.getAttribute("href") ?? "").trim().toLowerCase().startsWith("javascript:"),
      ).length,
      handlers: all.filter((element) => element.getAttributeNames().some((name: string) => name.startsWith("on")))
        .length,
    };
  });
}

const NOTHING_MADE = { scripts: 0, images: 0, bold: 0, scriptLinks: 0, handlers: 0 };

test("a_code_block_edits_in_codemirror_and_stays_a_fenced_block", async ({ page }) => {
  const watched = watch(page);
  const card = await openStored(page, "```js\nconst a = 1;\n```");
  const { dialog, editor } = await openEditor(page, card);
  const code = editor.locator(".cm-editor .cm-content");
  await expect(code).toHaveText("const a = 1;");
  await expect(editor.getByRole("textbox", { name: "Code language" })).toHaveValue("js");
  await code.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" // two");
  await expect(postedText(dialog)).toHaveValue("```js\nconst a = 1; // two\n```");
  await page.keyboard.press("Escape");
  expect(watched.pageErrors).toEqual([]);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
  await deleteNewest(page);
});

test("markup_and_script_in_a_code_block_stay_text_on_the_page_and_in_the_editor", async ({ page }) => {
  const watched = watch(page);
  const body = HOSTILE_LINES.join("\n");
  const stored = `\`\`\`${HOSTILE_LANGUAGE}\n${body}\n\`\`\``;
  const card = await openStored(page, stored);
  // The page as the server draws it, which every visitor gets before any script: each line is escaped text.
  const html = (await (await page.request.get(page.url())).text()).replace(/<!--[^>]*-->/g, "");
  for (const raw of [
    "<script>document.title",
    '<img src="/none"',
    '<a href="javascript:',
    "<b onclick",
    HOSTILE_LANGUAGE,
  ]) {
    expect(html).not.toContain(raw);
  }
  for (const line of HOSTILE_LINES) expect(html).toContain(line.replaceAll("&", "&amp;").replaceAll("<", "&lt;"));
  const { dialog, editor } = await openEditor(page, card);
  await expect(editor.locator(".cm-editor .cm-content")).toHaveText(HOSTILE_LINES.join(""));
  await expect(editor.getByRole("textbox", { name: "Code language" })).toHaveValue(HOSTILE_LANGUAGE);
  expect(await madeFromCode(editor)).toEqual(NOTHING_MADE);
  await expect(postedText(dialog)).toHaveValue(stored);
  await page.keyboard.press("Escape");
  expect(await page.title()).not.toBe(PWNED);
  expect(watched.pageErrors).toEqual([]);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
  await deleteNewest(page);
});

test("a_script_pasted_into_a_code_block_stays_text", async ({ page }) => {
  const watched = watch(page);
  const card = await openStored(page, "```\nx\n```");
  const { dialog, editor } = await openEditor(page, card);
  // A real copy and paste, as a member does: the line copied as text from another page's field.
  const elsewhere = await page.context().newPage();
  await elsewhere.setContent('<textarea id="copy"></textarea>');
  await elsewhere.locator("#copy").fill(HOSTILE_LINES[1] as string);
  await elsewhere.locator("#copy").selectText();
  await elsewhere.keyboard.press("ControlOrMeta+c");
  await elsewhere.close();
  await page.bringToFront();
  await editor.locator(".cm-editor .cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(postedText(dialog)).toHaveValue(`\`\`\`\nx${HOSTILE_LINES[1]}\n\`\`\``);
  expect(await madeFromCode(editor)).toEqual(NOTHING_MADE);
  await page.keyboard.press("Escape");
  expect(await page.title()).not.toBe(PWNED);
  expect(watched.pageErrors).toEqual([]);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
  await deleteNewest(page);
});

// Codex on #2003 at fcac4c8: the language field sits in the card's form, so Enter there saved the card; it only sets the
// language and goes back to the code.
test("enter_in_the_language_field_sets_the_language_and_keeps_the_card_open", async ({ page }) => {
  const watched = watch(page);
  const card = await openStored(page, "```\nx = 1\n```");
  const { dialog, editor } = await openEditor(page, card);
  const language = editor.getByRole("textbox", { name: "Code language" });
  await language.fill("py");
  await language.press("Enter");
  await expect(postedText(dialog)).toHaveValue("```py\nx = 1\n```");
  await expect(dialog).toBeVisible();
  await expect(editor.locator(".cm-content")).toBeFocused();
  await page.keyboard.press("Escape");
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
  await deleteNewest(page);
});
