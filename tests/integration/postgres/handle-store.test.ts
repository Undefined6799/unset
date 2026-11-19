// P3.08s (infrastructure/postgres/handleStore.ts, migration 0031): what a handle check's outcome does to an account,
// against real Postgres as the real `indexer` role (TE-2). The check itself (verifyHandle plus, for our hosted names,
// our PDS's word) runs before these calls; a stored handle is one that check verified, and one verified holder of a
// handle at a time.
import { join } from "node:path";
import { createHandleStore, type HandleStore, type Pool, withClient } from "@unset/infrastructure-postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  migrateAsMigrator,
  type PostgresContainer,
  randomPassword,
  STOP_ALL_MS,
  startPostgres,
  stopAllPostgresAfter,
  testPools,
} from "../../support/postgres.ts";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");
const indexerPassword = randomPassword();
const migratorPassword = randomPassword();
const pools = testPools("handle-store-test");
let postgres: PostgresContainer;
let indexer: Pool;
let handles: HandleStore;

const A = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const N = "did:plc:nnnnnnnnnnnnnnnnnnnnnnnn";
const sql = (query: string) => postgres.sql("unset", query);
const lines = (query: string) => sql(query).split("\n").filter(Boolean);
const stored = (did: string) =>
  lines(
    `SELECT coalesce(handle, '-'), handle_status, handle_checked_at IS NOT NULL FROM idx.account WHERE did = '${did}'`,
  );
const jobs = (did: string) => lines(`SELECT kind FROM idx.account_job WHERE did = '${did}' ORDER BY kind`);
const account = (did: string, handle: string | null, status: string, checked: string | null) =>
  sql(`INSERT INTO idx.account (did, handle, handle_status, handle_checked_at, pds_active, updated_at)
    VALUES ('${did}', ${handle === null ? "NULL" : `'${handle}'`}, '${status}', ${checked ?? "NULL"}, true, now())`);
const counter = (name: string) =>
  lines(`SELECT coalesce(sum(value), 0) FROM idx.ingest_stat WHERE name = '${name}'`)[0];
/** Queues a check for the DID and claims it as a pass would. */
const claim = async (did: string) => {
  sql(`INSERT INTO idx.account_job (did, kind, due_at, attempts, first_queued_at) VALUES ('${did}', 'handle_check', now(), 0, now())
    ON CONFLICT (did, kind) DO UPDATE SET due_at = now()`);
  const due = await handles.dueChecks(10);
  const job = due.find((one) => one.did === did);
  if (job === undefined) throw new Error("no job claimed");
  return job;
};

beforeAll(async () => {
  postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  await migrateAsMigrator(postgres, migratorPassword);
  postgres.sql("postgres", `ALTER ROLE indexer PASSWORD '${indexerPassword}'`);
  indexer = pools.open(postgres, "unset", "indexer", indexerPassword);
  handles = createHandleStore(indexer, { timeoutMs: 5_000 });
}, 120_000);
afterAll(() => stopAllPostgresAfter(pools.end), STOP_ALL_MS);

describe("handle store", () => {
  test("handle.new_account_null_checked_at_gets_verified", async () => {
    account(N, null, "unresolved", null);
    expect(await handles.queueStale(10, 86_400)).toBe(1);
    const [job] = await handles.dueChecks(10);
    expect(job?.did).toBe(N);
    await handles.checked(job as NonNullable<typeof job>, { status: "verified", handle: "new.example.org" });
    expect(stored(N)).toEqual(["new.example.org|verified|t"]);
    expect(jobs(N)).toEqual([]);
    expect(await handles.queueStale(10, 86_400)).toBe(0); // checked just now: not stale
  });

  test("handle.invalid_clears_the_stored_handle", async () => {
    account(A, "alice.example.org", "verified", "now()");
    await handles.checked(await claim(A), { status: "invalid" });
    expect(stored(A)).toEqual(["-|invalid|t"]);
  });

  test("handle.unresolved_keeps_stored_and_asks_again_later", async () => {
    sql(`UPDATE idx.account SET handle = 'alice.example.org', handle_status = 'verified',
      handle_checked_at = now() - interval '2 days' WHERE did = '${A}'`);
    await handles.checked(await claim(A), { status: "unresolved" });
    expect(stored(A)).toEqual(["alice.example.org|verified|t"]);
    expect(lines(`SELECT due_at > now() + interval '1 minute' FROM idx.account_job WHERE did = '${A}'`)).toEqual(["t"]);
    sql(`DELETE FROM idx.account_job WHERE did = '${A}'`);
  });

  test("handle.collision_moves_the_other_holder_to_unresolved", async () => {
    // B verified alice's old name after alice moved off it; the old holder is asked again, never left verified twice.
    account(B, "bob.example.org", "verified", "now()");
    await handles.checked(await claim(B), { status: "verified", handle: "alice.example.org" });
    expect(stored(B)).toEqual(["alice.example.org|verified|t"]);
    expect(stored(A)).toEqual(["alice.example.org|unresolved|t"]);
    expect(jobs(A)).toEqual(["handle_check"]);
    expect(counter("handle_moved")).toBe("1");
  });

  test("handle.two_verified_holders_are_refused_by_the_database", async () => {
    const twice = withClient(indexer, null, (db) =>
      db.query("UPDATE idx.account SET handle = 'alice.example.org', handle_status = 'verified' WHERE did = $1", [A]),
    );
    await expect(twice).rejects.toMatchObject({ code: "23505" });
  });

  test("handle.stale_write_is_dropped_and_the_job_stays_due", async () => {
    // A check read before a newer identity event: the event moved the claim, so the old answer writes nothing and the
    // job asks again.
    const job = await claim(N);
    sql(`UPDATE idx.account_job SET due_at = now() WHERE did = '${N}' AND kind = 'handle_check'`);
    await handles.checked(job, { status: "verified", handle: "stale.example.org" });
    expect(stored(N)).toEqual(["new.example.org|verified|t"]);
    expect(jobs(N)).toEqual(["handle_check"]);
    expect(counter("account_job_superseded")).toBe("1");
  });

  test("handle.an_account_gone_meanwhile_gets_no_write", async () => {
    // Erased or dropped while the check ran: no row is created and the job ends.
    const job = await claim(N);
    sql(`DELETE FROM idx.account WHERE did = '${N}'`);
    await handles.checked(job, { status: "verified", handle: "back.example.org" });
    expect(stored(N)).toEqual([]);
    expect(jobs(N)).toEqual([]);
  });
});
