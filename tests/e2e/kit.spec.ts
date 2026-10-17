// Kit behaviour the browser harness owns (P1.24a done-when, run here because the showcase
// needs the app shell's production assets). English only. The showcase route is the fixture server.
import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { AXE_ALLOWANCE, expiredAllowances, unallowedViolations } from "./allow.ts";
import { AXE_TAGS, pageNoise, undersizedTargets, type Watched, watch } from "./observe.ts";
import { FIXTURES, TEST_ORIGIN } from "./pages.ts";

const today = new Date().toISOString().slice(0, 10);
const SHOWCASE = `${TEST_ORIGIN}${FIXTURES.showcase}`;

async function openKit(page: Page): Promise<Watched> {
  const watched = watch(page);
  const response = await page.goto(SHOWCASE);
  expect(response?.status()).toBe(200);
  await page.waitForLoadState("networkidle");
  return watched;
}

/**
 * WebKit logs this while applying a stylesheet that a module imported, and the sheet still
 * applies (the combobox border is the same rgb(126, 123, 128) as Chromium). Chromium stays
 * strict: a real inline style fails there. CSP snapshots themselves are Chromium only.
 */
function withoutWebKitModuleStyle(messages: readonly string[], browserName: string): string[] {
  if (browserName !== "webkit") return [...messages];
  return messages.filter((text) => !text.startsWith("Refused to apply a stylesheet because its hash"));
}

async function expectAxeClean(page: Page, watched: Watched, browserName: string): Promise<void> {
  expect(expiredAllowances(AXE_ALLOWANCE, today)).toEqual([]);
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
  expect(unallowedViolations(results.violations, AXE_ALLOWANCE, today)).toEqual([]);
  const noise = await pageNoise(page, watched);
  expect(withoutWebKitModuleStyle(noise.consoleErrors, browserName)).toEqual([]);
  expect(withoutWebKitModuleStyle(noise.csp, browserName)).toEqual([]);
  expect(watched.pageErrors).toEqual([]);
}

for (const theme of ["dark", "light"] as const) {
  test(`kit_axe_both_themes ${theme}`, async ({ browser, browserName }) => {
    const context = await browser.newContext({
      colorScheme: theme === "dark" ? "light" : "dark",
      extraHTTPHeaders: { "accept-language": "en", cookie: `__Host-theme=${theme}` },
    });
    const page = await context.newPage();
    try {
      const watched = await openKit(page);
      await page.getByRole("combobox", { name: "Language" }).waitFor();
      // WebKit drops Playwright's Cookie header on http (a11y.spec.ts expectTheme).
      if (browserName === "webkit") await expect(page.locator("html")).not.toHaveAttribute("data-theme");
      else await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expectAxeClean(page, watched, browserName);
    } finally {
      await context.close();
    }
  });
}

test("tabs_default_arrow_moves_focus", async ({ page }) => {
  await openKit(page);
  const nav = page.getByRole("navigation", { name: "Install method" });
  const npm = nav.getByRole("link", { name: "npm" });
  const curl = nav.getByRole("link", { name: "curl" });
  await expect(npm).toHaveAttribute("aria-current", "page");
  await expect(nav.locator("[role=tab]")).toHaveCount(0);
  await npm.focus();
  await page.keyboard.press("ArrowRight");
  await expect(curl).toBeFocused();
  await expect(npm).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Home");
  await expect(curl).toBeFocused();
  await page.keyboard.press("End");
  await expect(npm).toBeFocused();
  expect(new URL(page.url()).pathname).toBe(FIXTURES.showcase);
});

test("tabs_eager_arrow_moves_selection", async ({ page }) => {
  await openKit(page);
  const nav = page.getByRole("navigation", { name: "Profile sections" });
  const about = nav.getByRole("tab", { name: "about" });
  const links = nav.getByRole("tab", { name: "links" });
  await expect(about).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("unset.sh", { exact: true })).toBeHidden();
  await about.focus();
  await page.keyboard.press("ArrowRight");
  await expect(links).toHaveAttribute("aria-selected", "true");
  await expect(links).toBeFocused();
  await expect(page.getByText("unset.sh", { exact: true })).toBeVisible();
  await expect(page.getByText("Videos and captions, nothing else.")).toBeHidden();
  await page.keyboard.press("Home");
  await expect(about).toHaveAttribute("aria-selected", "true");
  expect(new URL(page.url()).search).toContain("section=about");
});

test("select_island_keyboard", async ({ page }) => {
  await openKit(page);
  const box = page.getByRole("combobox", { name: "Language" });
  const list = page.getByRole("listbox");
  const native = page.locator('select[name="lang"]');
  await box.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(box).toHaveAttribute("aria-expanded", "true");
  await expect(list).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(box).toHaveAttribute("aria-expanded", "false");
  await expect(native).toHaveValue("fr");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(box).toHaveAttribute("aria-expanded", "false");
  await expect(box).toBeFocused();
  await expect(native).toHaveValue("fr");
});

test("select_island_typeahead", async ({ page }) => {
  await openKit(page);
  const box = page.getByRole("combobox", { name: "Language" });
  const native = page.locator('select[name="lang"]');
  await box.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("fr", { delay: 30 });
  await expect(page.getByRole("option", { name: "Français" })).toBeVisible();
  await expect(native).toHaveValue("");
  await page.keyboard.press("Escape");
  // SelectListbox joins keystrokes for 500ms. The closed pick is a new search.
  await page.waitForTimeout(600);
  await page.keyboard.press("f");
  await expect(native).toHaveValue("fr");
});

test("select_island_flip_up", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await openKit(page);
  const box = page.getByRole("combobox", { name: "Language" });
  await box.evaluate((element) => {
    const view = globalThis as unknown as {
      scrollY: number;
      innerHeight: number;
      scrollTo: (x: number, y: number) => void;
    };
    const top = (element as unknown as { getBoundingClientRect: () => { top: number } }).getBoundingClientRect().top;
    view.scrollTo(0, top + view.scrollY - (view.innerHeight - 70));
  });
  await box.focus();
  await page.keyboard.press("ArrowDown");
  const list = page.getByRole("listbox");
  await expect(list).toBeVisible();
  const listBox = await list.boundingBox();
  const combobox = await box.boundingBox();
  expect(listBox).not.toBeNull();
  expect(combobox).not.toBeNull();
  expect((listBox?.y ?? 0) + (listBox?.height ?? 0)).toBeLessThanOrEqual(combobox?.y ?? 0);
});

test("header_folds_by_container", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openKit(page);
  const section = page.locator("section", { has: page.getByRole("heading", { name: "Header", level: 2 }) });
  const menu = section.locator("details");
  // The wide nav is the island's sibling. The island wraps <details>, so they are not adjacent.
  const wide = section.locator("header > div > div").last();
  await expect(menu).toBeHidden();
  await expect(wide).toBeVisible();
  // servers.ts imports the page types, which load @types/react's empty DOM stubs
  // (this project has no DOM lib), so HTMLElement here has no style.
  await section.evaluate((element) => {
    (element as unknown as { style: { width: string } }).style.width = "400px";
  });
  await expect(menu).toBeVisible();
  await expect(wide).toBeHidden();
});

test("modal_dialog_focus_return", async ({ page }) => {
  await openKit(page);
  const trigger = page.getByRole("link", { name: "Delete draft" });
  await trigger.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("commandblock_button_with_js", async ({ page }) => {
  await openKit(page);
  await expect(page.getByRole("button", { name: "copy" })).toHaveCount(1);
});

test("showcase_target_size", async ({ page }) => {
  await openKit(page);
  const small = await page.evaluate(undersizedTargets);
  expect(small).toEqual([]);
});

async function blockPageScripts(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    if (route.request().resourceType() === "script") return route.abort();
    return route.continue();
  });
}

test("kit_axe_no_js", async ({ page, browserName }) => {
  // axe-core is injected with page.evaluate. A context with JavaScript disabled never finishes
  // that call (Firefox was still inside it after ten minutes), so the page's scripts are aborted
  // instead: the server markup stays, and axe can run.
  await blockPageScripts(page);
  const watched = await openKit(page);
  await expect(page.getByRole("button", { name: "copy" })).toHaveCount(0);
  expect(expiredAllowances(AXE_ALLOWANCE, today)).toEqual([]);
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
  expect(unallowedViolations(results.violations, AXE_ALLOWANCE, today)).toEqual([]);
  const noise = await pageNoise(page, watched);
  const errors = withoutWebKitModuleStyle(noise.consoleErrors, browserName).filter(
    (text) => !/ERR_FAILED|Failed to load resource/i.test(text),
  );
  expect(errors).toEqual([]);
  expect(withoutWebKitModuleStyle(noise.csp, browserName)).toEqual([]);
  expect(watched.pageErrors).toEqual([]);
});

test("header_menu_details_no_js", async ({ page }) => {
  await blockPageScripts(page);
  await page.setViewportSize({ width: 390, height: 700 });
  await openKit(page);
  const section = page.locator("section", { has: page.getByRole("heading", { name: "Header", level: 2 }) });
  const menu = section.locator("details");
  await expect(menu).toBeVisible();
  await menu.locator("summary").click();
  await expect(menu).toHaveAttribute("open", "");
  await menu.locator("summary").click();
  await expect(menu).not.toHaveAttribute("open");
});

test.describe("kit without javascript", () => {
  test.use({ javaScriptEnabled: false });

  test("commandblock_no_js_no_button", async ({ page }) => {
    await openKit(page);
    await expect(page.getByRole("button", { name: "copy" })).toHaveCount(0);
    await expect(page.getByText("unset login alex.example")).toBeVisible();
  });

  test("select_nojs_native", async ({ page }) => {
    await openKit(page);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    const native = page.locator('select[name="lang"]');
    await expect(native).toBeVisible();
    await native.selectOption("fr");
    await expect(native).toHaveValue("fr");
  });
});
