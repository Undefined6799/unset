// The card editor with SvelteKit's client running (P1.20k review gaps 15 and 16; outside review of f5cab2f, finding
// 1). A new card starts from the one Add card picker. Opening an editor puts focus in its first text field; a list editor's hint is read with each row. A refused save
// keeps the editor open with what was typed and the reason inside it; a save closes it, returns focus to the button
// that opened it, and cannot be sent twice while on its way; editing a stored card saves in place. A moved card keeps
// focus on its move button. The cards added are deleted again, so the member page is as the other specs expect it.
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
  const add = dialog.getByRole("button", { name: "Add" });
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
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue("Elsewhere");
  await expect(dialog.getByRole("button", { name: "Add" })).toBeEnabled();
  const first = dialog.getByRole("group", { name: "Link 1", exact: true });
  await first.getByRole("textbox", { name: "Address" }).fill("https://example.com/");
  await first.getByRole("textbox", { name: "Label" }).fill("Example");
  await dialog.getByRole("button", { name: "Add" }).click();
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

  // Move the README down: at the bottom now, so its other move button takes focus.
  await readmeCard.getByRole("button", { name: "Move down" }).click();
  await expect(readmeCard.getByRole("button", { name: "Move up" })).toBeFocused();
  await expect(
    page.getByRole("group", { name: "Elsewhere card" }).getByRole("button", { name: "Move down" }),
  ).toBeVisible();

  for (const name of ["README card", "Elsewhere card"]) {
    await page.getByRole("group", { name }).getByRole("link", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("group", { name })).toHaveCount(0);
  }
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
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog.getByRole("alert")).toContainText("too large");
  expect(await readme.inputValue()).toBe(typed);
  await expect(dialog.getByRole("button", { name: "Add" })).toBeEnabled();
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
async function deleteCard(page: Page, name: string) {
  await page.getByRole("group", { name }).getByRole("link", { name: "Delete" }).click();
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
  const second = dialog.getByRole("group", { name: "Link 2", exact: true });
  await second.getByRole("textbox", { name: "Address" }).fill("not a url");
  await dialog.getByRole("button", { name: "Add" }).click();
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
    await gamma.getByRole("button", { name: "Move up" }).focus();
    await page.mouse.wheel(0, 2_000);
    await expect.poll(() => page.evaluate(scrolled)).toBeGreaterThan(0);
    const before = await page.evaluate(scrolled);
    expect(before).toBeGreaterThan(0);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2 }).filter({ hasText: /^(Alpha|Beta|Gamma)$/ })).toHaveText([
      "Alpha",
      "Gamma",
      "Beta",
    ]);
    await expect(gamma.getByRole("button", { name: "Move up" })).toBeFocused();
    expect(await page.evaluate(scrolled)).toBeGreaterThan(0);

    await gamma.getByRole("link", { name: "Delete" }).click();
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
    await page.getByRole("group", { name: "Delta card" }).getByRole("link", { name: "Delete" }).click();
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
