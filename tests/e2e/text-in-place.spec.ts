// Text cards edited where they stand on the owner's page (ADR 0074 item 4): no Edit press, one Save for every changed
// card in the bar above the name, sticky under the site header; unsaved words kept on this device and offered back
// when the page opens, never merged on their own; Discard throws them away. All under the app's real CSP. The card
// added is deleted again.
import { expect, type Page, test } from "@playwright/test";
import { addCard, OWN_PAGE } from "./cards.ts";
import { openPage, pageNoise, watch } from "./observe.ts";

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
