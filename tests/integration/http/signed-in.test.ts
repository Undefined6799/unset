// P2.13s: one signed-in member walked through the server compose() builds, so the wiring compose holds in closures
// (the app gate, the email cache's SQL, the recorded issuer, the logout count) is run, not re-typed. Postgres as `web`
// with the real session, token-set and account tables (TE-2). The only stand-in is the identity network: PLC, DNS and
// handle domains are unmanaged dependencies (TE-1). Nothing here calls the PDS: the email check is fresh, and the
// browser that signs out is not the last, so the grant stays.
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type Did, type IdentityNetwork, PRIVACY_VERSION, parseDid, TERMS_VERSION } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import { createOAuthSessionStore, createPool, withClient, withTransaction } from "@unset/infrastructure-postgres";
import { createSealer } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { loadConfig } from "@unset/shared-config";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, expect, inject, test } from "vitest";
import { compose, type Services } from "../../../interfaces/http/compose.ts";
import { config } from "../../../interfaces/http/config.ts";
import { SESSION_COOKIE, sessionClearCookie } from "../../../interfaces/http/session-cookie.ts";
import { webTestEnv } from "../../../interfaces/http/test-env.ts";

const REPO = join(import.meta.dirname, "..", "..", "..");
const provided = inject("postgres");
const database = provided.databases[relative(REPO, import.meta.filename)] ?? "";
const SECRETS = mkdtempSync(join(tmpdir(), "web-secrets-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));

/** The web server's config, with its own pool pointed at this file's database as `web`. */
function webConfig() {
  const env = webTestEnv(SECRETS, { WEB_BUILD_DIR: join(REPO, "interfaces/http/web/testdata/") });
  const passwordFile = join(SECRETS, "pg_web_login");
  writeFileSync(passwordFile, provided.roles.web.password);
  return loadConfig(config, {
    ...env,
    PG_HOST: provided.host,
    PG_PORT: String(provided.port),
    PG_DATABASE: database,
    PG_USER: provided.roles.web.user,
    PG_PASSWORD_FILE: passwordFile,
  });
}
const cfg = webConfig();
const ORIGIN = cfg.PUBLIC_ORIGIN;
const ISSUER = `https://${cfg.PDS_HOSTNAME}`;

const pool = createPool({
  connection: { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false },
  service: "signed-in-http",
  max: 2,
  connectTimeoutMs: 5000,
});
afterAll(() => pool.end());
const quiet = createLogger({ service: "http", commit: "c".repeat(40), env: "test", write: () => undefined });
// The same keyring and limits the composed server reads, so it unseals and accepts what this file stores.
const tokenSets = createOAuthSessionStore<SavedSession>({ pool, sealer: createSealer(cfg.SEAL_KEYRING), log: quiet });
const sessions = createSessionStore({
  withDb: (deadline, fn) => withClient(pool, deadline, fn),
  limits: {
    idleS: cfg.SESSION_IDLE_S,
    absoluteS: cfg.SESSION_ABSOLUTE_S,
    touchIntervalS: cfg.SESSION_TOUCH_INTERVAL_S,
  },
  log: quiet,
});
const sql = <T extends Record<string, unknown>>(text: string, values: unknown[] = []) =>
  withClient(pool, null, async (client) => (await client.query<T>(text, values)).rows);

const did = (text: string): Did => {
  const parsed = parseDid(text);
  if (parsed === null) throw new Error("test DID did not parse");
  return parsed;
};
const ALICE = did(`did:plc:${"a".repeat(24)}`);
const BOB = did(`did:plc:${"b".repeat(24)}`);

/**
 * PLC answers with a document that claims no handle, so the real verifier ends at "invalid" without a DNS or HTTPS
 * lookup. A claimed handle that verifies is the identity domain's own test (verify-handle.test.ts): the guard on the
 * handle claim's field name lets only those files write it.
 */
const lookups = { plc: 0, other: 0 };
const network: IdentityNetwork = {
  get: async (url, request) => {
    if (request.target !== "plc") {
      lookups.other += 1;
      return { kind: "response", status: 404, body: new Uint8Array() };
    }
    lookups.plc += 1;
    const id = decodeURIComponent(url.pathname.slice(1));
    return { kind: "response", status: 200, body: new TextEncoder().encode(JSON.stringify({ id })) };
  },
  txt: async () => {
    lookups.other += 1;
    return { kind: "no_record" };
  },
};

let server: Services["server"];
/** Alice's two browsers; Bob's one. */
const cookies = { first: "", second: "", bob: "" };

/** A finished account with a stored grant and one browser per name, each with an email confirmed just now. */
async function signIn(owner: Did, browsers: number): Promise<string[]> {
  // A DPoP key made per run, as the callback stores one with every grant; no key material sits in the repository.
  const dpopJwk = {
    ...generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" }),
    kid: "dpop",
    alg: "ES256",
  };
  await tokenSets.set(owner, {
    dpopJwk: dpopJwk as SavedSession["dpopJwk"],
    authMethod: { method: "private_key_jwt", kid: cfg.OAUTH_ACTIVE_KID },
    tokenSet: {
      iss: ISSUER,
      sub: owner as SavedSession["tokenSet"]["sub"],
      aud: ISSUER,
      scope: "atproto",
      access_token: "a",
      token_type: "DPoP",
    },
  });
  await sql(
    "INSERT INTO app.account (did, first_seen_at, onboarding, terms_version, terms_accepted_at, privacy_version, " +
      "age_confirmed_at) VALUES ($1, now(), 'done', $2, now(), $3, now())",
    [owner, TERMS_VERSION, PRIVACY_VERSION],
  );
  const made: string[] = [];
  for (let i = 0; i < browsers; i += 1) {
    made.push((await withTransaction(pool, null, (tx) => sessions.create(tx, owner))).cookieValue);
  }
  await withTransaction(pool, null, (tx) => sessions.setEmailConfirmed(tx, { did: owner }, true));
  return made;
}

beforeAll(async () => {
  // The web server's composition takes apps/web's render; tests pass the source (P1.23c), never the build.
  const web = await import(join(REPO, "apps/web/render.tsx"));
  server = (await compose(cfg, web, { network })).server;
  const [first, second] = await signIn(ALICE, 2);
  const [bob] = await signIn(BOB, 1);
  Object.assign(cookies, { first, second, bob });
});
afterAll(() => server?.close());

const HEADERS = { host: new URL(ORIGIN).host, "x-forwarded-for": "198.51.100.7" };
const get = (path: string, cookie: string) =>
  server.request(
    new Request(`${ORIGIN}${path}`, { headers: { ...HEADERS, cookie: `${SESSION_COOKIE}=${cookie}` } }),
    "10.0.0.1",
  );
const signOut = (cookie: string) =>
  server.request(
    new Request(`${ORIGIN}/logout`, {
      method: "POST",
      headers: {
        ...HEADERS,
        cookie: `${SESSION_COOKIE}=${cookie}`,
        origin: ORIGIN,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "",
    }),
    "10.0.0.1",
  );
const sessionsOf = async (owner: Did) =>
  (await sql<{ n: number }>("SELECT count(*)::int AS n FROM app.session WHERE did = $1", [owner]))[0]?.n;

test("signed_in.did_redirects_to_own_account", async () => {
  const response = await get("/did", cookies.first);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(`/${ALICE}`);
});

test("signed_in.account_page_renders_for_its_owner", async () => {
  const response = await get(`/${ALICE}`, cookies.first);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const html = await response.text();
  expect(html).toContain(`<code>${ALICE}</code>`);
  // The handle check ran on the stand-in PLC and nowhere else; with no claimed handle the page says so.
  expect(html).toContain("<h1>handle.invalid</h1>");
  expect(lookups).toEqual({ plc: 1, other: 0 });
});

test("signed_in.another_account_reads_as_missing", async () => {
  // SE-2: Bob is signed in and Alice's page exists, and it still answers as an unknown path.
  expect((await get(`/${ALICE}`, cookies.bob)).status).toBe(404);
  expect((await get(`/${BOB}`, cookies.first)).status).toBe(404);
});

test("signed_in.settings_account_links_the_recorded_issuer", async () => {
  const response = await get("/settings/account", cookies.first);
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain(ALICE);
  // The issuer is the one stored with the grant, read through compose's own token-set store and keyring.
  expect(html).toContain(`href="${ISSUER}/account"`);
});

test("signed_in.logout_ends_this_browser_only", async () => {
  const response = await signOut(cookies.first);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/signed-out");
  expect(response.headers.getSetCookie()).toContain(sessionClearCookie());
  expect(await sessionsOf(ALICE)).toBe(1);
  // Not the last browser, so the grant stays and the other browser is still signed in.
  expect(await tokenSets.get(ALICE)).toBeDefined();
  expect((await get("/did", cookies.second)).headers.get("location")).toBe(`/${ALICE}`);
  // The signed-out browser's cookie no longer opens anything.
  const after = await get("/did", cookies.first);
  expect(after.status).toBe(303);
  expect(after.headers.get("location")).toBe("/login?next=%2Fdid");
  expect(await sessionsOf(BOB)).toBe(1);
});
