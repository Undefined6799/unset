// The card editor with SvelteKit's client running (P1.20k review gaps 15 and 16; outside review of f5cab2f, finding
// 1). Opening an editor puts focus in its first text field; a list editor's hint is read with each row. A refused save
// keeps the editor open with what was typed and the reason inside it; a save closes it, returns focus to the button
// that opened it, and cannot be sent twice while on its way; editing a stored card saves in place. A moved card keeps
// focus on its move button. The cards added are deleted again, so the member page is as the other specs expect it.
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

test("the_card_editor_saves_once_keeps_a_refusal_and_returns_focus", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const creates: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("?/create")) creates.push(r.url());
  });

  // Add README: focus in the text area; a save held back by the test cannot be sent twice.
  const addReadme = page.getByRole("button", { name: "Add README" });
  await addReadme.click();
  const dialog = page.getByRole("dialog");
  const readme = dialog.getByRole("textbox", { name: "README" });
  await expect(readme).toBeFocused();
  await readme.fill("# Hello");
  let release: () => void = () => undefined;
  const held = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/*", async (route) => {
    if (route.request().method() === "POST" && route.request().url().endsWith("?/create")) await held;
    await route.continue();
  });
  const add = dialog.getByRole("button", { name: "Add" });
  await add.click();
  await expect(add).toBeDisabled();
  // A second submit by other means (Enter in a field would do it) is cancelled while the first is on its way.
  await dialog.locator("form").evaluate((form: { requestSubmit: () => void }) => form.requestSubmit());
  release();
  await expect(dialog).toBeHidden();
  await page.unroute("**/*");
  expect(creates).toHaveLength(1);
  await expect(addReadme).toBeFocused();
  await expect(page.getByRole("heading", { name: "Hello" })).toBeVisible();

  // Add links with no link: refused, so the editor stays open with the title kept and the reason inside it.
  const addLinks = page.getByRole("button", { name: "Add links" });
  await addLinks.click();
  await expect(dialog.getByRole("textbox", { name: "Title" })).toBeFocused();
  await expect(dialog.getByRole("group", { name: "Link 1", exact: true })).toHaveAccessibleDescription(
    /^Up to \d+ links\./,
  );
  await dialog.getByRole("textbox", { name: "Title" }).fill("Elsewhere");
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue("Elsewhere");
  await expect(dialog.getByRole("button", { name: "Add" })).toBeEnabled();
  const first = dialog.getByRole("group", { name: "Link 1", exact: true });
  await first.getByRole("textbox", { name: "Address" }).fill("https://example.com/");
  await first.getByRole("textbox", { name: "Label" }).fill("Example");
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog).toBeHidden();
  await expect(addLinks).toBeFocused();

  // Edit the stored README: saved in place, the editor closes and focus goes back to its Edit button.
  const readmeCard = page.getByRole("group", { name: "README card" });
  await readmeCard.getByRole("button", { name: "Edit" }).click();
  await expect(dialog.getByRole("textbox", { name: "README" })).toHaveValue("# Hello");
  await dialog.getByRole("textbox", { name: "README" }).fill("# Hello again");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Hello again" })).toBeVisible();
  await expect(readmeCard.getByRole("button", { name: "Edit" })).toBeFocused();

  // Move the README down: at the bottom now, so its other move button takes focus.
  await readmeCard.getByRole("button", { name: "Move down" }).click();
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
