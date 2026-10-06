// The one place a transaction is opened (rule DM-2; Semgrep rule transactions-only-in-tx allows BEGIN, COMMIT and
// ROLLBACK in TypeScript only here). P1.11 adds the client-level primitive the migration runner needs; P1.11p builds
// the pool-level `withTransaction(pool, deadline, fn)` on it.
import type { ClientBase } from "pg";

/**
 * Runs `fn` between `BEGIN` and `COMMIT` on one client. Any throw rolls back and is rethrown; a failed rollback is
 * thrown together with the original error, never in place of it.
 */
export async function inTransaction<T>(client: ClientBase, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
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
