// The real editor under the app CSP. Compact controls follow touch input or the phone breakpoint, while actual
// pointer type still determines gesture behavior (Playwright 1.64.1 types/types.d.ts).
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { pageNoise, watch } from "./observe.ts";
import { TEST_ORIGIN } from "./pages.ts";

const URL = `${TEST_ORIGIN}/fixture/editor`;
const MOVING = "Move this paragraph with the block actions.";
const NEIGHBOR = "The next paragraph stays readable after a move.";
const TYPED = "Typed through the real editor.";
type Cell = { width: number; touch: boolean };
const CELLS: readonly Cell[] = [
  { width: 1440, touch: false },
  { width: 900, touch: false },
  { width: 390, touch: false },
  { width: 1440, touch: true },
  { width: 900, touch: true },
  { width: 390, touch: true },
];

async function activate(locator: Locator, touch: boolean): Promise<void> {
  if (touch) await locator.tap();
  else await locator.click();
}

async function withEditor(
  browser: Browser,
  browserName: string,
  cell: Cell,
  run: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: cell.width, height: 900 },
    hasTouch: cell.touch,
    // Playwright does not support isMobile in Firefox; hasTouch still exercises touch events there.
    isMobile: cell.touch && browserName !== "firefox",
    extraHTTPHeaders: { "accept-language": "en" },
  });
  try {
    const page = await context.newPage();
    const watched = watch(page);
    const response = await page.goto(URL);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-security-policy"]).toContain("require-trusted-types-for 'script'");
    expect(response?.headers()["content-security-policy"]).toContain("trusted-types 'none'");
    await activate(page.getByRole("button", { name: "Edit README", exact: true }), cell.touch);
    await expect(page.locator("form[data-readme-editor]")).toHaveAttribute("data-ready", "true");
    await run(page);
    const noise = await pageNoise(page, watched);
    expect(noise.csp).toEqual([]);
    expect(watched.pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
}

async function expectNoOverflow(page: Page): Promise<void> {
  const size = await page.evaluate(() => {
    const view = globalThis as unknown as {
      document: { documentElement: { scrollWidth: number; clientWidth: number } };
    };
    return { scroll: view.document.documentElement.scrollWidth, client: view.document.documentElement.clientWidth };
  });
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
  const content = await page.locator("[data-editor-root]").evaluate((element) => {
    const box = element as unknown as { scrollWidth: number; clientWidth: number };
    return { scroll: box.scrollWidth, client: box.clientWidth };
  });
  expect(content.scroll).toBeLessThanOrEqual(content.client + 1);
  for (const [role, name] of [
    ["toolbar", "Text style"],
    ["menu", "Block actions"],
    ["dialog", "Block actions"],
    ["dialog", "Add a block below"],
  ] as const) {
    const controls = page.getByRole(role, { name, exact: true });
    if (!(await controls.isVisible())) continue;
    const rect = await controls.boundingBox();
    expect(rect).not.toBeNull();
    if (rect !== null) {
      expect(rect.x).toBeGreaterThanOrEqual(-1);
      expect(rect.x + rect.width).toBeLessThanOrEqual(size.client + 1);
    }
  }
}

for (const cell of CELLS) {
  const label = `${cell.width} ${cell.touch ? "touch" : "pointer"}`;

  test(`editor_controls_follow_input_and_cancel_discards ${label}`, async ({ browser, browserName }) => {
    await withEditor(browser, browserName, cell, async (page) => {
      const editor = page.locator("[data-editor-root]");
      const paragraph = editor.locator('[data-content-type="paragraph"]').filter({ hasText: MOVING });
      await activate(paragraph, cell.touch);
      const toolbar = page.getByRole("toolbar", { name: "Text style", exact: true });
      if (cell.touch || cell.width < 768) {
        await expect(toolbar).toBeVisible();
        const bold = toolbar.getByRole("button", { name: "Bold", exact: true });
        await bold.focus();
        await expect(toolbar).toBeVisible();
        await activate(bold, cell.touch);
        await expect(bold).toHaveAttribute("aria-pressed", "true");
        await activate(bold, cell.touch);
        await expect(bold).toHaveAttribute("aria-pressed", "false");
        await activate(page.getByRole("heading", { name: "Editor Sample", exact: true }), cell.touch);
        // Leaving the text keeps the one bar docked at the bottom, away from Save at the top (Alex 2026-10-27).
        await expect(editor.locator("[data-docked]")).toHaveCount(1);
        await expect(toolbar).toBeVisible();
        await activate(paragraph, cell.touch);
        await expect(toolbar).toBeVisible();
        await expect(editor.getByRole("button", { name: "Add a block below", exact: true })).toHaveCount(0);
        await expect(editor.locator('button[draggable="true"]')).toHaveCount(0);
        await activate(editor.getByRole("button", { name: "Block actions", exact: true }), cell.touch);
        const sheet = page.getByRole("dialog", { name: "Block actions", exact: true });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole("button", { name: "Move up", exact: true })).toBeVisible();
        await expectNoOverflow(page);
        await activate(sheet.getByRole("button", { name: "Add a block below", exact: true }), cell.touch);
        const insertions = page.getByRole("dialog", { name: "Add a block below", exact: true });
        await expect(insertions.getByRole("button")).toHaveCount(10);
        for (const name of [
          "Text",
          "Heading 1",
          "Heading 2",
          "Heading 3",
          "Bullet list",
          "Numbered list",
          "Check list",
          "Quote",
          "Code",
        ]) {
          await expect(insertions.getByRole("button", { name, exact: true })).toBeVisible();
        }
        await expectNoOverflow(page);
        await activate(insertions.getByRole("button", { name: "Done", exact: true }), cell.touch);
        await expect(sheet).toBeHidden();
        await activate(editor.getByRole("button", { name: "Block actions", exact: true }), cell.touch);
        await activate(sheet.getByRole("button", { name: "Move down", exact: true }), cell.touch);
        await expect(sheet).toBeHidden();
        await expect
          .poll(async () => {
            const order = await editor.locator('[data-content-type="paragraph"]').allTextContents();
            return order.indexOf(MOVING) - order.indexOf(NEIGHBOR);
          })
          .toBeGreaterThan(0);
      } else {
        await expect(toolbar).toBeHidden();
        await page.mouse.move(0, 0);
        await page.keyboard.press("Shift+Tab");
        const blockActions = editor.getByRole("button", { name: "Block actions", exact: true });
        await expect(blockActions).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("menuitem", { name: "Move up", exact: true })).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(blockActions).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(editor.getByRole("textbox", { name: "README", exact: true })).toBeFocused();
        await page.keyboard.press("End");
        await page.keyboard.press("Shift+ArrowLeft");
        await expect(toolbar).toBeVisible();
      }
      await expectNoOverflow(page);
      await activate(paragraph, cell.touch);
      await page.keyboard.insertText(TYPED);
      await expect(editor).toContainText(TYPED);
      const cancel = page.getByRole("button", { name: "Cancel", exact: true });
      await Promise.all([
        page.waitForEvent("dialog").then(async (dialog) => {
          expect(dialog.type()).toBe("confirm");
          await dialog.dismiss();
        }),
        activate(cancel, cell.touch),
      ]);
      await expect(editor).toContainText(TYPED);
      await Promise.all([
        page.waitForEvent("dialog").then(async (dialog) => {
          expect(dialog.type()).toBe("confirm");
          await dialog.accept();
        }),
        activate(cancel, cell.touch),
      ]);
      await expect(editor).toHaveCount(0);
      await expect(page.locator("[data-readme-editor-mount]")).not.toContainText(TYPED);
      await expect(page.getByRole("button", { name: "Edit README", exact: true })).toBeFocused();
      await activate(page.getByRole("button", { name: "Edit README", exact: true }), cell.touch);
      await expect(page.locator("form[data-readme-editor]")).toHaveAttribute("data-ready", "true");
      await expect(page.locator("[data-editor-root]")).not.toContainText(TYPED);
      const restored = await page.locator('[data-editor-root] [data-content-type="paragraph"]').allTextContents();
      expect(restored.indexOf(MOVING)).toBeLessThan(restored.indexOf(NEIGHBOR));
    });
  });

  test(`editor_save_posts_the_current_document ${label}`, async ({ browser, browserName }) => {
    await withEditor(browser, browserName, cell, async (page) => {
      const paragraph = page.locator('[data-editor-root] [data-content-type="paragraph"]').filter({ hasText: MOVING });
      await activate(paragraph, cell.touch);
      await page.keyboard.insertText(TYPED);
      const submitted = page.waitForRequest(
        (request) => request.method() === "POST" && request.url() === `${TEST_ORIGIN}/profile/readme`,
      );
      await activate(page.getByRole("button", { name: "Save changes", exact: true }), cell.touch);
      const request = await submitted;
      const form = new URLSearchParams(request.postData() ?? "");
      expect(form.getAll("readme")).toHaveLength(1);
      const document: unknown = JSON.parse(form.get("readme") ?? "null");
      expect(Array.isArray(document)).toBe(true);
      expect(JSON.stringify(document)).toContain(TYPED);
      expect(JSON.stringify(document)).toContain("columnList");
      expect(request.headers()["content-type"]).toContain("application/x-www-form-urlencoded");
      // The fixture server has no write route: this observes the native form request without claiming persistence.
      await page.waitForURL(`${TEST_ORIGIN}/profile/readme`, { waitUntil: "load" });
    });
  });
}

test("editor_narrow_mouse_uses_sheet_and_restores_handles_when_widened", async ({ browser, browserName }) => {
  await withEditor(browser, browserName, { width: 390, touch: false }, async (page) => {
    const editor = page.locator("[data-editor-root]");
    const paragraph = editor.locator('[data-content-type="paragraph"]').filter({ hasText: MOVING });
    await paragraph.click();
    const add = editor.getByRole("button", { name: "Add a block below", exact: true });
    const actions = editor.getByRole("button", { name: "Block actions", exact: true });
    await expect(add).toHaveCount(0);
    await expect(editor.locator('button[draggable="true"]')).toHaveCount(0);
    await expect(actions).toHaveAttribute("aria-haspopup", "dialog");
    await actions.click();
    const sheet = page.getByRole("dialog", { name: "Block actions", exact: true });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Done", exact: true }).click();
    await expect(sheet).toBeHidden();
    await page.setViewportSize({ width: 900, height: 900 });
    await paragraph.click();
    await expect(add).toBeVisible();
    await expect(actions).toHaveAttribute("draggable", "true");
    await expect(actions).toHaveAttribute("aria-haspopup", "menu");
    await page.setViewportSize({ width: 390, height: 900 });
    await paragraph.click();
    await expect(add).toHaveCount(0);
    await expect(actions).toHaveAttribute("aria-haspopup", "dialog");
    await expectNoOverflow(page);
  });
});

test("editor_sheet_and_type_menu_restore_focus", async ({ browser, browserName }) => {
  await withEditor(browser, browserName, { width: 900, touch: true }, async (page) => {
    const paragraph = page.locator('[data-editor-root] [data-content-type="paragraph"]').filter({ hasText: MOVING });
    await paragraph.tap();
    const blockActions = page.getByRole("button", { name: "Block actions", exact: true });
    await blockActions.tap();
    const sheet = page.getByRole("dialog", { name: "Block actions", exact: true });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Move up", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("textbox", { name: "README", exact: true })).toBeFocused();

    await paragraph.tap();
    const blockType = page.getByRole("button", { name: "Block type", exact: true });
    await blockType.tap();
    const typeMenu = page.getByRole("menu", { name: "Block type", exact: true });
    await expect(typeMenu.getByRole("menuitemradio").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "Block type", exact: true })).toBeHidden();
    await expect.soft(blockType).toBeFocused();
  });
});

test("editor_pointer_type_menu_fits_near_viewport_bottom", async ({ browser, browserName }) => {
  await withEditor(browser, browserName, { width: 1440, touch: false }, async (page) => {
    await page.setViewportSize({ width: 1440, height: 420 });
    const paragraph = page.locator('[data-editor-root] [data-content-type="paragraph"]').filter({
      hasText: "Final line for keyboard navigation.",
    });
    await paragraph.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+ArrowLeft");
    const blockType = page.getByRole("button", { name: "Block type", exact: true });
    await blockType.click();
    const menu = page.getByRole("menu", { name: "Block type", exact: true });
    await expect(menu).toBeVisible();
    const rect = await menu.boundingBox();
    expect(rect).not.toBeNull();
    if (rect !== null) {
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y + rect.height).toBeLessThanOrEqual(420);
    }
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(blockType).toBeFocused();
  });
});

// Alex 2026-10-27 (iPhone): with focus outside the editor but its selection kept, the phone fell back to the floating
// desktop toolbar over the text. Later the same day: the bar must never interact with Save, which stays at the very
// top. Compact controls keep their one bar docked at the bottom whatever has focus, and Save and Cancel do not move.
test("editor_phone_bar_stays_docked_at_the_bottom_and_save_stays_at_the_top", async ({ browser, browserName }) => {
  await withEditor(browser, browserName, { width: 390, touch: true }, async (page) => {
    const editor = page.locator("[data-editor-root]");
    const actions = page.locator("[data-readme-actions]");
    const bar = page.getByRole("toolbar", { name: "Text style", exact: true });
    const save = await actions.boundingBox();
    await expect(bar).toBeVisible();
    const paragraph = editor.locator('[data-content-type="paragraph"]').filter({ hasText: MOVING });
    await paragraph.evaluate((element) =>
      (element as unknown as { scrollIntoView(options: object): void }).scrollIntoView({ block: "center" }),
    );
    await paragraph.tap();
    await page.keyboard.press("Shift+End");
    await page.evaluate(() =>
      (globalThis as unknown as { document: { activeElement: { blur(): void } } }).document.activeElement.blur(),
    );
    for (const _ of [0, 1]) {
      const view = page.viewportSize()?.height ?? 0;
      // Placement follows scroll events, which arrive a frame after the scroll itself.
      await expect
        .poll(async () => ((await bar.boundingBox())?.y ?? 0) + ((await bar.boundingBox())?.height ?? 0))
        .toBeGreaterThan(view - 32);
      const box = await bar.boundingBox();
      const pinned = await actions.boundingBox();
      expect(box?.height).toBeLessThanOrEqual(56);
      if (box !== null && pinned !== null) expect(box.y).toBeGreaterThan(pinned.y + pinned.height);
      if (save !== null && pinned !== null) expect(pinned.y).toBeLessThanOrEqual(save.y);
      await expect(bar.getByRole("button", { name: "Align left", exact: true })).toHaveCount(0);
      await paragraph.tap();
    }
  });
});

// Alex 2026-10-27: after scrolling, the compact type menu opened over the docked toolbar, whose labels painted over
// Check List and Code Block. 505px tall stands in for a software keyboard (Playwright sets the layout viewport).
for (const height of [844, 505]) {
  test(`editor_phone_type_menu_items_stay_readable_and_selectable ${height}`, async ({ browser, browserName }) => {
    await withEditor(browser, browserName, { width: 390, touch: true }, async (page) => {
      await page.setViewportSize({ width: 390, height });
      const paragraph = page
        .locator('[data-editor-root] [data-content-type="paragraph"]')
        .filter({ hasText: NEIGHBOR });
      // Playwright scrolls a target to the scroller's edge, where the docked bar covers it; a finger scrolls first.
      await paragraph.evaluate((element) =>
        (element as unknown as { scrollIntoView(options: object): void }).scrollIntoView({ block: "center" }),
      );
      await paragraph.tap();
      // Direction A (Alex 2026-10-27): one bar, and the phone navigation gives up its place while it is docked.
      const bar = await page.getByRole("toolbar", { name: "Text style", exact: true }).boundingBox();
      expect(bar?.height).toBeLessThanOrEqual(56);
      const phoneBar = page.locator("nav").filter({ has: page.getByRole("button", { name: "Menu", exact: true }) });
      await expect(phoneBar).toBeHidden();
      // The page scrolls in the shell's main, not the window (CoreShell.module.css).
      const main = page.locator("main");
      await main.evaluate((element) =>
        (element as unknown as { scrollBy(x: number, y: number): void }).scrollBy(0, 300),
      );
      const scrolled = () => main.evaluate((element) => (element as unknown as { scrollTop: number }).scrollTop);
      const before = await scrolled();
      await page.getByRole("button", { name: "Block type", exact: true }).tap();
      const menu = page.getByRole("menu", { name: "Block type", exact: true });
      await expect(menu).toBeVisible();
      // Opening the menu does not move the page.
      expect(await scrolled()).toBe(before);
      const actions = await page.locator("[data-readme-actions]").boundingBox();
      const rect = await menu.boundingBox();
      expect(rect).not.toBeNull();
      expect(actions).not.toBeNull();
      if (rect !== null && actions !== null) {
        expect(rect.y).toBeGreaterThanOrEqual(actions.y + actions.height - 1);
        expect(rect.y + rect.height).toBeLessThanOrEqual(height);
      }
      for (const name of ["Paragraph", "Check List", "Code Block"]) {
        const item = menu.getByRole("menuitemradio", { name, exact: true });
        await item.evaluate((element) =>
          (element as unknown as { scrollIntoView(options: object): void }).scrollIntoView({ block: "nearest" }),
        );
        // A trial tap runs Playwright's hit-target check: no other element, the toolbar included, may receive it.
        await item.tap({ trial: true, timeout: 2_000 });
      }
      await menu.getByRole("menuitemradio", { name: "Check List", exact: true }).tap();
      await expect(menu).toBeHidden();
      const checked = page
        .locator('[data-editor-root] [data-content-type="checkListItem"]')
        .filter({ hasText: NEIGHBOR });
      await expect(checked).toHaveCount(1);
    });
  });
}

test("editor_touch_edge_double_tap_opens_block_actions", async ({ browser, browserName }) => {
  await withEditor(browser, browserName, { width: 900, touch: true }, async (page) => {
    const paragraph = page.locator('[data-editor-root] [data-content-type="paragraph"]').filter({ hasText: MOVING });
    await paragraph.scrollIntoViewIfNeeded();
    const rect = await paragraph.boundingBox();
    if (rect === null) throw new Error("The fixture paragraph must be visible for the touch gesture");
    const x = rect.x + rect.width - 4;
    const y = rect.y + rect.height / 2;
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y);
    const sheet = page.getByRole("dialog", { name: "Block actions", exact: true });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Done", exact: true }).tap();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("textbox", { name: "README", exact: true })).toBeFocused();
  });
});
