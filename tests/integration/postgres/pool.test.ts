// P1.11p (infrastructure/postgres/pool.ts, tx.ts): the pool, transactions and the connection budget against the real
// image, in this file's database from the integration setup (P1.11t). The process roles arrive with P1.12, so each
// case creates a throwaway LOGIN role as migrator (CREATEROLE), named t_<random>, granted only USAGE on this database's
// public schema (never SUPERUSER, CREATEROLE or BYPASSRLS) and dropped in teardown (architecture ruling 2026-10-06 (b)).
import { randomBytes } from "node:crypto";
import { relative } from "node:path";
import { afterAll, describe, expect, inject, test } from "vitest";
import {
  acquire,
  checkConnectionBudget,
  createPool,
  type Pool,
  type PoolOptions,
  withClient,
  withTransaction,
} from "../../../infrastructure/postgres/index.ts";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const pools: Pool[] = [];
const roles: string[] = [];
const poolOf = (connection: PoolOptions["connection"], options: { max?: number; connectTimeoutMs?: number }) => {
  const pool = createPool({
    connection,
    service: "web",
    max: options.max ?? 2,
    connectTimeoutMs: options.connectTimeoutMs ?? 2000,
    statementTimeoutMs: 2000,
    idleInTransactionTimeoutMs: 5000,
  });
  pools.push(pool);
  return pool;
};
const migrator = poolOf({ ...provided, database, ssl: false }, { max: 1 });
afterAll(async () => {
  await Promise.all(pools.filter((pool) => pool !== migrator).map((pool) => pool.close()));
  await withClient(migrator, null, (client) => client.query("DROP TABLE IF EXISTS tx_rows"));
  for (const role of roles) {
    await withClient(migrator, null, (client) =>
      client.query(`REVOKE USAGE ON SCHEMA public FROM ${role}; DROP ROLE ${role}`),
    );
  }
  await migrator.close();
});

/** A fresh role allowed into this database's public schema, and a pool for it. */
async function setup(options: { max?: number; connectTimeoutMs?: number; connectionLimit?: number } = {}) {
  const role = `t_${randomBytes(6).toString("hex")}`;
  roles.push(role);
  const password = randomBytes(24).toString("hex");
  await withClient(migrator, null, (client) =>
    client.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${password}' CONNECTION LIMIT ${options.connectionLimit ?? -1}; ` +
        `GRANT USAGE ON SCHEMA public TO ${role}`,
    ),
  );
  return poolOf({ ...provided, database, user: role, password, ssl: false }, options);
}

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    (error: unknown) => (error as { code?: string }).code ?? String(error),
  );

describe("pool", () => {
  test("pool_settings", async () => {
    const pool = await setup();
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
    const pool = await setup({ max: 1, connectTimeoutMs: 200 });
    const held = await acquire(pool, null);
    const started = Date.now();
    expect(await codeOf(acquire(pool, null))).toBe("db.busy");
    expect(Date.now() - started).toBeLessThan(1500);
    held.release();
  });

  test("acquire_nested_in_deadline", async () => {
    const pool = await setup({ max: 1, connectTimeoutMs: 5000 });
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
    const pool = await setup();
    await withClient(migrator, null, (c) =>
      c.query("CREATE TABLE tx_rows (n int); GRANT SELECT, INSERT ON tx_rows TO PUBLIC"),
    );
    const count = () =>
      withClient(pool, null, async (c) => Number((await c.query("SELECT count(*) AS n FROM tx_rows")).rows[0].n));

    await withTransaction(pool, null, (c) => c.query("INSERT INTO tx_rows VALUES (1)"));
    expect(await count()).toBe(1);

    const boom = new Error("boom");
    await expect(
      withTransaction(pool, null, async (c) => {
        await c.query("INSERT INTO tx_rows VALUES (2)");
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(await count()).toBe(1);

    const deadline = new AbortController();
    expect(
      await codeOf(
        withTransaction(pool, deadline.signal, async (c) => {
          await c.query("INSERT INTO tx_rows VALUES (3)");
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
    const limited = await setup({ connectionLimit: 40 });
    await withClient(limited, null, async (client) => {
      // floor(40 / 3) = 13
      await expect(checkConnectionBudget(client, [20, 8], 3)).rejects.toMatchObject({ name: "ConfigError" });
      await expect(checkConnectionBudget(client, [8, 4], 3)).resolves.toBeUndefined();
    });
    const unlimited = await setup();
    await withClient(unlimited, null, (client) => checkConnectionBudget(client, [50, 50], 4));
  });
});
