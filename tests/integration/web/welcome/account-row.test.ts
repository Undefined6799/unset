// P2.12: the account row against Postgres as web. The birth date never reaches a parameter, so the row cannot hold it.
// Moved from tests/integration/http at P1.20k; the audit writer is now the web server's (lib/server/age-gate-audit.ts).
// P3.02s: finishing onboarding queues the member for the indexer (migration 0026), read back as indexer.
import { relative } from "node:path";
import { type Did, parseDid } from "@unset/domains-identity";
import { createAccountRepository, createPool, withClient } from "@unset/infrastructure-postgres";
import { afterAll, expect, inject, test } from "vitest";
import { recordUnderageBlock } from "../../../../interfaces/web/src/lib/server/age-gate-audit.ts";
import { chatAccountsOf } from "../../../support/chat-accounts.ts";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../../..`, import.meta.filename)] ?? "";
const pool = createPool({
  connection: { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false },
  service: "onboarding-http",
  max: 2,
  connectTimeoutMs: 5000,
});
const indexer = createPool({
  connection: { host: provided.host, port: provided.port, ...provided.roles.indexer, database, ssl: false },
  service: "onboarding-indexer",
  max: 1,
  connectTimeoutMs: 5000,
});
afterAll(() => Promise.all([pool.end(), indexer.end()]));

const did = (text: string): Did => {
  const parsed = parseDid(text);
  if (parsed === null) throw new Error("test DID did not parse");
  return parsed;
};
const ADULT = did(`did:plc:${"a".repeat(24)}`);
const CHILD = did(`did:plc:${"b".repeat(24)}`);
const MOVED = did(`did:plc:${"c".repeat(24)}`);
const store = createAccountRepository(pool, { recordUnderageBlock, chatAccounts: chatAccountsOf(pool) });

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

test("age.audit_failure_rolls_block_back", async () => {
  const did = parseDid(`did:plc:${"d".repeat(24)}`);
  if (did === null) throw new Error("test DID did not parse");
  const accountRows = () =>
    withClient(pool, null, async (db) => {
      const found = await db.query("SELECT onboarding FROM app.account WHERE did = $1", [did]);
      return found.rows;
    });
  // The writer appends the real audit row through the block's transaction and then fails, as a database error
  // after the append would. Neither the block nor that audit row may survive.
  let written: { lane: string; seq: number } | null = null;
  const failing = createAccountRepository(pool, {
    recordUnderageBlock: async (tx, subject, hosted) => {
      written = await recordUnderageBlock(tx, subject, hosted);
      throw new Error("audit failed");
    },
    chatAccounts: chatAccountsOf(pool),
  });
  await expect(failing.blockUnderage(did, false, AbortSignal.timeout(5_000))).rejects.toThrow("audit failed");
  expect(written).not.toBeNull();
  expect(await accountRows()).toEqual([]);

  // The account is still at the age step, so the next block commits and writes its one audit row.
  const appended = await store.blockUnderage(did, false, AbortSignal.timeout(5_000));
  expect(appended).not.toBeNull();
  expect(await accountRows()).toEqual([{ onboarding: "blocked_underage" }]);
});

const queued = () =>
  withClient(indexer, null, async (db) => {
    const { rows } = await db.query<{ did: string }>("SELECT did FROM idx.track_request ORDER BY did");
    return rows.map((row) => row.did);
  });

/** The SQLSTATE `sql` fails with as the role behind `on`, or "ran". */
async function sqlState(on: typeof pool, sql: string, values: unknown[] = []): Promise<string> {
  try {
    await withClient(on, null, (db) => db.query(sql, values));
  } catch (error) {
    let at: unknown = error;
    while (at instanceof Error && (at as { code?: unknown }).code === undefined && at.cause !== undefined)
      at = at.cause;
    return String((at as { code?: unknown }).code);
  }
  return "ran";
}

test("track.only_a_finished_onboarding_queues_the_member", async () => {
  const deadline = () => AbortSignal.timeout(5_000);
  // The tests above left ADULT and MOVED at the terms step and CHILD blocked: nobody is queued.
  expect(await queued()).toEqual([]);
  expect(await store.finishChat(ADULT, deadline())).toBe(false);
  expect(await store.acceptTerms(ADULT, "2026-10-17", "2026-10-17", deadline())).toBe("chat");
  expect(await queued()).toEqual([]);

  expect(await store.finishChat(ADULT, deadline())).toBe(true);
  expect(await queued()).toEqual([ADULT]);
  // A repeat finishes nothing and queues nothing more; a blocked account never reaches the queue.
  expect(await store.finishChat(ADULT, deadline())).toBe(false);
  expect(await store.finishChat(CHILD, deadline())).toBe(false);
  expect(await queued()).toEqual([ADULT]);
});

test("track.grant_web_insert_only", async () => {
  // web adds rows and nothing else; indexer reads and deletes and cannot add (42501: insufficient_privilege).
  expect(await sqlState(pool, "SELECT did FROM idx.track_request")).toBe("42501");
  expect(await sqlState(pool, "UPDATE idx.track_request SET requested_at = now()")).toBe("42501");
  expect(await sqlState(pool, "DELETE FROM idx.track_request WHERE did = $1", [ADULT])).toBe("42501");
  const add = "INSERT INTO idx.track_request (did, requested_at) VALUES ($1, now())";
  expect(await sqlState(indexer, add, [MOVED])).toBe("42501");
  expect(await sqlState(indexer, "UPDATE idx.track_request SET requested_at = now()")).toBe("42501");
  expect(await queued()).toEqual([ADULT]);
  expect(await sqlState(indexer, "DELETE FROM idx.track_request WHERE did = $1", [ADULT])).toBe("ran");
  expect(await queued()).toEqual([]);
});
