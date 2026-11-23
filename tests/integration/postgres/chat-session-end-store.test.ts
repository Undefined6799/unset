// Ending chat when web ends a session (infrastructure/postgres/chatSessionEndStore.ts, migration 0052; ADR 0095
// decision 5, ADR 0096 decision 7), against real Postgres connected as `web` and as the door's `chat_auth` (TE-2).
// In web's own transaction, Log out queues the devices that web session signed in, and a revoked grant every device
// of the member, for chat-admin's session.end. A ticket from an ended session can then neither add nor renew an entry.
// web claims each queued device under a lease and, once chat-admin has ended it, deletes it with the door's entry and
// its lock key, or puts it back with a wait. web reads no door table and adds no queue row by hand.
import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Did } from "@unset/domains-identity";
import {
  type BrowserEntry,
  type BrowserKey,
  type ChatUser,
  type DeviceId,
  type LockKey,
  sessionRef,
} from "@unset/domains-messaging";
import {
  createBrowserListStore,
  createChatSessionEndStore,
  type Pool,
  withClient,
  withTransaction,
} from "@unset/infrastructure-postgres";
import { createSealer, Keyring } from "@unset/infrastructure-seal";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  migrateAsMigrator,
  type PostgresContainer,
  randomPassword,
  STOP_ALL_MS,
  startPostgres,
  stopAllPostgresAfter,
  testPools,
} from "../../support/postgres.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const pools = testPools("chat-session-end-store-test");
const migratorPassword = randomPassword();
const webPassword = randomPassword();
const doorPassword = randomPassword();
let postgres: PostgresContainer;
let web: Pool;
let door: Pool;
let queue: ReturnType<typeof createChatSessionEndStore>;
let list: ReturnType<typeof createBrowserListStore>;

beforeAll(async () => {
  postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  await migrateAsMigrator(postgres, migratorPassword);
  postgres.sql("postgres", `ALTER ROLE web PASSWORD '${webPassword}'; ALTER ROLE chat_auth PASSWORD '${doorPassword}'`);
  web = pools.open(postgres, "unset", "web", webPassword, { max: 2 });
  door = pools.open(postgres, "unset", "chat_auth", doorPassword, { max: 2 });
  queue = createChatSessionEndStore(web, { leaseS: 60, logoutAfterS: 0 });
  list = createBrowserListStore(door, createSealer(new Keyring("k1", new Map([["k1", randomBytes(32)]]))));
}, 120_000);
afterAll(() => stopAllPostgresAfter(pools.end), STOP_ALL_MS);

const deadline = () => AbortSignal.timeout(5000);
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const base32 = (length: number) => Array.from(randomBytes(length), (b) => BASE32[b % 32]).join("");

/** A member with `sessions` web sessions; each session's id hash and its reference. */
function member(sessions: number) {
  const did = `did:plc:${base32(24)}` as Did;
  const user = `u${base32(20)}` as ChatUser;
  const ids = Array.from({ length: sessions }, () => randomBytes(32));
  postgres.sql(
    "unset",
    `INSERT INTO app.account (did, first_seen_at, onboarding) VALUES ('${did}', now(), 'done');
     INSERT INTO app.oauth_session (did, sealed, client_kid, updated_at) VALUES ('${did}', 's1.k1.made-up', 'kid', now());
     ${ids
       .map(
         (id) => `INSERT INTO app.session (id_hash, did, created_at, last_seen_at, absolute_expires_at)
           VALUES ('\\x${id.toString("hex")}', '${did}', now(), now(), now() + interval '1 day');`,
       )
       .join("\n")}`,
  );
  return { did, user, ids, refs: ids.map((id) => sessionRef(id)) };
}

let d = 0;
const device = () => `DEV${String(d++).padStart(7, "0")}` as DeviceId;
const browser = () => randomBytes(32) as unknown as BrowserKey;
const entry = (did: Did, user: ChatUser): BrowserEntry => ({
  id: randomUUID(),
  did,
  user,
  device: device(),
  lockKey: randomBytes(32) as unknown as LockKey,
});
const queued = () =>
  postgres.sql("unset", "SELECT chat_user || ' ' || device_id FROM app.chat_session_end ORDER BY 1").split("\n");
const browserRows = (did: Did) =>
  Number(postgres.sql("unset", `SELECT count(*) FROM door.browser WHERE did = '${did}'`));

describe("chat session end store", () => {
  test("chat.session_end_logout: Log out queues only the devices that session signed in, and drops their keys", async () => {
    const m = member(2);
    const [mine, other] = [entry(m.did, m.user), entry(m.did, m.user)];
    await list.add(browser(), mine, m.refs[0] as never, deadline());
    await list.add(browser(), other, m.refs[1] as never, deadline());
    await withTransaction(web, null, (tx) => queue.queueForSession(tx, m.ids[0] as Buffer));
    expect(queued()).toContain(`${m.user} ${mine.device}`);
    expect(queued()).not.toContain(`${m.user} ${other.device}`);
    // The entries, and their lock keys, stay until each device has ended.
    expect(browserRows(m.did)).toBe(2);
  });

  test("chat.session_end_rollback: nothing is queued or dropped when web's transaction rolls back", async () => {
    const m = member(1);
    const mine = entry(m.did, m.user);
    await list.add(browser(), mine, m.refs[0] as never, deadline());
    await expect(
      withTransaction(web, null, async (tx) => {
        await queue.queueForSession(tx, m.ids[0] as Buffer);
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    expect(queued()).not.toContain(`${m.user} ${mine.device}`);
    expect(browserRows(m.did)).toBe(1);
  });

  test("chat.session_end_did: a revoked grant queues every device of the member, whichever session signed it", async () => {
    const m = member(2);
    const others = member(1);
    const entries = [entry(m.did, m.user), entry(m.did, m.user)];
    await list.add(browser(), entries[0] as BrowserEntry, m.refs[0] as never, deadline());
    await list.add(browser(), entries[1] as BrowserEntry, m.refs[1] as never, deadline());
    const theirs = entry(others.did, others.user);
    await list.add(browser(), theirs, others.refs[0] as never, deadline());
    await withTransaction(web, null, (tx) => queue.queueForDid(tx, m.did));
    for (const e of entries) expect(queued()).toContain(`${m.user} ${e.device}`);
    expect(queued()).not.toContain(`${others.user} ${theirs.device}`);
  });

  test("chat.session_end_refuses_late_ticket: an ended session's ticket can neither add nor renew an entry", async () => {
    const m = member(2);
    const kept = entry(m.did, m.user);
    await list.add(browser(), kept, m.refs[1] as never, deadline());
    await withTransaction(web, null, (tx) => queue.queueForSession(tx, m.ids[0] as Buffer));
    // A ticket signed for the first session just before Log out reaches the door afterwards.
    expect(await list.add(browser(), entry(m.did, m.user), m.refs[0] as never, deadline())).toBe("taken");
    expect(await list.renew(kept, m.refs[0] as never, deadline())).toBe(false);
    // The live session still renews.
    expect(await list.renew(kept, m.refs[1] as never, deadline())).toBe(true);
  });

  test("chat.session_end_claim_finish_retry: a queued device is claimed under a lease, put back, then finished", async () => {
    const m = member(1);
    const mine = entry(m.did, m.user);
    await list.add(browser(), mine, m.refs[0] as never, deadline());
    await withTransaction(web, null, (tx) => queue.queueForSession(tx, m.ids[0] as Buffer));
    const claimed = await queue.claim(100);
    const job = claimed.find((j) => j.device === mine.device);
    expect(job).toMatchObject({ user: m.user, device: mine.device, attempts: 0 });
    if (job === undefined) throw new Error("no job");
    expect((await queue.claim(100)).some((j) => j.device === mine.device)).toBe(false);
    expect(await queue.retry(job, 0)).toBe(true);
    const again = (await queue.claim(100)).find((j) => j.device === mine.device);
    expect(again).toMatchObject({ attempts: 1 });
    expect(await queue.finish(job)).toBe(false);
    expect(await queue.finish(again as NonNullable<typeof again>)).toBe(true);
    expect(queued()).not.toContain(`${m.user} ${mine.device}`);
  });

  test("chat.session_end_rebound: a browser signed in again by a live session before its end is due keeps chat", async () => {
    const m = member(2);
    const mine = entry(m.did, m.user);
    await list.add(browser(), mine, m.refs[0] as never, deadline());
    const later = createChatSessionEndStore(web, { leaseS: 60, logoutAfterS: 3600 });
    await withTransaction(web, null, (tx) => later.queueForSession(tx, m.ids[0] as Buffer));
    // Not due while the grace lasts.
    expect((await queue.claim(100)).some((j) => j.device === mine.device)).toBe(false);
    postgres.sql("unset", `UPDATE app.chat_session_end SET due_at = now() WHERE device_id = '${mine.device}'`);
    expect(await list.renew(mine, m.refs[1] as never, deadline())).toBe(true);
    expect((await queue.claim(100)).some((j) => j.device === mine.device)).toBe(false);
    expect(queued()).not.toContain(`${m.user} ${mine.device}`);
    expect(browserRows(m.did)).toBe(1);
  });

  test("chat.session_end_rebound_then_logout: a browser signed in again, then logged out again, is still ended", async () => {
    const m = member(2);
    const mine = entry(m.did, m.user);
    await list.add(browser(), mine, m.refs[0] as never, deadline());
    const later = createChatSessionEndStore(web, { leaseS: 60, logoutAfterS: 3600 });
    await withTransaction(web, null, (tx) => later.queueForSession(tx, m.ids[0] as Buffer));
    // Within the grace the same browser signs chat in through the second session, which then logs out too.
    expect(await list.renew(mine, m.refs[1] as never, deadline())).toBe(true);
    await withTransaction(web, null, (tx) => queue.queueForSession(tx, m.ids[1] as Buffer));
    expect((await queue.claim(100)).map((j) => j.device)).toContain(mine.device);
  });

  test("chat.session_end_rebound_new_grace: the second Log out's grace replaces the first's", async () => {
    const m = member(2);
    const mine = entry(m.did, m.user);
    await list.add(browser(), mine, m.refs[0] as never, deadline());
    await withTransaction(web, null, (tx) => queue.queueForSession(tx, m.ids[0] as Buffer));
    expect(await list.renew(mine, m.refs[1] as never, deadline())).toBe(true);
    // The browser's own sign-out page needs the second session's grace to back up keys and log out.
    const later = createChatSessionEndStore(web, { leaseS: 60, logoutAfterS: 3600 });
    await withTransaction(web, null, (tx) => later.queueForSession(tx, m.ids[1] as Buffer));
    expect((await queue.claim(100)).map((j) => j.device)).not.toContain(mine.device);
    expect(queued()).toContain(`${m.user} ${mine.device}`);
  });

  test("chat.session_end_did_kept: a Log out after a revoked grant keeps the device's unconditional end", async () => {
    const m = member(2);
    const mine = entry(m.did, m.user);
    await list.add(browser(), mine, m.refs[0] as never, deadline());
    await withTransaction(web, null, (tx) => queue.queueForDid(tx, m.did));
    const later = createChatSessionEndStore(web, { leaseS: 60, logoutAfterS: 3600 });
    await withTransaction(web, null, (tx) => later.queueForSession(tx, m.ids[0] as Buffer));
    expect(await list.renew(mine, m.refs[1] as never, deadline())).toBe(false);
    expect((await queue.claim(100)).map((j) => j.device)).toContain(mine.device);
  });

  test("chat.session_end_hold_this_browser: after sign out everywhere, the browser that pressed it gets the grace", async () => {
    const m = member(2);
    const mine = entry(m.did, m.user);
    const theirs = entry(m.did, m.user);
    await list.add(browser(), mine, m.refs[0] as never, deadline());
    await list.add(browser(), theirs, m.refs[1] as never, deadline());
    const later = createChatSessionEndStore(web, { leaseS: 60, logoutAfterS: 3600 });
    const held = await withTransaction(web, null, async (tx) => {
      await later.queueForDid(tx, m.did);
      return later.holdForSession(tx, m.ids[0] as Buffer);
    });
    expect(held).toBe(1);
    const due = (await queue.claim(100)).map((j) => j.device);
    expect(due).toContain(theirs.device);
    expect(due).not.toContain(mine.device);
    // Still queued by DID: a renewal does not save it once it is due.
    expect(queued()).toContain(`${m.user} ${mine.device}`);
    postgres.sql("unset", `UPDATE app.chat_session_end SET due_at = now() WHERE device_id = '${mine.device}'`);
    expect(await list.renew(mine, m.refs[1] as never, deadline())).toBe(false);
    expect((await queue.claim(100)).map((j) => j.device)).toContain(mine.device);
  });

  test("chat.session_end_hold_bounds: a hold only delays rows already queued, by the store's own grace", async () => {
    const m = member(1);
    const mine = entry(m.did, m.user);
    await list.add(browser(), mine, m.refs[0] as never, deadline());
    const later = createChatSessionEndStore(web, { leaseS: 60, logoutAfterS: 3600 });
    // Nothing queued: nothing held, nothing added.
    expect(await withTransaction(web, null, (tx) => later.holdForSession(tx, m.ids[0] as Buffer))).toBe(0);
    expect(queued()).not.toContain(`${m.user} ${mine.device}`);
    const run = (sql: string) => withClient(web, null, (db) => db.query(sql));
    await expect(run(`SELECT app.hold_chat_session_end('${m.refs[0]}', 3601)`)).rejects.toThrow(/end_chat_bad_input/);
    await expect(run("SELECT app.hold_chat_session_end('short', 60)")).rejects.toThrow(/end_chat_bad_input/);
  });

  test("chat.session_end_finish_drops_key: finishing deletes the door's entry and its lock key", async () => {
    const m = member(1);
    const mine = entry(m.did, m.user);
    await list.add(browser(), mine, m.refs[0] as never, deadline());
    await withTransaction(web, null, (tx) => queue.queueForSession(tx, m.ids[0] as Buffer));
    expect(browserRows(m.did)).toBe(1);
    const job = (await queue.claim(100)).find((j) => j.device === mine.device);
    expect(await queue.finish(job as NonNullable<typeof job>)).toBe(true);
    expect(browserRows(m.did)).toBe(0);
  });

  test("chat.session_end_web_bounds: web reads no door table and cannot add or rename a queued device", async () => {
    const run = (sql: string) => withClient(web, null, (db) => db.query(sql));
    await expect(run("SELECT device_id FROM door.browser")).rejects.toThrow(/permission denied/);
    await expect(
      run(`INSERT INTO app.chat_session_end (chat_user, device_id) VALUES ('u${"y".repeat(20)}', 'AAAAAAAAAA')`),
    ).rejects.toThrow(/permission denied/);
    await expect(run("UPDATE app.chat_session_end SET device_id = 'AAAAAAAAAA'")).rejects.toThrow(/permission denied/);
    // A malformed reference is refused, not matched.
    await expect(run("SELECT app.end_chat_sessions(ARRAY['x'], NULL, 0)")).rejects.toThrow(/end_chat_bad_input/);
  });
});
