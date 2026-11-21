// The card editor with SvelteKit's client running (P1.20k review gaps 15 and 16; outside review of f5cab2f, finding
// 1). A new card starts from the one Add card picker. Opening an editor puts focus in its first text field; a list editor's hint is read with each row. A refused save
// keeps the editor open with what was typed and the reason inside it; a save closes it, returns focus to the button
// that opened it, and cannot be sent twice while on its way; editing a stored card saves in place. A card moved from
// its three-dot menu keeps focus on that menu's button (Alex 2026-11-18: actions behind three dots, always shown).
// The cards added are deleted again, so the member page is as the other specs expect it.
import { expect, test } from "@playwright/test";
import { ERROR_MESSAGES } from "@unset/shared-errors";
import {
  addCard,
  chooseFromMenu,
  deleteCard,
  menuButton,
  OWN_PAGE,
  paceWrites,
  postedText,
  writeText,
} from "./cards.ts";
import { openPage } from "./observe.ts";
import { phoneContext } from "./phone.ts";

paceWrites(test);

test("the_card_editor_saves_once_keeps_a_refusal_and_returns_focus", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const creates: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("?/create")) creates.push(r.url());
  });

  // Add card, then Text: the picker closes, focus is in the text area; a save held back by the test cannot be sent
  // twice; focus goes back to Add card.
  const addCard = page.getByRole("link", { name: "Add card" });
  const dialog = page.getByRole("dialog");
  const pick = async (kind: RegExp) => {
    await addCard.click();
    await dialog.getByRole("button", { name: kind }).click();
  };
  await pick(/^Text/);
  const readme = dialog.getByRole("textbox", { name: "Text" });
  await expect(readme).toBeFocused();
  await writeText(readme, ["# Hello"]);
  await expect(postedText(dialog)).toHaveValue("# Hello");
  let release: () => void = () => undefined;
  const held = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/*", async (route) => {
    if (route.request().method() === "POST" && route.request().url().endsWith("?/create")) await held;
    await route.continue();
  });
  const add = dialog.getByRole("button", { name: "Add", exact: true });
  await add.click();
  await expect(add).toBeDisabled();
  // A second submit by other means (Enter in a field would do it) is cancelled while the first is on its way.
  await dialog.locator("form").evaluate((form: { requestSubmit: () => void }) => form.requestSubmit());
  release();
  await expect(dialog).toBeHidden();
  await page.unroute("**/*");
  expect(creates).toHaveLength(1);
  await expect(addCard).toBeFocused();
  await expect(page.getByRole("heading", { name: "Hello" })).toBeVisible();

  // Add links with no link: refused, so the editor stays open with the title kept and the reason inside it.
  await pick(/^Links/);
  await expect(dialog.getByRole("textbox", { name: "Title" })).toBeFocused();
  await expect(dialog.getByRole("group", { name: "Link 1", exact: true })).toHaveAccessibleDescription(
    /^Up to \d+ links\./,
  );
  await dialog.getByRole("textbox", { name: "Title" }).fill("Elsewhere");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue("Elsewhere");
  await expect(dialog.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
  const first = dialog.getByRole("group", { name: "Link 1", exact: true });
  await first.getByRole("textbox", { name: "Address" }).fill("https://example.com/");
  await first.getByRole("textbox", { name: "Label" }).fill("Example");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(addCard).toBeFocused();
  // P1.21p: the row is one link (its label and host), with no link underline at rest and only the label's on hover.
  const row = page.locator("main").getByRole("link", { name: /^Example/ });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("example.com");
  await expect(row).toHaveCSS("text-decoration-line", "none");

  // Edit the stored Text card: saved in place, the editor closes and focus goes back to its Edit button.
  const readmeCard = page.getByRole("group", { name: "Text card" });
  await readmeCard.getByRole("link", { name: "Edit" }).click();
  await expect(postedText(dialog)).toHaveValue("# Hello");
  await expect(dialog.getByRole("textbox", { name: "Text" }).getByRole("heading", { name: "Hello" })).toBeVisible();
  await writeText(dialog.getByRole("textbox", { name: "Text" }), ["# Hello again"]);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Hello again" })).toBeVisible();
  await expect(readmeCard.getByRole("link", { name: "Edit" })).toBeFocused();

  // Move the Text card down from its menu: at the bottom now, and its menu button keeps focus.
  await chooseFromMenu(page, "Text card", "Move down");
  await expect(page.getByRole("heading", { level: 2, name: "Elsewhere" })).toBeVisible();
  await expect(menuButton(page, "Text card")).toBeFocused();
  await menuButton(page, "Text card").click();
  await expect(page.getByRole("menuitem", { name: "Move up" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Move down" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  for (const name of ["Text card", "Elsewhere card"]) await deleteCard(page, name);
});

// The independent review, M2: a save the gate refuses before the action runs (a body over the 2 MiB cap, a rate limit
// or a deadline) keeps the editor open with what was typed and the catalog's reason, instead of the error page. The
// gate's answer here is the one gate.test.ts pins for the built server (an action failure, devalue-encoded). It is
// played by the test because the harness's TLS listener (Node's http client) loses a 413 the server sends with
// Connection: close before reading a 2.2 MB body: the write fails with EPIPE first and the listener answers 502.
// Whether the edge passes that 413 on is unverified here; checked on staging.
test("a_save_the_gate_refuses_keeps_the_editor_and_what_was_typed", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Add card" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Text/ }).click();
  const readme = dialog.getByRole("textbox", { name: "Text" });
  await writeText(readme, ["# Long", "a".repeat(2_000)]);
  const typed = `# Long\n\n${"a".repeat(2_000)}`;
  await expect(postedText(dialog)).toHaveValue(typed);
  const code = "http.payload_too_large";
  await page.route(
    (url) => url.search === "?/create",
    (route) =>
      route.fulfill({
        status: 413,
        headers: { "content-type": "application/json", "cache-control": "private, no-store" },
        body: JSON.stringify({
          type: "failure",
          status: 413,
          data: JSON.stringify([{ code: 1, message: 2 }, code, ERROR_MESSAGES[code]]),
        }),
      }),
  );
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("too large");
  await expect(postedText(dialog)).toHaveValue(typed);
  await expect(readme).toContainText("a".repeat(2_000));
  await expect(dialog.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/did:plc:/);
});

const scrolled = () => (globalThis as unknown as { scrollY: number }).scrollY;
const linksCard = (title: string) => ({
  kind: "links",
  width: "full",
  title,
  "items.0.uri": `${title.toLowerCase()}.example`,
});

// Staging walkthrough 2026-11-18, finding 4: a refusal that blames one field is shown under it, the field is marked
// invalid and takes focus, scrolled into view, however long the editor is.
test("a_refused_save_is_shown_beside_the_field_it_blames_and_focuses_it", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Add card" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^Links/ }).click();
  await dialog.getByRole("button", { name: "Add link" }).click();
  const second = dialog.getByRole("group", { name: "Link 2", exact: true });
  await second.getByRole("textbox", { name: "Address" }).fill("not a url");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  const address = second.getByRole("textbox", { name: "Address" });
  await expect(address).toBeFocused();
  await expect(address).toHaveAttribute("aria-invalid", "true");
  await expect(address).toHaveAccessibleDescription(/http or https address/);
  await expect(address).toBeInViewport();
  await expect(address).toHaveValue("not a url");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "Links card" })).toHaveCount(0);
});

// Finding 6: moving or deleting a card leaves the page where it was, and focus on the moved card or on the card that
// took the deleted one's place.
test("moving_or_deleting_a_card_keeps_the_place_and_focus", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 400 });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  for (const title of ["Alpha", "Beta", "Gamma"]) await addCard(page, linksCard(title));
  await page.reload();
  await page.waitForLoadState("networkidle");
  try {
    const gamma = page.getByRole("group", { name: "Gamma card" });
    await menuButton(page, "Gamma card").focus();
    await page.mouse.wheel(0, 2_000);
    await expect.poll(() => page.evaluate(scrolled)).toBeGreaterThan(0);
    const before = await page.evaluate(scrolled);
    expect(before).toBeGreaterThan(0);
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: /^(Alpha|Beta|Gamma)$/ })).toHaveText([
      "Alpha",
      "Gamma",
      "Beta",
    ]);
    await expect(menuButton(page, "Gamma card")).toBeFocused();
    expect(await page.evaluate(scrolled)).toBeGreaterThan(0);

    await chooseFromMenu(page, "Gamma card", "Delete");
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(gamma).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Beta card" }).getByRole("link", { name: "Edit" })).toBeFocused();
    expect(await page.evaluate(scrolled)).toBeGreaterThan(0);
  } finally {
    for (const name of ["Alpha card", "Beta card", "Gamma card"]) {
      if ((await page.getByRole("group", { name }).count()) > 0) await deleteCard(page, name);
    }
  }
});

// Codex review of f14b5ab: a delete the server refuses keeps the dialog open with the reason inside it, where the
// member is looking, rather than behind the modal. The refusal is played as in the gate test above.
test("a_refused_delete_shows_its_reason_inside_the_dialog", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await addCard(page, linksCard("Delta"));
  await page.reload();
  await page.waitForLoadState("networkidle");
  const code = "card.pds_unavailable";
  try {
    await page.route(
      (url) => url.search === "?/remove",
      (route) =>
        route.fulfill({
          status: 503,
          headers: { "content-type": "application/json", "cache-control": "private, no-store" },
          body: JSON.stringify({
            type: "failure",
            status: 503,
            data: JSON.stringify([{ code: 1, message: 2 }, code, ERROR_MESSAGES[code]]),
          }),
        }),
    );
    await chooseFromMenu(page, "Delta card", "Delete");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(dialog.getByRole("alert")).toContainText("not answering");
    await expect(dialog.getByRole("button", { name: "Delete" })).toBeEnabled();
  } finally {
    await page.unrouteAll();
    await page.keyboard.press("Escape");
    await deleteCard(page, "Delta card");
  }
});

// Alex 2026-11-18: a list editor starts with one blank row and Add row adds the next, with focus in it; a buttons row
// shows only the fields of the kind it opens.
test("a_list_editor_starts_with_one_row_and_adds_rows_on_request", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const dialog = page.getByRole("dialog");
  await page.getByRole("link", { name: "Add card" }).click();
  await dialog.getByRole("button", { name: /^Links/ }).click();
  const rows = dialog.getByRole("group", { name: /^Link \d+$/ });
  await expect(rows).toHaveCount(1);
  await dialog.getByRole("button", { name: "Add link" }).click();
  await expect(rows).toHaveCount(2);
  await expect(
    dialog.getByRole("group", { name: "Link 2", exact: true }).getByRole("textbox", { name: "Address" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Add card" }).click();
  await dialog.getByRole("button", { name: /^Contact/ }).click();
  const button = dialog.getByRole("group", { name: "Button 1", exact: true });
  await button.getByRole("radio", { name: "Email", exact: true }).check();
  await expect(button.getByRole("textbox", { name: "Email address" })).toBeVisible();
  await expect(button.getByRole("textbox", { name: "Web address" })).toBeHidden();
  await button.getByRole("radio", { name: "Web address" }).check();
  await expect(button.getByRole("textbox", { name: "Email address" })).toBeHidden();
  await expect(button.getByRole("textbox", { name: "Web address" })).toBeVisible();
  await expect(button.getByRole("group", { name: "Button opens" })).toBeVisible();
  await page.keyboard.press("Escape");
});

// Alex 2026-11-18: the README editor has a Preview tab showing the card as it will look.
test("the_readme_editor_previews_the_text", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const dialog = page.getByRole("dialog");
  await page.getByRole("link", { name: "Add card" }).click();
  await dialog.getByRole("button", { name: /^Text/ }).click();
  await writeText(dialog.getByRole("textbox", { name: "Text" }), ["# Previewed", "Some *text*."]);
  await dialog.getByRole("tab", { name: "Preview" }).click();
  await expect(dialog.getByRole("heading", { name: "Previewed" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Text" })).toBeHidden();
  await dialog.getByRole("tab", { name: "Write" }).click();
  await expect(postedText(dialog)).toHaveValue("# Previewed\n\nSome _text_.");
  await page.keyboard.press("Escape");
});

// Review of #1702: a hidden field of the button kind not chosen never blocks the save.
test("a_button_saves_after_its_kind_changes_from_a_bad_email", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const dialog = page.getByRole("dialog");
  await page.getByRole("link", { name: "Add card" }).click();
  await dialog.getByRole("button", { name: /^Contact/ }).click();
  await dialog.getByRole("textbox", { name: "Heading" }).fill("Reach me");
  const button = dialog.getByRole("group", { name: "Button 1", exact: true });
  await button.getByRole("radio", { name: "Email", exact: true }).check();
  await button.getByRole("textbox", { name: "Email address" }).fill("not an email");
  await button.getByRole("radio", { name: "Web address" }).check();
  await button.getByRole("textbox", { name: "Web address" }).fill("reach.example");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("group", { name: "Reach me card" })).toHaveCount(1);
  await deleteCard(page, "Reach me card");
});

// Review of #1702: a refusal the server gives for the README text is shown on the Write tab, even when sent from
// Preview. Text of spaces only passes the browser's required check and is refused by the server.
test("a_readme_refusal_sent_from_preview_shows_on_write", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  const dialog = page.getByRole("dialog");
  await page.getByRole("link", { name: "Add card" }).click();
  await dialog.getByRole("button", { name: /^Text/ }).click();
  const text = dialog.getByRole("textbox", { name: "Text" });
  await writeText(text, ["   "]);
  await dialog.getByRole("tab", { name: "Preview" }).click();
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(text).toBeVisible();
  await expect(text).toBeFocused();
  await expect(text).toHaveAttribute("aria-invalid", "true");
  await page.keyboard.press("Escape");
});

// Alex 2026-11-18: card actions sit behind three dots. The menu is reached, opened and used by keyboard alone, and the
// moved card's menu button keeps focus.
test("the_card_menu_works_by_keyboard", async ({ page }) => {
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  for (const title of ["Alpha", "Beta"]) await addCard(page, linksCard(title));
  await page.reload();
  await page.waitForLoadState("networkidle");
  const titles = page.getByRole("heading", { level: 2 }).filter({ hasText: /^(Alpha|Beta)$/ });
  try {
    const alphaMenu = menuButton(page, "Alpha card");
    await alphaMenu.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveText(["Move down", "Delete"]);
    // Enter opens the menu on its first item; the arrow keys walk the items.
    await expect(menu.getByRole("menuitem", { name: "Move down" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Delete" })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(menu.getByRole("menuitem", { name: "Move down" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(titles).toHaveText(["Beta", "Alpha"]);
    await expect(alphaMenu).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["Move up", "Delete"]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(alphaMenu).toBeFocused();
  } finally {
    await page.keyboard.press("Escape");
    for (const name of ["Alpha card", "Beta card"]) {
      if ((await page.getByRole("group", { name }).count()) > 0) await deleteCard(page, name);
    }
  }
});

// Alex 2026-11-18: on a large screen with a mouse a card is dragged by its top bar onto another to take its place.
test("a_card_is_dragged_into_place_on_a_large_screen", async ({ browser, browserName, page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  for (const title of ["Alpha", "Beta", "Gamma"]) await addCard(page, linksCard(title));
  await page.reload();
  await page.waitForLoadState("networkidle");
  const titles = page.getByRole("heading", { level: 2 }).filter({ hasText: /^(Alpha|Beta|Gamma)$/ });
  let failed = false;
  let failure: unknown;
  try {
    await page
      .getByRole("heading", { level: 2, name: "Gamma" })
      .dragTo(page.getByRole("heading", { level: 2, name: "Alpha" }));
    await expect(titles).toHaveText(["Gamma", "Alpha", "Beta"]);
    // The same cards on a touch phone do not drag; their menu reorders them with a tap.
    const context = await browser.newContext(phoneContext(browserName, { width: 390, height: 900 }));
    try {
      const phonePage = await context.newPage();
      expect((await openPage(phonePage, OWN_PAGE))?.status()).toBe(200);
      await phonePage.waitForLoadState("networkidle");
      const beta = phonePage.getByRole("group", { name: "Beta card" });
      const phoneTitles = phonePage.getByRole("heading", { level: 2 }).filter({ hasText: /^(Alpha|Beta|Gamma)$/ });
      await expect(beta.locator("xpath=..")).toHaveAttribute("draggable", "false");
      await phonePage
        .getByRole("heading", { level: 2, name: "Beta" })
        .dragTo(phonePage.getByRole("heading", { level: 2, name: "Gamma" }));
      await expect(phoneTitles).toHaveText(["Gamma", "Alpha", "Beta"]);
      await beta.getByRole("button", { name: "More for Beta card" }).tap();
      await phonePage.getByRole("menuitem", { name: "Move up" }).tap();
      await expect(phoneTitles).toHaveText(["Gamma", "Beta", "Alpha"]);
    } finally {
      await context.close();
    }
    // The desktop page shows the old order until it reloads; the server kept the phone's move.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(titles).toHaveText(["Gamma", "Beta", "Alpha"]);
  } catch (error) {
    failed = true;
    failure = error;
  }
  // Cleanup starts from a fresh document whatever step failed: the page may show an old order, and in Playwright
  // 1.64.1's WebKit the first press after a drag fires mousedown but no pointerdown (reproduced 2026-11-19), while
  // Bits UI 2.20.6 opens a menu on pointerdown only (dist/bits/menu/menu.svelte.js DropdownMenuTriggerState).
  // A cleanup failure never hides the test's own.
  try {
    await page.reload();
    await page.waitForLoadState("networkidle");
    for (const name of ["Alpha card", "Beta card", "Gamma card"]) {
      if ((await page.getByRole("group", { name }).count()) > 0) await deleteCard(page, name);
    }
  } catch (cleanup) {
    if (!failed) throw cleanup;
  }
  if (failed) throw failure;
});

// Finding 5: a carousel with more entries than fit is a named stop the keyboard reaches and scrolls, and says so.
test("a_carousel_is_reached_and_scrolled_by_keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  const entries = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`items.${i}.title`, `Entry ${i + 1}`]));
  await addCard(page, { kind: "collection", width: "full", title: "Shelf", layout: "carousel", ...entries });
  await page.reload();
  await page.waitForLoadState("networkidle");
  try {
    const shelf = page.getByRole("region", { name: "Shelf, scrolls sideways" });
    await expect(page.getByText("scroll sideways for more")).toBeVisible();
    await shelf.focus();
    await expect(shelf).toBeFocused();
    // Each arrow press scrolls a step and the snap settles before the next, so press until the last entry shows.
    const last = page.getByRole("heading", { name: "Entry 6" });
    await expect(async () => {
      await page.keyboard.press("ArrowRight");
      await expect(last).toBeInViewport({ ratio: 0.9, timeout: 300 });
    }).toPass({ timeout: 10_000 });
    expect(await shelf.evaluate((node) => (node as unknown as { scrollLeft: number }).scrollLeft)).toBeGreaterThan(0);
  } finally {
    await deleteCard(page, "Shelf card");
  }
});
