// A member's own page left open in one tab while another tab changes the cards (P1.20p).
import { expect, test } from "@playwright/test";
import { addCard, chooseFromMenu, deleteCard, menuButton, OWN_PAGE } from "./cards.ts";
import { openPage } from "./observe.ts";

const linksCard = (title: string) => ({
  kind: "links",
  width: "full",
  title,
  "items.0.uri": `${title.toLowerCase()}.example`,
});

// P1.20p (the #1754 WebKit diagnosis, 2026-11-19): a member leaves their page open in one tab, reorders the cards in
// another, then comes back to the first, stale tab and deletes a card from its menu. The menu still opens with Delete,
// the delete goes through, and the page then shows the server's order. Cleanup reloads first and deletes without
// masking a failure of the test itself. Two cards, not three: card writes share the member's 30 a minute with
// cards.spec.ts (cards.ts), and three pushed that file's last test over it.
test("a_stale_tab_still_deletes_a_card_after_another_tab_reordered", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  for (const title of ["Alpha", "Beta"]) await addCard(page, linksCard(title));
  await page.reload();
  await page.waitForLoadState("networkidle");
  const headings = (on: typeof page) => on.getByRole("heading", { level: 2 }).filter({ hasText: /^(Alpha|Beta)$/ });
  let failure: unknown;
  try {
    await expect(headings(page)).toHaveText(["Alpha", "Beta"]);
    const other = await page.context().newPage();
    await other.goto(page.url());
    await other.waitForLoadState("networkidle");
    await chooseFromMenu(other, "Beta card", "Move up");
    await expect(headings(other)).toHaveText(["Beta", "Alpha"]);
    await other.close();

    // Back on the first tab, which still shows Alpha, Beta.
    await page.bringToFront();
    await expect(headings(page)).toHaveText(["Alpha", "Beta"]);
    await menuButton(page, "Alpha card").click();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("group", { name: "Alpha card" })).toHaveCount(0);
    await expect(headings(page)).toHaveText(["Beta"]);
  } catch (error) {
    failure = error;
  } finally {
    await page.reload();
    await page.waitForLoadState("networkidle");
    for (const name of ["Alpha card", "Beta card"]) {
      if ((await page.getByRole("group", { name }).count()) > 0) await deleteCard(page, name);
    }
  }
  if (failure !== undefined) throw failure;
});
