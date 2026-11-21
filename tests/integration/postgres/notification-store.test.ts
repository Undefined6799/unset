// P2.27 (infrastructure/postgres/notificationStore.ts, migration 0036, ADR 0079): the notification inbox against real
// Postgres, connected as `web` (TE-2). Every read and delete is scoped to the member and to what this browser may see;
// an entry only older browsers may see stays out of reach of the browser it is about and of every later one.
import { relative } from "node:path";
import { type Did, PRIVACY_VERSION, TERMS_VERSION } from "@unset/domains-identity";
import { BELL_READ, type Entry, notify } from "@unset/domains-notifications";
import {
  createAccountRepository,
  createNotificationStore,
  createOAuthSessionStore,
  createPool,
  type Pool,
  withClient,
  withTransaction,
} from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore } from "@unset/infrastructure-session";
import { createLogger } from "@unset/shared-log";
import { afterAll, describe, expect, inject, test } from "vitest";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const connection = { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false };
const web: Pool = createPool({ connection, service: "notification-store-test", max: 4, connectTimeoutMs: 5000 });
afterAll(() => web.end());

const store = createNotificationStore();
const quiet = createLogger({ service: "web", commit: "c".repeat(40), env: "test", write: () => undefined });
const sessions = createSessionStore({
  withDb: async () => {
    throw new Error("this file only creates sessions");
  },
  limits: { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 },
  log: quiet,
});
const accounts = createAccountRepository(web, {
  recordUnderageBlock: async () => {
    throw new Error("never blocks");
  },
});

const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 4).toString("base64") } }));
if (keyring === undefined) throw new Error("test keyring did not parse");
const tokenSets = createOAuthSessionStore({ pool: web, sealer: createSealer(keyring), log: quiet });

let dids = 0;
const nextDid = (): Did => {
  dids += 1; // one base32 letter per test DID; fewer than 32 here
  return `did:plc:${"q".repeat(23)}${"abcdefghijklmnopqrstuvwxyz234567"[dids]}` as Did;
};

/** A member with an account row (past the terms step). */
async function member(): Promise<Did> {
  const did = nextDid();
  const deadline = AbortSignal.timeout(5000);
  await accounts.confirmAdult(did, deadline);
  await accounts.acceptTerms(did, TERMS_VERSION, PRIVACY_VERSION, deadline);
  await tokenSets.set(did, { authMethod: { method: "private_key_jwt", kid: "A" } }); // so its sessions may exist
  return did;
}

/** A browser signed in as `did`, and, when `signIn`, the sign-in's notification sent in its transaction. */
async function browser(did: Did, signIn = false): Promise<Buffer> {
  const created = await withTransaction(web, null, async (tx) => {
    const session = await sessions.create(tx, did);
    if (signIn) await store.insert(tx, did, { reason: "sign_in", olderSessionsOnly: true });
    return session;
  });
  await new Promise((done) => setTimeout(done, 2)); // each browser starts after the last
  return created.idHash;
}

const db = <T>(fn: (client: Parameters<Parameters<typeof withClient>[2]>[0]) => Promise<T>) =>
  withClient(web, null, fn);
const send = (did: Did, n: Parameters<typeof store.insert>[2]) => db((c) => store.insert(c, did, n));
const list = (did: Did, idHash: Buffer, limit = 50): Promise<Entry[]> => db((c) => store.list(c, did, idHash, limit));
const reasons = async (did: Did, idHash: Buffer) => (await list(did, idHash)).map((e) => e.reason);

describe("notification store", () => {
  test("notifications.listed_newest_first_for_the_member_only", async () => {
    const [alice, bob] = [await member(), await member()];
    const [aliceBrowser, bobBrowser] = [await browser(alice), await browser(bob)];
    await send(alice, { reason: "privacy_notice", topic: "v1", dedupeKey: "privacy_notice:v1" });
    await send(alice, { reason: "sign_in" });
    await send(bob, { reason: "sign_in" });
    expect(await reasons(alice, aliceBrowser)).toEqual(["sign_in", "privacy_notice"]);
    expect(await reasons(bob, bobBrowser)).toEqual(["sign_in"]);
    // Bob's browser asking for Alice's inbox sees nothing: the session must be the member's own.
    expect(await list(alice, bobBrowser)).toEqual([]);
  });

  test("notifications.the_same_dedupe_key_keeps_one_entry", async () => {
    const did = await member();
    const me = await browser(did);
    for (let n = 0; n < 3; n += 1) await send(did, { reason: "privacy_notice", topic: "v2", dedupeKey: "k" });
    expect(await list(did, me)).toHaveLength(1);
    expect((await list(did, me))[0]?.topic).toBe("v2");
  });

  test("notifications.no_account_row_means_nothing_is_kept", async () => {
    const did = nextDid(); // a first sign-in, before the terms step
    await send(did, { reason: "sign_in" });
    expect(await db((c) => c.query("SELECT 1 FROM app.notification WHERE did = $1", [did]))).toMatchObject({
      rowCount: 0,
    });
  });

  test("notifications.a_sign_in_shows_only_on_browsers_signed_in_before_it", async () => {
    const did = await member();
    const laptop = await browser(did);
    const thief = await browser(did, true);
    const later = await browser(did);
    expect(await reasons(did, laptop)).toEqual(["sign_in"]);
    expect(await list(did, thief)).toEqual([]);
    expect(await list(did, later)).toEqual([]);
    // The browser it is about cannot dismiss it, by id or by dismissing all.
    const [entry] = await list(did, laptop);
    if (entry === undefined) throw new Error("no entry");
    expect(await db((c) => store.dismiss(c, did, thief, [entry.id]))).toEqual([]);
    await db((c) => store.dismissUpTo(c, did, thief, entry.id));
    expect(await list(did, laptop)).toHaveLength(1);
  });

  test("notifications.a_sign_in_on_a_replaced_session_still_shows_on_the_older_browser", async () => {
    // A sign-in that rotates its own browser's session (sessions.create with replacingCookie) leaves the member's
    // other browsers told; the gone session is no viewer at all.
    const did = await member();
    const laptop = await browser(did);
    await browser(did, true);
    const gone = Buffer.alloc(32, 7);
    expect(await reasons(did, laptop)).toEqual(["sign_in"]);
    expect(await list(did, gone)).toEqual([]);
  });

  test("notifications.dismissing_deletes_only_the_named_entries_and_only_once", async () => {
    const did = await member();
    const me = await browser(did);
    await send(did, { reason: "privacy_notice", topic: "v3", dedupeKey: "privacy_notice:v3" });
    await send(did, { reason: "sign_in" });
    await send(did, { reason: "sign_in" });
    const [newest, middle, older] = await list(did, me);
    if (newest === undefined || middle === undefined || older === undefined) throw new Error("three entries expected");
    const gone = await db((c) => store.dismiss(c, did, me, [older.id, middle.id]));
    expect(gone.map((e) => e.reason).sort()).toEqual(["privacy_notice", "sign_in"]);
    expect(await db((c) => store.dismiss(c, did, me, [older.id, middle.id]))).toEqual([]);
    expect(await db((c) => store.dismiss(c, did, me, []))).toEqual([]);
    expect((await list(did, me)).map((e) => e.id)).toEqual([newest.id]);
  });

  test("notifications.another_members_id_dismisses_nothing", async () => {
    const [alice, bob] = [await member(), await member()];
    const [aliceBrowser, bobBrowser] = [await browser(alice), await browser(bob)];
    await send(alice, { reason: "sign_in" });
    const [entry] = await list(alice, aliceBrowser);
    if (entry === undefined) throw new Error("no entry");
    expect(await db((c) => store.dismiss(c, bob, bobBrowser, [entry.id]))).toEqual([]);
    await db((c) => store.dismissUpTo(c, bob, bobBrowser, entry.id));
    expect(await list(alice, aliceBrowser)).toHaveLength(1);
  });

  test("notifications.dismiss_all_covers_the_list_and_none_sent_after_it", async () => {
    const did = await member();
    const me = await browser(did);
    await send(did, { reason: "sign_in" });
    await send(did, { reason: "sign_in" });
    const [newest] = await list(did, me);
    if (newest === undefined) throw new Error("no entry");
    await new Promise((done) => setTimeout(done, 2));
    await send(did, { reason: "privacy_notice", topic: "v4", dedupeKey: "privacy_notice:v4" });
    await db((c) => store.dismissUpTo(c, did, me, newest.id));
    expect(await reasons(did, me)).toEqual(["privacy_notice"]);
    // Again, or with an id already gone: nothing more.
    await db((c) => store.dismissUpTo(c, did, me, newest.id));
    expect(await reasons(did, me)).toEqual(["privacy_notice"]);
  });

  test("notifications.marking_seen_is_this_browsers_own_and_never_moves_back", async () => {
    // ADR 0085: opening the bell or the page marks what it showed seen in that browser only; the entries stay.
    const did = await member();
    const [laptop, phone] = [await browser(did), await browser(did)];
    await send(did, { reason: "privacy_notice", topic: "v1", dedupeKey: "a" });
    await new Promise((done) => setTimeout(done, 2));
    await send(did, { reason: "privacy_notice", topic: "v2", dedupeKey: "b" });
    const [newest, older] = await list(did, laptop);
    if (newest === undefined || older === undefined) throw new Error("no entries");
    await db((c) => store.markSeen(c, did, laptop, newest.id));
    expect((await list(did, laptop)).map((e) => e.seen)).toEqual([true, true]);
    expect((await list(did, phone)).map((e) => e.seen)).toEqual([false, false]);
    await new Promise((done) => setTimeout(done, 2));
    await send(did, { reason: "privacy_notice", topic: "v3", dedupeKey: "c" });
    // An older id never takes the mark back, and a new entry counts again.
    await db((c) => store.markSeen(c, did, laptop, older.id));
    expect((await list(did, laptop)).map((e) => e.seen)).toEqual([false, true, true]);
  });

  test("notifications.a_later_browser_or_another_member_marks_nothing_seen", async () => {
    const did = await member();
    const laptop = await browser(did);
    const thief = await browser(did, true);
    const [signIn] = await list(did, laptop);
    if (signIn?.reason !== "sign_in") throw new Error("no sign-in entry");
    // The browser the sign-in is about cannot see it, so it cannot mark it, and its own mark is not the laptop's.
    await db((c) => store.markSeen(c, did, thief, signIn.id));
    const other = await member();
    const stranger = await browser(other);
    await db((c) => store.markSeen(c, other, stranger, signIn.id));
    await db((c) => store.markSeen(c, did, stranger, signIn.id));
    expect((await list(did, laptop)).map((e) => e.seen)).toEqual([false]);
    const marks = await db((c) =>
      c.query<{ marked: number }>(
        "SELECT count(*)::int AS marked FROM app.session WHERE did = ANY($1) AND notifications_seen_at IS NOT NULL",
        [[did, other]],
      ),
    );
    expect(marks.rows[0]?.marked).toBe(0);
  });

  test("notifications.a_source_withdraws_by_its_key", async () => {
    const did = await member();
    const me = await browser(did);
    await send(did, { reason: "privacy_notice", topic: "v5", dedupeKey: "privacy_notice:v5" });
    await send(did, { reason: "sign_in" });
    await db((c) => store.withdraw(c, did, "privacy_notice:v5"));
    expect(await reasons(did, me)).toEqual(["sign_in"]);
  });

  test("notifications.the_sweep_deletes_what_is_past_its_days", async () => {
    const did = await member();
    const me = await browser(did);
    await send(did, { reason: "sign_in" });
    await db((c) => store.sweep(c));
    expect(await list(did, me)).toHaveLength(1); // a fresh entry is inside KEEP_DAYS
    await new Promise((done) => setTimeout(done, 2));
    expect(await db((c) => store.sweep(c, 0))).toBeGreaterThanOrEqual(1);
    expect(await list(did, me)).toEqual([]);
  });

  test("notifications.web_may_not_backdate_or_edit_a_row", async () => {
    const did = await member();
    await expect(
      db((c) => c.query("INSERT INTO app.notification (did, reason, created_at) VALUES ($1, 'sign_in', now())", [did])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db((c) => c.query("UPDATE app.notification SET reason = 'sign_in' WHERE did = $1", [did])),
    ).rejects.toThrow(/permission denied/);
  });

  test("notifications.the_table_refuses_an_unknown_reason", async () => {
    const did = await member();
    await expect(db((c) => store.insert(c, did, { reason: "chat" as "sign_in" }))).rejects.toThrow(/check constraint/);
  });

  test("notifications.the_session_read_brings_the_bell_by_the_same_rule", async () => {
    // The bell comes with the session read (infrastructure/session/store.ts) through app.inbox, as the list does.
    const reader = createSessionStore({
      withDb: (deadline, fn) => withClient(web, deadline, fn),
      limits: { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 },
      log: quiet,
    });
    const did = await member();
    const laptop = await withTransaction(web, null, (tx) => sessions.create(tx, did));
    await new Promise((done) => setTimeout(done, 2));
    const thief = await withTransaction(web, null, async (tx) => {
      const session = await sessions.create(tx, did);
      await store.insert(tx, did, { reason: "sign_in", olderSessionsOnly: true });
      return session;
    });
    for (let n = 0; n < BELL_READ + 2; n += 1) {
      await send(did, { reason: "privacy_notice", topic: `v${n}`, dedupeKey: `k${n}` });
    }
    const bell = async (cookieValue: string) =>
      (await reader.read({ key: {}, cookieValue, deadline: null })).session?.inbox ?? [];
    const laptopBell = await bell(laptop.cookieValue);
    expect(laptopBell.map((e) => e.id)).toEqual((await list(did, laptop.idHash, BELL_READ)).map((e) => e.id));
    // What this browser has seen comes with it too (ADR 0085), by the same view.
    const [top] = laptopBell;
    if (top === undefined) throw new Error("no bell");
    await db((c) => store.markSeen(c, did, laptop.idHash, top.id));
    const seenBell = await bell(laptop.cookieValue);
    expect(seenBell.every((e) => e.seen)).toBe(true);
    expect((await bell(thief.cookieValue)).some((e) => e.seen)).toBe(false);
    expect(laptopBell).toHaveLength(BELL_READ);
    expect((await bell(thief.cookieValue)).map((e) => e.reason)).not.toContain("sign_in");
    expect((await bell(thief.cookieValue)).map((e) => e.sentAt)).toEqual(
      (await list(did, thief.idHash, BELL_READ)).map((e) => new Date(Math.floor(e.sentAt.getTime()))),
    );
  });

  test("notifications.notify_refuses_before_the_store_is_asked", async () => {
    const did = await member();
    const me = await browser(did);
    const outbox = { insert: (n: Parameters<typeof store.insert>[2]) => send(did, n) };
    expect(await notify(outbox, { reason: "sign_in", topic: "has space" })).toMatchObject({ ok: false });
    expect(await list(did, me)).toEqual([]);
  });
});
