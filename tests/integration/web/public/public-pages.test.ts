// P1.20d: the public pages on the built SvelteKit server, with the outcomes interfaces/http/routes/public-pages.test.ts
// and legal.test.ts check for the Hono server: home, the legal pages, security.txt and the error pages run no script,
// carry the public or static CSP, and echo nothing sent. A visitor's home and legal pages are cached five minutes and
// vary on Cookie; P1.20k reads a member's session there so the header shows them signed in, and a member's copy is
// private and never stored, so no cache can hand it to anyone else. Book P1.22h: SvelteKit also answers each page at
// `<page>/__data.json` (../data-address.ts); that address is held to the page's own answers and is never a search result.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import { createOAuthSessionStore, createPool, withTransaction } from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { buildOnce, clientAddress, ORIGIN, type RunningWeb, startWeb } from "../built-server.ts";
import { DATA, dataAnswer, LAYOUT_ONLY, nodeData, undrawn } from "../data-address.ts";
import { readyMember } from "../members.ts";

const REPO = new URL("../../../../", import.meta.url).pathname;
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };

const PUBLIC_PAGES = ["/", "/legal/terms", "/legal/privacy", "/legal/domains"];
const LEGAL = ["/legal/terms", "/legal/privacy", "/legal/domains"];
const BANNER = "This page is a placeholder. It has not been reviewed by a lawyer, and it is not legal advice.";
const TITLE = "<b>x</b>";

const pool = createPool({
  connection: { ...pg, ssl: false },
  service: "web-public-test",
  max: 2,
  connectTimeoutMs: 5000,
});
const quiet = createLogger({ service: "web", commit: "c".repeat(40), env: "test", write: () => undefined });
const sessions = createSessionStore({
  withDb: async () => {
    throw new Error("this file only creates sessions");
  },
  limits: { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 },
  log: quiet,
});
const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: randomBytes(32).toString("base64") } }));
if (keyring === undefined) throw new Error("test keyring did not parse");
const tokenSets = createOAuthSessionStore<SavedSession>({ pool, sealer: createSealer(keyring), log: quiet });
const ISSUER = "https://pds.unset.test";

/** A stored grant for `did`, which a session row needs (as gate.test.ts plants one). */
async function grant(did: Did): Promise<void> {
  const dpopJwk = {
    ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
    kid: "dpop",
    alg: "ES256",
  };
  await tokenSets.set(did, {
    dpopJwk: dpopJwk as SavedSession["dpopJwk"],
    authMethod: { method: "private_key_jwt", kid: "A" },
    tokenSet: {
      iss: ISSUER,
      sub: did as SavedSession["tokenSet"]["sub"],
      aud: ISSUER,
      scope: "atproto",
      access_token: "a",
      token_type: "DPoP",
    },
  });
}

let members = 0;
/** A session cookie for a new member, onboarded unless `onboarded` is false. */
async function memberCookie(onboarded = true): Promise<{ did: Did; cookie: string }> {
  members += 1;
  const did = parseDid(
    `did:plc:publicpagesmember${String(members)
      .padStart(7, "a")
      .replace(/[0189]/g, "b")}`,
  );
  if (did === null) throw new Error("test DID did not parse");
  await grant(did);
  const created = await withTransaction(pool, null, (tx) => sessions.create(tx, did));
  if (onboarded) await readyMember(pool, did);
  return { did, cookie: `__Host-sid=${created.cookieValue}` };
}

let web: RunningWeb;
beforeAll(async () => {
  buildOnce(provided.port);
  // Listing on (P1.21b), so home's missing noindex below shows the legal pages carry their own.
  web = await startWeb(pg, { PRIVACY_OFFICER_TITLE: TITLE, SEARCH_LISTING: "on" });
}, 120_000);
afterAll(async () => {
  await web?.stop();
  await pool.end();
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
      cookie: "__Host-theme=dark; accountName=Mallory",
    });
    expect(plain.status).toBe(200);
    const html = await plain.text();
    expect(await supplied.text()).toBe(html);
    expect(supplied.headers.get("set-cookie")).toBeNull();
    expect(html).toMatch(/<a href="\/"[^>]*aria-current="page"/);
    expect(html).toContain('href="/login"');
    expect(html).not.toContain("Mallory");
    expect(html).not.toContain("/evil");
    expect(html).not.toContain('id="account-menu"');
    expect(html).not.toContain('action="/logout"');
    expect(html).not.toContain('action="/prefs/theme"');
    expect(html).toMatch(/<section[^>]*id="core-menu"[^>]*popover="auto"/);
  });

  // An unknown session cookie is cleared, as on every page that reads one; the page is the visitor's, but a response
  // that sets a cookie is never stored.
  test("an_unknown_session_is_cleared_and_not_stored", async () => {
    const html = await (await get("/")).text();
    const stale = await get("/", { cookie: "__Host-sid=untrusted" });
    expect(await stale.text()).toBe(html);
    expect(stale.headers.get("set-cookie")).toMatch(/^__Host-sid=;/);
    expect(stale.headers.get("cache-control")).toBe("private, no-store");
  });

  test("public_pages_run_no_script_and_vary_only_on_cookie", async () => {
    for (const path of PUBLIC_PAGES) {
      const response = await get(path, { cookie: "__Host-theme=dark" });
      expect(response.status, path).toBe(200);
      const csp = response.headers.get("content-security-policy") ?? "";
      expect(csp, path).toContain("default-src 'none'");
      expect(csp, path).not.toContain("script-src");
      expect(response.headers.get("cache-control"), path).toBe("public, max-age=300");
      expect(response.headers.get("vary"), path).toBe("Cookie");
      const html = await response.text();
      expect(html, path).not.toContain("<script");
      expect(html, path).not.toContain("modulepreload");
      expect(html, path).not.toContain("data-theme");
      expect(html.match(/<main id="main"/g), path).toHaveLength(1);
      expect(html, path).toMatch(/<link href="(\.\.?\/)+_app\/immutable\/assets\/[^"]+\.css" rel="stylesheet"/);
    }
  });

  test("every_page_has_the_legal_footer_and_the_menu_has_no_legal_links", async () => {
    for (const path of PUBLIC_PAGES) {
      const html = await (await get(path)).text();
      const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
      for (const link of LEGAL) expect(footer, path).toContain(`href="${link}"`);
      const menu = html.slice(html.indexOf('id="core-menu"'));
      expect(menu.slice(0, menu.indexOf("</section>")), path).not.toContain('href="/legal/');
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

// Alex, 2026-11-18 05:02Z: the legal pages showed Sign in to a signed-in member. Home and the legal pages now read the
// session (policy session "optional"), so a member sees their account menu there; their copy is private, never
// stored and varies on Cookie, while a visitor's copy carries nothing of any member.
describe("a signed-in member on public pages", () => {
  test("the_header_shows_the_member_and_their_copy_is_never_stored", async () => {
    const { did, cookie } = await memberCookie();
    for (const path of PUBLIC_PAGES) {
      const response = await get(path, { cookie: `${cookie}; __Host-theme=dark` });
      expect(response.status, path).toBe(200);
      expect(response.headers.get("cache-control"), path).toBe("private, no-store");
      expect(response.headers.get("vary"), path).toContain("Cookie");
      expect(response.headers.get("content-security-policy"), path).not.toContain("script-src");
      const html = await response.text();
      expect(html, path).toContain('id="account-menu"');
      expect(html, path).toContain(`href="/${did}"`);
      expect(html, path).toContain('action="/logout"');
      expect(html, path).toContain('data-theme="dark"');
      expect(html, path).not.toMatch(/href="\/login/);
      expect(html, path).not.toContain("<script");
    }
  });

  test("a_cacheable_copy_never_carries_a_member", async () => {
    const { did, cookie } = await memberCookie();
    // The member's request first, so a cache that ignored Vary or no-store would hand their copy to the visitor next.
    for (const path of PUBLIC_PAGES) {
      await (await get(path, { cookie })).text();
      const visitor = await get(path);
      expect(visitor.headers.get("cache-control"), path).toBe("public, max-age=300");
      const html = await visitor.text();
      expect(html, path).not.toContain(did);
      expect(html, path).not.toContain('id="account-menu"');
      expect(html, path).not.toContain('action="/logout"');
    }
    // Any response that names the member is one no cache may keep.
    for (const path of PUBLIC_PAGES) {
      const response = await get(path, { cookie });
      const html = await response.text();
      if (html.includes(did)) expect(response.headers.get("cache-control"), path).toBe("private, no-store");
    }
  });

  // Second staging walkthrough (2026-11-18 12:20Z): the not-found page showed a member Sign in and the light theme.
  test("the_not_found_page_shows_the_member_and_is_never_stored", async () => {
    const { did, cookie } = await memberCookie();
    const member = await get("/nowhere-at-all", { cookie: `${cookie}; __Host-theme=dark` });
    expect(member.status).toBe(404);
    expect(member.headers.get("cache-control")).toBe("private, no-store");
    expect(member.headers.get("vary")).toContain("Cookie");
    const html = await member.text();
    expect(html).toContain('id="account-menu"');
    expect(html).toContain(`href="/${did}"`);
    expect(html).toContain('data-theme="dark"');
    expect(html).not.toMatch(/href="\/login/);
    expect(html).toContain("<footer");
    const visitor = await get("/nowhere-at-all");
    expect(visitor.status).toBe(404);
    expect(visitor.headers.get("vary")).toBe("Cookie");
    const plain = await visitor.text();
    expect(plain).not.toContain(did);
    expect(plain).not.toContain('id="account-menu"');
    expect(plain).not.toContain("data-theme");
  });

  test("a_member_mid_onboarding_reads_the_terms_signed_in", async () => {
    const { did, cookie } = await memberCookie(false);
    const response = await get("/legal/terms", { cookie });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(`href="/${did}"`);
  });
});

/** The root layout's data for a visitor: the shell's flags and the Sign in link, no one's account. Listing is on here. */
const VISITOR_SHELL = {
  signedIn: false,
  account: undefined,
  appOpen: false,
  prefs: undefined,
  privacyNotice: null,
  notifications: undefined,
  bellOpens: false,
  siteNoindex: false,
};
/** A field named `kind` is what a component branches on, never drawn as words. */
const isKind = (path: string) => /(^|\.)kind$/.test(path);

// Book P1.22h. A data address is not a page: it always says noindex, home's too, whose page search engines may list.
describe("the data address of a public page", () => {
  test("home_s_data_is_the_shell_alone_and_the_same_for_every_visitor", async () => {
    const plain = await get(DATA);
    expect(plain.status).toBe(200);
    // Home's five-minute rule is set by its own load, which holds no data and does not run here: never stored.
    expect(plain.headers.get("cache-control")).toBe("private, no-store");
    expect(plain.headers.get("vary")).toBe("Cookie");
    expect(plain.headers.get("x-robots-tag")).toBe("noindex");
    expect(plain.headers.get("content-security-policy")).toBe((await get("/")).headers.get("content-security-policy"));
    const body = await plain.clone().text();
    const answer = await dataAnswer(plain);
    expect(answer.type === "data" && answer.nodes).toHaveLength(2);
    expect(nodeData(answer, 0)).toEqual({ ...VISITOR_SHELL, signInHref: "/login" });
    expect(answer.type === "data" && answer.nodes[1]).toBeNull();
    const supplied = await get(`${DATA}?active=account&accountName=Mallory&accountPath=/evil`, {
      cookie: "__Host-theme=dark; accountName=Mallory",
    });
    expect(await supplied.text()).toBe(body);
    expect(supplied.headers.get("set-cookie")).toBeNull();
  });

  test("a_legal_page_s_data_is_what_the_page_shows_under_its_headers", async () => {
    for (const path of LEGAL) {
      const [page, data] = [await get(path), await get(`${path}${DATA}`)];
      expect(data.status, path).toBe(200);
      for (const name of ["cache-control", "vary", "x-robots-tag", "content-security-policy"]) {
        expect(data.headers.get(name), `${path} ${name}`).toBe(page.headers.get(name));
      }
      expect(data.headers.get("cache-control"), path).toBe("public, max-age=300");
      expect(data.headers.get("x-robots-tag"), path).toBe("noindex");
      const body = await data.clone().text();
      const answer = await dataAnswer(data);
      const html = await page.text();
      const document = nodeData(answer, 1) as Record<string, unknown>;
      expect(Object.keys(document).sort(), path).toEqual(["sections", "shell", "title", "version"]);
      expect(undrawn(document, html, isKind), path).toEqual([]);
      expect(nodeData(answer, 0), path).toEqual({
        ...VISITOR_SHELL,
        signInHref: `/login?next=${encodeURIComponent(path)}`,
      });
      // Config is data here too: no `<` reaches the answer as typed (devalue 5.9.4 escapes it).
      expect(body, path).not.toContain("<");
    }
    expect(JSON.stringify(nodeData(await dataAnswer(await get(`/legal/privacy${DATA}`)), 1))).toContain(TITLE);
  });

  test("a_member_s_data_is_their_own_shell_and_never_stored", async () => {
    const { did, cookie } = await memberCookie();
    for (const path of PUBLIC_PAGES) {
      const address = path === "/" ? DATA : `${path}${DATA}`;
      const data = await get(address, { cookie: `${cookie}; __Host-theme=dark` });
      expect(data.headers.get("cache-control"), path).toBe("private, no-store");
      expect(data.headers.get("vary"), path).toContain("Cookie");
      expect(data.headers.get("x-robots-tag"), path).toBe("noindex");
      expect(nodeData(await dataAnswer(data), 0), path).toMatchObject({
        signedIn: true,
        account: { path: `/${did}` },
        prefs: { theme: "dark", returnTo: path },
        bellOpens: false,
      });
      // Right after the member's request, a visitor's data carries no one.
      const visitor = await get(address);
      expect(await visitor.text(), path).not.toContain(did);
    }
  });

  test("the_layout_alone_and_a_path_with_no_page_carry_no_one_and_noindex", async () => {
    for (const path of ["", "/legal/terms"]) {
      const layout = await get(`${path}${LAYOUT_ONLY}`);
      expect(layout.headers.get("cache-control"), path).toBe("private, no-store");
      expect(layout.headers.get("x-robots-tag"), path).toBe("noindex");
      const answer = await dataAnswer(layout);
      expect(answer.type === "data" && answer.nodes[1], path).toEqual({ type: "skip" });
    }
    // No page: SvelteKit's own 404, a code and no data. A route that is not a page has no data address at all.
    for (const path of ["/nowhere", "/legal/other", "/robots.txt", "/health"]) {
      const none = await get(`${path}${DATA}`);
      expect(none.status, path).toBe(404);
      expect(none.headers.get("x-robots-tag"), path).toBe("noindex");
      expect(["", '{"status":404,"message":"http.not_found"}'], path).toContain(await none.text());
    }
    // The error page's client asks for the root layout alone; it gets the shell for the path, nothing sent echoed.
    const shell = await get("/nowhere/__data.json?x-sveltekit-invalidated=1&accountName=Mallory");
    expect(shell.headers.get("cache-control")).toBe("private, no-store");
    expect(shell.headers.get("x-robots-tag")).toBe("noindex");
    const answer = await dataAnswer(shell);
    expect(nodeData(answer, 0)).toEqual({
      ...VISITOR_SHELL,
      signInHref: `/login?next=${encodeURIComponent("/nowhere")}`,
    });
  });

  // The route's own limit at the gate: a page and its data address spend the same allowance for an address (60 at
  // once, 5 a second back; lib/server/limits.ts `default`), and a refused data request gets the code, never a page.
  test("a_page_and_its_data_address_spend_one_limit", async () => {
    const from = clientAddress();
    const ask = (path: string) => web.fetch(path, { headers: { "x-forwarded-for": from, accept: "text/html" } });
    const started = performance.now();
    let passed = 0;
    let refused: Response | undefined;
    while (refused === undefined && passed < 200) {
      const response = await ask(passed % 2 === 0 ? "/legal/terms" : `/legal/terms${DATA}`);
      if (response.status === 200) passed += 1;
      else refused = response;
    }
    const refilled = Math.ceil(((performance.now() - started) / 1000) * 5);
    expect(passed).toBeGreaterThanOrEqual(60);
    expect(passed).toBeLessThanOrEqual(60 + refilled);
    expect(refused?.status).toBe(429);
    // Whichever kind was refused first, both are refused from the same address: ten at once, five of each kind, against
    // a limit that gives back five a second, so some of each kind are turned away.
    const kinds = Array.from({ length: 10 }, (_, at) => (at % 2 === 0 ? "/legal/terms" : `/legal/terms${DATA}`));
    const answers = await Promise.all(kinds.map(ask));
    const refusedAt = (path: string) => answers.filter((answer, at) => kinds[at] === path && answer.status === 429);
    expect(refusedAt("/legal/terms").length).toBeGreaterThan(0);
    const limited = refusedAt(`/legal/terms${DATA}`);
    expect(limited.length).toBeGreaterThan(0);
    const no = limited[0];
    expect(no?.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(no?.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await no?.text()).toBe("http.rate_limited\n");
  });
});

// Staging, 2026-11-18: SvelteKit builds its 304 after the hooks from a fixed header list (kit 3.2.0
// src/runtime/server/respond.js), so it lost the page's CSP and carried server.ts's static one; the browser merged that
// into the stored page and blocked its stylesheet and fonts. A 304 now carries no CSP, so the stored 200's stays.
describe("conditional requests", () => {
  for (const path of ["/", "/legal/terms", "/login"]) {
    test(`a_304_carries_no_csp ${path}`, async () => {
      const first = await get(path);
      const etag = first.headers.get("etag");
      expect(etag, path).not.toBeNull();
      expect(first.headers.get("content-security-policy"), path).not.toBeNull();
      const again = await web.fetch(path, {
        headers: { "x-forwarded-for": clientAddress(), "if-none-match": etag ?? "" },
      });
      expect(again.status, path).toBe(304);
      expect(again.headers.get("content-security-policy"), path).toBeNull();
      expect(again.headers.get("x-content-type-options"), path).toBe("nosniff");
    });
  }

  // A conditional request never crosses between a member and a visitor (outside review of the footer lane): each
  // copy has its own ETag, so the other's validator gets a full 200 of the right copy, and a member's 304 keeps
  // private, no-store and Vary: Cookie, so a browser merging it never turns the stored member page public.
  for (const path of PUBLIC_PAGES) {
    test(`a_validator_never_crosses_between_member_and_visitor ${path}`, async () => {
      const { did, cookie } = await memberCookie();
      const ask = (etag: string, withCookie?: string) =>
        web.fetch(path, {
          headers: {
            "x-forwarded-for": clientAddress(),
            "if-none-match": etag,
            ...(withCookie ? { cookie: withCookie } : {}),
          },
        });
      const visitorTag = (await get(path)).headers.get("etag") ?? "";
      const memberTag = (await get(path, { cookie })).headers.get("etag") ?? "";
      expect(visitorTag, path).not.toBe("");
      expect(memberTag, path).not.toBe("");
      expect(memberTag, path).not.toBe(visitorTag);

      const memberWithVisitorTag = await ask(visitorTag, cookie);
      expect(memberWithVisitorTag.status, path).toBe(200);
      expect(memberWithVisitorTag.headers.get("cache-control"), path).toBe("private, no-store");
      expect(await memberWithVisitorTag.text(), path).toContain(`href="/${did}"`);

      const visitorWithMemberTag = await ask(memberTag);
      expect(visitorWithMemberTag.status, path).toBe(200);
      expect(visitorWithMemberTag.headers.get("cache-control"), path).toBe("public, max-age=300");
      expect(await visitorWithMemberTag.text(), path).not.toContain(did);

      const memberAgain = await ask(memberTag, cookie);
      if (memberAgain.status === 304) {
        expect(memberAgain.headers.get("cache-control"), path).toBe("private, no-store");
        expect(memberAgain.headers.get("vary"), path).toContain("Cookie");
      } else {
        expect(memberAgain.status, path).toBe(200);
        expect(memberAgain.headers.get("cache-control"), path).toBe("private, no-store");
      }
    });
  }
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

// The two fonts app.css names (apps/web/app.css; ADR 0054 point 4, font-src /fonts/). Hono served them from /assets/;
// found missing at P1.20j. Only the exact two names are files; anything else is a plain 404.
describe("fonts", () => {
  const FONTS = ["/fonts/SpaceGrotesk-Variable.woff2", "/fonts/JetBrainsMono-Variable.woff2"];
  const SOURCE = new URL("../../../../shared/ui/fonts/", import.meta.url);

  test("the_two_fonts_are_served_as_woff2_and_cached", async () => {
    for (const path of FONTS) {
      const response = await get(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type"), path).toBe("font/woff2");
      expect(response.headers.get("cache-control"), path).toBe("public, max-age=86400");
      expect(response.headers.get("set-cookie"), path).toBeNull();
      const body = Buffer.from(await response.arrayBuffer());
      expect(body.equals(readFileSync(new URL(path.slice("/fonts/".length), SOURCE))), path).toBe(true);
    }
  });

  test("no_other_name_reaches_a_file", async () => {
    for (const path of [
      "/fonts/OFL-SpaceGrotesk.txt",
      "/fonts/..%2Fpackage.json",
      "/fonts/%2e%2e/package.json",
      "/fonts/spacegrotesk-variable.woff2",
      "/fonts",
    ]) {
      const response = await get(path);
      expect(response.status, path).toBe(404);
      expect(response.headers.get("content-type"), path).not.toBe("font/woff2");
    }
  });
});

// Gaps 8, 13 and 18 of the P1.20k review: what the Hono head and Link gave every page.
describe("the head and links", () => {
  test("every_page_preloads_both_fonts_and_links_its_icons_as_build_files", async () => {
    for (const path of ["/", "/legal/terms", "/login", "/nobody"]) {
      const html = await (await get(path)).text();
      expect(html.match(/<link rel="preload"[^>]*>/g), path).toEqual([
        '<link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href="/fonts/SpaceGrotesk-Variable.woff2"/>',
        '<link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" href="/fonts/JetBrainsMono-Variable.woff2"/>',
      ]);
      const icons = [...html.matchAll(/<link rel="(icon|apple-touch-icon)" href="([^"]+)"/g)];
      expect(
        icons.map((m) => m[1]),
        path,
      ).toEqual(["icon", "apple-touch-icon"]);
      for (const [, , href] of icons) {
        expect(href, path).toMatch(/^\/_app\/immutable\/assets\/[^/]+\.png$/);
        const icon = await get(href as string);
        expect(icon.status, href).toBe(200);
        expect(icon.headers.get("content-type"), href).toBe("image/png");
      }
    }
  });

  test("a_legal_link_off_our_origin_carries_noopener_noreferrer", async () => {
    const html = await (await get("/legal/privacy")).text();
    const external = [...html.matchAll(/<a href="(https:[^"]+)"([^>]*)>/g)];
    expect(external.length).toBeGreaterThan(0);
    for (const [, href, rest] of external) expect(rest, href).toContain('rel="noopener noreferrer"');
    expect(html).not.toMatch(/<a href="\/[^"]*" rel=/);
  });
});
