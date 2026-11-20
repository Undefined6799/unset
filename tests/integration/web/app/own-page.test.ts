// P1.20g: the theme form and the /me shortcut on the built web server, porting the outcomes
// interfaces/http/routes/prefs.test.ts and me.test.ts check (ADR 0054 decision 5). Postgres as `web` (TE-2); a
// signed-in browser is a stored grant and a session, as gate.test.ts makes one.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import { createOAuthSessionStore, createPool, withTransaction } from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { buildOnce, clientAddress, ORIGIN, type RunningWeb, startWeb } from "../built-server.ts";
import { readyMember } from "../members.ts";

const REPO = new URL("../../../../", import.meta.url).pathname;
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };
const pool = createPool({
  connection: { ...pg, ssl: false },
  service: "web-own-page-test",
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
const OWNER = parseDid(`did:plc:${"a".repeat(24)}`) as Did;

/** A signed-in browser for `owner`: a stored grant (the session's foreign key needs one), then a session. */
async function signedIn(owner: Did): Promise<string> {
  const dpopJwk = {
    ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
    kid: "dpop",
    alg: "ES256",
  };
  await tokenSets.set(owner, {
    dpopJwk: dpopJwk as SavedSession["dpopJwk"],
    authMethod: { method: "private_key_jwt", kid: "A" },
    tokenSet: {
      iss: ISSUER,
      sub: owner as SavedSession["tokenSet"]["sub"],
      aud: ISSUER,
      scope: "atproto",
      access_token: "a",
      token_type: "DPoP",
    },
  });
  const created = await withTransaction(pool, null, (tx) => sessions.create(tx, owner));
  await readyMember(pool, owner);
  return created.cookieValue;
}

let web: RunningWeb;
beforeAll(async () => {
  buildOnce(provided.port);
  web = await startWeb(pg);
}, 120_000);
afterAll(async () => {
  await web?.stop();
  await pool.end();
});

const FORM = "application/x-www-form-urlencoded";
/** What a browser sends with a plain form post; without it SvelteKit answers an action as JSON for its own client. */
const HTML = "text/html,application/xhtml+xml";
const YEAR = "Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax";
const theme = (body: string, headers: Record<string, string> = {}) =>
  web.fetch("/prefs/theme", {
    method: "POST",
    body,
    headers: { origin: ORIGIN, accept: HTML, "content-type": FORM, "x-forwarded-for": clientAddress(), ...headers },
  });
const returnTo = async (target: string) =>
  (await theme(`theme=dark&return=${encodeURIComponent(target)}`)).headers.get("location");

describe("POST /prefs/theme", () => {
  test("prefs_theme_sets_cookie", async () => {
    const response = await theme("theme=light");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toBe(`__Host-theme=light; ${YEAR}`);
  });

  test("prefs_theme_system_deletes_cookie", async () => {
    const response = await theme("theme=system");
    expect(response.status).toBe(303);
    expect(response.headers.get("set-cookie")).toMatch(
      /^__Host-theme=; Max-Age=0; Path=\/; .*HttpOnly; Secure; SameSite=Lax$/,
    );
  });

  test("prefs_theme_invalid_value_400", async () => {
    for (const body of ["theme=blue", "theme=%3Cscript%3E", "", "theme=light&theme=dark", "theme=Light"]) {
      const response = await theme(body);
      expect(response.status, body).toBe(400);
      expect(response.headers.get("set-cookie"), body).toBeNull();
      const html = await response.text();
      expect(html, body).toContain("prefs.invalid");
      expect(html, body).not.toContain("blue");
    }
  });

  test("prefs_body_too_large_413", async () => {
    const response = await theme(`theme=light&pad=${"x".repeat(4096)}`);
    expect(response.status).toBe(413);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("prefs_return_path_kept_when_safe", async () => {
    expect(await returnTo("/settings?tab=1")).toBe("/settings?tab=1");
  });

  test("prefs_return_path_rejects_offsite", async () => {
    for (const target of ["//evil.example", "https://evil.example", "/\\evil.example", "/\t/evil.example", "/x\u0000"])
      expect(await returnTo(target), target).toBe("/");
  });

  test("prefs_return_sign_in_keeps_next_and_handle", async () => {
    expect(await returnTo("/login?next=%2Fme&handle=alice.example.com")).toBe(
      "/login?next=%2Fme&handle=alice.example.com",
    );
    expect(await returnTo("/login?next=https%3A%2F%2Fevil.example&handle=alice.example.com")).toBe(
      "/login?handle=alice.example.com",
    );
    expect(await returnTo("/login?next=%2Fme&handle=%3Cb%3E")).toBe("/login?next=%2Fme");
    expect(await returnTo("/login?next=%2Fme&evil=1")).toBe("/login?next=%2Fme");
    for (const target of ["/loginx", "/login/other", "/login#x", "/./login"])
      expect(await returnTo(target), target).toBe("/");
  });

  test("prefs_csrf_denied", async () => {
    const response = await theme("theme=light", { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("prefs_get_405_and_json_415", async () => {
    expect((await web.fetch("/prefs/theme")).status).toBe(405);
    const json = await theme('{"theme":"light"}', { "content-type": "application/json" });
    expect(json.status).toBe(415);
    expect(json.headers.get("set-cookie")).toBeNull();
  });
});

describe("GET /me", () => {
  test("me_sends_a_visitor_to_sign_in", async () => {
    const response = await web.fetch("/me", { headers: { "x-forwarded-for": clientAddress() } });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(/^\/login(\?|$)/);
  });

  test("me_redirects_to_the_session_did", async () => {
    const cookie = await signedIn(OWNER);
    const response = await web.fetch("/me", {
      headers: { cookie: `__Host-sid=${cookie}`, "x-forwarded-for": clientAddress() },
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/${OWNER}`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
  });

  test("did_shortcut_is_gone", async () => {
    expect((await web.fetch("/did", { headers: { "x-forwarded-for": clientAddress() } })).status).toBe(404);
  });
});

// P1.20k, from staging (2026-11-18): the member page's route matches only a DID-shaped segment, so SvelteKit's client
// never takes a fixed path such as /me for it; a member's not-found page offers no Sign in; and every app page, not
// only the member page and Settings, carries the theme form, as interfaces/http/web/page.ts gave every app page.
describe("the shell around the member page", () => {
  const get = (path: string, cookie?: string) =>
    web.fetch(path, {
      headers: {
        accept: HTML,
        "x-forwarded-for": clientAddress(),
        ...(cookie === undefined ? {} : { cookie: `__Host-sid=${cookie}` }),
      },
    });

  test("a_path_that_is_no_did_is_no_member_page", async () => {
    const response = await get("/nobody");
    expect(response.status).toBe(404);
    // The unmatched page is public: no theme form, no session read.
    expect(await response.text()).not.toContain('action="/prefs/theme"');
  });

  test("another_members_page_sends_a_member_to_its_public_page_which_is_missing", async () => {
    const cookie = await signedIn(OWNER);
    const other = `did:plc:${"z".repeat(24)}`;
    const response = await get(`/${other}`, cookie);
    // Never the other member's editor: their public page, which for an account the index does not show is the 404.
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/@${other}`);
    const missing = await get(`/@${other}`, cookie);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("That page does not exist.");
  });

  test("a_visitor_on_a_missing_page_is_offered_sign_in", async () => {
    const html = await (await get("/nobody")).text();
    expect(html).toContain('href="/login?next=%2Fnobody"');
  });

  // Gap 11 of the P1.20k review: the sign-in page is the box alone, as Hono drew it, so it offers no Sign in.
  test("the_sign_in_page_has_no_header_or_footer", async () => {
    const html = await (await get("/login")).text();
    expect(html).not.toContain("<header");
    expect(html).not.toContain("<footer");
    expect(html).toContain('<main id="main"');
    expect(html).not.toMatch(/href="\/login/);
  });

  // Gap 7 of the P1.20k review: the Hono dialog carried the page as `next`, so a sign-in comes back to it.
  test("sign_in_in_the_shell_comes_back_to_this_page", async () => {
    const terms = await (await get("/legal/terms")).text();
    expect(terms.match(/href="\/login[^"]*"/g)).toEqual(['href="/login?next=%2Flegal%2Fterms"']);
    // Coming back to the signed-out page would only offer Sign in again.
    const signedOut = await (await get("/signed-out")).text();
    expect(signedOut.match(/href="\/login[^"]*"/g)).toEqual(['href="/login"', 'href="/login"']);
  });

  test("every_app_page_carries_the_theme_form_and_public_pages_none", async () => {
    for (const path of ["/signed-out", "/welcome/blocked"]) {
      const html = await (await get(path)).text();
      expect(html, path).toContain('action="/prefs/theme"');
      expect(html, path).toContain(`name="return" value="${path}"`);
    }
    for (const path of ["/", "/legal/terms"]) {
      expect(await (await get(path)).text(), path).not.toContain('action="/prefs/theme"');
    }
  });

  test("the_account_menu_picker_presses_the_saved_theme", async () => {
    const cookie = await signedIn(OWNER);
    const response = await web.fetch("/settings/account", {
      headers: { accept: HTML, "x-forwarded-for": clientAddress(), cookie: `__Host-sid=${cookie}; __Host-theme=light` },
    });
    const html = await response.text();
    const drawer = html.slice(html.indexOf('id="account-menu"'));
    expect(drawer).toMatch(/name="theme" value="light"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*value="light"/);
    expect(drawer).toMatch(/value="dark"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*value="dark"/);
  });
});
