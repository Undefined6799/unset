// The one place a transaction is opened (rule DM-2; Semgrep rule transactions-only-in-tx allows BEGIN, COMMIT and
// ROLLBACK in TypeScript only here). `inTransaction` is the client-level primitive the migration runner uses (P1.11);
// `withTransaction` is what every other caller uses (P1.11p).
import { AppError } from "@unset/shared-errors";
import type { ClientBase } from "pg";
import { type Pool, type PoolClient, withClient } from "./pool.ts";

export type Isolation = "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";

/**
 * Runs `fn` between `BEGIN` and `COMMIT` on one client. Any throw rolls back and is rethrown; a failed rollback is
 * thrown together with the original error, never in place of it.
 */
export async function inTransaction<T>(
  client: ClientBase,
  fn: () => Promise<T>,
  isolation: Isolation = "READ COMMITTED",
): Promise<T> {
  await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
  let result: T;
  try {
    result = await fn();
  } catch (error) {
    await client.query("ROLLBACK").catch((rollbackError: unknown) => {
      throw new AggregateError([error, rollbackError], "transaction failed and its rollback failed too");
    });
    throw error;
  }
  await client.query("COMMIT");
  return result;
}

/**
 * Takes a client within `deadline`, runs `fn` in a transaction on it and always returns the client. A deadline that
 * fired while `fn` ran rolls back with `http.deadline` instead of committing work the caller has given up on.
 */
export function withTransaction<T>(
  pool: Pool,
  deadline: AbortSignal | null,
  fn: (client: PoolClient) => Promise<T>,
  isolation: Isolation = "READ COMMITTED",
): Promise<T> {
  return withClient(pool, deadline, (client) =>
    inTransaction(
      client,
      async () => {
        const result = await fn(client);
        if (deadline?.aborted) throw new AppError("http.deadline");
        return result;
      },
      isolation,
    ),
  );
}
