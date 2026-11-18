// P1.20d: the public pages on the built SvelteKit server, with the outcomes interfaces/http/routes/public-pages.test.ts
// and legal.test.ts check for the Hono server: home, the legal pages, security.txt and the error pages run no script,
// read no cookie, are cached five minutes (home, legal), carry the public or static CSP, and echo nothing sent.
import { relative } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { buildOnce, clientAddress, ORIGIN, type RunningWeb, startWeb } from "../built-server.ts";

const REPO = new URL("../../../../", import.meta.url).pathname;
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };

const PUBLIC_PAGES = ["/", "/legal/terms", "/legal/privacy", "/legal/domains"];
const LEGAL = ["/legal/terms", "/legal/privacy", "/legal/domains"];
const BANNER = "This page is a placeholder. It has not been reviewed by a lawyer, and it is not legal advice.";
const TITLE = "<b>x</b>";

let web: RunningWeb;
beforeAll(async () => {
  buildOnce(provided.port);
  web = await startWeb(pg, { PRIVACY_OFFICER_TITLE: TITLE });
}, 120_000);
afterAll(async () => {
  await web?.stop();
});

const get = (path: string, init: { method?: string; cookie?: string } = {}) =>
  web.fetch(path, {
    method: init.method ?? "GET",
    headers: { "x-forwarded-for": clientAddress(), ...(init.cookie ? { cookie: init.cookie } : {}) },
  });

describe("public pages", () => {
  test("home_is_anonymous_and_cookie_independent", async () => {
    const plain = await get("/");
    const supplied = await get("/?active=account&accountName=Mallory&accountPath=/evil", {
      cookie: "__Host-sid=untrusted; __Host-theme=dark; accountName=Mallory",
    });
    expect(plain.status).toBe(200);
    const html = await plain.text();
    expect(await supplied.text()).toBe(html);
    expect(supplied.headers.get("set-cookie")).toBeNull();
    expect(html).toMatch(/<a href="\/"[^>]*aria-current="page"/);
    expect(html).toContain('href="/me"');
    expect(html).not.toContain("Mallory");
    expect(html).not.toContain("/evil");
    expect(html).not.toContain('action="/logout"');
    expect(html).not.toContain('action="/prefs/theme"');
    expect(html).toMatch(/<nav[^>]*id="core-menu"[^>]*popover="auto"/);
  });

  test("public_pages_run_no_script_and_never_vary", async () => {
    for (const path of PUBLIC_PAGES) {
      const response = await get(path, { cookie: "__Host-theme=dark" });
      expect(response.status, path).toBe(200);
      const csp = response.headers.get("content-security-policy") ?? "";
      expect(csp, path).toContain("default-src 'none'");
      expect(csp, path).not.toContain("script-src");
      expect(response.headers.get("cache-control"), path).toBe("public, max-age=300");
      expect(response.headers.get("vary"), path).toBeNull();
      const html = await response.text();
      expect(html, path).not.toContain("<script");
      expect(html, path).not.toContain("modulepreload");
      expect(html, path).not.toContain("data-theme");
      expect(html.match(/<main id="main"/g), path).toHaveLength(1);
      expect(html, path).toMatch(/<link href="(\.\.?\/)+_app\/immutable\/assets\/[^"]+\.css" rel="stylesheet"/);
    }
  });

  test("legal_pages_are_noindex_and_escape_config", async () => {
    for (const path of LEGAL) {
      const response = await get(path);
      expect(response.headers.get("x-robots-tag"), path).toBe("noindex");
      const html = await response.text();
      expect(html, path).toContain('<meta name="robots" content="noindex"');
      expect(html, path).toContain(BANNER);
      expect(html, path).toContain('lang="en"');
      expect(await (await get(`${path}?lang=fr`)).text(), path).toBe(html);
    }
    const privacy = await (await get("/legal/privacy")).text();
    expect(privacy).toContain("&lt;b>x&lt;/b>");
    expect(privacy).not.toContain(TITLE);
    expect((await get("/")).headers.get("x-robots-tag")).toBeNull();
  });

  test("an_unknown_legal_document_is_not_found", async () => {
    expect((await get("/legal/other")).status).toBe(404);
  });

  test("error_param_shows_only_a_catalog_code", async () => {
    const html = await (await get("/?error=csrf.denied")).text();
    expect(html).toContain('role="alert"');
    expect(html).toContain("The form expired or came from another site.");
    for (const value of ["nope.nope", "%3Cb%3Ex%3C%2Fb%3E", "config.invalid", "__proto__"]) {
      const other = await (await get(`/?error=${value}`)).text();
      expect(other, value).not.toContain('role="alert"');
      expect(other, value).not.toContain(decodeURIComponent(value));
    }
  });

  test("head_has_the_same_headers_and_no_body", async () => {
    for (const path of [...PUBLIC_PAGES, "/nowhere", "/.well-known/security.txt"]) {
      const [got, head] = await Promise.all([get(path), get(path, { method: "HEAD" })]);
      expect(head.status, path).toBe(got.status);
      expect(await head.text(), path).toBe("");
      const kept = (response: Response) =>
        [...response.headers].filter(([name]) => !["content-length", "date"].includes(name));
      expect(kept(head), path).toEqual(kept(got));
    }
  });
});

describe("security.txt", () => {
  test("fields_and_static_policy", async () => {
    const response = await get("/.well-known/security.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    const text = await response.text();
    expect(text.startsWith("# Placeholder: not reviewed by a lawyer. This file is not legal advice.\n")).toBe(true);
    expect(text).toContain(`Contact: ${ORIGIN}/legal/privacy`);
    expect(text).toContain("Expires: 2027-10-01T00:00:00Z");
    expect(text).toContain("Preferred-Languages: en, fr");
    expect(text).toContain(`Canonical: ${ORIGIN}/.well-known/security.txt`);
    expect(text).toContain(`Policy: ${ORIGIN}/legal/terms`);
  });
});

describe("error pages", () => {
  test("not_found_echoes_nothing_and_runs_no_script", async () => {
    const response = await get("/%3Cscript%3Ex");
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).toContain("That page does not exist.");
    expect(html).not.toContain("script>x");
    expect(html).not.toContain("%3Cscript");
    expect(html).not.toContain("<script");
    expect(html.match(/<main id="main"/g)).toHaveLength(1);
  });
});
