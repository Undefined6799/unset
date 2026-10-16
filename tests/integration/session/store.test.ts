// P2.03 (infrastructure/session/store.ts, migration 0011): the browser session store against real Postgres,
// connected as web, the only role P2.03x granted the table to (TE-2). Times in the past are written as web through
// the columns it may insert, so every expiry is judged by the database clock, as in production.
import { createHash } from "node:crypto";
import { relative } from "node:path";
import { createSessionStore, type SessionLimits } from "@unset/infrastructure-session";
import { AppError } from "@unset/shared-errors";
import type { LogEvent, LogFields, Logger } from "@unset/shared-log";
import { afterAll, describe, expect, inject, test } from "vitest";
import { createPool, type Pool, withClient, withTransaction } from "../../../infrastructure/postgres/index.ts";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const pools: Pool[] = [];
/** A web pool; `onStatement` runs before every statement it sends. */
function webPool(onStatement?: () => void): Pool {
  const pool = createPool({
    connection: { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false },
    service: "session-test",
    max: 4,
    connectTimeoutMs: 5000,
    ...(onStatement === undefined ? {} : { onStatement }),
  });
  pools.push(pool);
  return pool;
}
const web = webPool();
afterAll(() => Promise.all(pools.map((pool) => pool.end())));

const LIMITS: SessionLimits = { idleS: 604_800, absoluteS: 2_592_000, touchIntervalS: 300 };
const DID_A = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const DID_B = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const sha256 = (data: Uint8Array): Buffer => createHash("sha256").update(data).digest();

const sql = <T extends Record<string, unknown>>(text: string, values: unknown[] = []) =>
  withClient(web, null, async (client) => (await client.query<T>(text, values)).rows);

function setup(pool: Pool = web) {
  const logged: { event: LogEvent; fields: LogFields }[] = [];
  const record = (event: LogEvent, fields: LogFields = {}) => {
    logged.push({ event, fields });
  };
  const log: Logger = { info: record, warn: record, error: record, logError: () => undefined };
  const store = createSessionStore({ withDb: (deadline, fn) => withClient(pool, deadline, fn), limits: LIMITS, log });
  /** One request: a fresh memo key, and the cookie value it sends. */
  const request = (cookieValue: string | null) => ({ key: {}, cookieValue, deadline: null });
  return { store, logged, request };
}

/** A session row written directly, with times `idle` and `age` seconds in the past; returns its cookie value. */
async function insertSession(did: string, { idle = 0, age = 0 }: { idle?: number; age?: number } = {}) {
  const id = Buffer.alloc(32, Math.floor(Math.random() * 255) + 1);
  id.writeUInt32BE(Math.floor(Math.random() * 2 ** 32), 0);
  await sql(
    "INSERT INTO app.session (id_hash, did, created_at, last_seen_at, absolute_expires_at) VALUES " +
      "($1, $2, now() - make_interval(secs => $4), now() - make_interval(secs => $3), " +
      "now() - make_interval(secs => $4) + make_interval(secs => $5))",
    [sha256(id), did, idle, age, LIMITS.absoluteS],
  );
  return id.toString("base64url");
}

const rowFor = async (cookieValue: string) =>
  (
    await sql<{ did: string; last_seen_at: Date; touched: boolean }>(
      "SELECT did, last_seen_at, now() - last_seen_at < interval '5 seconds' AS touched FROM app.session " +
        "WHERE id_hash = $1",
      [sha256(Buffer.from(cookieValue, "base64url"))],
    )
  )[0];

describe("session store", () => {
  test("session.create_stores_hash_only", async () => {
    const { store } = setup();
    const { cookieValue, expiresAt } = await withClient(web, null, (db) => store.create(db, DID_A));
    expect(cookieValue).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const raw = Buffer.from(cookieValue, "base64url");
    const rows = await sql<Record<string, unknown>>("SELECT * FROM app.session WHERE did = $1", [DID_A]);
    const row = rows.find((r) => (r.id_hash as Buffer).equals(sha256(raw)));
    expect(row).toBeDefined();
    for (const value of Object.values(row ?? {})) {
      if (Buffer.isBuffer(value)) expect(value.equals(raw)).toBe(false);
      expect(String(value)).not.toContain(cookieValue);
    }
    // The absolute expiry is the database's now() plus the configured lifetime.
    const [{ ok }] = (await sql<{ ok: boolean }>(
      "SELECT abs(extract(epoch FROM $1::timestamptz - (now() + make_interval(secs => $2)))) < 10 AS ok",
      [expiresAt, LIMITS.absoluteS],
    )) as [{ ok: boolean }];
    expect(ok).toBe(true);
  });

  test("session.read_roundtrip", async () => {
    const { store, request } = setup();
    const { cookieValue } = await withClient(web, null, (db) => store.create(db, DID_A));
    const read = await store.read(request(cookieValue));
    expect(read.clearCookie).toBe(false);
    expect(read.session?.did).toBe(DID_A);
    expect(read.session?.emailConfirmed).toBeNull();
    expect(read.session?.idHash.equals(sha256(Buffer.from(cookieValue, "base64url")))).toBe(true);
  });

  test("session.rotation", async () => {
    const { store, request } = setup();
    const old = await insertSession(DID_B);
    // The same browser signs in as someone else: the previous session dies, whoever it belonged to.
    const { cookieValue } = await withTransaction(web, null, (db) => store.create(db, DID_A, { replacingCookie: old }));
    expect(await rowFor(old)).toBeUndefined();
    expect((await store.read(request(cookieValue))).session?.did).toBe(DID_A);
    // A malformed replacing value deletes nothing and still creates the session.
    const kept = await insertSession(DID_B);
    await withClient(web, null, (db) => store.create(db, DID_A, { replacingCookie: "not-a-cookie" }));
    expect((await rowFor(kept))?.did).toBe(DID_B);
  });

  test("session.idle_expiry", async () => {
    const { store, request } = setup();
    const value = await insertSession(DID_A, { idle: LIMITS.idleS + 1, age: LIMITS.idleS + 1 });
    expect(await store.read(request(value))).toEqual({ session: null, clearCookie: true });
    expect(await rowFor(value)).toBeUndefined();
    // One second inside the idle limit is still live.
    const live = await insertSession(DID_A, { idle: LIMITS.idleS - 60, age: LIMITS.idleS - 60 });
    expect((await store.read(request(live))).session?.did).toBe(DID_A);
  });

  test("session.absolute_expiry", async () => {
    const { store, request } = setup();
    // Touched a minute ago, so never idle, but created past the absolute lifetime.
    const value = await insertSession(DID_A, { idle: 60, age: LIMITS.absoluteS + 1 });
    expect(await store.read(request(value))).toEqual({ session: null, clearCookie: true });
    expect(await rowFor(value)).toBeUndefined();
  });

  test("session.touch_throttled", async () => {
    const { store, request } = setup();
    const recent = await insertSession(DID_A, { idle: 10, age: 10 });
    const before = (await rowFor(recent))?.last_seen_at;
    await store.read(request(recent));
    expect((await rowFor(recent))?.last_seen_at).toEqual(before);
    const stale = await insertSession(DID_A, { idle: 360, age: 360 });
    await store.read(request(stale));
    expect((await rowFor(stale))?.touched).toBe(true);
  });

  test("session.touch_failure_keeps_session", async () => {
    // The deadline fires once the SELECT has run, so the touch cannot take a client. The failure is logged by kind
    // only, and the request keeps its session (best effort).
    const deadline = new AbortController();
    const pool = webPool(() => deadline.abort());
    const { store, logged } = setup(pool);
    const stale = await insertSession(DID_A, { idle: 360, age: 360 });
    const read = await store.read({ key: {}, cookieValue: stale, deadline: deadline.signal });
    expect(read).toMatchObject({ session: { did: DID_A }, clearCookie: false });
    expect(logged).toEqual([{ event: "session.touch_failed", fields: { kind: "AppError" } }]);
    expect((await rowFor(stale))?.touched).toBe(false);
  });

  test("session.malformed_cookie", async () => {
    const statements = { n: 0 };
    const { store, request } = setup(
      webPool(() => {
        statements.n++;
      }),
    );
    const malformed = [
      "",
      "A".repeat(42),
      "A".repeat(44),
      `${"A".repeat(41)}+/`,
      `${"A".repeat(42)}=`,
      `${"A".repeat(42)}B`, // 43 characters whose last one carries bits a 32-byte value cannot have
      " ".repeat(43),
      "x".repeat(1024),
      "é".repeat(43),
      "A".repeat(42).concat("\n"),
    ];
    for (const value of malformed) {
      expect(await store.read(request(value)), JSON.stringify(value)).toEqual({ session: null, clearCookie: true });
    }
    expect(statements.n).toBe(0);
    // No cookie at all: nothing to clear.
    expect(await store.read(request(null))).toEqual({ session: null, clearCookie: false });
    expect(statements.n).toBe(0);
  });

  test("session.unknown_cookie_clears", async () => {
    const { store, request } = setup();
    expect(await store.read(request(Buffer.alloc(32, 7).toString("base64url")))).toEqual({
      session: null,
      clearCookie: true,
    });
  });

  test("session.memo", async () => {
    const statements = { n: 0 };
    const { store } = setup(
      webPool(() => {
        statements.n++;
      }),
    );
    const value = await insertSession(DID_A, { idle: 10, age: 10 });
    const one = { key: {}, cookieValue: value, deadline: null };
    const reads = await Promise.all([store.read(one), store.read(one), store.read(one)]);
    expect(reads.map((r) => r.session?.did)).toEqual([DID_A, DID_A, DID_A]);
    expect(statements.n).toBe(1);
    // Another request is read again.
    await store.read({ key: {}, cookieValue: value, deadline: null });
    expect(statements.n).toBe(2);
  });

  test("session.touch_outside_read_only_tx", async () => {
    const { store, request } = setup();
    const stale = await insertSession(DID_A, { idle: 360, age: 360 });
    // A GET handler's transaction is read-only (P1.07); the read and its touch run on their own connections.
    await withTransaction(web, null, async (handler) => {
      await handler.query("SET TRANSACTION READ ONLY");
      expect((await store.read(request(stale))).session?.did).toBe(DID_A);
      const { rows } = await handler.query<{ transaction_read_only: string }>("SHOW transaction_read_only");
      expect(rows[0]?.transaction_read_only).toBe("on");
    });
    expect((await rowFor(stale))?.touched).toBe(true);
  });

  test("session.db_error_is_503", async () => {
    const pool = webPool();
    const { store } = setup(pool);
    const value = await insertSession(DID_A);
    await pool.end();
    pools.splice(pools.indexOf(pool), 1);
    // The route's error handler answers the AppError with its catalogue status; the cookie is never cleared.
    const failed = await store.read({ key: {}, cookieValue: value, deadline: null }).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(AppError);
    expect((failed as AppError).status).toBe(503);
    expect((await rowFor(value))?.did).toBe(DID_A);
  });

  test("session.memo_is_a_snapshot", async () => {
    // A read after a session change in the same request still sees the first read: handlers must not rely on it.
    const { store } = setup();
    const value = await insertSession(DID_A);
    const one = { key: {}, cookieValue: value, deadline: null };
    const first = await store.read(one);
    await withClient(web, null, (db) => store.destroy(db, first.session?.idHash as Buffer));
    expect((await store.read(one)).session?.did).toBe(DID_A);
    expect((await store.read({ key: {}, cookieValue: value, deadline: null })).session).toBeNull();
  });

  test("session.destroy", async () => {
    const { store, request } = setup();
    const value = await insertSession(DID_A);
    const read = await store.read(request(value));
    await withClient(web, null, (db) => store.destroy(db, read.session?.idHash as Buffer));
    expect(await rowFor(value)).toBeUndefined();
  });

  test("session.set_email_confirmed", async () => {
    const { store, request } = setup();
    const did = "did:plc:cccccccccccccccccccccccc";
    const first = await insertSession(did);
    const second = await insertSession(did);
    const one = await store.read(request(first));
    await withClient(web, null, (db) => store.setEmailConfirmed(db, one.session?.idHash as Buffer, true));
    expect((await store.read(request(first))).session?.emailConfirmed).toBe(true);
    expect((await store.read(request(second))).session?.emailConfirmed).toBeNull();
    await withClient(web, null, (db) => store.setEmailConfirmed(db, { did }, false));
    expect((await store.read(request(first))).session?.emailConfirmed).toBe(false);
    expect((await store.read(request(second))).session?.emailConfirmed).toBe(false);
  });

  test("session.sweep", async () => {
    const { store, logged } = setup();
    await sql("DELETE FROM app.session");
    await insertSession(DID_A, { idle: LIMITS.idleS + 1, age: LIMITS.idleS + 1 });
    await insertSession(DID_A, { idle: 60, age: LIMITS.absoluteS + 1 });
    await insertSession(DID_B, { idle: LIMITS.idleS + 5, age: LIMITS.absoluteS + 5 });
    const live = [await insertSession(DID_A), await insertSession(DID_B, { idle: 600, age: 86_400 })];
    expect(await withClient(web, null, (db) => store.sweep(db))).toBe(3);
    for (const value of live) expect(await rowFor(value)).toBeDefined();
    expect(logged).toEqual([{ event: "session.sweep", fields: { count: 3 } }]);
  });
});
