// P1.25 (routes/home.ts, routes/legal.ts, web/page.ts): the public pages and the error pages through the web server,
// so the kit's group headers, CSP and error-page hook run exactly as in production.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as web from "@unset/apps-web";
import { loadConfig } from "@unset/shared-config";
import { createServer, defineRoute } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { afterAll, describe, expect, test } from "vitest";
import { compose } from "../compose.ts";
import { config } from "../config.ts";
import { policies } from "../limits.ts";
import { webTestEnv } from "../test-env.ts";
import { loadWebBuild } from "../web/build.ts";
import { errorPageHook } from "../web/page.ts";
import type { WebRender } from "../web/render-entry.ts";

const ORIGIN = "https://unset.test";
const TESTDATA = fileURLToPath(new URL("../web/testdata/", import.meta.url));
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));
const CONFIG = loadConfig(config, webTestEnv(SECRETS, { PUBLIC_ORIGIN: ORIGIN, WEB_BUILD_DIR: TESTDATA }));
const { server } = await compose(CONFIG, web);
const PUBLIC_PAGES = ["/", "/legal/terms", "/legal/privacy"];

type Server = { request: (request: Request, peer?: string) => Promise<Response> };
const get = (path: string, init: { method?: string; cookie?: string; on?: Server } = {}) =>
  (init.on ?? server).request(
    new Request(`${ORIGIN}${path}`, {
      method: init.method ?? "GET",
      headers: { host: "unset.test", "x-forwarded-for": "192.0.2.1", ...(init.cookie ? { cookie: init.cookie } : {}) },
    }),
    "10.0.0.1",
  );

/** A server with one route that throws, the composed server's error page and a log the test reads. */
function throwingServer(screens: WebRender["screens"] = web.screens) {
  const lines: Record<string, unknown>[] = [];
  const log = createLogger({
    service: "http",
    commit: "c".repeat(40),
    env: "test",
    write: (line) => lines.push(JSON.parse(line)),
  });
  const deps = {
    build: loadWebBuild(TESTDATA, web.islandName),
    render: web.renderPage,
    assetsOrigin: ORIGIN,
    env: "test",
    log,
  } as const;
  const route = defineRoute({
    method: "GET",
    path: "/boom",
    group: "app",
    rateLimit: "default",
    session: "none",
    handler: () => {
      throw new Error("stack text that must not reach the page");
    },
  });
  const on = createServer({ config: CONFIG, routes: [route], policies, log, errorPage: errorPageHook(deps, screens) });
  return { on, lines };
}

describe("public pages", () => {
  test("public_routes_use_public_group", async () => {
    const table = server.routeTable();
    for (const path of PUBLIC_PAGES) {
      expect(table.find((route) => route.path === path)?.group, path).toBe("public");
      const response = await get(path, { cookie: "__Host-theme=dark" });
      expect(response.status, path).toBe(200);
      const csp = response.headers.get("content-security-policy") ?? "";
      expect(csp, path).toContain("default-src 'none'");
      expect(csp, path).not.toContain("script-src");
      // Public: the theme cookie is not read and nothing varies on it.
      expect(response.headers.get("vary"), path).toBeNull();
      expect(await response.text(), path).not.toContain("data-theme");
    }
  });

  test("shell_zero_js", async () => {
    const { on } = throwingServer();
    const pages = [...PUBLIC_PAGES.map((path) => get(path)), get("/nowhere"), get("/boom", { on })];
    for (const response of await Promise.all(pages)) {
      const html = await response.text();
      expect(html).toContain('<main id="main">');
      expect(html).not.toContain("<script");
      expect(html).not.toContain("modulepreload");
    }
  });

  test("legal_placeholders_noindex", async () => {
    for (const path of ["/legal/terms", "/legal/privacy"]) {
      const response = await get(path);
      expect(response.headers.get("x-robots-tag"), path).toBe("noindex");
      expect(await response.text(), path).toContain('<meta name="robots" content="noindex"/>');
    }
    const home = await get("/");
    expect(home.headers.get("x-robots-tag")).toBeNull();
  });

  test("error_param_known_code", async () => {
    const html = await (await get("/?error=csrf.denied")).text();
    expect(html).toContain('role="alert"');
    expect(html).toContain("The form expired or came from another site.");
  });

  test("error_param_unknown_ignored", async () => {
    for (const value of ["nope.nope", "%3Cb%3Ex%3C%2Fb%3E", "config.invalid", "__proto__"]) {
      const html = await (await get(`/?error=${value}`)).text();
      expect(html, value).not.toContain('role="alert"');
      expect(html, value).not.toContain(decodeURIComponent(value));
    }
  });

  test("head_same_headers_no_body", async () => {
    for (const path of [...PUBLIC_PAGES, "/nowhere"]) {
      const [got, head] = await Promise.all([get(path), get(path, { method: "HEAD" })]);
      expect(head.status, path).toBe(got.status);
      expect(await head.text(), path).toBe("");
      const headers = (response: Response) => [...response.headers].filter(([name]) => name !== "content-length");
      expect(headers(head), path).toEqual(headers(got));
    }
  });
});

describe("error pages", () => {
  test("notfound_no_echo", async () => {
    const response = await get("/%3Cscript%3Ex");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    const html = await response.text();
    expect(html).toContain("That page does not exist.");
    expect(html).not.toContain("script>x");
    expect(html).not.toContain("%3Cscript");
  });

  test("server_error_request_id", async () => {
    const { on, lines } = throwingServer();
    const response = await get("/boom", { on });
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    const shown = /<code>([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})<\/code>/.exec(html)?.[1];
    expect(shown).toBeDefined();
    expect(lines.find((line) => line.event === "http.request")?.reqId).toBe(shown);
    expect(html).toContain('<main id="main">');
    expect(html).not.toContain("stack text");
    expect(html).not.toMatch(/at \S+ \(/);
  });

  test("server_error_fallback_static", async () => {
    const broken = {
      ...web.screens,
      errorPage: () => {
        throw new Error("error page broke");
      },
    };
    const { on } = throwingServer(broken);
    const response = await get("/boom", { on });
    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("<title>Error</title>");
    expect(html).not.toContain('<main id="main">');
  });
});
