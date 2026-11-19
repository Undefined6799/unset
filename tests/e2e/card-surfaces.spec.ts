// Outer card surfaces persist through the real form actions and keep controls in every theme and width.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { addCard, deleteCard, OWN_PAGE } from "./cards.ts";
import { openPage } from "./observe.ts";

const CARDS = [
  { name: "README card", fields: { kind: "readme", text: "# Surface check" } },
  {
    name: "Surface links card",
    fields: { kind: "links", title: "Surface links", "items.0.uri": "https://example.com" },
  },
  { name: "Surface work card", fields: { kind: "collection", title: "Surface work", "items.0.title": "Project" } },
  {
    name: "Surface contact card",
    fields: {
      kind: "buttons",
      heading: "Surface contact",
      "buttons.0.kind": "email",
      "buttons.0.address": "hello@example.com",
    },
  },
] satisfies { name: string; fields: Record<string, string> }[];

async function appearance(page: Page, outer: Locator, surface: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    if (surface === "filled") {
      await expect(outer).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    } else {
      await expect(outer).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      // Tailwind 4 resets its shadow layers to transparent zero-size shadows.
      await expect(outer).toHaveCSS("box-shadow", /^(none|(?:rgba\(0, 0, 0, 0\) 0px 0px 0px 0px(?:, )?)+)$/);
      await expect(outer).toHaveCSS("border-top-width", surface === "outlined" ? "1px" : "0px");
    }
  }
}

test("all_card_kinds_save_reload_and_restore_their_surface", async ({ page }) => {
  test.setTimeout(120_000);
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  for (const card of CARDS) await addCard(page, { ...card.fields, surface: "plain" });
  await page.reload();
  await page.waitForLoadState("networkidle");
  try {
    for (const card of CARDS) {
      const controls = page.getByRole("group", { name: card.name, exact: true });
      const outer = page.locator('[data-slot="card"]').filter({ has: controls });
      await appearance(page, outer, "plain");
      for (const [value, label] of [
        ["outlined", "Outlined"],
        ["filled", "Filled"],
        ["plain", "Plain"],
      ] as const) {
        await controls.getByRole("link", { name: "Edit", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("radio", { name: label, exact: true }).check();
        await dialog.getByRole("button", { name: "Save", exact: true }).click();
        await expect(dialog).toBeHidden();
        await page.reload();
        await page.waitForLoadState("networkidle");
        await appearance(page, outer, value);
        await controls.getByRole("link", { name: "Edit", exact: true }).click();
        await expect(dialog.getByRole("radio", { name: label, exact: true })).toBeChecked();
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(controls.getByRole("link", { name: "Edit", exact: true })).toBeFocused();
      }
    }
    await page.getByRole("heading", { level: 1 }).click();
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot({
        path: test.info().outputPath(`plain-cards-${colorScheme}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.setViewportSize({ width: 320, height: 800 });
    for (const card of CARDS) await expect(page.getByRole("group", { name: card.name, exact: true })).toBeVisible();
    const width = await page.locator("html").evaluate((element: { scrollWidth: number }) => element.scrollWidth);
    expect(width).toBeLessThanOrEqual(320);
    await page.screenshot({
      path: test.info().outputPath("plain-cards-mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    for (const card of CARDS) await deleteCard(page, card.name);
  }
});
