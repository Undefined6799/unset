// Text cards edited where they stand on the owner's page (ADR 0074 item 4): no Edit press, one Save for every changed
// card in the bar above the name, sticky under the site header; unsaved words kept on this device and offered back
// when the page opens, never merged on their own; Discard throws them away. All under the app's real CSP. The card
// added is deleted again.
import { expect, type Page, test } from "@playwright/test";
import { addCard, OWN_PAGE } from "./cards.ts";
import { addPageCookies, openPage, pageNoise, watch } from "./observe.ts";

/** The in-place editor of the Text card that holds `word`, once the page has loaded it. */
async function editorHolding(page: Page, word: string) {
  const card = page.locator('[data-slot="card"]', { hasText: word });
  const editor = card.locator("[data-text-in-place] [contenteditable]");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  return { card, editor };
}

async function openOwnPage(page: Page) {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
}

async function removeCard(page: Page, word: string) {
  const card = page.locator('[data-slot="card"]', { hasText: word });
  await card.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(card).toHaveCount(0);
}

const bar = (page: Page) =>
  page.getByRole("region", { name: "Unsaved changes" }).and(page.locator("[data-unsaved-bar]"));

test("a_text_card_is_edited_in_place_and_saved_from_the_bar", async ({ page }) => {
  const watched = watch(page);
  const word = `inplace${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} first` });
  await openOwnPage(page);
  await expect(bar(page)).toHaveCount(0);
  const { editor } = await editorHolding(page, word);
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(" and more");
  await expect(bar(page)).toContainText("1 card has unsaved changes.");
  await bar(page).getByRole("button", { name: "Save" }).click();
  await expect(bar(page).getByRole("status")).toHaveText("Saved.");
  await openOwnPage(page);
  await expect(page.locator('[data-slot="card"]', { hasText: word })).toContainText(`${word} first and more`);
  await expect(bar(page)).toHaveCount(0);
  await removeCard(page, word);
  expect(await pageNoise(page, watched)).toEqual({ consoleErrors: [], csp: [] });
});

test("unsaved_words_are_offered_back_after_a_reload_and_discard_drops_them", async ({ page }) => {
  const word = `draft${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} kept` });
  await openOwnPage(page);
  const { editor } = await editorHolding(page, word);
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(" typed");
  await expect(bar(page)).toContainText("1 card has unsaved changes.");
  // Leaving asks nothing (Alex 2026-11-20): the words wait on the device.
  await openOwnPage(page);
  await expect(bar(page)).toHaveCount(0);
  const offer = page.getByText("This device kept unsaved words for 1 card from an earlier visit.");
  await expect(offer).toBeVisible();
  await page.getByRole("button", { name: "Bring them back" }).click();
  await expect(bar(page)).toContainText("1 card has unsaved changes.");
  await expect((await editorHolding(page, word)).editor).toContainText(`${word} kept typed`);
  await bar(page).getByRole("button", { name: "Discard" }).click();
  await expect(bar(page)).toHaveCount(0);
  await expect((await editorHolding(page, word)).editor).toHaveText(`${word} kept`);
  await openOwnPage(page);
  await expect(offer).toHaveCount(0);
  await removeCard(page, word);
});

test("the_bar_sticks_under_the_site_header", async ({ page }) => {
  const word = `sticky${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, {
    kind: "readme",
    width: "full",
    surface: "filled",
    text: `${word}\n\n${"line\n\n".repeat(80)}`,
  });
  await openOwnPage(page);
  const { editor } = await editorHolding(page, word);
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially(" end");
  await expect(bar(page)).toBeVisible();
  await page.mouse.wheel(0, 3000);
  const header = await page.locator("[data-site-header]").boundingBox();
  await expect(async () => {
    const box = await bar(page).boundingBox();
    expect(Math.round(box?.y ?? -1)).toBe(Math.round((header?.y ?? 0) + (header?.height ?? 0)));
  }).toPass();
  await bar(page).getByRole("button", { name: "Discard" }).click();
  await removeCard(page, word);
});

// Review of f6c6a2f: the editors stay open while a Save is on its way, so words typed meanwhile must stay unsaved, with
// their draft, and the editor must not be redrawn under the member's caret when the answer comes.
test("words_typed_while_a_save_is_on_its_way_stay_unsaved", async ({ page }) => {
  const word = `during${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} one` });
  await openOwnPage(page);
  const { editor } = await editorHolding(page, word);
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(" two");
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\?\/saveAll$/, async (route) => {
    await held;
    await route.continue();
  });
  await bar(page).getByRole("button", { name: "Save" }).click();
  await expect(bar(page).getByRole("button", { name: "Saving…" })).toBeDisabled();
  await editor.pressSequentially(" three");
  release();
  await expect(bar(page).getByRole("status")).toHaveText("Saved.");
  await expect(bar(page)).toContainText("1 card has unsaved changes.");
  // The same editor, still focused: typing goes on where it was.
  await expect(editor).toBeFocused();
  await editor.pressSequentially(" four");
  await expect(editor).toContainText(`${word} one two three four`);
  await page.unroute(/\?\/saveAll$/);
  await openOwnPage(page);
  await expect(page.locator('[data-slot="card"]', { hasText: word })).toContainText(`${word} one two`);
  await expect(page.getByText("This device kept unsaved words for 1 card from an earlier visit.")).toBeVisible();
  await page.getByRole("button", { name: "Throw them away" }).click();
  await removeCard(page, word);
});

// Codex review of f6c6a2f: a Save sent to sign in again wrote nothing, so the words stay in this device's drafts.
test("a_save_sent_to_sign_in_again_keeps_the_words_as_drafts", async ({ page }) => {
  const word = `ended${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} kept` });
  await openOwnPage(page);
  const { editor } = await editorHolding(page, word);
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(" unsent");
  await expect(bar(page)).toContainText("1 card has unsaved changes.");
  // The action's answer when the sign-in has ended (+page.server.ts write: 303 to the sign-in page), as kit sends it.
  await page.route(/\?\/saveAll$/, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ type: "redirect", status: 303, location: "/login?error=login.session_ended" }),
    }),
  );
  await bar(page).getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/login/);
  await page.unroute(/\?\/saveAll$/);
  await openOwnPage(page);
  await expect(page.getByText("This device kept unsaved words for 1 card from an earlier visit.")).toBeVisible();
  await page.getByRole("button", { name: "Throw them away" }).click();
  await removeCard(page, word);
});

// Codex on 1bdb437: a card deleted from its menu with unsaved words leaves no count in the bar and no draft behind.
test("a_card_deleted_with_unsaved_words_leaves_nothing_unsaved", async ({ page }) => {
  const word = `gone${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} here` });
  await openOwnPage(page);
  const { editor } = await editorHolding(page, word);
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(" typed");
  await expect(bar(page)).toContainText("1 card has unsaved changes.");
  await removeCard(page, word);
  await expect(bar(page)).toHaveCount(0);
  await openOwnPage(page);
  await expect(page.getByText(/This device kept unsaved words/)).toHaveCount(0);
});

// Codex on 4fca548: typing into a card while an earlier visit's draft is offered keeps the new words on the device,
// so leaving afterwards loses nothing.
test("words_typed_while_a_draft_is_offered_are_kept", async ({ page }) => {
  const word = `offer${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} start` });
  await openOwnPage(page);
  let { editor } = await editorHolding(page, word);
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(" old");
  await openOwnPage(page);
  const offer = page.getByText(/This device kept unsaved words/);
  await expect(offer).toBeVisible();
  ({ editor } = await editorHolding(page, word));
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(" new");
  await expect(bar(page)).toContainText("1 card has unsaved changes.");
  const drop = page.getByRole("button", { name: "Throw them away" });
  if (await drop.isVisible()) await drop.click();
  await openOwnPage(page);
  await page.getByRole("button", { name: "Bring them back" }).click();
  await expect((await editorHolding(page, word)).editor).toContainText(`${word} start new`);
  await bar(page).getByRole("button", { name: "Discard" }).click();
  await removeCard(page, word);
});

// Codex on b69a0ce: a Width or Style change saved while an earlier visit's draft is offered keeps that draft offered;
// only new words replace it.
test("a_layout_change_saved_while_a_draft_is_offered_keeps_the_draft", async ({ page }) => {
  const word = `layout${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} start` });
  await openOwnPage(page);
  const { editor } = await editorHolding(page, word);
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(" kept");
  await openOwnPage(page);
  const offer = page.getByText(/This device kept unsaved words/);
  await expect(offer).toBeVisible();
  const card = page.locator('[data-slot="card"]', { hasText: word });
  await card.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitemradio", { name: "Half width" }).click();
  await page.keyboard.press("Escape");
  await expect(offer).toBeVisible();
  await bar(page).getByRole("button", { name: "Save" }).click();
  await expect(bar(page).getByRole("status")).toHaveText("Saved.");
  await openOwnPage(page);
  await page.getByRole("button", { name: "Bring them back" }).click();
  await expect((await editorHolding(page, word)).editor).toContainText(`${word} start kept`);
  await bar(page).getByRole("button", { name: "Discard" }).click();
  await removeCard(page, word);
});

// Codex on edc4570: while an earlier visit's draft is offered, a Width change discarded leaves the draft, and Throw
// them away removes it even with a Width change unsaved.
test("discarding_a_layout_change_keeps_an_offered_draft_and_throwing_it_away_removes_it", async ({ page }) => {
  const word = `answer${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} start` });
  await openOwnPage(page);
  const { editor } = await editorHolding(page, word);
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(" kept");
  const offer = page.getByText(/This device kept unsaved words/);
  const half = async () => {
    await page
      .locator('[data-slot="card"]', { hasText: word })
      .getByRole("button", { name: /^More for / })
      .click();
    await page.getByRole("menuitemradio", { name: "Half width" }).click();
    await page.keyboard.press("Escape");
    await expect(bar(page)).toContainText("1 card has unsaved changes.");
  };
  await openOwnPage(page);
  await half();
  await bar(page).getByRole("button", { name: "Discard" }).click();
  await openOwnPage(page);
  await expect(offer).toBeVisible();
  await half();
  await page.getByRole("button", { name: "Throw them away" }).click();
  await openOwnPage(page);
  await expect(offer).toHaveCount(0);
  await removeCard(page, word);
});

// Codex on b7db900: words put back to what was stored while a Save is on its way stay as typed, and unsaved.
test("words_put_back_while_a_save_is_on_its_way_stay_unsaved", async ({ page }) => {
  const word = `back${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} one` });
  await openOwnPage(page);
  const { editor } = await editorHolding(page, word);
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(" two");
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\?\/saveAll$/, async (route) => {
    await held;
    await route.continue();
  });
  await bar(page).getByRole("button", { name: "Save" }).click();
  await expect(bar(page).getByRole("button", { name: "Saving…" })).toBeDisabled();
  for (let i = 0; i < " two".length; i += 1) await editor.press("Backspace");
  await expect(editor).toHaveText(`${word} one`);
  release();
  await expect(bar(page).getByRole("status")).toHaveText("Saved.");
  await expect(bar(page)).toContainText("1 card has unsaved changes.");
  await expect(editor).toHaveText(`${word} one`);
  await page.unroute(/\?\/saveAll$/);
  await bar(page).getByRole("button", { name: "Save" }).click();
  // The first Save's "Saved." is still shown, so wait for this Save to leave nothing unsaved before reloading.
  await expect(bar(page)).not.toContainText("unsaved changes");
  await openOwnPage(page);
  await expect(page.locator('[data-slot="card"]', { hasText: word })).toContainText(`${word} one`);
  await expect(page.locator('[data-slot="card"]', { hasText: word })).not.toContainText("two");
  await removeCard(page, word);
});

// Codex on d91bf83: the editor reports its words once a frame, so a Save pressed in the same frame as the last
// keystroke must still send them. The words and the press are one task here, so no frame comes between them.
test("words_typed_in_the_frame_of_the_save_are_saved", async ({ page }) => {
  const word = `frame${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} one` });
  await openOwnPage(page);
  const { editor } = await editorHolding(page, word);
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(" two");
  await expect(bar(page)).toContainText("1 card has unsaved changes.");
  // ProseMirror reads the typed words from its MutationObserver, a microtask; the press comes in the next one, so the
  // editor holds the words and no frame has run.
  type Button = { textContent: string | null; click: () => void };
  type Doc = {
    execCommand: (command: string, ui: boolean, value: string) => boolean;
    querySelectorAll: (s: string) => Iterable<Button>;
  };
  await editor.evaluate(async (node: { ownerDocument: Doc }) => {
    const doc = node.ownerDocument;
    doc.execCommand("insertText", false, " three");
    await Promise.resolve();
    [...doc.querySelectorAll("[data-unsaved-bar] button")].find((button) => button.textContent === "Save")?.click();
  });
  await expect(bar(page)).not.toContainText("unsaved changes");
  await openOwnPage(page);
  await expect(page.locator('[data-slot="card"]', { hasText: word })).toContainText(`${word} one two three`);
  await removeCard(page, word);
});

/**
 * The own page as a member had it open before: an editor drawn, so the editor's script has run in this browser. CI
 * on WebKit failed the held and broken loads below only when the idle load had run first (runs 44971448694 and
 * 44971449858); here it is always so.
 */
async function warm(page: Page) {
  await openOwnPage(page);
  await expect(page.locator("[data-text-in-place] [contenteditable='true']").first()).toBeVisible();
}

/**
 * A page in a browser context of its own. WebKit gives a page a script it already holds in its memory cache without
 * asking page.route (in Playwright 1.64.1's WebKit no route call came for the editor's chunk once a page had loaded
 * it), so a hold or a failure set on a page that had drawn an editor did nothing, at random under load. A new context
 * starts with nothing cached here, while `page`'s visit stays the member's earlier one.
 */
async function freshPage(page: Page): Promise<Page> {
  const browser = page.context().browser();
  if (browser === null) throw new Error("no browser");
  return (await browser.newContext()).newPage();
}

/**
 * A fresh page (freshPage) whose editor's own script (the chunk that carries ProseMirror) is held for `ms`, or failed,
 * as a slow or broken load. Close it with closeHeld.
 */
async function holdEditorScript(page: Page, how: { readonly ms: number } | "fail"): Promise<Page> {
  await warm(page);
  const held = await freshPage(page);
  await held.route("**/_app/immutable/**/*.js", async (route) => {
    const answer = await route.fetch();
    const body = await answer.text();
    if (!body.includes("ProseMirror-")) return route.fulfill({ response: answer, body });
    if (how === "fail") return route.abort();
    await new Promise((done) => setTimeout(done, how.ms));
    return route.fulfill({ response: answer, body });
  });
  return held;
}

async function closeHeld(held: Page) {
  await held.context().close();
}

test("a_click_and_words_typed_before_the_editor_opens_are_kept", async ({ page }) => {
  const word = `early${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} start` });
  const held = await holdEditorScript(page, { ms: 1500 });
  // Not openOwnPage: its wait for a quiet network would wait out the held script.
  expect((await openPage(held, OWN_PAGE))?.status()).toBe(200);
  // A press before the page's own script runs is the browser's alone; from the moment it runs, the card listens.
  await expect(held.locator("[data-text-in-place][data-listening]")).not.toHaveCount(0);
  await expect(held.locator("[data-text-in-place] [contenteditable]")).toHaveCount(0);
  const card = held.locator('[data-slot="card"]', { hasText: word });
  await card.getByText(`${word} start`).click();
  await held.keyboard.type("Q");
  const { editor } = await editorHolding(held, word);
  await expect(editor).toBeFocused();
  await expect(editor).toContainText("Q");
  await held.keyboard.type("R");
  await expect(editor).toContainText("QR");
  await expect(bar(held)).toContainText("1 card has unsaved changes.");
  await bar(held).getByRole("button", { name: "Discard" }).click();
  await closeHeld(held);
  await removeCard(page, word);
});

// Staging, 2026-11-21 (cold load): a click on the words before the page's own script has run reached no listener,
// so the editor opened with no caret and the letters typed then were lost (WebKit once put them in the first list
// item). The browser keeps that click as a caret in the words; the card carries it into the editor.
test("a_click_before_the_page_script_runs_puts_the_caret_there_once_the_editor_opens", async ({ page }) => {
  const word = `cold${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `- first item\n\n${word} start` });
  // Every script of the page held, as a cold load on a slow line: the words are drawn and nothing listens yet. A
  // fresh page (freshPage), as WebKit serves the scripts it holds without asking the route.
  // Held until the click is made, then all let go: held by a fixed time instead, three waves of it (the page, its
  // parts, the editor) brought the editor 4.6 to 5.2 s after the click in Firefox, past the wait (CI, #1951).
  await warm(page);
  const cold = await freshPage(page);
  await addPageCookies(cold.context(), OWN_PAGE);
  const clicked = Promise.withResolvers<void>();
  await cold.route("**/_app/immutable/**/*.js", async (route) => {
    await clicked.promise;
    return route.continue();
  });
  await cold.goto(page.url(), { waitUntil: "commit" });
  const card = cold.locator('[data-slot="card"]', { hasText: word });
  const line = card.getByText(`${word} start`);
  await expect(line).toBeVisible();
  await expect(cold.locator("[data-text-in-place][data-listening]")).toHaveCount(0);
  const box = await line.boundingBox();
  if (box === null) throw new Error("no line");
  // At the end of the line, as the tester clicked at the end of a sentence.
  await cold.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
  clicked.resolve();
  const { editor } = await editorHolding(cold, word);
  await expect(editor).toBeFocused();
  // The editor draws the words where they were (the list's items and the space between blocks as the page draws
  // them), so nothing moves when it takes their place and the click's point is the same words in both. Within a
  // pixel: Firefox puts one of the two lines on a half pixel (331.5 against 331).
  const drawn = (await editor.locator(":scope > p").boundingBox())?.y ?? Number.NaN;
  expect(Math.abs(drawn - box.y)).toBeLessThanOrEqual(1);
  await cold.keyboard.type("Q");
  await expect(editor.locator(":scope > p")).toHaveText(`${word} startQ`);
  await expect(editor.locator("li")).toHaveText("first item");
  await bar(cold).getByRole("button", { name: "Discard" }).click();
  await removeCard(cold, word);
  await closeHeld(cold);
});

// Staging, 2026-11-21 23:52Z (tester, main 10f85af): a click at the end of "A weekly slow-radio show" before the
// editor opened put the caret on the line above, mid-word in Chromium. The page and the editor draw some blocks at
// different sizes (here a code block: 13 px on the page), so the click's point is other words once the editor shows.
// The click is carried as a place in the words, not a point on the screen.
test("a_click_before_the_editor_opens_lands_in_the_same_words_where_the_editor_draws_them_elsewhere", async ({
  page,
}) => {
  const word = `place${Date.now()}`;
  await openOwnPage(page);
  const code = "```\none\ntwo\nthree\nfour\n```";
  // The emoji is one character on the page and two UTF-16 units in the editor: the count must agree.
  const last = "A weekly 🎧 slow-radio show";
  const text = `${word} start\n\n${code}\n\nSound design for short films\n\n${last}`;
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text });
  const cold = await freshPage(page);
  await addPageCookies(cold.context(), OWN_PAGE);
  const clicked = Promise.withResolvers<void>();
  const typed = Promise.withResolvers<void>();
  // Every script held until the click, as a cold load; then the editor's own held until the letters are typed.
  await cold.route("**/_app/immutable/**/*.js", async (route) => {
    await clicked.promise;
    const answer = await route.fetch();
    const body = await answer.text();
    if (body.includes("ProseMirror-")) await typed.promise;
    return route.fulfill({ response: answer, body });
  });
  await cold.goto(page.url(), { waitUntil: "commit" });
  const card = cold.locator('[data-slot="card"]', { hasText: word });
  const line = card.getByText(last);
  await expect(line).toBeVisible();
  const box = await line.boundingBox();
  if (box === null) throw new Error("no line");
  await cold.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
  clicked.resolve();
  await expect(cold.locator("[data-text-in-place][data-listening]")).not.toHaveCount(0);
  await expect(cold.locator("[data-text-in-place] [contenteditable]")).toHaveCount(0);
  await cold.keyboard.type("EARLY");
  typed.resolve();
  const { editor } = await editorHolding(cold, word);
  await expect(editor).toBeFocused();
  await cold.keyboard.type("!");
  await expect(editor.locator(":scope > p").last()).toHaveText(`${last}EARLY!`);
  await expect(editor.locator(":scope > p").nth(1)).toHaveText("Sound design for short films");
  await bar(cold).getByRole("button", { name: "Discard" }).click();
  await removeCard(cold, word);
  await closeHeld(cold);
});

// Review of #1968 (Codex, 2026-11-22 00:17Z): a click just after a space landed before it, and a click at the start
// of a list's second item landed at the end of the first (the page draws <li>one</li><li>two</li>, nothing between).
// Codex on 921401f (00:53Z): a click at the start of the line after a hard line break landed at the end of the line
// before it, and a click inside a code block's indentation landed before the indentation (white space was one space).
for (const { name, within, has, piece, at, expected } of [
  { name: "just_after_a_space", within: "p", has: "hello", piece: 0, at: 6, expected: "hello EARLYworld" },
  { name: "at_the_start_of_a_later_list_item", within: "li", has: "two", piece: 0, at: 0, expected: "EARLYtwo" },
  {
    name: "at_the_start_of_the_line_after_a_line_break",
    within: "p",
    has: "right",
    piece: 1,
    at: 0,
    expected: "left\nEARLYright",
  },
  { name: "inside_a_code_block_s_indentation", within: "pre", has: "foo", piece: 0, at: 4, expected: "    EARLYfoo" },
]) {
  test(`a_click_before_the_editor_opens_${name}_lands_on_the_same_side`, async ({ page }) => {
    const word = `side${Date.now()}`;
    await openOwnPage(page);
    const text = `${word} start\n\nhello world\n\n- one\n- two\n\nleft  \nright\n\n\`\`\`\n    foo\n\`\`\``;
    await addCard(page, { kind: "readme", width: "full", surface: "filled", text });
    const cold = await freshPage(page);
    await addPageCookies(cold.context(), OWN_PAGE);
    const clicked = Promise.withResolvers<void>();
    const typed = Promise.withResolvers<void>();
    await cold.route("**/_app/immutable/**/*.js", async (route) => {
      await clicked.promise;
      const answer = await route.fetch();
      const body = await answer.text();
      if (body.includes("ProseMirror-")) await typed.promise;
      return route.fulfill({ response: answer, body });
    });
    await cold.goto(page.url(), { waitUntil: "commit" });
    const card = cold.locator('[data-slot="card"]', { hasText: word });
    const target = card.locator(within, { hasText: has });
    await expect(target).toBeVisible();
    // The left edge of the character at `at`, a pixel in: the browser puts the caret just before it.
    const point = await target.evaluate(
      (element, { index, skip }) => {
        const page = element.ownerDocument;
        // NodeFilter.SHOW_TEXT (the e2e project has no DOM types).
        const walker = page.createTreeWalker(element, 4);
        let words = walker.nextNode();
        for (let left = skip; words !== null; words = walker.nextNode()) {
          if ((words.textContent ?? "").trim() === "") continue;
          if (left === 0) break;
          left -= 1;
        }
        if (words === null) throw new Error("no words");
        const range = page.createRange();
        range.setStart(words, index);
        range.setEnd(words, index + 1);
        const box = range.getBoundingClientRect();
        return { x: box.left + 1, y: box.top + box.height / 2 };
      },
      { index: at, skip: piece },
    );
    await cold.mouse.click(point.x, point.y);
    clicked.resolve();
    await expect(cold.locator("[data-text-in-place][data-listening]")).not.toHaveCount(0);
    await expect(cold.locator("[data-text-in-place] [contenteditable]")).toHaveCount(0);
    await cold.keyboard.type("EARLY");
    typed.resolve();
    const { editor } = await editorHolding(cold, word);
    await expect(editor).toBeFocused();
    // As drawn, so the side of a line break shows (innerText writes it as a new line).
    await expect
      .poll(() =>
        editor.locator(within, { hasText: has }).evaluate((element) => (element as { innerText: string }).innerText),
      )
      .toBe(expected);
    await bar(cold).getByRole("button", { name: "Discard" }).click();
    await removeCard(cold, word);
    await closeHeld(cold);
  });
}

/**
 * The Text card specs share one member, whose profile bucket refills one write every two seconds (limits.ts `profile`,
 * 30 a minute). As cards-stale.spec.ts does, a test that adds cards waits for its writes to come back, so the spec
 * after this one (text-markdown.spec.ts) is not refused.
 */
async function giveBackWrites(page: Page, used: number) {
  await page.waitForTimeout(used * 2_000 + 1_000);
}

/** The own page opened while the editor's script is held, with every Text card listening and none drawn yet. */
async function openHeld(page: Page): Promise<Page> {
  const held = await holdEditorScript(page, { ms: 1500 });
  // Not openOwnPage: its wait for a quiet network would wait out the held script.
  expect((await openPage(held, OWN_PAGE))?.status()).toBe(200);
  await expect(held.locator("[data-text-in-place]:not([data-listening])")).toHaveCount(0);
  await expect(held.locator("[data-text-in-place] [contenteditable]")).toHaveCount(0);
  return held;
}

// Codex on 46550e5: only the card pressed last takes the keys typed before the editors open, and a card lets go of
// them once the member presses anywhere else.
test("keys_typed_before_the_editor_opens_go_only_to_the_card_pressed_last", async ({ page }) => {
  const first = `firstcard${Date.now()}`;
  const second = `secondcard${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${first} start` });
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${second} start` });
  const held = await openHeld(page);
  await held.getByText(`${first} start`).click();
  await held.getByText(`${second} start`).click();
  await held.keyboard.type("XY");
  const one = await editorHolding(held, first);
  const two = await editorHolding(held, second);
  await expect(two.editor).toContainText("XY");
  await expect(one.editor).toHaveText(`${first} start`);
  await expect(bar(held)).toContainText("1 card has unsaved changes.");
  await bar(held).getByRole("button", { name: "Discard" }).click();
  await closeHeld(held);
  // A press outside every card lets go too.
  const again = await openHeld(page);
  await again.getByText(`${first} start`).click();
  await again.locator("main").click({ position: { x: 2, y: 2 } });
  await again.keyboard.type("Z");
  await expect((await editorHolding(again, first)).editor).toHaveText(`${first} start`);
  await expect(again.getByText("unsaved changes")).toHaveCount(0);
  await closeHeld(again);
  await removeCard(page, first);
  await removeCard(page, second);
  await giveBackWrites(page, 4);
});

// Codex on 46550e5: a key the card cannot replay (Backspace, Enter, an arrow) ends the keys it keeps, so the words
// that reach the editor are only ever ones the member typed in that order: "ab", Backspace, "c" never becomes "abc".
test("a_key_typed_before_the_editor_opens_that_cannot_be_replayed_ends_the_kept_keys", async ({ page }) => {
  const word = `replay${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} start` });
  const held = await openHeld(page);
  await held.getByText(`${word} start`).click();
  await held.keyboard.type("ab");
  await held.keyboard.press("Backspace");
  await held.keyboard.type("c");
  const { editor } = await editorHolding(held, word);
  await expect(editor).toContainText("ab");
  await expect(editor).not.toContainText("c");
  await bar(held).getByRole("button", { name: "Discard" }).click();
  await closeHeld(held);
  await removeCard(page, word);
  await giveBackWrites(page, 2);
});

test("a_click_on_the_card_around_the_words_puts_the_caret_in_them", async ({ page }) => {
  const word = `around${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} start` });
  await openOwnPage(page);
  const { card, editor } = await editorHolding(page, word);
  const box = await card.boundingBox();
  if (box === null) throw new Error("the card has no box");
  await page.mouse.click(box.x + 6, box.y + box.height - 6);
  await expect(editor).toBeFocused();
  await page.keyboard.type("Z");
  await expect(editor).toHaveText(`${word} startZ`);
  await bar(page).getByRole("button", { name: "Discard" }).click();
  await removeCard(page, word);
});

test("an_editor_that_cannot_load_says_so", async ({ page }) => {
  const word = `broken${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} start` });
  const held = await holdEditorScript(page, "fail");
  await openOwnPage(held);
  const card = held.locator('[data-slot="card"]', { hasText: word });
  await expect(card.getByRole("alert")).toHaveText("The editor could not load. Reload the page to edit here.");
  await expect(card).toContainText(`${word} start`);
  await closeHeld(held);
  await removeCard(page, word);
});

test("after_a_save_typing_goes_on_where_it_was", async ({ page }) => {
  const word = `onward${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} start` });
  await openOwnPage(page);
  const { editor } = await editorHolding(page, word);
  await editor.click();
  await editor.press("End");
  await page.keyboard.type(" one");
  await bar(page).getByRole("button", { name: "Save" }).click();
  await expect(bar(page)).not.toContainText("unsaved changes");
  await expect(editor).toBeFocused();
  await page.keyboard.type(" two");
  await expect(editor).toHaveText(`${word} start one two`);
  await expect(bar(page)).toContainText("1 card has unsaved changes.");
  await bar(page).getByRole("button", { name: "Discard" }).click();
  await removeCard(page, word);
});

// Staging, 2026-11-21: letters typed in the instant after pressing Save went to the button and were lost; focus came
// back only once the Save had answered. The press hands the keys straight back to the words.
test("letters_typed_straight_after_pressing_save_stay_in_the_words", async ({ page }) => {
  const word = `quick${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} start` });
  await openOwnPage(page);
  const { editor } = await editorHolding(page, word);
  await editor.click();
  await editor.press("End");
  await page.keyboard.type(" one");
  // A Save that takes a moment to answer, as on a phone line.
  await page.route(/\?\/saveAll$/, async (route) => {
    await new Promise((done) => setTimeout(done, 1000));
    return route.continue();
  });
  const saved = page.waitForResponse(/\?\/saveAll$/);
  await bar(page).getByRole("button", { name: "Save" }).click();
  await page.keyboard.type(" two");
  await expect(editor).toHaveText(`${word} start one two`);
  // Once the Save has answered (a Discard while it is out would cancel it), " two" is what is left unsaved.
  await saved;
  await expect(bar(page)).toContainText("1 card has unsaved changes.");
  await page.unroute(/\?\/saveAll$/);
  await bar(page).getByRole("button", { name: "Discard" }).click();
  await removeCard(page, word);
});

// Review of c753f37: only a pointer press hands the keys back to the words. A member who reached Save by Tab is not
// in the middle of a word, so Enter or Space pressed twice there saves once and puts nothing in the card.
test("enter_or_space_pressed_twice_on_save_saves_once_and_leaves_the_words", async ({ page }) => {
  const word = `keysave${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} start` });
  await openOwnPage(page);
  const { editor } = await editorHolding(page, word);
  let saves = 0;
  page.on("request", (request) => {
    if (/\?\/saveAll$/.test(request.url())) saves += 1;
  });
  for (const [key, typed] of [
    ["Enter", " one"],
    ["Space", " two"],
  ] as const) {
    await editor.click();
    await editor.press("End");
    await page.keyboard.type(typed);
    const before = saves;
    const saved = page.waitForResponse(/\?\/saveAll$/);
    await bar(page).getByRole("button", { name: "Save" }).focus();
    await page.keyboard.press(key);
    await page.keyboard.press(key);
    await saved;
    await expect(bar(page).getByRole("status")).toHaveText("Saved.");
    await expect(bar(page)).not.toContainText("unsaved");
    expect(saves - before).toBe(1);
  }
  await expect(editor).toHaveText(`${word} start one two`);
  await expect(editor.locator("[data-type='hardbreak']")).toHaveCount(0);
  await removeCard(page, word);
});

/** Two frames of the page: a change the editor reports reaches the page within them (milkdown.ts, once a frame). */
async function nextFrames(page: Page) {
  await page.evaluate(() => {
    const view = globalThis as unknown as { requestAnimationFrame(next: () => void): number };
    return new Promise<void>((done) => view.requestAnimationFrame(() => view.requestAnimationFrame(() => done())));
  });
}

// #1967 on WebKit (run 44969033836): when the answer came before the second press, the Save had already put the
// caret back in the words, so that press went into the card and left it unsaved. A Save made by keyboard leaves the
// keys where they are, however soon its answer comes. #1981 on WebKit (run 44971445183): once Save goes, focus falls
// to the page and WebKit still sends Enter and Space to the words where the caret was left, a frame later; so the
// test waits out that frame and reads the words exactly (a typed space included).
test("enter_or_space_pressed_again_after_a_keyboard_save_answered_leaves_the_words", async ({ page }) => {
  const word = `keyagain${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} start` });
  await openOwnPage(page);
  const { editor } = await editorHolding(page, word);
  for (const [key, typed, words] of [
    ["Enter", " one", `${word} start one`],
    ["Space", " two", `${word} start one two`],
  ] as const) {
    await editor.click();
    await editor.press("End");
    await page.keyboard.type(typed);
    const saved = page.waitForResponse(/\?\/saveAll$/);
    await bar(page).getByRole("button", { name: "Save" }).focus();
    await page.keyboard.press(key);
    await saved;
    await expect(bar(page).getByRole("status")).toHaveText("Saved.");
    await expect(editor).not.toBeFocused();
    await page.keyboard.press(key);
    await nextFrames(page);
    await expect(bar(page).getByRole("status")).toHaveText("Saved.");
    await expect(bar(page)).not.toContainText("unsaved");
    expect(await editor.evaluate((node) => node.textContent)).toBe(words);
  }
  await expect(editor).toHaveText(`${word} start one two`);
  await expect(editor.locator("[data-type='hardbreak']")).toHaveCount(0);
  await removeCard(page, word);
});

// Codex on b9d96b6: the Markdown field (Show Markdown) is a way back too, so a Save from it returns there and not to
// the editor the member typed in before.
test("after_a_save_from_the_markdown_field_typing_goes_on_there", async ({ page }) => {
  const word = `plainback${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} start` });
  await openOwnPage(page);
  const { card, editor } = await editorHolding(page, word);
  await editor.click();
  await editor.press("End");
  await page.keyboard.type(" one");
  await card.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show Markdown" }).click();
  await page.keyboard.press("Escape");
  const field = page.locator('textarea[aria-label^="Text of the"]');
  await field.click();
  await field.press("End");
  await page.keyboard.type(" two");
  await bar(page).getByRole("button", { name: "Save" }).click();
  await expect(bar(page)).not.toContainText("unsaved changes");
  await expect(field).toBeFocused();
  await page.keyboard.type(" three");
  await expect(field).toHaveValue(`${word} start one two three`);
  await bar(page).getByRole("button", { name: "Discard" }).click();
  // A field's value is no text the card's filter finds, so the card is found by its field to show its words again.
  await page
    .locator('[data-slot="card"]', { has: field })
    .getByRole("button", { name: /^More for / })
    .click();
  await page.getByRole("menuitemcheckbox", { name: "Show Markdown" }).click();
  await page.keyboard.press("Escape");
  await removeCard(page, word);
  await giveBackWrites(page, 3);
});

test("the_words_show_a_focus_ring_as_every_other_field_does", async ({ page }) => {
  const word = `ring${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} start` });
  await openOwnPage(page);
  const { editor } = await editorHolding(page, word);
  await editor.focus();
  // The spec's types have no DOM, so the browser's own function is named by its shape.
  // A light outline 8 px out, so the words never touch it (staging, 2026-11-21: a 3 px ring hugged them).
  type Styles = { getComputedStyle: (element: unknown) => { outlineStyle: string; outlineOffset: string } };
  const ring = await editor.evaluate((el) => {
    const style = (globalThis as unknown as Styles).getComputedStyle(el);
    return [style.outlineStyle, style.outlineOffset];
  });
  expect(ring).toEqual(["solid", "8px"]);
  await removeCard(page, word);
});

// Codex on c6cddd7: words typed during a Save stay unsaved on the version that Save wrote, never on one another tab
// wrote after it. So when the other tab saves the card while this Save's answer is on its way, this tab's next Save
// is refused as a conflict instead of writing over the other tab's words.
test("a_save_after_another_tab_wrote_the_card_meanwhile_is_a_conflict", async ({ page, context }) => {
  const word = `tabs${Date.now()}`;
  await openOwnPage(page);
  await addCard(page, { kind: "readme", width: "full", surface: "filled", text: `${word} one` });
  await openOwnPage(page);
  const { editor } = await editorHolding(page, word);
  await editor.click();
  await editor.press("End");
  await editor.pressSequentially(" two");
  const other = await context.newPage();
  // The other tab's whole visit runs inside this route, longer than one expect waits on a slow WebKit (half a CPU,
  // 2026-11-22): this tab waits for it before it looks for the answer.
  const written = Promise.withResolvers<void>();
  await page.route(/\?\/saveAll$/, async (route) => {
    try {
      const answer = await route.fetch();
      // The other tab writes the card after this Save landed and before this tab reads the cards again.
      await openOwnPage(other);
      const there = await editorHolding(other, word);
      await there.editor.click();
      await there.editor.press("End");
      await there.editor.pressSequentially(" elsewhere");
      await bar(other).getByRole("button", { name: "Save" }).click();
      await expect(bar(other)).not.toContainText("unsaved changes");
      await route.fulfill({ response: answer });
    } finally {
      written.resolve();
    }
  });
  await bar(page).getByRole("button", { name: "Save" }).click();
  await expect(bar(page).getByRole("button", { name: "Saving…" })).toBeDisabled();
  await editor.pressSequentially(" three");
  await written.promise;
  await expect(bar(page).getByRole("status")).toHaveText("Saved.");
  await page.unroute(/\?\/saveAll$/);
  await expect(bar(page)).toContainText("1 card has unsaved changes.");
  await bar(page).getByRole("button", { name: "Save" }).click();
  await expect(bar(page).getByRole("alert")).toHaveText(
    "This card changed somewhere else since you opened it. Reload to see it, then save again.",
  );
  await openOwnPage(page);
  await expect(page.locator('[data-slot="card"]', { hasText: word })).toContainText(`${word} one two elsewhere`);
  await page.getByRole("button", { name: "Throw them away" }).click();
  await other.close();
  await removeCard(page, word);
});
