// The one place code takes a pooled client (P1.11p; plan §6.1 Deadlines; Semgrep pool-access-single-file allows
// pool.connect and pool.query only here). One pool per process role, lazy: `new pg.Pool()` opens no connection
// (pg-pool 3.14.0 index.js connect()), so nothing connects until the first acquire.
import { ConfigError } from "@unset/shared-config";
import { AppError } from "@unset/shared-errors";
import pg from "pg";
import type { Connection } from "./config.ts";

export type PoolClient = pg.PoolClient;

export type PoolOptions = {
  readonly connection: Connection;
  /** Sent as `application_name`, so `pg_stat_activity` shows which service holds a connection. */
  readonly service: string;
  readonly max: number;
  /** PG_CONNECT_TIMEOUT_MS: the longest wait for a client, nested inside the caller's deadline. */
  readonly connectTimeoutMs: number;
  /** The role's `statement_timeout` (2 s on `web`, plan §6.1). */
  readonly statementTimeoutMs: number;
  readonly idleInTransactionTimeoutMs: number;
};

export type Pool = {
  /** The driver pool; only this file touches it. */
  readonly driver: pg.Pool;
  readonly connectTimeoutMs: number;
  /** The P1.04 shutdown close hook: ends every connection. */
  readonly close: () => Promise<void>;
};

/** Builds a role's pool. The settings travel in the startup packet (pg 8.23.0 lib/client.js:551-568), not as SETs. */
export function createPool(options: PoolOptions): Pool {
  const driver = new pg.Pool({
    ...options.connection,
    max: options.max,
    // node-postgres waits forever by default (findings F-09); this bounds the wait even without a deadline.
    connectionTimeoutMillis: options.connectTimeoutMs,
    application_name: options.service,
    statement_timeout: options.statementTimeoutMs,
    idle_in_transaction_session_timeout: options.idleInTransactionTimeoutMs,
  });
  // An idle client's dropped connection is reported here; the pool already discards that client.
  driver.on("error", () => undefined);
  return { driver, connectTimeoutMs: options.connectTimeoutMs, close: () => driver.end() };
}

/**
 * A client, waiting at most `min(PG_CONNECT_TIMEOUT_MS, time left on deadline)`. A deadline already fired, or firing
 * while waiting, rejects with `http.deadline`; a client the pool hands over afterwards is released at once. Any pool
 * failure (exhausted, or the server unreachable) rejects with `db.busy`, the driver error kept as its cause.
 */
export async function acquire(pool: Pool, deadline: AbortSignal | null): Promise<PoolClient> {
  if (deadline?.aborted) throw new AppError("http.deadline");
  const pending = pool.driver.connect();
  if (deadline === null) return pending.catch(busy);
  let onAbort = (): void => undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new AppError("http.deadline"));
    deadline.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([pending.catch(busy), aborted]);
  } catch (error) {
    // The pool may still hand a client to this waiter; give it straight back so it never leaks.
    pending.then(
      (client) => client.release(),
      () => undefined, // its own failure was already reported as db.busy, or the deadline won
    );
    throw error;
  } finally {
    deadline.removeEventListener("abort", onAbort);
  }
}

function busy(cause: unknown): never {
  throw new AppError("db.busy", { cause });
}

/**
 * Runs `fn` with a client and always returns it. A client whose `fn` threw is destroyed, not reused, because its
 * session state (an open transaction, a broken connection) is unknown.
 */
export async function withClient<T>(
  pool: Pool,
  deadline: AbortSignal | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await acquire(pool, deadline);
  let result: T;
  try {
    result = await fn(client);
  } catch (error) {
    client.release(error instanceof Error ? error : true);
    throw error;
  }
  client.release();
  return result;
}

/**
 * Boot check, after every pool of the process exists: the pools of all replicas alive during a rollout must fit the
 * role's `rolconnlimit`, so a three-replica `docker-rollout` never meets connection refusals mid-deploy. -1 is no limit.
 */
export async function checkConnectionBudget(
  client: PoolClient,
  pools: readonly number[],
  maxReplicas: number,
): Promise<void> {
  const { rows } = await client.query<{ limit: number }>(
    "SELECT rolconnlimit AS limit FROM pg_roles WHERE rolname = current_user",
  );
  const limit = rows[0]?.limit ?? 0;
  if (limit === -1) return;
  const wanted = pools.reduce((sum, max) => sum + max, 0);
  if (wanted > Math.floor(limit / maxReplicas)) throw new ConfigError([{ key: "PG_POOL_MAX", reason: "invalid" }]);
}
