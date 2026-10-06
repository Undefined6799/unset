// P1.17 (infrastructure/postgres/lock.ts): the advisory lock against real Postgres, connected as `web`, the role that
// refreshes OAuth tokens (TE-2). Two lock pools stand in for two `web` replicas.
import { relative } from "node:path";
import type { LogEvent, LogFields, Logger } from "@unset/shared-log";
import { afterAll, describe, expect, inject, test } from "vitest";
import {
  createLockPool,
  createPool,
  createRequestLock,
  LockError,
  LockNamespace,
  type LockPool,
  MIGRATE_LOCK_ID,
  type Pool,
  withAdvisoryLock,
  withClient,
} from "../../../infrastructure/postgres/index.ts";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const connection = { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false };
// The `web` role's own timeouts (roles.json): statement_timeout 2 s, idle_in_transaction_session_timeout 10 s.
const roleTimeouts = { statementTimeoutMs: 2000, idleInTransactionTimeoutMs: 10_000 };
const pools: Pool[] = [];
afterAll(() => Promise.all(pools.map((pool) => pool.close())));

/** One replica's lock pool, whose log lines land in `logged`. */
function replica(options: { max?: number; service?: string } = {}) {
  const logged: { event: LogEvent; fields: LogFields }[] = [];
  const record = (event: LogEvent, fields: LogFields = {}) => {
    logged.push({ event, fields });
  };
  const log: Logger = { info: record, warn: record, error: record, logError: () => undefined };
  const lock: LockPool = createLockPool({
    connection,
    service: options.service ?? "lock-test",
    max: options.max ?? 4,
    ...roleTimeouts,
    log,
  });
  pools.push(lock.pool);
  return { lock, logged };
}

/** A plain `web` pool for side sessions: holding other locks, reading pg_locks, ending a backend. */
const side = createPool({ connection, service: "lock-test-side", max: 2, connectTimeoutMs: 5000, ...roleTimeouts });
pools.push(side);
const sql = async <T extends Record<string, unknown>>(text: string, values: unknown[] = []) =>
  withClient(side, null, async (client) => (await client.query<T>(text, values)).rows);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: unknown) => (error instanceof LockError ? error.code : String(error)),
  );

/** Holds `key` on `lock` for `ms`, recording when `fn` started and ended. */
function hold(lock: LockPool, key: string, ms: number, options?: { waitMs?: number }) {
  const times = { start: 0, end: 0 };
  const done = withAdvisoryLock(
    lock,
    LockNamespace.oauth,
    key,
    async () => {
      times.start = Date.now();
      await sleep(ms);
      times.end = Date.now();
      return "held";
    },
    options,
  );
  return { times, done };
}

describe("advisory lock", () => {
  test("serialises_same_key", async () => {
    const a = replica();
    const b = replica();
    const first = hold(a.lock, DID, 300);
    await sleep(50);
    const second = hold(b.lock, DID, 10);
    expect(await Promise.all([first.done, second.done])).toEqual(["held", "held"]);
    expect(second.times.start).toBeGreaterThanOrEqual(first.times.end);
  });

  test("parallel_different_keys", async () => {
    const a = replica();
    const b = replica();
    const x = hold(a.lock, "did:plc:xxxxxxxxxxxxxxxxxxxxxxxx", 300);
    const y = hold(b.lock, "did:plc:yyyyyyyyyyyyyyyyyyyyyyyy", 300);
    await Promise.all([x.done, y.done]);
    expect(y.times.start).toBeLessThan(x.times.end);
    expect(x.times.start).toBeLessThan(y.times.end);
  });

  test("wait_timeout", async () => {
    const a = replica();
    const b = replica();
    const first = hold(a.lock, DID, 2000);
    await sleep(100);
    const started = Date.now();
    expect(await codeOf(hold(b.lock, DID, 10, { waitMs: 200 }).done)).toBe("lock.timeout");
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(150);
    expect(waited).toBeLessThan(1000);
    expect(await first.done).toBe("held");
    // The timed-out client rolled back cleanly and went back to the pool.
    expect(b.lock.pool.driver.idleCount).toBe(1);
  });

  test("wait_longer_than_role_timeout", { timeout: 20_000 }, async () => {
    const a = replica();
    const b = replica();
    const first = hold(a.lock, DID, 6000);
    await sleep(100);
    const started = Date.now();
    expect(await codeOf(hold(b.lock, DID, 10, { waitMs: 5000 }).done)).toBe("lock.timeout");
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(4500);
    expect(waited).toBeLessThan(5900);
    expect(await first.done).toBe("held");
  });

  test("releases_on_throw", async () => {
    const a = replica();
    const b = replica();
    const failing = withAdvisoryLock(a.lock, LockNamespace.oauth, DID, async () => {
      throw new Error("refresh failed");
    });
    await expect(failing).rejects.toThrow("refresh failed");
    const started = Date.now();
    expect(await hold(b.lock, DID, 10, { waitMs: 200 }).done).toBe("held");
    expect(Date.now() - started).toBeLessThan(200);
  });

  test("releases_on_success", async () => {
    const { lock } = replica();
    expect(await withAdvisoryLock(lock, LockNamespace.oauth, "a lock name", async () => 7)).toBe(7);
    const rows = await sql("SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = $1 AND objsubid = 2", [
      LockNamespace.oauth,
    ]);
    expect(rows).toEqual([]);
  });

  test("namespace_isolated", async () => {
    const { lock } = replica();
    await withClient(side, null, async (client) => {
      // The migration runner's bigint lock, and the bigint whose halves equal (oauth, hashtext(key)).
      await client.query(
        "SELECT pg_advisory_lock($1::bigint), pg_advisory_lock(($2::bigint << 32) | (hashtext($3)::bigint & 4294967295))",
        [MIGRATE_LOCK_ID, LockNamespace.oauth, DID],
      );
      try {
        const run = withAdvisoryLock(lock, LockNamespace.oauth, DID, async () => "free", { waitMs: 500 });
        expect(await run).toBe("free");
      } finally {
        await client.query("SELECT pg_advisory_unlock_all()");
      }
    });
  });

  test("lock_lost_logged", async () => {
    const { lock, logged } = replica({ service: "lock-test-lost" });
    const result = await withAdvisoryLock(lock, LockNamespace.oauth, DID, async () => {
      await sql(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'lock-test-lost' AND pid <> pg_backend_pid()",
      );
      await sleep(200);
      return 42;
    });
    expect(result).toBe(42);
    expect(logged).toEqual([{ event: "lock.lost", fields: { kind: "oauth" } }]);
    expect(lock.pool.driver.totalCount).toBe(0);
  });

  test("pool_exhausted", async () => {
    const { lock } = replica({ max: 1 });
    let finish = (): void => undefined;
    const busy = withAdvisoryLock(lock, LockNamespace.oauth, "first", () => new Promise<void>((r) => (finish = r)));
    await sleep(100);
    const started = Date.now();
    expect(await codeOf(withAdvisoryLock(lock, LockNamespace.oauth, "second", async () => 1))).toBe(
      "lock.pool_exhausted",
    );
    expect(Date.now() - started).toBeLessThan(3000);
    finish();
    await busy;
  });

  test("hold_exceeded_logged", async () => {
    const { lock, logged } = replica();
    expect(await hold(lock, DID, 300, {}).done).toBe("held");
    expect(logged).toEqual([]);
    const late = await withAdvisoryLock(lock, LockNamespace.oauth, DID, () => sleep(300).then(() => "late"), {
      holdMs: 100,
    });
    expect(late).toBe("late");
    expect(logged).toEqual([{ event: "lock.hold_exceeded", fields: { kind: "oauth", ms: 100 } }]);
  });

  test("adapter_shape", async () => {
    const { lock } = replica();
    const requestLock = createRequestLock(lock);
    expect(await requestLock("k", () => 42)).toBe(42);
    expect(await requestLock(DID, async () => "async")).toBe("async");
  });

  test("bad_wait_refused", async () => {
    const { lock } = replica();
    await expect(withAdvisoryLock(lock, LockNamespace.oauth, DID, async () => 1, { waitMs: 0 })).rejects.toThrow(
      RangeError,
    );
    expect(lock.pool.driver.totalCount).toBe(0);
  });
});
