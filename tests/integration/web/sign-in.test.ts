// P1.20e: signing in and out on the built SvelteKit server, the outcomes interfaces/http's login, callback and logout
// routes give today, with the same cookies (names, SameSite, Max-Age, host-only). Postgres as `web` (TE-2). The only
// stand-ins are the network the server may not reach in a test (TE-1): PLC, and our PDS's authorization server, both
// answered by stand-in-server.ts from the fixture below. Everything else, the OAuth client included, is real.
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { PRIVACY_VERSION } from "@unset/domains-identity";
import type { SavedState } from "@unset/infrastructure-pds";
import { createOAuthStateStore, createPool } from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { scopeString } from "@unset/shared-lexicons";
import { createLogger } from "@unset/shared-log";
import { afterAll, afterEach, beforeAll, describe, expect, inject, test } from "vitest";
import {
  buildOnce,
  clientAddress,
  ORIGIN,
  PDS_HOST,
  type RunningWeb,
  type StandInFixture,
  startWeb,
} from "./built-server.ts";
import { DATA, dataAnswer, inlineScripts, nodeData, startup, startupData } from "./data-address.ts";
import { readyMember } from "./members.ts";

const REPO = join(import.meta.dirname, "..", "..", "..");
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const pg = { host: provided.host, port: provided.port, database, ...provided.roles.web };
const pool = createPool({
  connection: { ...pg, ssl: false },
  service: "web-sign-in-test",
  max: 2,
  connectTimeoutMs: 5000,
});

// The malformed-state cases use the real sealed store with the same per-run key as the built server.
const KEYRING = JSON.stringify({ active: "k1", keys: { k1: randomBytes(32).toString("base64") } });
const keyring = parseKeyring(KEYRING);
if (keyring === undefined) throw new Error("test keyring did not parse");
const states = createOAuthStateStore<SavedState>({
  pool,
  sealer: createSealer(keyring),
  log: createLogger({ service: "web", commit: "c".repeat(40), env: "test", write: () => undefined }),
});
const secrets = mkdtempSync(join(tmpdir(), "web-sign-in-"));
const keyringFile = join(secrets, "seal_keyring");
writeFileSync(keyringFile, KEYRING);

const PDS = `https://${PDS_HOST}`;
const DID = `did:plc:${"s".repeat(24)}`;
const REQUEST_URI = "urn:ietf:params:oauth:request_uri:req-0123456789abcdef";

/** A PLC document placing `did` on our PDS. */
const plcDocument = (did: string) => ({
  "@context": ["https://www.w3.org/ns/did/v1"],
  id: did,
  verificationMethod: [{ id: `${did}#atproto`, type: "Multikey", controller: did, publicKeyMultibase: "zQ3sh" }],
  service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }],
});

/** Accounts the stand-in PLC knows, all on our PDS: DID, and the ones the outcome tests below sign in as. */
const OTHER = `did:plc:${"o".repeat(24)}`;
const LAST = `did:plc:${"l".repeat(24)}`;
const DROP = `did:plc:${"d".repeat(24)}`;

type Grant = { sub?: string; scope?: string; revokeStatus?: number };

/**
 * Our PDS as the OAuth library sees it: discovery, PAR, the token endpoint (a grant for `sub`, DID unless given, with
 * `scope`) and revocation (answering `revokeStatus`).
 */
const pdsFixture = ({ sub = DID, scope = scopeString(), revokeStatus = 200 }: Grant = {}): StandInFixture => ({
  http: Object.fromEntries(
    [DID, OTHER, LAST, DROP].map((did) => [`https://plc.directory/${did}`, { body: plcDocument(did) }]),
  ),
  txt: { "_atproto.alice.example.com": [`did=${DID}`] },
  fetch: {
    [`GET ${PDS}/.well-known/oauth-protected-resource`]: { body: { resource: PDS, authorization_servers: [PDS] } },
    [`GET ${PDS}/.well-known/oauth-authorization-server`]: {
      body: {
        issuer: PDS,
        authorization_endpoint: `${PDS}/oauth/authorize`,
        token_endpoint: `${PDS}/oauth/token`,
        revocation_endpoint: `${PDS}/oauth/revoke`,
        pushed_authorization_request_endpoint: `${PDS}/oauth/par`,
        require_pushed_authorization_requests: true,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
        token_endpoint_auth_signing_alg_values_supported: ["ES256"],
        dpop_signing_alg_values_supported: ["ES256"],
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
        scopes_supported: ["atproto"],
      },
    },
    [`POST ${PDS}/oauth/par`]: { status: 201, body: { request_uri: REQUEST_URI, expires_in: 299 } },
    [`POST ${PDS}/oauth/token`]: {
      body: { access_token: "at", refresh_token: "rt", token_type: "DPoP", sub, expires_in: 3600, scope },
    },
    [`POST ${PDS}/oauth/revoke`]: { status: revokeStatus, body: {} },
  },
});
const fixture = pdsFixture();

let web: RunningWeb;
beforeAll(async () => {
  buildOnce(provided.port);
  // The shortest deadline config allows, so a store held below stops the request in 5 seconds, not 30.
  web = await startWeb(pg, { REQUEST_DEADLINE_MS: "5000", SEAL_KEYRING_FILE: keyringFile }, fixture);
}, 120_000);
afterEach(() => web.setStandIns(fixture));
afterAll(async () => {
  await web?.stop();
  await pool.end();
  rmSync(secrets, { recursive: true, force: true });
});

const headers = (extra: Record<string, string> = {}) => ({ "x-forwarded-for": clientAddress(), ...extra });
const post = (path: string, body: string, extra: Record<string, string> = {}) =>
  web.fetch(path, {
    method: "POST",
    body,
    headers: headers({
      origin: ORIGIN,
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
      ...extra,
    }),
  });

/** Each Set-Cookie of a response, by cookie name. */
function setCookies(response: Response): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of response.headers.getSetCookie()) out.set(line.slice(0, line.indexOf("=")), line);
  return out;
}
const value = (line: string | undefined): string =>
  (line ?? "")
    .slice(line?.indexOf("=") ?? 0)
    .split(";")[0]
    ?.slice(1) ?? "";

/** The attributes interfaces/http writes for every sign-in cookie: host-only, Secure, HttpOnly, the given SameSite. */
function expectHostOnly(line: string | undefined, sameSite: "Lax" | "Strict", maxAge: number) {
  expect(line).toBeDefined();
  const parts = (line ?? "").split(";").map((part) => part.trim().toLowerCase());
  expect(parts).toContain("path=/");
  expect(parts).toContain("secure");
  expect(parts).toContain("httponly");
  expect(parts).toContain(`samesite=${sameSite.toLowerCase()}`);
  expect(parts).toContain(`max-age=${maxAge}`);
  expect(parts.some((part) => part.startsWith("domain="))).toBe(false);
}

/** POST /login with the chooser, as the one button does; returns the nonce and target cookies. */
async function startSignIn(extra: Record<string, string> = {}, next = "/settings") {
  const response = await post("/login", new URLSearchParams({ intent: "chooser", next }).toString(), extra);
  const cookies = setCookies(response);
  return { response, nonce: cookies.get("__Host-oauth_nonce"), target: cookies.get("__Host-login_target") };
}

/** The state the library sent our PDS for the newest sign-in: the key of its stored, sealed row. */
async function newestState(): Promise<string> {
  const { rows } = await pool.query<{ key: string }>(
    "SELECT key FROM app.oauth_state ORDER BY expires_at DESC LIMIT 1",
  );
  return rows[0]?.key ?? "";
}

/** The callback for the newest sign-in, as our PDS sends the browser back: `params` replace the code. */
async function callBack(nonce: string | undefined, params: Record<string, string> = { code: "code-1" }, cookie = "") {
  const query = new URLSearchParams({ state: await newestState(), iss: PDS, ...params });
  const jar = [nonce === undefined ? "" : `__Host-oauth_nonce=${value(nonce)}`, cookie].filter(Boolean).join("; ");
  return web.fetch(`/oauth/callback?${query}`, { headers: headers({ cookie: jar }) });
}

/** A whole sign-in, through the callback, for the account the token endpoint names; returns the session cookie. */
async function signIn(cookie = ""): Promise<string> {
  const { nonce } = await startSignIn();
  const callback = await callBack(nonce, undefined, cookie);
  expect(callback.status).toBe(303);
  return value(setCookies(callback).get("__Host-sid"));
}

/** The session cookie still signs a browser in: /login sends it on to its page. */
const signedIn = async (sid: string): Promise<boolean> =>
  (await web.fetch("/login", { headers: headers({ cookie: `__Host-sid=${sid}` }) })).status === 303;

/** POST /login with a typed handle or DID, as the form posted before P2.05r (chooseAccount still reads it). */
const typed = (handle: string) => post("/login", new URLSearchParams({ handle }).toString());

describe("the sign-in form", () => {
  test("a_visitor_sees_the_one_button_to_our_pds", async () => {
    const response = await web.fetch("/login?next=%2Fsettings", { headers: headers() });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(PDS_HOST);
    expect(body).toContain('value="chooser"');
    expect(body).toContain('value="/settings"');
  });

  test("an_error_code_shows_its_message_and_an_unknown_one_none", async () => {
    const known = await (await web.fetch("/login?error=login.expired", { headers: headers() })).text();
    expect(known).toContain('role="alert"');
    const unknown = await (await web.fetch("/login?error=%3Cscript%3Ex%3C%2Fscript%3E", { headers: headers() })).text();
    expect(unknown).not.toContain('role="alert"');
    expect(unknown).not.toContain("<script>x");
  });

  test("close_goes_back_to_our_page_but_never_to_another_site", async () => {
    const ours = await (await web.fetch("/login", { headers: headers({ referer: `${ORIGIN}/about` }) })).text();
    expect(ours).toContain('href="/about"');
    const other = await (await web.fetch("/login", { headers: headers({ referer: "https://evil.test/x" }) })).text();
    expect(other).not.toContain("evil.test");
  });

  // The shell's Sign in carries the page as `next` (P1.20k), so Close returns to that same page.
  test("close_returns_to_the_page_whose_sign_in_was_pressed", async () => {
    const html = await (
      await web.fetch("/login?next=%2Flegal%2Fterms", { headers: headers({ referer: `${ORIGIN}/legal/terms` }) })
    ).text();
    expect(html).toContain('href="/legal/terms"');
  });
});

// Book P1.22l (ADR 0116 points 1 and 2): the sign-in page runs SvelteKit's client under the app's script policy.
// SvelteKit writes a load's result into the start-up script and then hashes it (kit 3.2.0
// src/runtime/server/page/render.js), so the policy allows whatever the server wrote there: these tests read it.
describe("the sign-in page with the client", () => {
  const SCRIPT_POLICY = `script-src ${ORIGIN}/_app/ 'sha256-`;
  /** What a link's author, or the page a visitor came from, might put where the page reads a path. */
  const HOSTILE = [
    "/</script><script>alert(1)</script>",
    "/x?q=</script><script>alert(1)</script>",
    "/<!--<script>",
    "/x\u2028alert(1)\u2029",
    '/"onmouseover="alert(1)',
    "/x#</script><img src=x onerror=alert(1)>",
    "https://evil.test/x",
    "//evil.test/x",
    "javascript:alert(1)",
    "/\\evil.test",
  ];
  /** A path as `safeReturnPath` gives it: one slash first, then printable ASCII with no quote, angle bracket or `\`. */
  const CHECKED_PATH = /^\/(?!\/)[!#-;=?-[\]-~]*$/;

  /** A script with each string's text taken out, and `next` read as a string whether it was sent or not. */
  const outsideStrings = (script: string): string =>
    script.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace("next:null", 'next:""');

  test("the_sign_in_page_runs_only_our_client_and_its_data_is_what_it_draws", async () => {
    const from = headers({ referer: `${ORIGIN}/legal/terms` });
    const response = await web.fetch("/login?next=%2Fsettings", { headers: from });
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(SCRIPT_POLICY);
    expect(csp).not.toContain("unsafe-inline");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const html = await response.text();
    const drawn = { next: "/settings", pdsHost: PDS_HOST, close: "/legal/terms", shell: { kind: "bare" } };
    expect(startupData(html, 1)).toEqual(drawn);
    // Each value is on the page: the hidden field, the sentence naming the server, and Close's address.
    expect(html).toContain('value="/settings"');
    expect(html).toContain(PDS_HOST);
    expect(html).toContain('href="/legal/terms"');
    // The data address says the same, under the fixed header that runs nothing.
    const data = await web.fetch(`/login${DATA}?next=%2Fsettings`, { headers: from });
    expect(data.headers.get("content-security-policy")).not.toContain("script-src");
    expect(nodeData(await dataAnswer(data), 1)).toEqual(drawn);
  });

  test("next_and_the_referer_reach_the_start_up_script_only_as_checked_paths", async () => {
    const plain = await (await web.fetch("/login", { headers: headers() })).text();
    expect(startupData(plain, 1)).toMatchObject({ next: null, close: "/" });
    for (const value of HOSTILE) {
      const asked = `/login?next=${encodeURIComponent(value)}`;
      // A browser percent-encodes the Referer it sends; a program that writes its own header need not.
      const from = /^[\x20-\x7e]*$/.test(value) ? value : encodeURI(value);
      const referer = value.startsWith("/") ? `${ORIGIN}${from}` : from;
      const html = await (await web.fetch(asked, { headers: headers({ referer }) })).text();
      const page = startupData(html, 1) as { next: string | null; close: string };
      expect(Object.keys(page).sort(), asked).toEqual(["close", "next", "pdsHost", "shell"]);
      if (page.next !== null) expect(page.next, asked).toMatch(CHECKED_PATH);
      expect(page.close, asked).toMatch(CHECKED_PATH);
      // Nothing of the value is in the script as markup or as a line end, and outside its strings the script is the
      // plain page's: no string ended early.
      const script = inlineScripts(html).join("\n");
      expect(script, asked).not.toMatch(/<|\u2028|\u2029/);
      expect(outsideStrings(script), asked).toBe(outsideStrings(inlineScripts(plain).join("\n")));
    }
    // A value that is no path of ours leaves the script as it is with no `next` at all.
    for (const value of ["https://evil.test/x", "//evil.test/x", "javascript:alert(1)", "/login", "/oauth/callback"]) {
      const html = await (await web.fetch(`/login?next=${encodeURIComponent(value)}`, { headers: headers() })).text();
      expect(inlineScripts(html), value).toEqual(inlineScripts(plain));
    }
    // Any other query value is not read by the server at all.
    for (const name of ["error", "handle", "state", "code", "iss"]) {
      const html = await (
        await web.fetch(`/login?${name}=${encodeURIComponent(HOSTILE[0] ?? "")}`, { headers: headers() })
      ).text();
      expect(inlineScripts(html), name).toEqual(inlineScripts(plain));
    }
  });

  // The Threats of book P1.22l: no value that authorises anything is in a page's script or at its data address. The
  // browser here is in the middle of a sign-in and holds both of its cookies. The state is the key of the stored row
  // that seals the PKCE verifier; the request_uri is what the authorization server takes in its place.
  test("nothing_that_authorises_a_sign_in_reaches_a_page_s_script_or_data", async () => {
    const { nonce, target } = await startSignIn();
    const state = await newestState();
    const secrets = [value(nonce), value(target), state, REQUEST_URI, encodeURIComponent(REQUEST_URI)];
    expect(secrets.every((secret) => secret.length >= 16)).toBe(true);
    const cookie = `__Host-oauth_nonce=${value(nonce)}; __Host-login_target=${value(target)}`;
    const pages = ["/login", "/login?error=login.expired&next=%2Fsettings", "/join", "/welcome/blocked"];
    for (const path of pages) {
      const page = await web.fetch(path, { headers: headers({ cookie }) });
      expect(page.status, path).toBe(200);
      const html = await page.text();
      expect(startup(html), path).not.toBeNull();
      const [address, query = ""] = path.split("?");
      const data = await (await web.fetch(`${address}${DATA}?${query}`, { headers: headers({ cookie }) })).text();
      for (const secret of secrets) {
        expect(html, path).not.toContain(secret);
        expect(data, path).not.toContain(secret);
      }
    }
    // The hop that does hold the address keeps no script: it must not wait for a file (ADR 0116 point 4).
    const hop = await web.fetch("/login/continue", { headers: headers({ cookie }) });
    expect(hop.status).toBe(200);
    expect(startup(await hop.text())).toBeNull();
  });
});

describe("starting a sign-in", () => {
  test("the_chooser_sets_the_nonce_and_target_cookies_and_goes_to_continue", async () => {
    const { response, nonce, target } = await startSignIn();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login/continue");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expectHostOnly(nonce, "Lax", 600);
    expectHostOnly(target, "Strict", 120);
    expect(value(nonce)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("the_continue_page_sends_the_browser_on_to_our_pds", async () => {
    const { target } = await startSignIn();
    const page = await web.fetch("/login/continue", {
      headers: headers({ cookie: `__Host-login_target=${value(target)}` }),
    });
    expect(page.status).toBe(200);
    const body = await page.text();
    expect(body).toContain('http-equiv="refresh"');
    expect(body).toContain(`${PDS}/oauth/authorize?`);
    expect(body).toContain(encodeURIComponent(REQUEST_URI));
    expect(body).toContain("our sign-in server");
  });

  test("continue_without_this_browsers_cookie_goes_back_to_the_form", async () => {
    const page = await web.fetch("/login/continue", { headers: headers() });
    expect(page.status).toBe(303);
    expect(page.headers.get("location")).toBe("/login?error=login.expired");
  });

  test("a_cross_site_post_never_starts_one", async () => {
    const response = await post("/login", "intent=chooser", { origin: "https://evil.test" });
    expect(response.status).toBe(403);
    expect(setCookies(response).size).toBe(0);
  });
});

describe("the callback", () => {
  test("a_whole_sign_in_makes_a_session_and_returns_to_next", async () => {
    const { nonce } = await startSignIn({ cookie: "__Host-signed_out=1" });
    const query = new URLSearchParams({ state: await newestState(), code: "code-1", iss: PDS });
    const callback = await web.fetch(`/oauth/callback?${query}`, {
      headers: headers({ cookie: `__Host-oauth_nonce=${value(nonce)}` }),
    });
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe("/settings");
    const cookies = setCookies(callback);
    expectHostOnly(cookies.get("__Host-sid"), "Lax", 2_592_000);
    expectHostOnly(cookies.get("__Host-oauth_nonce"), "Lax", 0);
    expectHostOnly(cookies.get("__Host-signed_out"), "Lax", 0);
    expectHostOnly(cookies.get("__Host-signed_out_issuer"), "Strict", 0);
    // The session row carries the issuer the library verified (ADR 0048).
    const { rows } = await pool.query<{ issuer_origin: string }>(
      "SELECT issuer_origin FROM app.session WHERE did = $1",
      [DID],
    );
    expect(rows.map((row) => row.issuer_origin)).toContain(PDS);
    expect(JSON.stringify(web.logs())).not.toContain(DID);
  });

  test("another_browsers_callback_is_refused_and_makes_no_session", async () => {
    await startSignIn();
    const query = new URLSearchParams({ state: await newestState(), code: "code-1", iss: PDS });
    const other = await web.fetch(`/oauth/callback?${query}`, {
      headers: headers({ cookie: `__Host-oauth_nonce=${"x".repeat(43)}` }),
    });
    expect(other.status).toBe(303);
    expect(other.headers.get("location")).toBe("/login?error=login.state_mismatch");
    expect(setCookies(other).has("__Host-sid")).toBe(false);
  });

  test("a_signed_in_browser_is_sent_to_its_page", async () => {
    const cookie = `__Host-sid=${await signIn()}`;
    const form = await web.fetch("/login", { headers: headers({ cookie }) });
    expect(form.status).toBe(303);
    expect(form.headers.get("location")).toBe("/me");
    const again = await post("/login", "intent=chooser", { cookie });
    expect(again.headers.get("location")).toBe("/me");
  });
});

// P2.06 step 11: one best-effort read of the member's email state at sign-in, cached on the new session for the P2.11
// gate. A PDS that is slow, failing or silent never stops the sign-in and never marks the email confirmed.
describe("the email answer at sign-in", () => {
  const GET_SESSION = `GET ${PDS}/xrpc/com.atproto.server.getSession`;
  const HANDLE = "alice.example.com";
  const EMAIL = "alice@example.com";
  const ACCESS_TOKEN = "access-token-for-the-log-check-0123456789";
  /** The token endpoint issues a recognisable token, and getSession answers `answer`. */
  const withSession = (answer: { status?: number; body: unknown; delayMs?: number }): StandInFixture => ({
    ...fixture,
    fetch: {
      ...fixture.fetch,
      [`POST ${PDS}/oauth/token`]: {
        body: {
          access_token: ACCESS_TOKEN,
          refresh_token: "refresh-token-for-the-log-check-0123456789",
          token_type: "DPoP",
          sub: DID,
          expires_in: 3600,
          scope: scopeString(),
        },
      },
      [GET_SESSION]: answer,
    },
  });
  const sessionBody = (emailConfirmed: boolean) => ({ did: DID, handle: HANDLE, email: EMAIL, emailConfirmed });

  /** The new session's cached answer, found by the hash of its cookie as the store keys it. */
  async function cachedAnswer(sid: string) {
    const idHash = createHash("sha256").update(Buffer.from(sid, "base64url")).digest();
    const { rows } = await pool.query<{ email_confirmed: boolean | null; checked: boolean }>(
      "SELECT email_confirmed, email_checked_at IS NOT NULL AS checked FROM app.session WHERE id_hash = $1",
      [idHash],
    );
    return rows[0];
  }

  test("a_confirmed_email_is_cached_on_the_new_session", async () => {
    web.setStandIns(withSession({ body: sessionBody(true) }));
    const sid = await signIn();
    expect(web.standInCalls()).toContain(GET_SESSION);
    expect(await cachedAnswer(sid)).toEqual({ email_confirmed: true, checked: true });
  });

  test("an_unconfirmed_email_is_cached_as_not_confirmed", async () => {
    web.setStandIns(withSession({ body: sessionBody(false) }));
    const sid = await signIn();
    expect(await cachedAnswer(sid)).toEqual({ email_confirmed: false, checked: true });
  });

  test("a_failing_pds_still_signs_in_and_leaves_the_answer_unknown", async () => {
    web.setStandIns(withSession({ status: 503, body: { error: "InternalServerError" } }));
    const sid = await signIn();
    expect(await signedIn(sid)).toBe(true);
    expect(await cachedAnswer(sid)).toEqual({ email_confirmed: null, checked: false });
  });

  test("a_slow_pds_still_signs_in_within_the_deadline_and_leaves_the_answer_unknown", async () => {
    web.setStandIns(withSession({ body: sessionBody(true), delayMs: 60_000 }));
    const started = performance.now();
    const sid = await signIn();
    // The request deadline here is 5 s: the read gives up before it, so the browser gets its session, not a 503.
    expect(performance.now() - started).toBeLessThan(5000);
    expect(await signedIn(sid)).toBe(true);
    expect(await cachedAnswer(sid)).toEqual({ email_confirmed: null, checked: false });
    expect(web.logs()).toContainEqual(expect.objectContaining({ event: "auth.email_read_failed", kind: "timeout" }));
  }, 15_000);

  test("no_did_handle_email_or_token_reaches_the_log", async () => {
    web.setStandIns(withSession({ body: sessionBody(true) }));
    await signIn();
    web.setStandIns(withSession({ status: 503, body: {} }));
    await signIn();
    const logs = JSON.stringify(web.logs());
    for (const secret of [DID, HANDLE, EMAIL, ACCESS_TOKEN]) expect(logs).not.toContain(secret);
  });
});

describe("signing out", () => {
  test("sign_out_ends_this_session_marks_the_browser_and_carries_the_issuer", async () => {
    const sid = await signIn();
    const response = await post("/logout", "", { cookie: `__Host-sid=${sid}` });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/signed-out");
    const cookies = setCookies(response);
    expectHostOnly(cookies.get("__Host-sid"), "Lax", 0);
    expectHostOnly(cookies.get("__Host-signed_out"), "Lax", 2_592_000);
    expectHostOnly(cookies.get("__Host-signed_out_issuer"), "Strict", 600);
    expectHostOnly(cookies.get("__Host-login_target"), "Strict", 0);
    // The session is gone: the same cookie no longer signs the browser in.
    const after = await web.fetch("/login", { headers: headers({ cookie: `__Host-sid=${sid}` }) });
    expect(after.status).toBe(200);

    const issuer = value(cookies.get("__Host-signed_out_issuer"));
    const page = await web.fetch("/signed-out", { headers: headers({ cookie: `__Host-signed_out_issuer=${issuer}` }) });
    expect(page.status).toBe(200);
    const body = await page.text();
    expect(body).toContain(`href="${PDS}/account"`);
    expect(body).toContain('rel="noopener noreferrer"');
    expectHostOnly(setCookies(page).get("__Host-signed_out_issuer"), "Strict", 0);
  });

  test("the_next_sign_in_after_a_sign_out_asks_for_the_password", async () => {
    // The marker turns the silent first try into prompt=login, so the stored appState is not silent.
    const { response } = await startSignIn({ cookie: "__Host-signed_out=1" });
    expect(response.status).toBe(303);
  });

  test("a_forged_issuer_cookie_links_our_pds_instead", async () => {
    const forged = Buffer.from("https://evil.test/path").toString("base64url");
    const body = await (
      await web.fetch("/signed-out", { headers: headers({ cookie: `__Host-signed_out_issuer=${forged}` }) })
    ).text();
    expect(body).not.toContain("evil.test");
    expect(body).toContain(`href="${PDS}/account"`);
  });

  test("no_thanks_clears_the_marker_and_goes_home", async () => {
    const response = await post("/signed-out", "", { cookie: "__Host-signed_out=1" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expectHostOnly(setCookies(response).get("__Host-signed_out"), "Lax", 0);
  });

  test("sign_out_everywhere_ends_every_session_of_the_account", async () => {
    const first = await signIn();
    const second = await signIn();
    const response = await post("/logout/everywhere", "", { cookie: `__Host-sid=${first}` });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/signed-out");
    const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM app.session WHERE did = $1", [
      DID,
    ]);
    expect(rows[0]?.n).toBe(0);
    const other = await web.fetch("/login", { headers: headers({ cookie: `__Host-sid=${second}` }) });
    expect(other.status).toBe(200);
  });

  // P2.27 (ADR 0079): every sign-in of a member sends one "new sign-in" to the inbox in its own transaction, which
  // only browsers signed in before it may see; a changed privacy notice is sent once per version at sign-in.
  test("a_sign_in_tells_the_members_older_browsers_and_a_changed_notice_once", async () => {
    await signIn();
    await readyMember(pool, DID as Parameters<typeof readyMember>[1]);
    await pool.query(
      "UPDATE app.account SET privacy_version = 'an-older-notice', privacy_notice_seen_version = NULL WHERE did = $1",
      [DID],
    );
    await pool.query("DELETE FROM app.notification WHERE did = $1", [DID]);
    await signIn();
    await signIn();
    const { rows } = await pool.query<{ reason: string; older: boolean; topic: string | null; same: boolean }>(
      "SELECT n.reason, n.older_sessions_only AS older, n.topic, " +
        "EXISTS (SELECT 1 FROM app.session s WHERE s.did = n.did AND s.created_at = n.created_at) AS same " +
        "FROM app.notification n WHERE n.did = $1 ORDER BY n.created_at",
      [DID],
    );
    expect(rows.filter((r) => r.reason === "sign_in")).toEqual([
      { reason: "sign_in", older: true, topic: null, same: true },
      { reason: "sign_in", older: true, topic: null, same: true },
    ]);
    expect(rows.filter((r) => r.reason === "privacy_notice")).toEqual([
      { reason: "privacy_notice", older: false, topic: PRIVACY_VERSION, same: false },
    ]);
  });

  // P2.27c (ADR 0082): every sign-in of a member with an account row keeps one history row, written in the sign-in's
  // own transaction, so its time is the new session's; nothing but the member and the time is stored.
  test("a_sign_in_keeps_one_history_row_at_the_sessions_time", async () => {
    await signIn();
    await readyMember(pool, DID as Parameters<typeof readyMember>[1]);
    await pool.query("DELETE FROM app.sign_in WHERE did = $1", [DID]);
    await signIn();
    await signIn();
    const { rows } = await pool.query<{ same: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM app.session s WHERE s.did = h.did AND s.created_at = h.signed_in_at) AS same " +
        "FROM app.sign_in h WHERE h.did = $1",
      [DID],
    );
    expect(rows).toEqual([{ same: true }, { same: true }]);
  });

  test("a_link_or_another_site_cannot_sign_a_member_out", async () => {
    const sid = await signIn();
    expect((await web.fetch("/logout", { headers: headers({ cookie: `__Host-sid=${sid}` }) })).status).toBe(405);
    const crossSite = await post("/logout", "", { cookie: `__Host-sid=${sid}`, origin: "https://evil.test" });
    expect(crossSite.status).toBe(403);
    const still = await web.fetch("/login", { headers: headers({ cookie: `__Host-sid=${sid}` }) });
    expect(still.status).toBe(303);
  });
});

describe("typed accounts", () => {
  test("a_handle_that_resolves_is_checked_against_its_did_document", async () => {
    // DNS names DID for the handle, but the stand-in document does not claim the handle back: the library's check
    // (P2.05a) refuses before any server is asked, and no nonce reaches the browser.
    const response = await typed("@Alice.example.com");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?error=login.handle_unverified");
    expect(setCookies(response).has("__Host-oauth_nonce")).toBe(false);
  });

  test("a_did_starts_a_sign_in_as_typed", async () => {
    const response = await typed(DID);
    expect(response.headers.get("location")).toBe("/login/continue");
  });

  test.each([
    ["a handle nobody holds", "nobody.example.com", "login.handle_not_found"],
    ["a handle that does not parse", "bad..name", "login.handle_invalid"],
    ["a DID that does not parse", "did:plc:", "login.handle_invalid"],
  ])("%s_goes_back_to_the_form_with_its_code", async (_name, handle, code) => {
    const response = await typed(handle);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/login?error=${code}`);
    expect(setCookies(response).has("__Host-oauth_nonce")).toBe(false);
  });
});

describe("cancelled sign-ins", () => {
  test("cancel_keeps_next_in_the_login_form_without_spending_the_nonce", async () => {
    const { nonce } = await startSignIn({}, "/settings/profile");
    const before = web.logs().length;
    const response = await callBack(nonce, { error: "access_denied", next: "/about" });
    expect(response.status).toBe(303);
    const target = response.headers.get("location");
    expect(target).toBe("/login?error=login.consent_denied&next=%2Fsettings%2Fprofile");
    const form = await web.fetch(target ?? "", { headers: headers() });
    expect(form.status).toBe(200);
    expect(await form.text()).toContain('name="next" value="/settings/profile"');
    expect(setCookies(response).size).toBe(0);
    const tokenHash = createHash("sha256")
      .update(Buffer.from(value(nonce), "base64url"))
      .digest();
    const { rows } = await pool.query<{ consumed_at: Date | null }>(
      "SELECT consumed_at FROM app.single_use WHERE purpose = 'login.nonce' AND id = $1",
      [tokenHash],
    );
    expect(rows).toEqual([{ consumed_at: null }]);
    expect(
      web
        .logs()
        .slice(before)
        .filter((line) => line.event === "auth.login_denied"),
    ).toEqual([expect.objectContaining({ code: "login.consent_denied" })]);
  });

  test.each([undefined, `__Host-oauth_nonce=${"x".repeat(43)}`])(
    "cancel_from_another_browser_drops_next_%s",
    async (nonce) => {
      await startSignIn({}, "/settings/profile");
      const response = await callBack(nonce, { error: "access_denied", next: "/about" });
      expect(response.headers.get("location")).toBe("/login?error=login.consent_denied");
      expect(setCookies(response).size).toBe(0);
    },
  );

  test.each(["//evil.example", "https://evil.example/x", "/\\evil.example", "/\t/evil.example", "/settings\u0000"])(
    "cancel_drops_a_hostile_next_from_sealed_state_%s",
    async (next) => {
      const { nonce } = await startSignIn();
      const key = await newestState();
      const saved = await states.get(key);
      if (saved?.appState === undefined) throw new Error("sign-in state missing");
      await states.set(key, { ...saved, appState: JSON.stringify({ ...JSON.parse(saved.appState), next }) });
      const response = await callBack(nonce, { error: "access_denied", next: "/about" });
      expect(response.headers.get("location")).toBe("/login?error=login.consent_denied");
    },
  );

  test.each(["not json", "{}"])("cancel_drops_an_unparsable_app_state_%s", async (appState) => {
    const { nonce } = await startSignIn();
    const key = await newestState();
    const saved = await states.get(key);
    if (saved === undefined) throw new Error("sign-in state missing");
    await states.set(key, { ...saved, appState });
    const response = await callBack(nonce, { error: "access_denied", next: "/about" });
    expect(response.headers.get("location")).toBe("/login?error=login.consent_denied");
  });

  test("other_refusals_still_drop_next", async () => {
    const { nonce } = await startSignIn({}, "/settings/profile");
    const response = await callBack(nonce, { error: "server_error", next: "/about" });
    expect(response.headers.get("location")).toBe("/login?error=login.failed");
  });
});

describe("callback refusals", () => {
  test("a_spent_nonce_is_refused_and_makes_no_session", async () => {
    const { nonce } = await startSignIn();
    // As if another callback had spent it first: web's own consume statement, for every unspent sign-in nonce.
    await pool.query(
      "UPDATE app.single_use SET consumed_at = now() WHERE purpose = 'login.nonce' AND consumed_at IS NULL",
    );
    const response = await callBack(nonce);
    expect(response.headers.get("location")).toBe("/login?error=login.expired");
    expect(setCookies(response).has("__Host-sid")).toBe(false);
  });

  test("a_grant_for_another_account_than_the_one_typed_is_refused", async () => {
    web.setStandIns(pdsFixture({ sub: OTHER }));
    const started = await typed(DID);
    const response = await callBack(setCookies(started).get("__Host-oauth_nonce"));
    expect(response.headers.get("location")).toBe("/login?error=login.account_mismatch");
    expect(setCookies(response).has("__Host-sid")).toBe(false);
  });

  test("a_grant_that_does_not_cover_a_session_is_revoked_and_refused", async () => {
    web.setStandIns(pdsFixture({ sub: OTHER, scope: "atproto" }));
    const { nonce } = await startSignIn();
    const before = web.standInCalls().length;
    const response = await callBack(nonce);
    expect(response.headers.get("location")).toBe("/login?error=login.scope_insufficient");
    expect(setCookies(response).has("__Host-sid")).toBe(false);
    expect(web.standInCalls().slice(before)).toContain(`POST ${PDS}/oauth/revoke`);
    const { rows } = await pool.query("SELECT 1 FROM app.oauth_session WHERE did = $1", [OTHER]);
    expect(rows).toEqual([]);
  });

  test("a_silent_try_that_needs_a_page_is_asked_again_once_with_one", async () => {
    const { nonce } = await startSignIn();
    const before = web.standInCalls().length;
    const response = await callBack(nonce, { error: "login_required" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(new RegExp(`^${PDS}/oauth/authorize\\?`));
    expect(web.standInCalls().slice(before)).toContain(`POST ${PDS}/oauth/par`);
    // The nonce is not spent and its cookie stays, so the callback of the page's answer can spend it.
    expect(setCookies(response).has("__Host-oauth_nonce")).toBe(false);
    // The second answer comes back for a flow that is no longer silent: refused, never asked a third time.
    const again = await callBack(nonce, { error: "login_required" });
    expect(again.headers.get("location")).toBe("/login?error=login.failed");
  });

  test("a_silent_refusal_for_another_browser_is_not_asked_again", async () => {
    await startSignIn();
    const response = await callBack("x".repeat(43), { error: "login_required" });
    expect(response.headers.get("location")).toBe("/login?error=login.state_mismatch");
  });

  test("a_sign_in_over_a_session_replaces_it", async () => {
    const old = await signIn();
    const fresh = await signIn(`__Host-sid=${old}`);
    expect(fresh).not.toBe(old);
    expect(await signedIn(old)).toBe(false);
    expect(await signedIn(fresh)).toBe(true);
  });
});

/**
 * Holds `lock` (a statement taking row or table locks) in an open transaction of the test's own connection while
 * `during` runs, so the server's statement on those rows waits until its request deadline: a store that does not answer.
 */
async function whileHeld<T>(lock: string, params: unknown[], during: () => Promise<T>): Promise<T> {
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query(lock, params);
    return await during();
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
  }
}

describe("a store that does not answer", () => {
  test("a_nonce_store_that_does_not_answer_refuses_the_sign_in", async () => {
    const { nonce } = await startSignIn();
    const response = await whileHeld(
      "SELECT 1 FROM app.single_use WHERE purpose = 'login.nonce' AND consumed_at IS NULL FOR UPDATE",
      [],
      () => callBack(nonce),
    );
    expect(response.headers.get("location")).toBe("/login?error=login.failed");
    expect(setCookies(response).has("__Host-sid")).toBe(false);
  }, 20_000);

  test("a_session_store_that_does_not_answer_refuses_the_sign_in", async () => {
    const { nonce } = await startSignIn();
    const response = await whileHeld("LOCK TABLE app.session IN SHARE MODE", [], () => callBack(nonce));
    expect(response.headers.get("location")).toBe("/login?error=login.failed");
    expect(setCookies(response).has("__Host-sid")).toBe(false);
  }, 20_000);

  test("sign_out_everywhere_that_cannot_end_the_sessions_is_a_retryable_503", async () => {
    web.setStandIns(pdsFixture({ sub: OTHER }));
    const sid = await signIn();
    const response = await whileHeld("SELECT 1 FROM app.session WHERE did = $1 FOR UPDATE", [OTHER], () =>
      post("/logout/everywhere", "", { cookie: `__Host-sid=${sid}` }),
    );
    expect(response.status).toBe(503);
    // The cookie stays, so the member can try again.
    expect(setCookies(response).has("__Host-sid")).toBe(false);
    // The deadline answers first (http.deadline); the abandoned attempt then gives up and says so, for an operator.
    await expect
      .poll(() => web.logs().map((line) => line.event), { timeout: 2000 })
      .toContain("auth.logout_everywhere_incomplete");
  }, 20_000);
});

describe("the last browser", () => {
  const tokenSet = async (did: string): Promise<boolean> =>
    (await pool.query("SELECT 1 FROM app.oauth_session WHERE did = $1", [did])).rows.length === 1;

  test("only_the_last_browser_to_sign_out_revokes_the_grant", async () => {
    web.setStandIns(pdsFixture({ sub: LAST }));
    const first = await signIn();
    const second = await signIn();
    const before = web.standInCalls().length;
    await post("/logout", "", { cookie: `__Host-sid=${first}` });
    expect(web.standInCalls().slice(before)).not.toContain(`POST ${PDS}/oauth/revoke`);
    expect(await tokenSet(LAST)).toBe(true);
    expect(await signedIn(second)).toBe(true);
    await post("/logout", "", { cookie: `__Host-sid=${second}` });
    expect(web.standInCalls().slice(before)).toContain(`POST ${PDS}/oauth/revoke`);
    expect(await tokenSet(LAST)).toBe(false);
  });

  test("a_revocation_the_server_refuses_still_leaves_no_grant_here", async () => {
    web.setStandIns(pdsFixture({ sub: DROP, revokeStatus: 500 }));
    const sid = await signIn();
    expect(await tokenSet(DROP)).toBe(true);
    const response = await post("/logout", "", { cookie: `__Host-sid=${sid}` });
    expect(response.headers.get("location")).toBe("/signed-out");
    expect(await tokenSet(DROP)).toBe(false);
  });
});

describe("client metadata", () => {
  test("the_client_metadata_and_public_keys_are_served_cacheable", async () => {
    const metadata = await web.fetch("/oauth-client-metadata.json", { headers: headers() });
    expect(metadata.status).toBe(200);
    expect(metadata.headers.get("cache-control")).toBe("public, max-age=300");
    expect(((await metadata.json()) as { client_id: string }).client_id).toBe(`${ORIGIN}/oauth-client-metadata.json`);
    const jwks = (await (await web.fetch("/oauth/jwks.json", { headers: headers() })).json()) as {
      keys: Record<string, unknown>[];
    };
    expect(jwks.keys.length).toBe(1);
    expect(jwks.keys[0]).not.toHaveProperty("d");
  });
});
