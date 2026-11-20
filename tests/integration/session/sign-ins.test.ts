// P2.27 (ADR 0079; infrastructure/session store.ts newerSignIns, migration 0036): the "new sign-in" notifications are
// the member's other live sessions that began after this browser's and after it last opened them, worked out from
// app.session and never stored. Real Postgres as web (TE-2). Each test uses its own DID, and sessions are written with
// start times in the past through the columns web may insert, so the database clock judges every lifetime.
import { createHash } from "node:crypto";
import { relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import { createOAuthSessionStore, createPool, withClient, withTransaction } from "@unset/infrastructure-postgres";
import { createSealer, parseKeyring } from "@unset/infrastructure-seal";
import { createSessionStore, type SessionLimits } from "@unset/infrastructure-session";
import type { Logger } from "@unset/shared-log";
import { afterAll, describe, expect, inject, test } from "vitest";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const web = createPool({
  connection: { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false },
  service: "sign-ins-test",
  max: 4,
  connectTimeoutMs: 5000,
});
afterAll(() => web.end());

const LIMITS: SessionLimits = { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 };
const quiet: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  logError: () => undefined,
};
const store = createSessionStore({
  withDb: (deadline, fn) => withClient(web, deadline, fn),
  limits: LIMITS,
  log: quiet,
  newerSignInsRead: 3,
});
const keyring = parseKeyring(JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 6).toString("base64") } }));
if (keyring === undefined) throw new Error("test keyring did not parse");
const tokenSets = createOAuthSessionStore({ pool: web, sealer: createSealer(keyring), log: quiet });

let dids = 0;
/** A DID of its own with a token set, so its sessions are live (P2.04s). */
async function member(): Promise<Did> {
  dids += 1;
  const parsed = parseDid(`did:plc:${"s".repeat(22)}${"abcdefghijklmnopqrstuvwxyz234567"[dids]}a`);
  if (parsed === null) throw new Error("test DID did not parse");
  await tokenSets.set(parsed, { authMethod: { method: "private_key_jwt", kid: "A" } });
  return parsed;
}

const sha256 = (data: Uint8Array): Buffer => createHash("sha256").update(data).digest();
const sql = (text: string, values: unknown[] = []) =>
  withClient(web, null, async (client) => (await client.query(text, values)).rows);

/** A session that began `ago` seconds back (and was last seen then, unless `idle` says longer); its cookie and hash. */
async function session(did: Did, ago: number, idle = ago) {
  const id = Buffer.alloc(32);
  id.writeUInt32BE(Math.floor(Math.random() * 2 ** 32), 0);
  id.writeUInt32BE(Math.floor(Math.random() * 2 ** 32), 4);
  await sql(
    "INSERT INTO app.session (id_hash, did, created_at, last_seen_at, absolute_expires_at) VALUES " +
      "($1, $2, now() - make_interval(secs => $3), now() - make_interval(secs => $4), " +
      "now() - make_interval(secs => $3) + make_interval(secs => $5))",
    [sha256(id), did, ago, Math.min(idle, LIMITS.idleS + 60), LIMITS.absoluteS],
  );
  return { cookie: id.toString("base64url"), idHash: sha256(id) };
}

/** What a request with `cookie` reads: the newer sign-ins that came with the session. */
async function newer(cookie: string): Promise<readonly string[]> {
  const read = await store.read({ key: {}, cookieValue: cookie, deadline: null });
  if (read.session === null) throw new Error("no session");
  return read.session.newerSignIns ?? [];
}

const since = (idHash: Buffer, limit: number) => withClient(web, null, (db) => store.signInsSince(db, idHash, limit));
const markSeen = (idHash: Buffer, upTo: string) =>
  withTransaction(web, null, (tx) => store.markSignInsSeen(tx, idHash, upTo));
const EXACT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

describe("new sign-in notifications", () => {
  test("sign_ins.newer_sessions_show_on_the_older_browser_only", async () => {
    const did = await member();
    const phone = await session(did, 3600);
    const laptop = await session(did, 60);
    const onPhone = await newer(phone.cookie);
    expect(onPhone).toHaveLength(1);
    expect(onPhone[0]).toMatch(EXACT);
    // The newer browser is not told about the one that signed in before it.
    expect(await newer(laptop.cookie)).toEqual([]);
  });

  test("sign_ins.another_members_sessions_never_show", async () => {
    const mine = await member();
    const theirs = await member();
    const me = await session(mine, 3600);
    await session(theirs, 60);
    expect(await newer(me.cookie)).toEqual([]);
    expect(await since(me.idHash, 50)).toEqual([]);
  });

  test("sign_ins.newest_first_capped_by_the_read_and_paged_by_since", async () => {
    const did = await member();
    const first = await session(did, 7200);
    for (const ago of [600, 500, 400, 300, 200]) await session(did, ago);
    const read = await newer(first.cookie);
    expect(read).toHaveLength(3);
    expect([...read].sort().reverse()).toEqual(read);
    const all = await since(first.idHash, 50);
    expect(all).toHaveLength(5);
    expect(all.slice(0, 3)).toEqual(read);
  });

  test("sign_ins.opening_the_newest_hides_it_and_every_older_one_and_none_after", async () => {
    const did = await member();
    const me = await session(did, 7200);
    await session(did, 600);
    await session(did, 300);
    const [newest] = await since(me.idHash, 50);
    if (newest === undefined) throw new Error("no sign-in listed");
    await markSeen(me.idHash, newest);
    expect(await newer(me.cookie)).toEqual([]);
    // A sign-in after the list was drawn still shows.
    await session(did, 0);
    expect(await newer(me.cookie)).toHaveLength(1);
  });

  test("sign_ins.marking_is_exact_to_the_microsecond", async () => {
    const did = await member();
    const me = await session(did, 7200);
    await sql(
      "INSERT INTO app.session (id_hash, did, created_at, last_seen_at, absolute_expires_at) VALUES " +
        "($1, $2, '2026-11-20T20:00:00.000001Z', now(), now() + interval '1 day'), " +
        "($3, $2, '2026-11-20T20:00:00.000002Z', now(), now() + interval '1 day')",
      [sha256(Buffer.alloc(32, 201)), did, sha256(Buffer.alloc(32, 202))],
    );
    const older = "2026-11-20T20:00:00.000001Z";
    expect(await since(me.idHash, 50)).toEqual(["2026-11-20T20:00:00.000002Z", older]);
    await markSeen(me.idHash, older);
    expect(await since(me.idHash, 50)).toEqual(["2026-11-20T20:00:00.000002Z"]);
  });

  test("sign_ins.marking_twice_or_with_an_older_time_never_reopens", async () => {
    const did = await member();
    const me = await session(did, 7200);
    await session(did, 600);
    await session(did, 300);
    const [newest, older] = await since(me.idHash, 50);
    if (newest === undefined || older === undefined) throw new Error("two sign-ins expected");
    await markSeen(me.idHash, newest);
    await markSeen(me.idHash, newest);
    // A stale tab's form names an older time: the mark stays where it is.
    await markSeen(me.idHash, older);
    expect(await since(me.idHash, 50)).toEqual([]);
  });

  test("sign_ins.a_future_time_cannot_hide_sign_ins_still_to_come", async () => {
    const did = await member();
    const me = await session(did, 7200);
    await markSeen(me.idHash, "2099-01-01T00:00:00.000000Z");
    await session(did, 0);
    expect(await newer(me.cookie)).toHaveLength(1);
  });

  test("sign_ins.each_browser_keeps_its_own_mark", async () => {
    // Someone signed in with a stolen password can dismiss the alert only in their own browser.
    const did = await member();
    const member1 = await session(did, 7200);
    const other = await session(did, 3600);
    await session(did, 60);
    const [newest] = await since(other.idHash, 50);
    if (newest === undefined) throw new Error("no sign-in listed");
    await markSeen(other.idHash, newest);
    expect(await newer(other.cookie)).toEqual([]);
    expect(await newer(member1.cookie)).toHaveLength(2);
  });

  test("sign_ins.an_ended_or_expired_session_takes_its_entry_with_it", async () => {
    const did = await member();
    const me = await session(did, 7200);
    const later = await session(did, 600);
    // Idle past the limit: no longer live, so no longer a sign-in to report.
    await session(did, 300, LIMITS.idleS + 60);
    expect(await newer(me.cookie)).toHaveLength(1);
    await withClient(web, null, (db) => store.destroy(db, later.idHash));
    expect(await newer(me.cookie)).toEqual([]);
  });

  test("sign_ins.web_cannot_insert_the_mark", async () => {
    const did = await member();
    await expect(
      sql(
        "INSERT INTO app.session (id_hash, did, created_at, last_seen_at, absolute_expires_at, sign_ins_seen_at) " +
          "VALUES ($1, $2, now(), now(), now() + interval '1 day', now())",
        [sha256(Buffer.alloc(32, 9)), did],
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
