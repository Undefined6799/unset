// The card editor with SvelteKit's client running (P1.20k review gaps 15 and 16): opening an editor puts focus in its
// first text field, a list editor's hint is read with each row, and a moved card keeps focus on its move button. The
// cards it adds are deleted again, so the member page is as the other specs expect it.
import { expect, test } from "@playwright/test";
import { openPage } from "./observe.ts";
import { ACCOUNT, type PageFixture } from "./pages.ts";

const OWN_PAGE: PageFixture = {
  path: `/${ACCOUNT.did}`,
  route: "/:did",
  group: "app",
  expectJs: true,
  member: "account",
};

test("the_editor_focuses_its_text_and_a_moved_card_keeps_focus", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Add README" }).click();
  const readme = page.getByRole("dialog").getByRole("textbox", { name: "README" });
  await expect(readme).toBeFocused();
  await readme.fill("# Hello");
  await page.getByRole("dialog").getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  // A refused save (a links card with no link) closes the editor, so the page's alert with the reason is in view.
  await page.getByRole("button", { name: "Add links" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("main [role=alert]")).toBeVisible();

  await page.getByRole("button", { name: "Add links" }).click();
  const links = page.getByRole("dialog");
  await expect(links.getByRole("textbox", { name: "Title" })).toBeFocused();
  await expect(links.getByRole("group", { name: "Link 1", exact: true })).toHaveAccessibleDescription(
    /^Up to \d+ links\./,
  );
  await links.getByRole("textbox", { name: "Title" }).fill("Elsewhere");
  const first = links.getByRole("group", { name: "Link 1", exact: true });
  await first.getByRole("textbox", { name: "Address" }).fill("https://example.com/");
  await first.getByRole("textbox", { name: "Label" }).fill("Example");
  await links.getByRole("button", { name: "Add" }).click();
  await expect(links).toBeHidden();

  const readmeCard = page.getByRole("group", { name: "README card" });
  await readmeCard.getByRole("button", { name: "Move down" }).click();
  // At the bottom now, so its other move button takes focus.
  await expect(readmeCard.getByRole("button", { name: "Move up" })).toBeFocused();
  await expect(
    page.getByRole("group", { name: "Elsewhere card" }).getByRole("button", { name: "Move down" }),
  ).toBeVisible();

  for (const name of ["README card", "Elsewhere card"]) {
    await page.getByRole("group", { name }).getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("group", { name })).toHaveCount(0);
  }
});
