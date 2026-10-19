// P2.08a: HTTP proof that one of two sessions can sign out, and account access ends when the grant is gone.
// The route tests stub the store. This file uses Postgres as web and the real session store (P2.03, P2.04s).
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import { createOAuthSessionStore, createPool, withClient, withTransaction } from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore, type SessionDb, type SessionLimits } from "@unset/infrastructure-session";
import { loadConfig } from "@unset/shared-config";
import { createServer } from "@unset/shared-http";
import { createLogger } from "@unset/shared-log";
import { afterAll, beforeAll, expect, inject, test } from "vitest";
import { sessionClearCookie } from "../../../interfaces/http/session-cookie.ts";

// Loaded by path, as query-budget does for compose: a static import would pull the server into this project.

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const webPool = createPool({
  connection: { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false },
  service: "logout-http",
  max: 4,
  connectTimeoutMs: 5000,
});
afterAll(() => webPool.end());

const LIMITS: SessionLimits = { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 };
const did = (text: string): Did => {
  const parsed = parseDid(text);
  if (parsed === null) throw new Error("test DID did not parse");
  return parsed;
};
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
let n = 0;
const newDid = (): Did => {
  const i = n++;
  return did(`did:plc:${"d".repeat(22)}${BASE32[i >> 5]}${BASE32[i & 31]}`);
};

const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 5).toString("base64") } }));
if (keyring === undefined) throw new Error("test keyring did not parse");
const quiet = createLogger({ service: "http", commit: "c".repeat(40), env: "test", write: () => undefined });
const tokenSets = createOAuthSessionStore({ pool: webPool, sealer: createSealer(keyring), log: quiet });

const sql = <T extends Record<string, unknown>>(text: string, values: unknown[] = []) =>
  withClient(webPool, null, async (client) => (await client.query<T>(text, values)).rows);

const hasToken = async (owner: Did) =>
  (await sql("SELECT 1 FROM app.oauth_session WHERE did = $1", [owner])).length === 1;
const sessionsOf = async (owner: Did) =>
  (await sql<{ n: number }>("SELECT count(*)::int AS n FROM app.session WHERE did = $1", [owner]))[0]?.n;

const ORIGIN = "https://unset.test";
const REPO = join(import.meta.dirname, "..", "..", "..");
const HTTP = join(REPO, "interfaces", "http");
const SECRETS = mkdtempSync(join(tmpdir(), "logout-http-"));
afterAll(() => rmSync(SECRETS, { recursive: true, force: true }));

type Revoke = { did: string; hadToken: boolean };
type Server = { request(request: Request, peer?: string): Promise<Response> };
let mode: "keep" | "drop" = "drop";
let revoked: Revoke[] = [];
const lines: Record<string, unknown>[] = [];
const log = createLogger({
  service: "http",
  commit: "c".repeat(40),
  env: "test",
  write: (line) => lines.push(JSON.parse(line)),
});
const store = createSessionStore({
  withDb: (deadline, fn) => withClient(webPool, deadline, fn),
  limits: LIMITS,
  log,
});
let server: Server | undefined;
let remainingSessions: (db: SessionDb, did: Did, idleS: number) => Promise<number>;

beforeAll(async () => {
  const [
    { browserLogout, remainingSessions: counted },
    { logoutRoutes },
    { meRoutes },
    { policies },
    { config },
    { webTestEnv },
    { pageResponse },
    web,
  ] = await Promise.all([
    import(join(HTTP, "logout-sessions.ts")),
    import(join(HTTP, "routes/logout.ts")),
    import(join(HTTP, "routes/me.ts")),
    import(join(HTTP, "limits.ts")),
    import(join(HTTP, "config.ts")),
    import(join(HTTP, "test-env.ts")),
    import(join(HTTP, "web/page.ts")),
    import(join(REPO, "apps/web/render.tsx")),
  ]);
  remainingSessions = counted;
  const page = (input: Parameters<typeof pageResponse>[1]) =>
    pageResponse(
      {
        build: { manifest: { boot: "assets/boot.js", styles: [], fonts: [], islands: new Map() }, files: new Map() },
        render: web.renderPage,
        assetsOrigin: ORIGIN,
        env: "test",
        log,
      },
      input,
    );
  server = createServer({
    // The schema arrives through a path import, so its field types do not survive; the value is the web config.
    config: loadConfig(config, webTestEnv(SECRETS, { PUBLIC_ORIGIN: ORIGIN })) as Parameters<
      typeof createServer
    >[0]["config"],
    routes: [
      ...logoutRoutes({
        readSession: async (request: Request, deadline: AbortSignal) =>
          (await store.read({ key: request, cookieValue: cookieOf(request), deadline })).session,
        ...browserLogout({
          pool: webPool,
          sessions: store,
          idleS: LIMITS.idleS,
          revoke: async (owner: Did) => {
            revoked.push({ did: owner, hadToken: await hasToken(owner) });
            if (mode === "keep") throw new Error("RevokeDown");
            await tokenSets.del(owner);
          },
        }),
        page,
        screens: web.screens,
        pdsHost: "pds.unset.test",
        log,
      }),
      ...meRoutes({
        // This file proves logout, not the age gate. compose is what applies that gate; here a live session is enough.
        open: async (request: Request, deadline: AbortSignal, next: string) => {
          const { session, clearCookie } = await store.read({
            key: request,
            cookieValue: cookieOf(request),
            deadline,
          });
          if (session === null) {
            const headers = new Headers({
              location: `/login?${new URLSearchParams({ next })}`,
              "cache-control": "no-store",
            });
            if (clearCookie) headers.append("set-cookie", sessionClearCookie());
            return new Response(null, { status: 303, headers });
          }
          return { session, privacyNotice: false };
        },
        verifyHandle: async () => ({ status: "verified", handle: "alice.test", checkedAt: 0 }),
        page,
        screens: web.screens,
        pdsHost: "pds.unset.test",
      }),
    ],
    policies,
    log,
  });
});

function cookieOf(request: Request): string | null {
  const pair = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim());
  const found = pair.filter((part) => part.startsWith("__Host-sid="));
  return found.length === 1 ? (found[0]?.slice("__Host-sid=".length) ?? null) : null;
}

const open = (owner: Did) => withTransaction(webPool, null, (tx) => store.create(tx, owner));

function ask(request: Request): Promise<Response> {
  if (server === undefined) throw new Error("server was not started");
  return server.request(request, "10.0.0.8");
}

function post(path: string, cookie: string, body: string) {
  const headers = new Headers({
    host: "unset.test",
    "x-forwarded-for": "192.0.2.8",
    cookie: `__Host-sid=${cookie}`,
    "content-type": "application/x-www-form-urlencoded",
    "sec-fetch-site": "same-origin",
    origin: ORIGIN,
  });
  return ask(new Request(`${ORIGIN}${path}`, { method: "POST", headers, body }));
}

function get(path: string, cookie: string) {
  return ask(
    new Request(`${ORIGIN}${path}`, {
      headers: { host: "unset.test", "x-forwarded-for": "192.0.2.8", cookie: `__Host-sid=${cookie}` },
    }),
  );
}

test("logout.this_browser keeps the other session and the grant", async () => {
  mode = "drop";
  revoked = [];
  const owner = newDid();
  await tokenSets.set(owner, { authMethod: { method: "private_key_jwt", kid: "A" } });
  const first = await open(owner);
  const second = await open(owner);
  const accountPath = `/${owner}`;
  const home = await get(accountPath, second.cookieValue);
  expect(home.status).toBe(200);
  expect(await home.text()).toContain("alice.test");
  const response = await post("/logout", first.cookieValue, "");
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/signed-out");
  expect(revoked).toEqual([]);
  expect(await sessionsOf(owner)).toBe(1);
  expect(await hasToken(owner)).toBe(true);
  const still = await get(accountPath, second.cookieValue);
  expect(still.status).toBe(200);
  expect(await still.text()).toContain("alice.test");
  for (const shortcut of ["/did", "/me"]) {
    const resolved = await get(shortcut, second.cookieValue);
    expect(resolved.status).toBe(303);
    expect(resolved.headers.get("location")).toBe(accountPath);
  }
  await tokenSets.del(owner);
  const gone = await get(accountPath, second.cookieValue);
  expect(gone.status).toBe(303);
  expect(gone.headers.get("location")).toBe(`/login?${new URLSearchParams({ next: accountPath })}`);
  expect(gone.headers.get("set-cookie")).toContain("__Host-sid=");
  expect(await sessionsOf(owner)).toBe(0);
  for (const shortcut of ["/did", "/me"]) {
    const signedOut = await get(shortcut, second.cookieValue);
    expect(signedOut.status).toBe(303);
    expect(signedOut.headers.get("location")).toBe("/login?next=%2Fdid");
  }
  expect(JSON.stringify(lines)).not.toContain(owner);
});

test("logout.last_browser_revokes", async () => {
  mode = "drop";
  revoked = [];
  const owner = newDid();
  await tokenSets.set(owner, { authMethod: { method: "private_key_jwt", kid: "A" } });
  const only = await open(owner);
  const response = await post("/logout", only.cookieValue, "");
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/signed-out");
  expect(revoked).toEqual([{ did: owner, hadToken: true }]);
  expect(await hasToken(owner)).toBe(false);
  expect(await sessionsOf(owner)).toBe(0);
});

// P2.08c: a session row past its idle or absolute expiry signs nobody in (the store reads it as expired), but no sweep
// runs until the jobs process exists. Counting it would keep the grant alive after the last real browser signs out.
// `stale` backdates a row: last seen `idleS` ago, its absolute expiry `absoluteS` after that.
const stale = (owner: Did, ages: { idleS: number; absoluteS: number }) =>
  sql(
    "INSERT INTO app.session (id_hash, did, created_at, last_seen_at, absolute_expires_at) VALUES " +
      "($1, $2, now() - make_interval(secs => $3), now() - make_interval(secs => $3), " +
      "now() - make_interval(secs => $3) + make_interval(secs => $4))",
    [randomBytes(32), owner, ages.idleS, ages.absoluteS],
  );
// Inside a limit by this much, the row is still live. A few seconds, not one, so a slow runner cannot cross it
// between the insert and the sign-out.
const INSIDE_S = 5;

async function signOutBesides(ages: { idleS: number; absoluteS: number }) {
  mode = "drop";
  revoked = [];
  const owner = newDid();
  await tokenSets.set(owner, { authMethod: { method: "private_key_jwt", kid: "A" } });
  await stale(owner, ages);
  const only = await open(owner);
  const response = await post("/logout", only.cookieValue, "");
  expect(response.headers.get("location")).toBe("/signed-out");
  return owner;
}

async function expectRevoked(ages: { idleS: number; absoluteS: number }) {
  const owner = await signOutBesides(ages);
  expect(revoked).toEqual([{ did: owner, hadToken: true }]);
  expect(await hasToken(owner)).toBe(false);
}

async function expectKept(ages: { idleS: number; absoluteS: number }) {
  const owner = await signOutBesides(ages);
  expect(revoked).toEqual([]);
  expect(await hasToken(owner)).toBe(true);
}

test("logout.last_browser_ignores_idle_expired", () =>
  expectRevoked({ idleS: LIMITS.idleS + 60, absoluteS: LIMITS.absoluteS }));

test("logout.last_browser_ignores_absolute_expired", () => expectRevoked({ idleS: 60, absoluteS: 30 }));

test("logout.last_browser_counts_inside_idle", () =>
  expectKept({ idleS: LIMITS.idleS - INSIDE_S, absoluteS: LIMITS.absoluteS }));

test("logout.last_browser_counts_inside_absolute", () => expectKept({ idleS: 60, absoluteS: 60 + INSIDE_S }));

test("logout.remaining_sessions_need_a_token_set", async () => {
  const owner = newDid();
  await open(owner);
  const count = (tx: SessionDb) => remainingSessions(tx, owner, LIMITS.idleS);
  expect(await withTransaction(webPool, null, count)).toBe(0);
  await tokenSets.set(owner, { authMethod: { method: "private_key_jwt", kid: "A" } });
  expect(await withTransaction(webPool, null, count)).toBe(1);
});
