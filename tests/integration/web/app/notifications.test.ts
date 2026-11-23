// P2.27 (ADR 0079 and 0081): the bell and the notifications page on the built web server, over the inbox. Postgres as `web`
// (TE-2). A member's browsers are stored grants and sessions, as own-page.test.ts makes them; a sign-in on another
// device is a session made with its notification in one transaction, as the OAuth callback does it, which the older
// browser is told about and the new one is not.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { relative } from "node:path";
import { type Did, PRIVACY_VERSION, parseDid } from "@unset/domains-identity";
import type { SavedSession } from "@unset/infrastructure-pds";
import {
  createNotificationStore,
  createOAuthSessionStore,
  createPool,
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
const inbox = createNotificationStore();

let dids = 0;
function nextDid(): Did {
  dids += 1;
  const parsed = parseDid(`did:plc:${"n".repeat(23)}${"abcdefghijklmnopqrstuvwxyz234567"[dids]}`);
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

/** Another device signs in: its session and its notification in one transaction, as oauth-callback.ts does. */
async function signInElsewhere(did: Did): Promise<string> {
  const created = await withTransaction(pool, null, async (tx) => {
    const session = await sessions.create(tx, did);
    await inbox.insert(tx, did, { reason: "sign_in", olderSessionsOnly: true });
    return session;
  });
  await readyMember(pool, did);
  await new Promise((done) => setTimeout(done, 3));
  return `__Host-sid=${created.cookieValue}`;
}

const notice = (did: Did, version: string) =>
  withClient(pool, null, (db) =>
    inbox.insert(db, did, { reason: "privacy_notice", topic: version, dedupeKey: `privacy_notice:${version}` }),
  );

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
/** A visit as a browser sends it, with its Fetch Metadata: from our own page unless `extra` says otherwise. */
const visit = async (
  path: string,
  cookie: string,
  extra: Record<string, string> = { "sec-fetch-site": "same-origin" },
) => (await web.fetch(path, { headers: { "x-forwarded-for": clientAddress(), cookie, ...extra } })).text();
/** The ids the page's forms carry, once each (the bell and the page both list them, newest first). */
const listed = (page: string): string[] => [
  ...new Set([...page.matchAll(/name="(?:id|upTo)" value="([^"]+)"/g)].map((m) => m[1] ?? "")),
];
/** The bell's count, as its accessible name reads it. */
const WAITING = /Notifications, (?:\d+|9\+) waiting/;
const SIGN_IN = "New sign-in to your account";

describe("the bell and the notifications page", () => {
  test("notifications.requires_session: a visitor goes to sign in, and the bell asks them to", async () => {
    const response = await get("/notifications");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?next=%2Fnotifications");
    // A page with no script draws the bell as a link to the page, which sends a visitor to sign in (ADR 0108).
    expect(await (await get("/legal/terms")).text()).toMatch(/<a [^>]*href="\/notifications"/);
  });

  test("notifications.sign_in_shows_on_the_older_browser_with_its_count", async () => {
    const { did, cookie: laptop } = await member();
    const phone = await signInElsewhere(did);
    // The bell on every page: the count in the button's name, and the newest few.
    expect(await html("/legal/terms", laptop)).toContain("Notifications, 1 waiting");
    const page = await html("/notifications", laptop);
    expect(page).toContain(SIGN_IN);
    expect(listed(page)[0]).toMatch(/^[0-9a-f-]{36}$/);
    const other = await html("/notifications", phone);
    expect(other).not.toContain(SIGN_IN);
    expect(other).toContain("No notifications.");
  });

  test("notifications.denial: another member's notifications never show, and their ids dismiss nothing", async () => {
    const alice = await member();
    await signInElsewhere(alice.did);
    const [id] = listed(await html("/notifications", alice.cookie));
    const bob = await member();
    const page = await html("/notifications", bob.cookie);
    expect(page).not.toContain(SIGN_IN);
    expect(page).not.toMatch(WAITING);
    expect(await html(`/notifications?n=${id}`, bob.cookie)).not.toContain(SIGN_IN);
    const dismissed = await post("/notifications?/dismiss", { id: id as string }, bob.cookie);
    expect(dismissed.headers.get("location")).toBe("/notifications");
    await post("/notifications?/dismissAll", { upTo: id as string }, bob.cookie);
    expect(await html("/notifications", alice.cookie)).toContain(SIGN_IN);
  });

  test("notifications.the_new_browser_cannot_clear_the_alert", async () => {
    const { did, cookie: laptop } = await member();
    const thief = await signInElsewhere(did);
    const [id] = listed(await html("/notifications", laptop));
    await post("/notifications?/dismiss", { id: id as string }, thief);
    await post("/notifications?/dismissAll", { upTo: id as string }, thief);
    expect(await html("/notifications", laptop)).toContain(SIGN_IN);
  });

  test("notifications.opening_the_page_clears_the_count_on_every_browser_until_a_newer_entry", async () => {
    // ADR 0085 (Alex 2026-11-21 05:16Z): seeing the list is acknowledging it; the entries stay until dismissed.
    // ADR 0090 (Alex 2026-11-21 19:36Z): seen once is seen on the whole account.
    const { did, cookie: laptop } = await member();
    const created = await withTransaction(pool, null, (tx) => sessions.create(tx, did));
    const phone = `__Host-sid=${created.cookieValue}`;
    await notice(did, "seen-1");
    expect(await html("/legal/terms", laptop)).toContain("Notifications, 1 waiting");
    expect(await html("/legal/terms", phone)).toContain("Notifications, 1 waiting");
    const page = await visit("/notifications", laptop);
    expect(page).not.toMatch(WAITING); // the bell on the page itself reads nothing waiting
    expect(page).toContain("Read the privacy notice");
    expect(await html("/legal/terms", laptop)).not.toMatch(WAITING);
    expect(await html("/legal/terms", phone)).not.toMatch(WAITING);
    await new Promise((done) => setTimeout(done, 3));
    await notice(did, "seen-2");
    expect(await html("/legal/terms", laptop)).toContain("Notifications, 1 waiting");
    expect(await html("/legal/terms", phone)).toContain("Notifications, 1 waiting");
  });

  test("notifications.a_sign_in_alert_seen_on_an_older_browser_clears_on_every_browser", async () => {
    // ADR 0108 (Alex 2026-11-21 23:56Z): an alert shown on any browser signed in before it is seen on all of them;
    // the browser that signed in never sees its own alert, so a look there clears it nowhere.
    const { did, cookie: laptop } = await member();
    const created = await withTransaction(pool, null, (tx) => sessions.create(tx, did));
    const phone = `__Host-sid=${created.cookieValue}`;
    const thief = await signInElsewhere(did);
    await new Promise((done) => setTimeout(done, 3));
    await notice(did, "after-sign-in");
    await visit("/notifications", thief); // sees the notice, not the alert
    expect(await html("/legal/terms", laptop)).toContain("Notifications, 1 waiting");
    expect(await html("/legal/terms", phone)).toContain("Notifications, 1 waiting");
    await visit("/notifications", laptop);
    expect(await html("/legal/terms", laptop)).not.toMatch(WAITING);
    expect(await html("/legal/terms", phone)).not.toMatch(WAITING);
    expect(await html("/notifications", phone)).toContain(SIGN_IN); // still listed until dismissed
  });

  test("notifications.each_alert_clears_once_a_browser_that_may_see_it_has_shown_it", async () => {
    // The staging test of 2026-11-21 23:50Z: A, then B signs in, then C. A is told of B and C, B of C only.
    const { did, cookie: a } = await member();
    const b = await signInElsewhere(did);
    const c = await signInElsewhere(did);
    expect(await html("/legal/terms", a)).toContain("Notifications, 2 waiting");
    expect(await html("/legal/terms", b)).toContain("Notifications, 1 waiting");
    await visit("/notifications", b);
    // B has shown C's alert, so it is seen on A too; B's own alert only A may see, so A still counts it.
    expect(await html("/legal/terms", a)).toContain("Notifications, 1 waiting");
    expect(await html("/legal/terms", b)).not.toMatch(WAITING);
    await visit("/notifications", c); // C sees neither alert
    expect(await html("/legal/terms", a)).toContain("Notifications, 1 waiting");
    await visit("/notifications", a);
    expect(await html("/legal/terms", a)).not.toMatch(WAITING);
  });

  test("notifications.an_intruder_cannot_clear_the_alert_about_its_first_sign_in", async () => {
    // ADR 0108: the intruder signs in twice. Its first browser is told of the second, so its look clears that alert,
    // but no browser of the intruder was signed in before the first, so that alert stays for the member.
    const { did, cookie: laptop } = await member();
    const first = await signInElsewhere(did);
    const second = await signInElsewhere(did);
    expect(await html("/legal/terms", laptop)).toContain("Notifications, 2 waiting");
    await visit("/notifications", first);
    await visit("/notifications", second);
    expect(await html("/legal/terms", laptop)).toContain("Notifications, 1 waiting");
    expect(await html("/notifications", laptop)).toContain(SIGN_IN);
  });

  test("notifications.the_bell_is_a_link_to_the_page_where_no_script_runs", async () => {
    // ADR 0108 point 3: a page that runs no script (home, a profile, the legal pages) cannot mark what a popover showed,
    // so its bell is a plain link to the page, whose visit marks it; a page with script keeps the popover.
    const { did, cookie } = await member();
    await signInElsewhere(did);
    for (const path of ["/", "/legal/terms"]) {
      const page = await html(path, cookie);
      expect(page).toMatch(/<a [^>]*href="\/notifications"[^>]*>(?:(?!<\/a>).)*Notifications, 1 waiting/s);
      expect(page).not.toContain('id="notifications-menu"');
      expect(page).not.toContain("?/seen");
    }
    const app = await html("/notifications/sign-ins", cookie);
    expect(app).toContain('id="notifications-menu"');
    expect(app).toContain('action="/notifications?/seen"');
  });

  test("notifications.only_a_visit_from_our_pages_or_a_typed_address_marks_seen", async () => {
    // Review of #1910: with SameSite=Lax another site's link still carries the cookie, so it must not clear the badge.
    const { did, cookie } = await member();
    await signInElsewhere(did);
    const ignored: Record<string, string>[] = [
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      {}, // no Fetch Metadata at all
      { "sec-fetch-site": "same-origin", "sec-purpose": "prefetch" },
      { "sec-fetch-site": "same-origin", "sec-purpose": "prefetch;prerender" },
      { "sec-fetch-site": "none", purpose: "prefetch" },
    ];
    for (const headers of ignored) {
      const page = await visit("/notifications", cookie, headers);
      expect(page).toContain(SIGN_IN);
      expect(page).toContain("Notifications, 1 waiting");
    }
    expect(await html("/legal/terms", cookie)).toContain("Notifications, 1 waiting");
    await visit("/notifications", cookie, { "sec-fetch-site": "none" }); // typed or bookmarked
    expect(await html("/legal/terms", cookie)).not.toMatch(WAITING);
  });

  test("notifications.opening_the_bell_marks_seen_only_what_this_browser_may_see", async () => {
    const { did, cookie: laptop } = await member();
    const thief = await signInElsewhere(did);
    // A page with script draws the bell's panel and its hidden form; the sign-ins tab marks nothing on its own.
    const [id] = listed(await html("/notifications/sign-ins", laptop));
    // The browser the sign-in is about cannot see it, so its mark does not clear the laptop's badge.
    const refused = await post("/notifications?/seen", { upTo: id as string }, thief);
    expect(refused.status).toBe(303);
    expect(await html("/legal/terms", laptop)).toContain("Notifications, 1 waiting");
    // Another site's form is refused by the gate.
    const forged = await post("/notifications?/seen", { upTo: id as string }, laptop, "https://evil.example");
    expect(forged.status).toBe(403);
    expect(await html("/legal/terms", laptop)).toContain("Notifications, 1 waiting");
    await post("/notifications?/seen", { upTo: id as string }, laptop);
    const after = await html("/notifications/sign-ins", laptop);
    expect(after).not.toMatch(WAITING);
    expect(after).toContain(SIGN_IN); // still listed in the bell's panel until dismissed
  });

  test("notifications.viewing_or_showing_an_entry_changes_nothing", async () => {
    const { did, cookie } = await member();
    await signInElsewhere(did);
    const [id] = listed(await html("/notifications", cookie));
    for (let n = 0; n < 3; n += 1) await html(`/notifications?n=${id}`, cookie);
    expect(await html("/notifications", cookie)).toContain(SIGN_IN);
  });

  test("notifications.an_entry_is_shown_by_its_link_with_its_button_to_the_reasons_page", async () => {
    const { did, cookie } = await member();
    await signInElsewhere(did);
    await notice(did, "an-older-notice");
    const [newest, older] = listed(await html("/notifications", cookie));
    // The newest is shown when the address names none; a row's link shows its own.
    const first = await html("/notifications", cookie);
    expect(first).toContain("Read the privacy notice");
    expect(first).not.toContain("Review sign-ins");
    const page = await html(`/notifications?n=${older}`, cookie);
    expect(page).toMatch(/href="\/settings\/account"(?:[^<]|<!--[^>]*-->)*Review sign-ins/);
    expect(page).not.toContain("Read the privacy notice");
    expect(page).toContain(`href="/notifications?n=${newest}"`);
    // An id that is not listed shows the newest.
    expect(await html(`/notifications?n=${crypto.randomUUID()}`, cookie)).toContain("Read the privacy notice");
  });

  test("notifications.dismiss: the named entries go and the browser goes back to the list", async () => {
    const { did, cookie } = await member();
    await signInElsewhere(did);
    await signInElsewhere(did);
    await notice(did, "an-older-notice");
    const [notice1, ...signIns] = listed(await html("/notifications", cookie));
    const body = new URLSearchParams(signIns.map((id) => ["id", id]));
    body.append("return", "/notifications");
    const response = await web.fetch("/notifications?/dismiss", {
      method: "POST",
      body: body.toString(),
      headers: {
        "x-forwarded-for": clientAddress(),
        origin: ORIGIN,
        accept: "text/html",
        "content-type": "application/x-www-form-urlencoded",
        cookie,
      },
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/notifications");
    const page = await html("/notifications", cookie);
    expect(page).not.toContain(SIGN_IN);
    expect(listed(page)).toEqual([notice1]);
  });

  test("notifications.dismiss_selected_of_a_full_page_fits_the_form_limit", async () => {
    const { did, cookie } = await member();
    for (let n = 0; n < 50; n += 1) {
      await withClient(pool, null, (db) => inbox.insert(db, did, { reason: "privacy_notice", topic: `v${n}` }));
    }
    const ids = listed(await html("/notifications", cookie));
    expect(ids).toHaveLength(50);
    const body = new URLSearchParams(ids.map((id) => ["id", id]));
    body.append("return", "/notifications");
    const response = await web.fetch("/notifications?/dismiss", {
      method: "POST",
      body: body.toString(),
      headers: {
        "x-forwarded-for": clientAddress(),
        origin: ORIGIN,
        accept: "text/html",
        "content-type": "application/x-www-form-urlencoded",
        cookie,
      },
    });
    expect(response.status).toBe(303);
    expect(await html("/notifications", cookie)).toContain("No notifications.");
  });

  test("notifications.dismiss_all_twice_and_rapid_dismisses_change_nothing_more", async () => {
    const { did, cookie } = await member();
    await signInElsewhere(did);
    await signInElsewhere(did);
    const ids = listed(await html("/notifications", cookie));
    expect(ids).toHaveLength(2);
    const fields = { upTo: ids[0] as string, return: "/settings/account" };
    const sent = await Promise.all([1, 2, 3].map(() => post("/notifications?/dismissAll", fields, cookie)));
    for (const response of sent) {
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/settings/account");
    }
    // A stale tab then dismisses the older one: it is gone, so nothing changes.
    const stale = await post("/notifications?/dismiss", { id: ids[1] as string }, cookie);
    expect(stale.headers.get("location")).toBe("/notifications");
    expect(await html("/notifications", cookie)).not.toContain(SIGN_IN);
  });

  test("notifications.dismiss_all_keeps_one_that_came_after_the_list", async () => {
    const { did, cookie } = await member();
    await signInElsewhere(did);
    const [shown] = listed(await html("/notifications", cookie));
    await signInElsewhere(did);
    await post("/notifications?/dismissAll", { upTo: shown as string }, cookie);
    expect(listed(await html("/notifications", cookie))).toHaveLength(1);
  });

  test("notifications.bad_forms_change_nothing", async () => {
    const { did, cookie } = await member();
    await signInElsewhere(did);
    for (const fields of [{ id: "not-an-id" }, { id: "" }, {}, { id: crypto.randomUUID() }]) {
      const response = await post("/notifications?/dismiss", fields as Record<string, string>, cookie);
      expect(response.headers.get("location"), JSON.stringify(fields)).toBe("/notifications");
    }
    const outside = await post("/notifications?/dismissAll", { upTo: "x", return: "https://evil.test/" }, cookie);
    expect(outside.headers.get("location")).toBe("/notifications");
    expect(await html("/notifications", cookie)).toContain(SIGN_IN);
  });

  test("notifications.cross_site: a POST from another site is refused and dismisses nothing", async () => {
    const { did, cookie } = await member();
    await signInElsewhere(did);
    const [id] = listed(await html("/notifications", cookie));
    const response = await post("/notifications?/dismiss", { id: id as string }, cookie, "https://evil.test");
    expect(response.status).toBe(403);
    expect(await html("/notifications", cookie)).toContain(SIGN_IN);
  });

  test("notifications.privacy_notice: listed once, and its button leads to the notice", async () => {
    const { did, cookie } = await member();
    await notice(did, "an-older-notice");
    await notice(did, "an-older-notice");
    const page = await html("/notifications", cookie);
    expect(page).toContain("We updated our privacy notice");
    expect(page).toMatch(/href="\/legal\/privacy"(?:[^<]|<!--[^>]*-->)*Read the privacy notice/);
    expect(listed(page)).toHaveLength(1);
  });

  test("notifications.privacy_notice: dismissing the banner withdraws the entry", async () => {
    const { did, cookie } = await member();
    await withClient(pool, null, (db) =>
      db.query("UPDATE app.account SET privacy_version = 'an-older-notice' WHERE did = $1", [did]),
    );
    await notice(did, PRIVACY_VERSION);
    expect(await html("/notifications", cookie)).toContain("We updated our privacy notice");
    const dismissed = await post(
      "/privacy-notice/seen",
      { version: PRIVACY_VERSION, return: "/notifications" },
      cookie,
    );
    expect(dismissed.status).toBe(303);
    expect(await html("/notifications", cookie)).not.toContain("We updated our privacy notice");
  });

  test("notifications.privacy_notice: dismissing it, alone or with all, records the notice as seen, so it is not sent again", async () => {
    // Codex review of 2491506: the row goes on dismiss, so the seen version is what stops the next sign-in resending it.
    for (const action of ["dismiss", "dismissAll"] as const) {
      const { did, cookie } = await member();
      await withClient(pool, null, (db) =>
        db.query("UPDATE app.account SET privacy_version = 'an-older-notice' WHERE did = $1", [did]),
      );
      await notice(did, PRIVACY_VERSION);
      const [id] = listed(await html("/notifications", cookie));
      await post(
        `/notifications?/${action}`,
        action === "dismiss" ? { id: id as string } : { upTo: id as string },
        cookie,
      );
      const { rows } = await withClient(pool, null, (db) =>
        db.query<{ seen: string | null }>(
          "SELECT privacy_notice_seen_version AS seen FROM app.account WHERE did = $1",
          [did],
        ),
      );
      expect(rows[0]?.seen, action).toBe(PRIVACY_VERSION);
    }
  });

  test("notifications.no_script: the page and the bell are plain links and forms", async () => {
    const { did, cookie } = await member();
    await signInElsewhere(did);
    const page = await html("/notifications", cookie);
    const [id] = listed(page);
    expect(page).toContain(`href="/notifications?n=${id}"`);
    expect(page).toMatch(/<form[^>]* method="POST" action="\/notifications\?\/dismiss"/);
    expect(page).toMatch(/<form method="POST" action="\/notifications\?\/dismissAll">/);
    expect(page).toMatch(/<input type="checkbox" name="id" value="[0-9a-f-]{36}"/);
    // No style attribute: the page's CSP allows none.
    expect(page).not.toMatch(/<(?:div|section|form|li)[^>]* style="/);
    // With no script the time reads in UTC.
    expect(page).toMatch(/<time datetime="[^"]+">[^<]+ UTC<\/time>/);
  });
});
