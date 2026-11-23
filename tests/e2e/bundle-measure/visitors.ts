// The shared-address measurement (book P1.22f; ADR 0114, ADR 0116): signed-out visitors open the public profile, home
// and an address no route matches through the local edge (edge.caddy: the dev app site's own zones, read from the
// repository) in front of the built interfaces/web (serve.ts), every visitor a fresh browser with no cache, all from
// one client address. It reports what each cold and warm page asks for, how much of it app_files counts, and what
// happens when several visitors behind that one address open the profile in the same few seconds: how many fit, which
// files the edge refuses past that, and whether each visitor still reads the server's page.
// Usage: node tests/e2e/bundle-measure/visitors.ts <caddy-binary> <out.json>, after `npm run build -w interfaces/web`.
// BUNDLE_CHROMIUM points at a Chromium when the pinned one is missing. Never run against staging.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "@playwright/test";
import { HOST, INDEXED } from "../pages.ts";

const [caddyArg, outArg] = process.argv.slice(2);
if (caddyArg === undefined || outArg === undefined) throw new Error("usage: visitors.ts <caddy-binary> <out.json>");
const caddyBin: string = caddyArg;
const outFile: string = outArg;
const EDGE_ORIGIN = `https://${HOST}:9444`;
const work = mkdtempSync(join(tmpdir(), "unset-visitors-"));
const edgeLog = join(work, "edge.log");
const executablePath = process.env.BUNDLE_CHROMIUM === undefined ? {} : { executablePath: process.env.BUNDLE_CHROMIUM };
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const PAGES = {
  profile: { path: `/@${INDEXED.did}`, heading: "Public Member" },
  home: { path: "/", heading: null },
  unmatched: { path: "/no-route-matches-this", heading: "That page does not exist." },
} as const;
type PageName = keyof typeof PAGES;

/** What app_files counts: ratelimit.caddy's (app-build-file) pattern, on the path as the browser sent it. */
const BUILD_FILE = /^\/_app\/immutable\/(?:entry|nodes|chunks|assets)\/[\w-]+(?:\.[\w-]+)?\.(?:js|css|woff2|png)$/;

async function waitForLine(file: string, text: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (existsSync(file) && readFileSync(file, "utf8").includes(text)) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for "${text}" in ${file}`);
}

function stop(child: ChildProcess | undefined): Promise<void> {
  return new Promise((done) => {
    if (child === undefined || child.exitCode !== null) return done();
    child.once("exit", () => done());
    child.kill("SIGTERM");
  });
}

function startLogged(command: string, args: string[], log: string, env: NodeJS.ProcessEnv = process.env) {
  writeFileSync(log, "");
  const child = spawn(command, args, { env, stdio: ["ignore", "ignore", "pipe"] });
  let text = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    text += chunk.toString();
    writeFileSync(log, text);
  });
  return child;
}

let edge: ChildProcess | undefined;
/** A fresh edge, so no zone carries counts from the scenario before. */
async function startEdge(): Promise<void> {
  await stop(edge);
  writeFileSync(edgeLog, "");
  const log = join(work, "caddy.log");
  const config = join(import.meta.dirname, "edge.caddy");
  edge = startLogged(caddyBin, ["run", "--config", config, "--adapter", "caddyfile"], log, {
    ...process.env,
    BUNDLE_EDGE_LOG: edgeLog,
    XDG_DATA_HOME: join(work, "caddy-data"),
  });
  await waitForLine(log, "serving initial configuration", 30_000);
}

type EdgeLine = { ts: number; path: string; status: number };
function edgeLines(): EdgeLine[] {
  return readFileSync(edgeLog, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as { ts: number; status: number; request: { uri: string } })
    .map((entry) => ({ ts: entry.ts, path: entry.request.uri.split("?")[0] ?? "", status: entry.status }));
}

/** What reached the edge: build files (app_files) and everything else (app_burst), and what it refused. */
function summarise(lines: readonly EdgeLine[]) {
  const files = lines.filter((line) => BUILD_FILE.test(line.path));
  const refused = lines.filter((line) => line.status === 429);
  return {
    requests: lines.length,
    buildFiles: files.length,
    otherRequests: lines.length - files.length,
    others: lines.filter((line) => !BUILD_FILE.test(line.path)).map((line) => `${line.status} ${line.path}`),
    refused: refused.length,
    refusedPaths: refused.map((line) => line.path.replace(/^\/_app\/immutable\//, "")),
    spanS: lines.length === 0 ? 0 : Math.round(((lines.at(-1)?.ts ?? 0) - (lines[0]?.ts ?? 0)) * 100) / 100,
  };
}

async function edgeDuring<T>(work: () => Promise<T>) {
  const before = edgeLines().length;
  const seen = await work();
  await sleep(300);
  return { edge: summarise(edgeLines().slice(before)), seen };
}

// SvelteKit's client adds the window's beforeunload listener right after hydrating (@sveltejs/kit 3.2.0
// src/runtime/client/client.js, start → _hydrate, then _start_router): the moment the client took the page.
const READY_SCRIPT = `(() => {
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (this === window && type === "beforeunload" && window.__kitReady === undefined) window.__kitReady = true;
    return add.call(this, type, ...rest);
  };
})();`;

/** One visitor's view of a load: status, what failed, whether the client took over, and whether the page reads. */
async function open(page: Page, name: PageName) {
  const failed: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400 && response.request().resourceType() !== "document") {
      failed.push(`${response.status()} ${new URL(response.url()).pathname.replace(/^\/_app\/immutable\//, "")}`);
    }
  });
  const { path, heading } = PAGES[name];
  const response = await page.goto(EDGE_ORIGIN + path, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
  const h1 =
    (
      await page
        .locator("h1")
        .first()
        .textContent({ timeout: 2000 })
        .catch(() => null)
    )?.trim() ?? null;
  // Styled: the build's stylesheet arrived and applies (a refused one leaves a sheet with no rules).
  const styled = await page.evaluate(() => {
    type Sheet = { href: string | null; cssRules: { length: number } };
    const sheets = (globalThis as unknown as { document: { styleSheets: Iterable<Sheet> } }).document.styleSheets;
    return [...sheets].some((sheet) => sheet.href?.includes("/_app/immutable/") === true && sheet.cssRules.length > 0);
  });
  // What the document itself names for the browser to fetch at once (kit's modulepreload links).
  const preloads = await page.locator('link[rel="modulepreload"]').count();
  return {
    status: response?.status() ?? 0,
    h1,
    reads: heading === null ? h1 !== null : h1?.includes(heading) === true,
    styled,
    preloads,
    client: await page.evaluate(() => (globalThis as { __kitReady?: boolean }).__kitReady === true),
    failed,
  };
}

async function visitor(browser: Browser) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: "block" });
  await context.addInitScript(READY_SCRIPT);
  return context;
}

/** Each page cold in a fresh browser, then warm: a reload, and the page again in a new tab. */
async function pageCosts(browser: Browser) {
  const result: Record<string, unknown> = {};
  for (const name of Object.keys(PAGES) as PageName[]) {
    await startEdge();
    const context = await visitor(browser);
    const page = await context.newPage();
    const cold = await edgeDuring(() => open(page, name));
    const reload = await edgeDuring(async () => {
      await page.reload({ waitUntil: "load" });
      await page.waitForLoadState("networkidle");
    });
    const newTab = await edgeDuring(async () => open(await context.newPage(), name));
    result[name] = { cold, warmReload: reload.edge, warmNewTab: newTab };
    await context.close();
  }
  return result;
}

/** `count` visitors behind the one address open the profile cold at the same moment, on a fresh edge. */
async function together(browser: Browser, count: number) {
  await startEdge();
  const contexts = await Promise.all(Array.from({ length: count }, () => visitor(browser)));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const measured = await edgeDuring(() => Promise.all(pages.map((page) => open(page, "profile"))));
  await Promise.all(contexts.map((context) => context.close()));
  return {
    edge: { ...measured.edge, others: undefined },
    visitors: measured.seen.map((seen) => ({ ...seen, failed: seen.failed.length, failedFirst: seen.failed[0] })),
  };
}

/** Visitors arriving one a second, as a shared link spreads through one office, until the edge refuses one. */
async function oneASecond(browser: Browser, count: number) {
  await startEdge();
  const contexts = await Promise.all(Array.from({ length: count }, () => visitor(browser)));
  const loads = contexts.map(async (context, at) => {
    await sleep(at * 1000);
    return open(await context.newPage(), "profile");
  });
  const measured = await edgeDuring(() => Promise.all(loads));
  await Promise.all(contexts.map((context) => context.close()));
  return {
    edge: { ...measured.edge, others: undefined },
    visitors: measured.seen.map((seen) => ({
      reads: seen.reads,
      styled: seen.styled,
      client: seen.client,
      failed: seen.failed.length,
    })),
  };
}

const webLog = join(work, "web.log");
const web = startLogged(process.execPath, [join(import.meta.dirname, "serve.ts"), join(work, "cookie")], webLog);
const browser = await chromium.launch({
  ...executablePath,
  args: ["--host-resolver-rules=MAP unset.test 127.0.0.1", "--no-proxy-server"],
});
const out: Record<string, unknown> = { at: new Date().toISOString() };
try {
  await waitForLine(webLog, "bundle web listening", 180_000);
  out.pages = await pageCosts(browser);
  for (const count of [1, 2, 3, 4, 5, 6, 8]) out[`together:${count}`] = await together(browser, count);
  out["oneASecond:10"] = await oneASecond(browser, 10);
} finally {
  await browser.close();
  await stop(edge);
  await stop(web);
  writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`);
}
