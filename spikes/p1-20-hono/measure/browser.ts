// Chromium runs for P1.20 step 4b-4d: console and page errors, CSP and Trusted Types reports, hydration counter,
// computed styles, island interaction, script bytes per page. Writes the raw report it was given a path for.
import { writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright-core";

const CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

type PageReport = {
  url: string;
  status: number;
  console: { type: string; text: string }[];
  pageErrors: string[];
  scriptTags: number;
  modulePreloads: number;
  scriptBytes: number;
  hydrationErrors: number | null;
  boxStyle: { border: string; padding: string } | null;
  plainDivStyle: { border: string; padding: string } | null;
  interactions: { counterAfterClick: string | null; searchResults: string[] | null } | null;
};

async function visit(page: Page, url: string, interact: boolean): Promise<PageReport> {
  const report: PageReport = {
    url, status: 0, console: [], pageErrors: [], scriptTags: 0, modulePreloads: 0, scriptBytes: 0,
    hydrationErrors: null, boxStyle: null, plainDivStyle: null, interactions: null,
  };
  page.removeAllListeners();
  page.on("console", (m) => report.console.push({ type: m.type(), text: m.text() }));
  page.on("pageerror", (e) => report.pageErrors.push(String(e)));
  page.on("response", async (r) => {
    if (r.request().resourceType() === "script") report.scriptBytes += (await r.body().catch(() => Buffer.alloc(0))).length;
  });
  const response = await page.goto(url, { waitUntil: "networkidle" });
  report.status = response?.status() ?? 0;
  const html = (await response?.text()) ?? "";
  report.scriptTags = (html.match(/<script/g) ?? []).length - (html.match(/<script type="application\/json"/g) ?? []).length;
  report.modulePreloads = (html.match(/rel="modulepreload"/g) ?? []).length;
  const styleOf = (selector: string) =>
    page.$eval(selector, (el) => ({ border: getComputedStyle(el).borderTopColor + " " + getComputedStyle(el).borderTopWidth, padding: getComputedStyle(el).paddingTop })).catch(() => null);
  report.boxStyle = await styleOf("main > div, body > div");
  report.plainDivStyle = await page.evaluate(() => {
    const d = document.createElement("div");
    document.body.append(d);
    const s = { border: getComputedStyle(d).borderTopColor + " " + getComputedStyle(d).borderTopWidth, padding: getComputedStyle(d).paddingTop };
    d.remove();
    return s;
  });
  if (interact) {
    await page.click('[data-testid="count"]');
    const counterAfterClick = await page.textContent('[data-testid="count"]');
    await page.fill('[data-testid="q"]', "hello");
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="results"] li').length > 0, null, { timeout: 5000 }).catch(() => {});
    const searchResults = await page.$$eval('[data-testid="results"] li', (lis) => lis.map((li) => li.textContent ?? ""));
    report.interactions = { counterAfterClick, searchResults };
  }
  await page.waitForTimeout(300);
  report.hydrationErrors = await page.evaluate(() => (globalThis as { __hydrationErrors?: number }).__hydrationErrors ?? null);
  return report;
}

export async function runChromium(base: string, paths: { path: string; interact: boolean }[], out: string) {
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const page = await browser.newPage();
  const pages: PageReport[] = [];
  for (const { path, interact } of paths) pages.push(await visit(page, base + path, interact));
  const report = { engine: "chromium", version: browser.version(), base, pages };
  await browser.close();
  writeFileSync(out, JSON.stringify(report, null, 2));
  return report;
}
