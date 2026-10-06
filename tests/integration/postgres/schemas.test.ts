// P1.12 (infrastructure/postgres/migrations/0002_schemas.sql): the four application schemas exist in this file's
// database, cloned from the migrated template (P1.11t), and are owned by migrator, except `audit`, which migration
// 0003 hands to audit_owner. Their grants are the grant-matrix test's (tests/integration/postgres/grants.test.ts).
import { relative } from "node:path";
import { afterAll, describe, expect, inject, test } from "vitest";
import { createPool, withClient } from "../../../infrastructure/postgres/index.ts";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const pool = createPool({
  connection: { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false },
  service: "schemas-test",
  max: 1,
  connectTimeoutMs: 2000,
  statementTimeoutMs: 2000,
  idleInTransactionTimeoutMs: 5000,
});
afterAll(() => pool.close());

describe("schemas", () => {
  test("schemas_exist", async () => {
    const rows = await withClient(pool, null, async (client) => {
      const result = await client.query<{ name: string; owner: string }>(
        "SELECT nspname AS name, nspowner::regrole::text AS owner FROM pg_catalog.pg_namespace " +
          "WHERE nspname = ANY($1) ORDER BY nspname",
        [["app", "audit", "idx", "index", "types"]],
      );
      return result.rows;
    });
    // `idx` is the one name for the index schema, never `index` (P1.12 Outputs).
    expect(rows).toEqual([
      { name: "app", owner: "migrator" },
      { name: "audit", owner: "audit_owner" },
      { name: "idx", owner: "migrator" },
      { name: "types", owner: "migrator" },
    ]);
  });
});
