// P2.03i (infrastructure/postgres/migrations/0012 and 0013): the two app.session indexes exist in this file's
// database, cloned from the migrated template, so both migrations apply after P2.03x's 0011.
import { relative } from "node:path";
import { afterAll, describe, expect, inject, test } from "vitest";
import { createPool, withClient } from "../../../infrastructure/postgres/index.ts";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const pool = createPool({
  connection: { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false },
  service: "session-indexes-test",
  max: 1,
  connectTimeoutMs: 2000,
  statementTimeoutMs: 2000,
  idleInTransactionTimeoutMs: 5000,
});
afterAll(() => pool.close());

describe("session indexes", () => {
  test("session_indexes_exist", async () => {
    const rows = await withClient(pool, null, async (client) => {
      const result = await client.query<{ name: string; definition: string }>(
        "SELECT indexname AS name, indexdef AS definition FROM pg_catalog.pg_indexes " +
          "WHERE schemaname = 'app' AND tablename = 'session' ORDER BY indexname",
      );
      return result.rows;
    });
    expect(rows).toEqual([
      {
        name: "session_absolute_expires_at",
        definition: "CREATE INDEX session_absolute_expires_at ON app.session USING btree (absolute_expires_at)",
      },
      { name: "session_did", definition: "CREATE INDEX session_did ON app.session USING btree (did)" },
      { name: "session_pkey", definition: "CREATE UNIQUE INDEX session_pkey ON app.session USING btree (id_hash)" },
    ]);
  });
});
