// P1.11t: the statement count behind query_budget_per_route (README invariant 14; plan §6.1 Data access). Every
// statement a checked-out client sends counts, inside withTransaction too, except transaction control (BEGIN, COMMIT,
// ROLLBACK, SAVEPOINT, RELEASE): the budget is about data round trips, and tx.ts adds those on its own (architecture
// ruling 2026-10-06 (c)). The per-route half is tests/integration/web/query-budget.test.ts (P1.20k), which counts on
// the wire because the built server runs in its own process.
import { relative } from "node:path";
import { createPool, type Pool, withClient, withTransaction } from "@unset/infrastructure-postgres";
import { afterAll, describe, expect, inject, test } from "vitest";

const REPOSITORY = new URL("../../", import.meta.url).pathname;
const provided = inject("postgres");
const database = provided.databases[relative(REPOSITORY, import.meta.filename)] ?? "";
let statements = 0;
const pools: Pool[] = [];
afterAll(() => Promise.all(pools.map((pool) => pool.end())));

function countingPool(): Pool {
  const pool = createPool({
    connection: { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false },
    service: "query-budget",
    max: 1,
    connectTimeoutMs: 2000,
    onStatement: () => {
      statements += 1;
    },
  });
  pools.push(pool);
  return pool;
}

describe("query budget", () => {
  test("query_budget_counts_tx_statements", async () => {
    const pool = countingPool();
    statements = 0;
    await withTransaction(pool, null, async (client) => {
      await client.query("SELECT 1");
      await client.query("SAVEPOINT s");
      await client.query({ text: "SELECT $1::int", values: [2] });
      await client.query("RELEASE SAVEPOINT s");
    });
    await withClient(pool, null, (client) => client.query("SELECT 3"));
    expect(statements).toBe(3);
  });
});
