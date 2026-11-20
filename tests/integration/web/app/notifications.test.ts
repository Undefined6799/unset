// P2.27 (ADR 0079): the bell and the notifications page on the built web server. Postgres as `web` (TE-2). A member's
// browsers are stored grants and sessions, as own-page.test.ts makes them; a second session of the same DID is a
// sign-in on another device, which the first browser is told about and the second is not.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import { createOAuthSessionStore, createPool, withClient, withTransaction } from "@unset/infrastructure-postgres";
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
  service: "web-notifications-test",
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

let dids = 0;
function nextDid(): Did {
  dids += 1;
  const parsed = parseDid(`did:plc:${"n".repeat(23)}${"abcdefghijklmnopqrstuvwxyz234567"[dids]}`);
  if (parsed === null) throw new Error("test DID did not parse");
  return parsed;
}

/** A member past the app gate with `browsers` sessions, oldest first, each signed in a moment after the last. */
async function member(browsers: number): Promise<{ did: Did; cookies: string[] }> {
  const did = nextDid();
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
  const cookies: string[] = [];
  for (let n = 0; n < browsers; n += 1) {
    const created = await withTransaction(pool, null, (tx) => sessions.create(tx, did));
    cookies.push(`__Host-sid=${created.cookieValue}`);
    await new Promise((done) => setTimeout(done, 5));
  }
  await readyMember(pool, did);
  return { did, cookies };
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

const get = (path: string, cookie?: string) =>
  web.fetch(path, { headers: { "x-forwarded-for": clientAddress(), ...(cookie === undefined ? {} : { cookie }) } });
const post = (path: string, fields: Record<string, string>, cookie: string, origin = ORIGIN) =>
  web.fetch(path, {
    method: "POST",
    body: new URLSearchParams(fields).toString(),
    headers: {
      "x-forwarded-for": clientAddress(),
      origin,
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
      cookie,
    },
  });
const html = async (path: string, cookie: string) => (await get(path, cookie)).text();
/** The exact times the page's forms carry, once each (the bell and the page both list them, newest first). */
const listed = (page: string): string[] => [
  ...new Set([...page.matchAll(/name="at" value="([^"]+)"/g)].map((m) => m[1] ?? "")),
];
/** The bell's count, as its accessible name reads it. */
const UNREAD = /Notifications, (?:\d+|9\+) unread/;
const SIGN_IN = "New sign-in to your account";

describe("the bell and the notifications page", () => {
  test("notifications.requires_session: a visitor goes to sign in, and the bell asks them to", async () => {
    const response = await get("/notifications");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?next=%2Fnotifications");
    expect(await (await get("/legal/terms")).text()).toContain("Sign in to see your notifications.");
  });

  test("notifications.sign_in_shows_on_the_older_browser_with_its_count", async () => {
    const { cookies } = await member(2);
    const [phone, laptop] = cookies as [string, string];
    const page = await html("/notifications", phone);
    expect(page).toContain(SIGN_IN);
    // The bell on every page: the count in the button's name, and the newest few.
    expect(page).toContain("Notifications, 1 unread");
    expect(listed(page)[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    const other = await html("/notifications", laptop);
    expect(other).not.toContain(SIGN_IN);
    expect(other).toContain("No new notifications.");
  });

  test("notifications.denial: another member's sign-ins never show", async () => {
    const mine = await member(1);
    await member(2);
    const page = await html("/notifications", mine.cookies[0] as string);
    expect(page).not.toContain(SIGN_IN);
    expect(page).not.toMatch(UNREAD);
  });

  test("notifications.viewing_changes_nothing", async () => {
    const { cookies } = await member(2);
    const phone = cookies[0] as string;
    for (let n = 0; n < 3; n += 1) await html("/notifications", phone);
    expect(await html("/notifications", phone)).toContain(SIGN_IN);
  });

  test("notifications.open: it is gone and the browser goes to Settings, Account", async () => {
    const { cookies } = await member(2);
    const phone = cookies[0] as string;
    const [at] = listed(await html("/notifications", phone));
    const response = await post("/notifications?/open", { kind: "sign_in", at: at as string }, phone);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/settings/account");
    const page = await html("/notifications", phone);
    expect(page).not.toContain(SIGN_IN);
    expect(page).not.toMatch(UNREAD);
  });

  test("notifications.read_all_twice_and_rapid_opens_change_nothing_more", async () => {
    const { cookies } = await member(3);
    const phone = cookies[0] as string;
    const times = listed(await html("/notifications", phone));
    expect(times).toHaveLength(2);
    const fields = { at: times[0] as string, return: "/settings/account" };
    const sent = await Promise.all([1, 2, 3].map(() => post("/notifications?/readAll", fields, phone)));
    for (const response of sent) {
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/settings/account");
    }
    // A stale tab then opens the older one: nothing comes back.
    await post("/notifications?/open", { kind: "sign_in", at: times[1] as string }, phone);
    expect(await html("/notifications", phone)).not.toContain(SIGN_IN);
  });

  test("notifications.read_all_keeps_a_sign_in_that_came_after_the_list", async () => {
    const { did, cookies } = await member(2);
    const phone = cookies[0] as string;
    const [shown] = listed(await html("/notifications", phone));
    await withTransaction(pool, null, (tx) => sessions.create(tx, did));
    await post("/notifications?/readAll", { at: shown as string }, phone);
    expect(listed(await html("/notifications", phone))).toHaveLength(1);
  });

  test("notifications.bad_forms_change_nothing", async () => {
    const { cookies } = await member(2);
    const phone = cookies[0] as string;
    for (const fields of [
      { kind: "sign_in", at: "2099-01-01T00:00:00Z" },
      { kind: "sign_in", at: "not a time" },
      { kind: "sign_in" },
      { kind: "other", at: "2026-11-20T20:00:00.000000Z" },
    ]) {
      const response = await post("/notifications?/open", fields, phone);
      expect(response.headers.get("location"), JSON.stringify(fields)).toBe("/notifications");
    }
    const outside = await post("/notifications?/readAll", { return: "https://evil.test/" }, phone);
    expect(outside.headers.get("location")).toBe("/notifications");
    expect(await html("/notifications", phone)).toContain(SIGN_IN);
  });

  test("notifications.cross_site: a POST from another site is refused and marks nothing", async () => {
    const { cookies } = await member(2);
    const phone = cookies[0] as string;
    const [at] = listed(await html("/notifications", phone));
    const response = await post(
      "/notifications?/open",
      { kind: "sign_in", at: at as string },
      phone,
      "https://evil.test",
    );
    expect(response.status).toBe(403);
    expect(await html("/notifications", phone)).toContain(SIGN_IN);
  });

  test("notifications.privacy_notice: a changed notice is listed, and opening it dismisses it", async () => {
    const { did, cookies } = await member(1);
    const phone = cookies[0] as string;
    await withClient(pool, null, (db) =>
      db.query("UPDATE app.account SET privacy_version = 'an-older-notice' WHERE did = $1", [did]),
    );
    const page = await html("/notifications", phone);
    expect(page).toContain("We updated our privacy notice");
    const version = /name="version" value="([^"]+)"/.exec(page)?.[1];
    expect(version).toBeDefined();
    const response = await post("/notifications?/open", { kind: "privacy_notice", version: version as string }, phone);
    expect(response.headers.get("location")).toBe("/legal/privacy");
    expect(await html("/notifications", phone)).not.toContain("We updated our privacy notice");
  });

  test("notifications.no_script: the page and the bell are plain forms", async () => {
    const { cookies } = await member(2);
    const page = await html("/notifications", cookies[0] as string);
    expect(page).toMatch(/<form method="POST" action="\/notifications\?\/open">/);
    expect(page).toMatch(/<form method="POST" action="\/notifications\?\/readAll">/);
    // With no script the time reads in UTC.
    expect(page).toMatch(/<time datetime="[^"]+">[^<]+ UTC<\/time>/);
  });
});
