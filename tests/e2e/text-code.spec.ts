// A Text card's code block (P1.21v, Alex 2026-11-23 03:51Z): the editor shows it in CodeMirror (apps/web/lib/editor/
// code-block.ts), the stored text stays a fenced Markdown block, and the app's CSP and Trusted Types rule stay as they
// are, with nothing refused. Code that looks like markup, a script, an event handler or a
// javascript: link is only ever text: in the editor and on the page, with no element made from it and nothing run.
// The cards added are deleted again.
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { addCard, OWN_PAGE, paceWrites, postedText, spendsWrites } from "./cards.ts";
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

/** The computed text colour of the first element `where` finds. */
const colourOf = (where: Locator) =>
  where
    .first()
    .evaluate(
      (el) =>
        (globalThis as unknown as { getComputedStyle: (e: unknown) => { color: string } }).getComputedStyle(el).color,
    );

/**
 * The same page with script off, as the member: the owner's page draws a Text card in the editor when script runs, and
 * the server-drawn card only without it. Its own context, counted against the write budget (cards.ts spendsWrites).
 */
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

// The newest card's code: a card's text sits beside its group of controls, not in it.
const newestCode = (page: Page) => page.locator("main pre code").last();

test("code_on_the_page_is_coloured_by_the_server_with_the_editors_colours", async ({ browser, page }) => {
  const watched = watch(page);
  await openStored(page, '```js\nconst a = "<b>x</b>"; // note\n```');
  // Coloured as the server draws it, before any script; the string stays escaped text.
  const html = await (await page.request.get(page.url())).text();
  expect(html).toContain('<span class="code-keyword">const</span>');
  expect(html).not.toContain("<b>x</b>");
  const quiet = await withoutScript(browser, page);
  const code = newestCode(quiet);
  await expect(code).toHaveText('const a = "<b>x</b>"; // note');
  const pageKeyword = await colourOf(code.locator(".code-keyword"));
  const pageString = await colourOf(code.locator(".code-string"));
  expect(pageKeyword).not.toBe(pageString);
  expect(pageKeyword).not.toBe(await colourOf(code));
  await quiet.context().close();
  // The card in the editor, with script: the same text in the same two colours.
  const content = page.locator("main .cm-editor .cm-content").last();
  await expect(content).toHaveText('const a = "<b>x</b>"; // note');
  expect(await colourOf(content.locator(".code-keyword"))).toBe(pageKeyword);
  expect(await colourOf(content.locator(".code-string"))).toBe(pageString);
  expect(watched.pageErrors).toEqual([]);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
  await deleteNewest(page);
});

test("markup_coloured_as_html_on_the_page_stays_text", async ({ browser, page }) => {
  const body = HOSTILE_LINES.join("\n");
  await openStored(page, `\`\`\`html\n${body}\n\`\`\``);
  const quiet = await withoutScript(browser, page);
  const code = newestCode(quiet);
  await expect(code.locator(".code-tag").first()).toBeVisible();
  expect(await code.evaluate((el) => (el as unknown as { textContent: string }).textContent)).toBe(body);
  expect(await madeFromCode(code)).toEqual(NOTHING_MADE);
  await quiet.context().close();
  await deleteNewest(page);
});

/**
 * A new card's key, so the test can remove the card it added: a TID (atproto.com/specs/tid), the microseconds since
 * 1970 and a random clock id in base32-sortable, as domains/profile parseNewCardKey accepts.
 */
function newCardKey(): string {
  let value = (BigInt(Date.now()) * 1000n) << 10n;
  value |= BigInt(Math.floor(Math.random() * 1024));
  let key = "";
  for (let i = 0; i < 13; i += 1) {
    key = "234567abcdefghijklmnopqrstuvwxyz"[Number(value & 31n)] + key;
    value >>= 5n;
  }
  return key;
}

// Review of #2004 at e36de8a: the server colours a member's code inside the page load, and one Textile line of "<a "
// took minutes there, stalling the web process for every visitor. Within the colouring limits
// (interfaces/web limits.ts CODE_COLOUR_LIMITS) the page answers at once and shows the code as plain text. The card is
// added and removed by the form actions alone: the owner's page with script would draw it in the editor.
test("hostile_code_on_the_page_is_plain_and_the_page_answers_quickly", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  const key = newCardKey();
  const line = "<a ".repeat(3_000);
  await addCard(page, {
    kind: "readme",
    width: "full",
    surface: "filled",
    text: `\`\`\`textile\n${line}\n\`\`\``,
    newKey: key,
  });
  const started = Date.now();
  const answer = await page.request.get(page.url());
  expect(answer.status()).toBe(200);
  expect(Date.now() - started).toBeLessThan(5_000);
  // The whole line as one run of escaped text: a coloured one would be split by spans.
  expect(await answer.text()).toContain(line.replaceAll("<", "&lt;"));
  const removed = await page.evaluate(async (card) => {
    const body = new URLSearchParams({ key: card });
    const init = { method: "POST", body, headers: { accept: "text/html" }, redirect: "manual" } as const;
    return (await fetch("?/remove", init)).type;
  }, key);
  expect(removed).toBe("opaqueredirect");
});

// The editor colours what the page colours (CODE_COLOUR_LIMITS through cardEditLimits): the same parsers froze the
// member's own tab on one long line (Textile "<a " repeated: 94 s per 20,000-character line, "Make page code colouring
// safe" thread on #2008), since a stream parser takes a whole line in one step that nothing interrupts.
test("code_grown_past_the_limits_turns_plain_and_shrunk_back_is_coloured_again", async ({ page }) => {
  await openStored(page, "```js\nlet a = 1;\n```");
  const content = page.locator("main .cm-editor .cm-content").last();
  await expect(content.locator(".code-keyword")).toHaveText("let");
  await content.click();
  await page.keyboard.press("End");
  // One line past the page's 400 characters (interfaces/web limits.ts CODE_COLOUR_LIMITS lineChars).
  await page.keyboard.insertText(` // ${"x".repeat(450)}`);
  await expect(content.locator(".code-keyword")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(content.locator(".code-keyword")).toHaveText("let");
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

// Codex on #2003 at ae4c0d4: an arrow on a wrapped row of a code block's first or last line moves to the next row of
// the code, as in any editor; it leaves the block only from the row at its top or bottom.
test("an_arrow_on_a_wrapped_row_of_code_stays_in_the_code", async ({ page }) => {
  const watched = watch(page);
  const long = "word ".repeat(150).trim();
  const card = await openStored(page, `above\n\n\`\`\`\n${long}\n\`\`\`\n\nbelow`);
  const { dialog, editor } = await openEditor(page, card);
  const code = editor.locator(".cm-content");
  await code.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("ArrowUp");
  await expect(code).toBeFocused();
  await page.keyboard.type("X");
  await expect(postedText(dialog)).not.toHaveValue(/X\n```\n\nbelow/);
  await expect(postedText(dialog)).toHaveValue(/^above\n\n```\nword .*X.*\n```\n\nbelow$/);
  await page.keyboard.press("Escape");
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
  await deleteNewest(page);
});

// Codex on #2003 at ae4c0d4: code selected backwards stays backwards in the outer editor, so a block change keeps the
// end the keys move.
test("code_selected_backwards_keeps_its_direction_when_the_block_changes", async ({ page }) => {
  const watched = watch(page);
  const card = await openStored(page, "```\nabcdef\n```");
  const { dialog, editor } = await openEditor(page, card);
  await editor.locator(".cm-content").click();
  await page.keyboard.press("End");
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("Shift+ArrowLeft");
  await dialog.getByRole("button", { name: "Code block" }).click();
  await expect(editor.locator("p")).toHaveText("abcdef");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.type("X");
  await expect(postedText(dialog)).toHaveValue("abX");
  await page.keyboard.press("Escape");
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
  await deleteNewest(page);
});
