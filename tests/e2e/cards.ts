// What the card specs share: the member's own page, and adding and deleting cards. The cards a spec adds are deleted
// again, so the member page is as the other specs expect it. Card writes count against the member's 30 a minute
// (interfaces/web/src/lib/server/limits.ts), so specs keep their writes few.
import { expect, type Page } from "@playwright/test";
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
