// P1.11p (infrastructure/postgres/pool.ts, tx.ts): the pool, transactions and the connection budget against the real
// image. The process roles arrive with P1.12, so these tests create a plain LOGIN role per case; P1.11t moves them
// onto the shared template database and the real web role.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  acquire,
  checkConnectionBudget,
  createPool,
  type Pool,
  withClient,
  withTransaction,
} from "../../../infrastructure/postgres/index.ts";
import { type PostgresContainer, randomPassword, startPostgres, stopAllPostgres } from "../../support/postgres.ts";

const initDir = new URL("../../../deployment/postgres/init", import.meta.url).pathname;
let postgres: PostgresContainer;
let roles = 0;
const pools: Pool[] = [];

beforeAll(async () => {
  postgres = await startPostgres({
    initDir,
    secrets: { pg_migrator_password: randomPassword(), pg_tap_password: randomPassword() },
  });
}, 120_000);
afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.close()));
  stopAllPostgres();
});

/** A fresh role with its own database, and a pool for it. */
function setup(options: { max?: number; connectTimeoutMs?: number; connectionLimit?: number } = {}) {
  roles += 1;
  const role = `p_${roles}`;
  const password = randomPassword();
  postgres.sql(
    "postgres",
    `CREATE ROLE ${role} LOGIN PASSWORD '${password}' CONNECTION LIMIT ${options.connectionLimit ?? -1}`,
  );
  postgres.sql("postgres", `CREATE DATABASE ${role} OWNER ${role}`);
  const pool = createPool({
    connection: { host: "127.0.0.1", port: postgres.port, database: role, user: role, password, ssl: false },
    service: "web",
    max: options.max ?? 2,
    connectTimeoutMs: options.connectTimeoutMs ?? 2000,
    statementTimeoutMs: 2000,
    idleInTransactionTimeoutMs: 5000,
  });
  pools.push(pool);
  return pool;
}

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: unknown) => (error as { code?: string }).code ?? String(error),
  );

describe("pool", () => {
  test("pool_settings", async () => {
    const pool = setup();
    expect(pool.driver.totalCount).toBe(0);
    const settings = await withClient(pool, null, async (client) => {
      const { rows } = await client.query(
        "SELECT current_setting('statement_timeout') AS st, current_setting('idle_in_transaction_session_timeout') AS it, current_setting('application_name') AS app",
      );
      return rows[0];
    });
    expect(settings).toEqual({ st: "2s", it: "5s", app: "web" });
    expect(pool.driver.idleCount).toBe(1);
  });

  test("pool_exhaustion_fails_fast", async () => {
    const pool = setup({ max: 1, connectTimeoutMs: 200 });
    const held = await acquire(pool, null);
    const started = Date.now();
    expect(await codeOf(acquire(pool, null))).toBe("db.busy");
    expect(Date.now() - started).toBeLessThan(1500);
    held.release();
  });

  test("acquire_nested_in_deadline", async () => {
    const pool = setup({ max: 1, connectTimeoutMs: 5000 });
    const held = await acquire(pool, null);
    const started = Date.now();
    expect(await codeOf(acquire(pool, AbortSignal.timeout(100)))).toBe("http.deadline");
    expect(Date.now() - started).toBeLessThan(1500);
    // The pool hands the freed client to the abandoned waiter, which gives it straight back.
    held.release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect([pool.driver.totalCount, pool.driver.idleCount, pool.driver.waitingCount]).toEqual([1, 1, 0]);
    expect(await codeOf(acquire(pool, AbortSignal.abort()))).toBe("http.deadline");
  });

  test("tx_commit_and_rollback", async () => {
    const pool = setup();
    await withClient(pool, null, (c) => c.query("CREATE TABLE t (n int)"));
    const count = () =>
      withClient(pool, null, async (c) => Number((await c.query("SELECT count(*) AS n FROM t")).rows[0].n));

    await withTransaction(pool, null, (c) => c.query("INSERT INTO t VALUES (1)"));
    expect(await count()).toBe(1);

    const boom = new Error("boom");
    await expect(
      withTransaction(pool, null, async (c) => {
        await c.query("INSERT INTO t VALUES (2)");
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(await count()).toBe(1);

    const deadline = new AbortController();
    expect(
      await codeOf(
        withTransaction(pool, deadline.signal, async (c) => {
          await c.query("INSERT INTO t VALUES (3)");
          deadline.abort();
        }),
      ),
    ).toBe("http.deadline");
    expect(await count()).toBe(1);

    const level = await withTransaction(
      pool,
      null,
      async (c) => (await c.query("SHOW transaction_isolation")).rows[0].transaction_isolation,
      "SERIALIZABLE",
    );
    expect(level).toBe("serializable");
    expect(pool.driver.waitingCount).toBe(0);
  });

  test("connection_budget", async () => {
    const limited = setup({ connectionLimit: 40 });
    await withClient(limited, null, async (client) => {
      // floor(40 / 3) = 13
      await expect(checkConnectionBudget(client, [20, 8], 3)).rejects.toMatchObject({ name: "ConfigError" });
      await expect(checkConnectionBudget(client, [8, 4], 3)).resolves.toBeUndefined();
    });
    const unlimited = setup();
    await withClient(unlimited, null, (client) => checkConnectionBudget(client, [50, 50], 4));
  });
});
