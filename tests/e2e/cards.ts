// What the card specs share: the member's own page, and adding and deleting cards. The cards a spec adds are deleted
// again, so the member page is as the other specs expect it. Card writes count against the member's 30 a minute
// (interfaces/web/src/lib/server/limits.ts), so specs keep their writes few.
import { expect, type Locator, type Page } from "@playwright/test";
import { ACCOUNT, type PageFixture } from "./pages.ts";

export const OWN_PAGE: PageFixture = {
  path: `/${ACCOUNT.did}`,
  route: "/:did",
  group: "app",
  expectJs: true,
  member: "account",
};

/** Adds a card as a plain form post (the fields as the editor names them), then reloads the page. */
export async function addCard(page: Page, fields: Record<string, string>) {
  const status = await page.evaluate(async (body) => {
    const init = {
      method: "POST",
      body: new URLSearchParams(body),
      headers: { accept: "text/html" },
      redirect: "manual",
    } as const;
    const answer = await fetch("?/create", init);
    return answer.type === "opaqueredirect" ? 303 : answer.status;
  }, fields);
  expect(status).toBe(303);
}
/** The three-dot menu button on the card whose controls are grouped under `name` ("Gamma card"). */
export const menuButton = (page: Page, name: string) =>
  page.getByRole("group", { name }).getByRole("button", { name: `More for ${name}` });
export async function chooseFromMenu(page: Page, name: string, item: string) {
  await menuButton(page, name).click();
  await page.getByRole("menuitem", { name: item }).click();
}
export async function deleteCard(page: Page, name: string) {
  await chooseFromMenu(page, name, "Delete");
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("group", { name })).toHaveCount(0);
}

/** The Text card's posted markdown: the plain field the rich editor writes into (P1.21u). */
export const postedText = (dialog: Locator) => dialog.locator('textarea[name="text"]');

/**
 * Types into the Text card's rich editor as a member does, one block per entry with Enter between, after clearing
 * it; markdown shortcuts ("# ", "*a*") turn into formatting as they are typed.
 */
export async function writeText(editor: Locator, blocks: readonly string[]) {
  // The editor's own file loads when the dialog opens (ADR 0069 split), so wait for it before typing.
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.click();
  // The editor puts its selection back a moment after a toolbar press, which can undo a select-all made at once:
  // clear until it is empty.
  await expect(async () => {
    await editor.press("ControlOrMeta+a");
    await editor.press("Backspace");
    await expect(editor).toHaveText("", { timeout: 500 });
  }).toPass();
  for (const [i, block] of blocks.entries()) {
    if (i > 0) await editor.press("Shift+Enter");
    await editor.pressSequentially(block);
  }
}
