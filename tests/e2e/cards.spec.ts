// The card editor with SvelteKit's client running (P1.20k review gaps 15 and 16; outside review of f5cab2f, finding
// 1). A new card starts from the one Add card picker. Opening an editor puts focus in its first text field; a list editor's hint is read with each row. A refused save
// keeps the editor open with what was typed and the reason inside it; a save closes it, returns focus to the button
// that opened it, and cannot be sent twice while on its way; editing a stored card saves in place. A card moved from
// its three-dot menu keeps focus on that menu's button (Alex 2026-11-18: actions behind three dots, always shown).
// The cards added are deleted again, so the member page is as the other specs expect it.
import { expect, type Page, test } from "@playwright/test";
import { ERROR_MESSAGES } from "@unset/shared-errors";
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

  // Add card, then README: the picker closes, focus is in the text area; a save held back by the test cannot be sent
  // twice; focus goes back to Add card.
  const addCard = page.getByRole("link", { name: "Add card" });
  const dialog = page.getByRole("dialog");
  const pick = async (kind: RegExp) => {
    await addCard.click();
    await dialog.getByRole("button", { name: kind }).click();
  };
  await pick(/^README/);
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

  // Edit the stored README: saved in place, the editor closes and focus goes back to its Edit button.
  const readmeCard = page.getByRole("group", { name: "README card" });
  await readmeCard.getByRole("link", { name: "Edit" }).click();
  await expect(dialog.getByRole("textbox", { name: "README" })).toHaveValue("# Hello");
  await dialog.getByRole("textbox", { name: "README" }).fill("# Hello again");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Hello again" })).toBeVisible();
  await expect(readmeCard.getByRole("link", { name: "Edit" })).toBeFocused();

  // Move the README down from its menu: at the bottom now, and its menu button keeps focus.
  await chooseFromMenu(page, "README card", "Move down");
  await expect(page.getByRole("heading", { level: 2, name: "Elsewhere" })).toBeVisible();
  await expect(menuButton(page, "README card")).toBeFocused();
  await menuButton(page, "README card").click();
  await expect(page.getByRole("menuitem", { name: "Move up" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Move down" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  for (const name of ["README card", "Elsewhere card"]) await deleteCard(page, name);
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
  await dialog.getByRole("button", { name: /^README/ }).click();
  const readme = dialog.getByRole("textbox", { name: "README" });
  const typed = `# Long\n\n${"a".repeat(2_000)}`;
  await readme.fill(typed);
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
  expect(await readme.inputValue()).toBe(typed);
  await expect(dialog.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/did:plc:/);
});

/** Adds a card as a plain form post (the fields as the editor names them), then reloads the page. */
async function addCard(page: Page, fields: Record<string, string>) {
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
const scrolled = () => (globalThis as unknown as { scrollY: number }).scrollY;
const linksCard = (title: string) => ({
  kind: "links",
  width: "full",
  title,
  "items.0.uri": `${title.toLowerCase()}.example`,
});
/** The three-dot menu button on the card whose controls are grouped under `name` ("Gamma card"). */
const menuButton = (page: Page, name: string) =>
  page.getByRole("group", { name }).getByRole("button", { name: `More for ${name}` });
async function chooseFromMenu(page: Page, name: string, item: string) {
  await menuButton(page, name).click();
  await page.getByRole("menuitem", { name: item }).click();
}
async function deleteCard(page: Page, name: string) {
  await chooseFromMenu(page, name, "Delete");
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("group", { name })).toHaveCount(0);
}

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
  await dialog.getByRole("button", { name: /^README/ }).click();
  await dialog.getByRole("textbox", { name: "README" }).fill("# Previewed\n\nSome *text*.");
  await dialog.getByRole("tab", { name: "Preview" }).click();
  await expect(dialog.getByRole("heading", { name: "Previewed" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "README" })).toBeHidden();
  await dialog.getByRole("tab", { name: "Write" }).click();
  await expect(dialog.getByRole("textbox", { name: "README" })).toHaveValue("# Previewed\n\nSome *text*.");
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
  await dialog.getByRole("button", { name: /^README/ }).click();
  const text = dialog.getByRole("textbox", { name: "README" });
  await text.fill("   ");
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
test("a_card_is_dragged_into_place_on_a_large_screen", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  for (const title of ["Alpha", "Beta", "Gamma"]) await addCard(page, linksCard(title));
  await page.reload();
  await page.waitForLoadState("networkidle");
  const titles = page.getByRole("heading", { level: 2 }).filter({ hasText: /^(Alpha|Beta|Gamma)$/ });
  try {
    await page
      .getByRole("heading", { level: 2, name: "Gamma" })
      .dragTo(page.getByRole("heading", { level: 2, name: "Alpha" }));
    await expect(titles).toHaveText(["Gamma", "Alpha", "Beta"]);
    // On a phone-width screen nothing drags: the menu's Move up and Move down do the reordering there.
    await page.setViewportSize({ width: 390, height: 900 });
    const bar = page.getByRole("group", { name: "Beta card" }).locator("xpath=..");
    await expect(bar).toHaveAttribute("draggable", "false");
    await page
      .getByRole("heading", { level: 2, name: "Beta" })
      .dragTo(page.getByRole("heading", { level: 2, name: "Gamma" }));
    await expect(titles).toHaveText(["Gamma", "Alpha", "Beta"]);
  } finally {
    for (const name of ["Alpha card", "Beta card", "Gamma card"]) {
      if ((await page.getByRole("group", { name }).count()) > 0) await deleteCard(page, name);
    }
  }
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

// Alex's staging report 2026-11-18: a carousel had no arrows. With script, Previous and Next buttons scroll it by
// a tile, each is off at its end, and the keyboard reaches both.
test("a_carousel_has_previous_and_next_buttons", async ({ browser, page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  const entries = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`items.${i}.title`, `Entry ${i + 1}`]));
  await addCard(page, { kind: "collection", width: "full", title: "Shelf", layout: "carousel", ...entries });
  await page.reload();
  await page.waitForLoadState("networkidle");
  try {
    const shelf = page.getByRole("region", { name: "Shelf, scrolls sideways" });
    const previous = page.getByRole("button", { name: "Previous in Shelf" });
    const next = page.getByRole("button", { name: "Next in Shelf" });
    const left = () => shelf.evaluate((node) => (node as unknown as { scrollLeft: number }).scrollLeft);
    await expect(previous).toBeDisabled();
    await expect(next).toBeEnabled();
    await next.focus();
    await page.keyboard.press("Enter");
    await expect.poll(left).toBeGreaterThan(0);
    await expect(previous).toBeEnabled();
    for (let i = 0; i < 3; i++) if (await next.isEnabled()) await next.click();
    await expect(next).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Entry 4" })).toBeInViewport({ ratio: 0.9 });
    await previous.click();
    await expect(next).toBeEnabled();

    // Without script the buttons could not scroll, so they are not drawn; the region still scrolls by keyboard.
    const plain = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 900 } });
    try {
      const noScript = await plain.newPage();
      expect((await openPage(noScript, OWN_PAGE))?.status()).toBe(200);
      await expect(noScript.getByRole("region", { name: "Shelf, scrolls sideways" })).toBeVisible();
      await expect(noScript.getByRole("button", { name: /^(Previous|Next) in Shelf$/ })).toHaveCount(0);
    } finally {
      await plain.close();
    }
  } finally {
    await deleteCard(page, "Shelf card");
  }
});

// A carousel whose tiles all fit has nothing to scroll, so it shows no buttons.
test("a_carousel_that_fits_shows_no_buttons", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await addCard(page, {
    kind: "collection",
    width: "full",
    title: "Pair",
    layout: "carousel",
    "items.0.title": "One",
    "items.1.title": "Two",
  });
  await page.reload();
  await page.waitForLoadState("networkidle");
  try {
    await expect(page.getByRole("region", { name: "Pair, scrolls sideways" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Previous|Next) in Pair$/ })).toHaveCount(0);
  } finally {
    await deleteCard(page, "Pair card");
  }
});

// Staging walkthrough 2026-11-18: a full-width grid of three entries left an empty fourth column. The tiles now
// share the whole row.
test("a_full_width_grid_fills_its_row", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  const entries = Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`items.${i}.title`, `Tile ${i + 1}`]));
  await addCard(page, { kind: "collection", width: "full", title: "Trio", layout: "grid", ...entries });
  await page.reload();
  try {
    const list = page.locator("ul", { has: page.getByRole("heading", { name: "Tile 3" }) });
    const last = list.locator("li").last();
    const [row, tile] = await Promise.all([list.boundingBox(), last.boundingBox()]);
    if (row === null || tile === null) throw new Error("the grid was not drawn");
    expect(row.x + row.width - (tile.x + tile.width)).toBeLessThan(2);
  } finally {
    await deleteCard(page, "Trio card");
  }
});

// Review of #1718: one or two grid entries keep their tile width rather than stretching into banners.
test("a_grid_of_one_keeps_its_tile_width", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await addCard(page, { kind: "collection", width: "full", title: "Solo", layout: "grid", "items.0.title": "Only" });
  await page.reload();
  try {
    const tile = await page.locator("li", { has: page.getByRole("heading", { name: "Only" }) }).boundingBox();
    if (tile === null) throw new Error("the grid was not drawn");
    expect(tile.width).toBeLessThan(300);
  } finally {
    await deleteCard(page, "Solo card");
  }
});

// Review of #1718: when the person scrolls the carousel themselves while a press is still scrolling it, the next
// press steps from where the carousel is, not from where the interrupted press was heading.
test("a_carousel_press_after_the_person_scrolls_steps_from_where_it_is", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  const entries = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`items.${i}.title`, `Entry ${i + 1}`]));
  await addCard(page, { kind: "collection", width: "full", title: "Shelf", layout: "carousel", ...entries });
  await page.reload();
  await page.waitForLoadState("networkidle");
  try {
    const shelf = page.getByRole("region", { name: "Shelf, scrolls sideways" });
    const next = page.getByRole("button", { name: "Next in Shelf" });
    const left = () => shelf.evaluate((node) => Math.round((node as unknown as { scrollLeft: number }).scrollLeft));
    const tileAt = (n: number) =>
      shelf.evaluate((node, i) => {
        const tiles = (
          node as unknown as { querySelectorAll(s: string): ArrayLike<{ offsetLeft: number }> }
        ).querySelectorAll("li");
        return Math.round((tiles[i]?.offsetLeft ?? 0) - (tiles[0]?.offsetLeft ?? 0));
      }, n);
    // Next twice in quick succession heads for the third tile; the person then presses Home before it lands.
    await next.click();
    await next.click();
    await shelf.focus();
    await page.keyboard.press("Home");
    await expect.poll(left).toBe(0);
    await next.click();
    const second = await tileAt(1);
    await expect.poll(left).toBe(second);
  } finally {
    await deleteCard(page, "Shelf card");
  }
});

// Codex on #1718: the buttons honour reduced motion, which an explicit smooth scroll would otherwise override.
test("a_carousel_button_jumps_when_motion_is_reduced", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 900 });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  const entries = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`items.${i}.title`, `Entry ${i + 1}`]));
  await addCard(page, { kind: "collection", width: "full", title: "Shelf", layout: "carousel", ...entries });
  await page.reload();
  await page.waitForLoadState("networkidle");
  try {
    const shelf = page.getByRole("region", { name: "Shelf, scrolls sideways" });
    await page.getByRole("button", { name: "Next in Shelf" }).click();
    // Read in the same task as nothing else: a smooth scroll would still be at or near the start.
    const [now, second] = await shelf.evaluate((node) => {
      const region = node as unknown as {
        scrollLeft: number;
        querySelectorAll(s: string): ArrayLike<{ offsetLeft: number }>;
      };
      const tiles = region.querySelectorAll("li");
      return [Math.round(region.scrollLeft), Math.round((tiles[1]?.offsetLeft ?? 0) - (tiles[0]?.offsetLeft ?? 0))];
    });
    expect(now).toBe(second);
  } finally {
    await deleteCard(page, "Shelf card");
  }
});

// Codex on #1718: a carousel edited in place from one entry to several shows its buttons without a scroll or resize.
test("a_carousel_edited_to_overflow_shows_its_buttons", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  expect((await openPage(page, OWN_PAGE))?.status()).toBe(200);
  await addCard(page, { kind: "collection", width: "full", title: "Grow", layout: "carousel", "items.0.title": "A" });
  await page.reload();
  await page.waitForLoadState("networkidle");
  try {
    const next = page.getByRole("button", { name: "Next in Grow" });
    await expect(next).toHaveCount(0);
    await page.getByRole("group", { name: "Grow card" }).getByRole("link", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog");
    for (const n of [2, 3]) {
      await dialog.getByRole("button", { name: "Add entry" }).click();
      const row = dialog.getByRole("group", { name: `Entry ${n}`, exact: true });
      await row.getByRole("textbox", { name: "Title" }).fill(String.fromCharCode(64 + n));
    }
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "C", exact: true })).toHaveCount(1);
    await expect(next).toBeEnabled();
  } finally {
    await deleteCard(page, "Grow card");
  }
});
