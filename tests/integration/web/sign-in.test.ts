// P1.20e: signing in and out on the built SvelteKit server, the outcomes interfaces/http's login, callback and logout
// routes give today, with the same cookies (names, SameSite, Max-Age, host-only). Postgres as `web` (TE-2). The only
// stand-ins are the network the server may not reach in a test (TE-1): PLC, and our PDS's authorization server, both
// answered by stand-in-server.ts from the fixture below. Everything else, the OAuth client included, is real.
import { join, relative } from "node:path";
import { createPool } from "@unset/infrastructure-postgres";
import { scopeString } from "@unset/shared-lexicons";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import {
  buildOnce,
  clientAddress,
  ORIGIN,
  PDS_HOST,
  type RunningWeb,
  type StandInFixture,
  startWeb,
} from "./built-server.ts";

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

const PDS = `https://${PDS_HOST}`;
const DID = `did:plc:${"s".repeat(24)}`;
const REQUEST_URI = "urn:ietf:params:oauth:request_uri:req-0123456789abcdef";

/** Our PDS as the OAuth library sees it: discovery, PAR, the token endpoint (a grant for DID) and revocation. */
const fixture: StandInFixture = {
  http: {
    [`https://plc.directory/${DID}`]: {
      body: {
        "@context": ["https://www.w3.org/ns/did/v1"],
        id: DID,
        verificationMethod: [{ id: `${DID}#atproto`, type: "Multikey", controller: DID, publicKeyMultibase: "zQ3sh" }],
        service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }],
      },
    },
  },
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
      body: {
        access_token: "at",
        refresh_token: "rt",
        token_type: "DPoP",
        sub: DID,
        expires_in: 3600,
        scope: scopeString(),
      },
    },
    [`POST ${PDS}/oauth/revoke`]: { body: {} },
  },
};

let web: RunningWeb;
beforeAll(async () => {
  buildOnce();
  web = await startWeb(pg, {}, fixture);
}, 120_000);
afterAll(async () => {
  await web?.stop();
  await pool.end();
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
async function startSignIn(extra: Record<string, string> = {}) {
  const response = await post("/login", "intent=chooser&next=%2Fsettings", extra);
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

/** A whole sign-in for DID, through the callback; returns the session cookie. */
async function signIn(): Promise<string> {
  const { nonce } = await startSignIn();
  const query = new URLSearchParams({ state: await newestState(), code: "code-1", iss: PDS });
  const callback = await web.fetch(`/oauth/callback?${query}`, {
    headers: headers({ cookie: `__Host-oauth_nonce=${value(nonce)}` }),
  });
  expect(callback.status).toBe(303);
  return value(setCookies(callback).get("__Host-sid"));
}

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

  test("a_link_or_another_site_cannot_sign_a_member_out", async () => {
    const sid = await signIn();
    expect((await web.fetch("/logout", { headers: headers({ cookie: `__Host-sid=${sid}` }) })).status).toBe(405);
    const crossSite = await post("/logout", "", { cookie: `__Host-sid=${sid}`, origin: "https://evil.test" });
    expect(crossSite.status).toBe(403);
    const still = await web.fetch("/login", { headers: headers({ cookie: `__Host-sid=${sid}` }) });
    expect(still.status).toBe(303);
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
