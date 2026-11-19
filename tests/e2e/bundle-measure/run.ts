// The bundle experiment's runner (P1.20u): loads the member's pages in Chromium through the local edge (edge.caddy,
// staging's app-ratelimit zones) in front of a built interfaces/web (serve.ts), and reports what reached the edge.
// Usage: node tests/e2e/bundle-measure/run.ts <builds-dir> <caddy-binary> <out.json>
// <builds-dir> holds copies of interfaces/web/build named <mode>-base, <mode>-page and <mode>-shared, for mode single
// and split (output.bundleStrategy in vite.config.ts): the same commit; then with data-v="2" on Settings › Account's
// h1; then with data-v="2" on the shared Button's anchor. The caddy binary is xcaddy-built as deployment/edge/Dockerfile
// builds it. BUNDLE_EDGE_CONFIG names another edge file in this folder (edge-asset-zone.caddy, the what-if),
// BUNDLE_MODES limits the run to some modes, BUNDLE_CHROMIUM points at a Chromium when the pinned one is missing.
// Every scenario starts a fresh edge, so no zone carries counts from the one before. Never run against staging.
import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, type BrowserContext, chromium, type Page } from "@playwright/test";
import { ACCOUNT, HOST } from "../pages.ts";

function argument(index: number): string {
  const value = process.argv[index + 2];
  if (value === undefined) throw new Error("usage: run.ts <builds-dir> <caddy-binary> <out.json>");
  return value;
}
const buildsDir = argument(0);
const caddyBin = argument(1);
const outFile = argument(2);
// serve.ts and edge.caddy use the same port and name.
const EDGE_ORIGIN = `https://${HOST}:9444`;
const ROOT = join(import.meta.dirname, "../../..");
const WEB_BUILD = join(ROOT, "interfaces/web/build");
const work = mkdtempSync(join(tmpdir(), "unset-bundle-run-"));
const cookieFile = join(work, "cookie");
const edgeLog = join(work, "edge.log");

const ROUTES = {
  owner: `/${ACCOUNT.did}`,
  settingsProfile: "/settings/profile",
  settingsAccount: "/settings/account",
} as const;
type RouteName = keyof typeof ROUTES;

// Lighthouse's default mobile profile (150 ms RTT, 1.6 Mbps down, 750 kbps up, CPU 4x), applied through CDP for the
// timing rows only; the counting rows run unthrottled, which packs requests closest together (the worst case for a
// 10 s window).
const SLOW = { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };

// A Chromium other than the one this Playwright pins, when that is not installed (BUNDLE_CHROMIUM).
const executablePath = process.env.BUNDLE_CHROMIUM === undefined ? {} : { executablePath: process.env.BUNDLE_CHROMIUM };
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function waitForLine(file: string, text: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (existsSync(file) && readFileSync(file, "utf8").includes(text)) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for "${text}" in ${file}`);
}

let web: ChildProcess | undefined;
let starts = 0;
async function startWeb(build: string): Promise<string> {
  if (web !== undefined) await stop(web);
  rmSync(WEB_BUILD, { recursive: true, force: true });
  cpSync(join(buildsDir, build), WEB_BUILD, { recursive: true });
  rmSync(cookieFile, { force: true });
  starts += 1;
  const log = join(work, `web-${starts}-${build}.log`);
  web = spawn(process.execPath, [join(import.meta.dirname, "serve.ts"), cookieFile], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let text = "";
  web.stderr?.on("data", (chunk: Buffer) => {
    text += chunk.toString();
    writeFileSync(log, text);
  });
  await waitForLine(log, "bundle web listening", 180_000);
  return readFileSync(cookieFile, "utf8");
}

let edge: ChildProcess | undefined;
async function startEdge(): Promise<void> {
  if (edge !== undefined) await stop(edge);
  writeFileSync(edgeLog, "");
  const log = join(work, "caddy.log");
  writeFileSync(log, "");
  const child = spawn(
    caddyBin,
    [
      "run",
      "--config",
      join(import.meta.dirname, process.env.BUNDLE_EDGE_CONFIG ?? "edge.caddy"),
      "--adapter",
      "caddyfile",
    ],
    {
      env: { ...process.env, BUNDLE_EDGE_LOG: edgeLog, XDG_DATA_HOME: join(work, "caddy-data") },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  edge = child;
  let text = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    text += chunk.toString();
    writeFileSync(log, text);
  });
  await waitForLine(log, "serving initial configuration", 30_000);
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((done) => {
    if (child.exitCode !== null) return done();
    child.once("exit", () => done());
    child.kill("SIGTERM");
  });
}

type EdgeLine = { ts: number; uri: string; status: number; size: number };
function edgeLines(): EdgeLine[] {
  return readFileSync(edgeLog, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { ts: number; status: number; size: number; request: { uri: string } })
    .map((entry) => ({ ts: entry.ts, uri: entry.request.uri, status: entry.status, size: entry.size }));
}

const kindOf = (uri: string): string => {
  const path = uri.split("?")[0] ?? uri;
  if (path.endsWith(".js")) return "js";
  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".woff2")) return "font";
  if (path.endsWith(".png") || path.endsWith(".ico") || path.endsWith(".svg")) return "image";
  if (path.endsWith("__data.json")) return "data";
  return "document";
};

/** What reached the edge between two offsets of its log: counts, 429s, bytes by kind, and the peak in any 10 s. */
function summarise(lines: readonly EdgeLine[]) {
  const bytes: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const line of lines) {
    const kind = kindOf(line.uri);
    if (line.status !== 429) bytes[kind] = (bytes[kind] ?? 0) + line.size;
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  let peak10s = 0;
  for (const line of lines) {
    const inWindow = lines.filter((other) => other.ts >= line.ts && other.ts < line.ts + 10).length;
    peak10s = Math.max(peak10s, inWindow);
  }
  return {
    requests: lines.length,
    rejected429: lines.filter((line) => line.status === 429).length,
    rejectedUris: lines.filter((line) => line.status === 429).map((line) => line.uri.split("?")[0]),
    counts,
    bytes,
    peak10s,
  };
}

/** Runs `work` and returns what the edge saw while it ran; a navigation the edge refused is recorded, not thrown. */
async function edgeDuring(work: () => Promise<unknown>) {
  const before = edgeLines().length;
  const extra = await work().catch((error: unknown) => ({ error: String(error).split("\n")[0] }));
  await sleep(300);
  return { ...summarise(edgeLines().slice(before)), ...(extra === undefined ? {} : { browser: extra }) };
}

// Marks the moment SvelteKit's client finished hydrating: its router adds the window's beforeunload listener right
// after hydration (@sveltejs/kit 3.2.0 src/runtime/client/client.js, start → _hydrate, then _start_router).
const READY_SCRIPT = `(() => {
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (this === window && type === "beforeunload" && window.__kitReady === undefined) window.__kitReady = performance.now();
    return add.call(this, type, ...rest);
  };
})();`;

async function newContext(browser: Browser, cookie: string): Promise<BrowserContext> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: "block" });
  await context.addCookies([
    { name: "__Host-sid", value: cookie, url: EDGE_ORIGIN, secure: true, httpOnly: true, sameSite: "Lax" },
  ]);
  await context.addInitScript(READY_SCRIPT);
  return context;
}

/** The browser's own view of a load: failed requests by status, and the hydration time. */
function watch(page: Page) {
  const failed: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on("requestfailed", (request) => failed.push(`failed ${new URL(request.url()).pathname}`));
  return failed;
}

async function open(page: Page, route: RouteName) {
  const failed = watch(page);
  const response = await page.goto(EDGE_ORIGIN + ROUTES[route], { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  const ready = await page.evaluate(() => (globalThis as { __kitReady?: number }).__kitReady ?? null);
  return { status: response?.status() ?? 0, hydratedMs: ready === null ? null : Math.round(ready), failed };
}

async function throttle(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, ...SLOW });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

/** Opens the card editor from Add card and picks README: the time to the focused text field and what it fetched. */
async function openEditor(page: Page) {
  const started = Date.now();
  await page.getByRole("link", { name: "Add card" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^README/ })
    .click();
  await page.getByRole("dialog").getByRole("textbox", { name: "README" }).waitFor();
  const ms = Date.now() - started;
  const url = page.url();
  return { ms, stayedOnPage: !url.includes("?add") };
}

async function scenarios(browser: Browser, mode: string) {
  const cookie = await startWeb(`${mode}-base`);
  const result: Record<string, unknown> = {};

  // 1. Each route cold in its own fresh browser, then warm: a reload, and the same route in a new tab.
  for (const route of Object.keys(ROUTES) as RouteName[]) {
    await startEdge();
    const context = await newContext(browser, cookie);
    const page = await context.newPage();
    const cold = await edgeDuring(() => open(page, route));
    const reload = await edgeDuring(async () => {
      const failed = watch(page);
      await page.reload({ waitUntil: "load" });
      await page.waitForLoadState("networkidle");
      return { failed };
    });
    const tab = await edgeDuring(async () => open(await context.newPage(), route));
    result[`route:${route}`] = { cold, warmReload: reload, warmNewTab: tab };
    await context.close();
  }

  // 2. A member's visit, cold: owner page, then settings profile and account by link (client navigation), then
  // back twice to the owner page; all inside one fresh edge window.
  await startEdge();
  {
    const context = await newContext(browser, cookie);
    const page = await context.newPage();
    result.visitByLink = await edgeDuring(async () => {
      const failed = watch(page);
      await page.goto(EDGE_ORIGIN + ROUTES.owner, { waitUntil: "load" });
      await page.waitForLoadState("networkidle");
      for (const path of [ROUTES.settingsProfile, ROUTES.settingsAccount]) {
        try {
          await page.locator(`a[href="${path}"]:visible`).first().click({ timeout: 10_000 });
          await page.waitForURL(EDGE_ORIGIN + path, { timeout: 10_000 });
          await page.waitForLoadState("networkidle");
        } catch (error) {
          return { failed, stuckAt: page.url(), title: await page.title(), error: String(error).split("\n")[0] };
        }
      }
      // Back twice, to the owner page, as the browser's back button does (SvelteKit handles popstate).
      await page.goBack();
      await page.goBack();
      await page.waitForURL(EDGE_ORIGIN + ROUTES.owner);
      await page.waitForLoadState("networkidle");
      return { failed };
    });
    await context.close();
  }

  // 3. Two tabs opened at once, cold, in one browser: the owner page and settings profile.
  await startEdge();
  {
    const context = await newContext(browser, cookie);
    const [a, b] = [await context.newPage(), await context.newPage()];
    result.twoTabsCold = await edgeDuring(async () => Promise.all([open(a, "owner"), open(b, "settingsProfile")]));
    await context.close();
  }

  // 4. Timing on a slow phone profile: each route cold, then the card editor opened on the warm owner page.
  await startEdge();
  {
    const timing: Record<string, unknown> = {};
    for (const route of Object.keys(ROUTES) as RouteName[]) {
      const context = await newContext(browser, cookie);
      const page = await context.newPage();
      await throttle(page);
      timing[route] = await open(page, route);
      await context.close();
      await startEdge();
    }
    const context = await newContext(browser, cookie);
    const page = await context.newPage();
    await throttle(page);
    await open(page, "owner");
    timing.editor = await edgeDuring(() => openEditor(page));
    await context.close();
    result.slowPhone = timing;
  }

  // 5. A returning browser after a deploy: visit the three routes on the base build, then on a build with one edit,
  // and count what the second visit fetched again. The browser keeps its HTTP cache across the server restart.
  for (const change of ["page", "shared"] as const) {
    const profile = mkdtempSync(join(work, "profile-"));
    const launch = () =>
      chromium.launchPersistentContext(profile, {
        ...executablePath,
        ignoreHTTPSErrors: true,
        serviceWorkers: "block",
        args: ["--host-resolver-rules=MAP unset.test 127.0.0.1", "--no-proxy-server"],
      });
    const visit = async (context: BrowserContext, sid: string) => {
      await context.addCookies([
        { name: "__Host-sid", value: sid, url: EDGE_ORIGIN, secure: true, httpOnly: true, sameSite: "Lax" },
      ]);
      const page = await context.newPage();
      for (const route of Object.keys(ROUTES) as RouteName[]) {
        await page.goto(EDGE_ORIGIN + ROUTES[route], { waitUntil: "load" });
        await page.waitForLoadState("networkidle");
      }
      await page.close();
    };
    const baseSid = await startWeb(`${mode}-base`);
    await startEdge();
    let context = await launch();
    const first = await edgeDuring(() => visit(context, baseSid));
    await context.close();
    const nextSid = await startWeb(`${mode}-${change}`);
    await startEdge();
    context = await launch();
    const again = await edgeDuring(() => visit(context, nextSid));
    await context.close();
    result[`redeploy:${change}`] = { firstVisit: first, afterDeploy: again };
  }
  return result;
}

const browser = await chromium.launch({
  ...executablePath,
  args: ["--host-resolver-rules=MAP unset.test 127.0.0.1", "--no-proxy-server"],
});
const out: Record<string, unknown> = { at: new Date().toISOString() };
try {
  for (const mode of (process.env.BUNDLE_MODES ?? "single,split").split(","))
    out[mode] = await scenarios(browser, mode);
} finally {
  await browser.close();
  if (edge !== undefined) await stop(edge);
  if (web !== undefined) await stop(web);
  writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`);
}
