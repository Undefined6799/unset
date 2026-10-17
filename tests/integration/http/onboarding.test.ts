// P2.12: the account row against Postgres as web. The birth date never reaches a parameter, so the row cannot hold it.
import { relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import { createPool, withClient } from "@unset/infrastructure-postgres";
import { afterAll, expect, inject, test } from "vitest";
import { createAccountStore } from "../../../interfaces/http/account.ts";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const pool = createPool({
  connection: { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false },
  service: "onboarding-http",
  max: 2,
  connectTimeoutMs: 5000,
});
afterAll(() => pool.end());

const did = (text: string): Did => {
  const parsed = parseDid(text);
  if (parsed === null) throw new Error("test DID did not parse");
  return parsed;
};
const ADULT = did(`did:plc:${"a".repeat(24)}`);
const CHILD = did(`did:plc:${"b".repeat(24)}`);
const MOVED = did(`did:plc:${"c".repeat(24)}`);
const store = createAccountStore(pool);

const columns = () =>
  withClient(pool, null, async (db) => {
    const { rows } = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'account'",
    );
    return rows.map((row) => row.column_name);
  });

test("age.valid_adult", async () => {
  expect(await columns()).not.toEqual(expect.arrayContaining(["birth_date", "date_of_birth", "born_on"]));
  expect(await store.confirmAdult(ADULT, AbortSignal.timeout(5_000))).toBe(true);
  const rows = await withClient(pool, null, async (db) => {
    const found = await db.query<Record<string, unknown>>(
      "SELECT did, onboarding, age_confirmed_at, terms_version FROM app.account WHERE did = $1",
      [ADULT],
    );
    return found.rows;
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ onboarding: "terms", terms_version: null });
  expect(rows[0]?.age_confirmed_at).toBeInstanceOf(Date);
  expect(JSON.stringify(rows)).not.toContain("2000-01-01");
});

test("age.underage_blocks", async () => {
  const appended = await store.blockUnderage(CHILD, true, AbortSignal.timeout(5_000));
  if (appended === null) throw new Error("block did not commit");
  expect(appended.lane).toBe("sec");
  expect(appended.seq).toBeGreaterThan(0);
  expect(await store.blockUnderage(CHILD, true, AbortSignal.timeout(5_000))).toBeNull();
  expect(await store.confirmAdult(MOVED, AbortSignal.timeout(5_000))).toBe(true);
  expect(await store.blockUnderage(MOVED, false, AbortSignal.timeout(5_000))).toBeNull();
  const rows = await withClient(pool, null, async (db) => {
    const found = await db.query<{ did: string; onboarding: string }>(
      "SELECT did, onboarding FROM app.account WHERE did IN ($1, $2) ORDER BY did",
      [CHILD, MOVED],
    );
    return found.rows;
  });
  expect(rows).toEqual([
    { did: CHILD, onboarding: "blocked_underage" },
    { did: MOVED, onboarding: "terms" },
  ]);
});
