// What a browser page is allowed to do while the harness watches it (P1.26).
import { expect, type Page } from "@playwright/test";

/** @axe-core/playwright 4.13.0 tags for WCAG 2.2 AA. https://github.com/dequelabs/axe-core/blob/v4.13.0/doc/rule-descriptions.md */
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;

export type Watched = {
  consoleErrors: string[];
  csp: string[];
  pageErrors: string[];
  scripts: string[];
};

/** Console, CSP or Trusted Types text, uncaught errors, and script requests. */
export function watch(page: Page): Watched {
  const watched: Watched = { consoleErrors: [], csp: [], pageErrors: [], scripts: [] };
  page.on("console", (message) => {
    const where = message.location().url;
    const text = where === "" ? message.text() : `${message.text()} ${where}`;
    if (/content security policy|trusted.?type/i.test(text)) watched.csp.push(text);
    if (message.type() === "error") watched.consoleErrors.push(text);
  });
  page.on("pageerror", (error) => {
    watched.pageErrors.push(error.message);
  });
  page.on("request", (request) => {
    if (request.resourceType() === "script") watched.scripts.push(request.url());
  });
  return watched;
}

/**
 * Chromium asks for `/favicon.ico` on its own. The head leaves favicons out
 * (apps/web/src/shell/head.tsx), so that probe is not a page violation. A linked icon is never ignored.
 */
export function withoutFaviconProbe(messages: readonly string[], html: string): string[] {
  if (/rel=["'][^"']*icon["']/i.test(html)) return [...messages];
  return messages.filter((text) => !/favicon\.ico/i.test(text));
}

export async function pageNoise(page: Page, watched: Watched): Promise<{ consoleErrors: string[]; csp: string[] }> {
  const html = await page.content();
  return {
    consoleErrors: withoutFaviconProbe(watched.consoleErrors, html),
    csp: withoutFaviconProbe(watched.csp, html),
  };
}

type Sized = {
  tagName: string;
  hasAttribute: (name: string) => boolean;
  getAttribute: (name: string) => string | null;
  getBoundingClientRect: () => { width: number; height: number };
};

type ShownStyle = { display: string; visibility: string; clipPath: string };

/**
 * Interactive controls under 24 CSS px (WCAG 2.2 SC 2.5.8). Skips undisplayed subtrees, inline
 * targets in text, and a clipped 1px input whose label is the visible target (the kit Switch).
 * The helper stays inside this function: Playwright serialises `page.evaluate`'s source only.
 * Passed to `page.evaluate` (no DOM lib in this project).
 */
export function undersizedTargets(): string[] {
  const view = globalThis as unknown as {
    document: { querySelectorAll: (selector: string) => Iterable<Sized> };
    getComputedStyle: (element: object) => ShownStyle;
  };
  const shown = (element: Sized): boolean => {
    if (element.hasAttribute("hidden") || element.getAttribute("type") === "hidden") return false;
    let current: { parentElement: object | null } | null = element as unknown as { parentElement: object | null };
    while (current !== null) {
      const style = view.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden") return false;
      current = current.parentElement as typeof current;
    }
    return true;
  };
  const controls = [...view.document.querySelectorAll("a, button, input, select, textarea, summary")];
  return controls.flatMap((element) => {
    if (!shown(element)) return [];
    const style = view.getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const inline = style.display === "inline";
    const clipped = box.width <= 1 && box.height <= 1 && style.clipPath !== "none";
    if (inline || clipped || (box.width >= 24 && box.height >= 24)) return [];
    return [`${element.tagName} ${box.width}x${box.height}`];
  });
}

/** The header menu is hydrated when Escape closes it and focus returns to the summary. */
export async function expectHeaderMenuCloses(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  // The menu is display:none until the header's container is 440px or narrower.
  await page.setViewportSize({ width: 400, height: 700 });
  const menu = page.locator("[data-island='header-menu'] details");
  await menu.locator("summary").click();
  await expect(menu).toHaveJSProperty("open", true);
  await menu.locator("summary").press("Escape");
  await expect(menu).toHaveJSProperty("open", false);
}
