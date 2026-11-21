// P2.27c (ADR 0082): the Sign-in history tab on the built web server. Postgres as `web` (TE-2). A member's browsers are
// stored grants and sessions, as own-page.test.ts makes them; a sign-in is a session made with its history row in one
// transaction, as the OAuth callback does it. Any of the member's browsers may delete any entry (Alex 2026-11-21).
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import {
  createOAuthSessionStore,
  createPool,
  createSignInStore,
  withClient,
  withTransaction,
} from "@unset/infrastructure-postgres";
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
  service: "web-sign-ins-test",
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
const history = createSignInStore();

let dids = 0;
function nextDid(): Did {
  dids += 1;
  const parsed = parseDid(`did:plc:${"s".repeat(23)}${"abcdefghijklmnopqrstuvwxyz234567"[dids]}`);
  if (parsed === null) throw new Error("test DID did not parse");
  return parsed;
}

/** A member past the app gate with one browser. */
async function member(): Promise<{ did: Did; cookie: string }> {
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
  const created = await withTransaction(pool, null, (tx) => sessions.create(tx, did));
  await readyMember(pool, did);
  await new Promise((done) => setTimeout(done, 3));
  return { did, cookie: `__Host-sid=${created.cookieValue}` };
}

/** Another device signs in: its session and its history row in one transaction, as oauth-callback.ts does. */
async function signInElsewhere(did: Did): Promise<string> {
  const created = await withTransaction(pool, null, async (tx) => {
    const session = await sessions.create(tx, did);
    await history.record(tx, did);
    return session;
  });
  await readyMember(pool, did);
  await new Promise((done) => setTimeout(done, 3));
  return `__Host-sid=${created.cookieValue}`;
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

const PAGE = "/notifications/sign-ins";
const get = (path: string, cookie?: string) =>
  web.fetch(path, { headers: { "x-forwarded-for": clientAddress(), ...(cookie === undefined ? {} : { cookie }) } });
const send = (path: string, body: URLSearchParams, cookie: string, origin = ORIGIN) =>
  web.fetch(path, {
    method: "POST",
    body: body.toString(),
    headers: {
      "x-forwarded-for": clientAddress(),
      origin,
      accept: "text/html",
      "content-type": "application/x-www-form-urlencoded",
      cookie,
    },
  });
const post = (path: string, fields: Record<string, string>, cookie: string, origin = ORIGIN) =>
  send(path, new URLSearchParams(fields), cookie, origin);
const html = async (path: string, cookie: string) => (await get(path, cookie)).text();
/** The sign-ins the page lists, newest first: each row's own Delete form carries its id once. */
const listed = (page: string): string[] => [
  ...new Set([...page.matchAll(/<input type="hidden" name="id" value="([0-9a-f-]{36})"/g)].map((m) => m[1] ?? "")),
];
const NONE = "No sign-ins in the last 30 days.";

describe("the Sign-in history tab", () => {
  test("sign_ins.requires_session: a visitor goes to sign in", async () => {
    const response = await get(PAGE);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?next=%2Fnotifications%2Fsign-ins");
  });

  test("sign_ins.lists_every_sign_in_of_the_member_newest_first_on_any_browser", async () => {
    const { did, cookie: laptop } = await member();
    expect(await html(PAGE, laptop)).toContain(NONE);
    const phone = await signInElsewhere(did);
    await signInElsewhere(did);
    const seen = listed(await html(PAGE, laptop));
    expect(seen).toHaveLength(2);
    expect(listed(await html(PAGE, phone))).toEqual(seen);
    expect(await html(PAGE, laptop)).toContain("2 sign-ins");
  });

  test("sign_ins.denial: another member's sign-ins never show, and their ids delete nothing", async () => {
    const alice = await member();
    await signInElsewhere(alice.did);
    const [id] = listed(await html(PAGE, alice.cookie));
    const bob = await member();
    expect(await html(PAGE, bob.cookie)).toContain(NONE);
    const deleted = await post(`${PAGE}?/delete`, { id: id as string }, bob.cookie);
    expect(deleted.status).toBe(303);
    expect(deleted.headers.get("location")).toBe(PAGE);
    await post(`${PAGE}?/deleteAll`, { upTo: id as string }, bob.cookie);
    expect(listed(await html(PAGE, alice.cookie))).toEqual([id]);
  });

  test("sign_ins.delete_one_then_all_and_again_changes_nothing_more", async () => {
    const { did, cookie } = await member();
    for (let n = 0; n < 3; n += 1) await signInElsewhere(did);
    const [newest, middle, oldest] = listed(await html(PAGE, cookie));
    const sent = await Promise.all([1, 2].map(() => post(`${PAGE}?/delete`, { id: middle as string }, cookie)));
    for (const response of sent) expect(response.headers.get("location")).toBe(PAGE);
    expect(listed(await html(PAGE, cookie))).toEqual([newest, oldest]);
    for (let n = 0; n < 2; n += 1) await post(`${PAGE}?/deleteAll`, { upTo: newest as string }, cookie);
    expect(await html(PAGE, cookie)).toContain(NONE);
  });

  test("sign_ins.delete_all_keeps_one_that_came_after_the_page", async () => {
    const { did, cookie } = await member();
    await signInElsewhere(did);
    const [shown] = listed(await html(PAGE, cookie));
    await signInElsewhere(did);
    await post(`${PAGE}?/deleteAll`, { upTo: shown as string }, cookie);
    const left = listed(await html(PAGE, cookie));
    expect(left).toHaveLength(1);
    expect(left).not.toContain(shown);
  });

  test("sign_ins.delete_selected_of_a_full_page_fits_the_form_limit", async () => {
    const { did, cookie } = await member();
    for (let n = 0; n < 51; n += 1) await withClient(pool, null, (db) => history.record(db, did));
    const page = await html(PAGE, cookie);
    const ids = listed(page);
    expect(ids).toHaveLength(50);
    expect(page).toContain("Older sign-ins are not shown.");
    const response = await send(`${PAGE}?/delete`, new URLSearchParams(ids.map((id) => ["id", id])), cookie);
    expect(response.status).toBe(303);
    expect(listed(await html(PAGE, cookie))).toHaveLength(1);
  });

  test("sign_ins.bad_forms_change_nothing", async () => {
    const { did, cookie } = await member();
    await signInElsewhere(did);
    for (const fields of [{ id: "not-an-id" }, { id: "" }, {}, { id: crypto.randomUUID() }]) {
      const response = await post(`${PAGE}?/delete`, fields as Record<string, string>, cookie);
      expect(response.headers.get("location"), JSON.stringify(fields)).toBe(PAGE);
    }
    for (const fields of [{ upTo: "x" }, {}, { upTo: crypto.randomUUID() }]) {
      await post(`${PAGE}?/deleteAll`, fields as Record<string, string>, cookie);
    }
    expect(listed(await html(PAGE, cookie))).toHaveLength(1);
  });

  test("sign_ins.cross_site: a POST from another site is refused and deletes nothing", async () => {
    const { did, cookie } = await member();
    await signInElsewhere(did);
    const [id] = listed(await html(PAGE, cookie));
    const response = await post(`${PAGE}?/delete`, { id: id as string }, cookie, "https://evil.test");
    expect(response.status).toBe(403);
    expect(listed(await html(PAGE, cookie))).toEqual([id]);
  });

  test("sign_ins.no_script: tabs are links, every action a form, times in UTC, no style attributes", async () => {
    const { did, cookie } = await member();
    await signInElsewhere(did);
    const page = await html(PAGE, cookie);
    expect(page).toMatch(/href="\/notifications\/sign-ins"[^>]*aria-current="page"/);
    expect(page).toMatch(/<form[^>]* method="POST" action="\/notifications\/sign-ins\?\/delete"/);
    expect(page).toMatch(/<form method="POST" action="\/notifications\/sign-ins\?\/deleteAll">/);
    expect(page).toMatch(/<input type="checkbox" name="id" value="[0-9a-f-]{36}"[^>]* form="sign-ins-delete-selected"/);
    expect(page).toMatch(/<time datetime="[^"]+"[^>]*>[^<]+ UTC<\/time>/);
    expect(page).toContain("Only the time of each sign-in is kept");
    expect(page).not.toMatch(/<(?:div|section|form|li)[^>]* style="/);
    expect(await html("/notifications", cookie)).toMatch(/href="\/notifications\/sign-ins"/);
  });
});
