// P3.06s and P3.06e (infrastructure/postgres/accountStore.ts, migration 0029): what our PDS's answer to getRepoStatus
// does to an account, against real Postgres as the real `indexer` role (TE-2). Revealing waits for this confirmation;
// hiding never does. A confirmed deletion is erased through idx.erase_deleted_account, within its hourly cap.
import { join } from "node:path";
import {
  type AccountStore,
  createAccountStore,
  createIndexStore,
  type IndexStore,
  type Pool,
  withClient,
} from "@unset/infrastructure-postgres";
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
const pools = testPools("account-store-test");
let postgres: PostgresContainer;
let migrator: Pool;
let indexer: Pool;
let accounts: AccountStore;
let index: IndexStore;

const A = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const D = "did:plc:dddddddddddddddddddddddd";
const E = "did:plc:eeeeeeeeeeeeeeeeeeeeeeee";
const N = "did:plc:nnnnnnnnnnnnnnnnnnnnnnnn";
const sql = (query: string) => postgres.sql("unset", query);
const erased = (did: string) => lines(`SELECT idx.is_erased('${did}')`)[0] === "t";
const asIndexer = (query: string, did: string) => withClient(indexer, null, (c) => c.query(query, [did]));
const lines = (query: string) => sql(query).split("\n").filter(Boolean);
const state = (did: string) =>
  lines(`SELECT pds_active, coalesce(pds_status, '-') FROM idx.account WHERE did = '${did}'`);
const jobs = (did: string) => lines(`SELECT kind FROM idx.account_job WHERE did = '${did}' ORDER BY kind`);
/** Takes the account's job as a confirm pass would, queueing it first if needed, and returns the claim. */
const job = (did: string, kind: "confirm_status" | "confirm_deletion", attempts = 0) => {
  const claim = lines(`INSERT INTO idx.account_job (did, kind, due_at, attempts, first_queued_at)
    VALUES ('${did}', '${kind}', now() + interval '5 minutes', ${attempts}, now())
    ON CONFLICT (did, kind) DO UPDATE SET due_at = clock_timestamp() + interval '5 minutes', attempts = ${attempts}
    RETURNING due_at::text`)[0];
  return { did, kind, attempts, claim: String(claim) };
};
const account = (did: string, active: boolean, status: string | null, kind?: string) =>
  sql(`INSERT INTO idx.account (did, pds_active, pds_status, updated_at) VALUES ('${did}', ${active},
    ${status === null ? "NULL" : `'${status}'`}, now());
    ${kind === undefined ? "" : `INSERT INTO idx.account_job (did, kind, due_at, attempts, first_queued_at) VALUES ('${did}', '${kind}', now(), 0, now());`}`);

beforeAll(async () => {
  postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  await migrateAsMigrator(postgres, migratorPassword);
  postgres.sql("postgres", `ALTER ROLE indexer PASSWORD '${indexerPassword}'`);
  indexer = pools.open(postgres, "unset", "indexer", indexerPassword);
  migrator = pools.open(postgres, "unset", "migrator", migratorPassword);
  accounts = createAccountStore(indexer, { timeoutMs: 5_000 });
  index = createIndexStore(indexer, { source: "pds", timeoutMs: 5_000 });
}, 120_000);
afterAll(() => stopAllPostgresAfter(pools.end), STOP_ALL_MS);

describe("account store", () => {
  test("account.due_jobs_by_kind", async () => {
    account(A, false, null, "confirm_status");
    account(D, false, "deleted", "confirm_deletion");
    expect((await accounts.dueJobs("confirm_status", 10)).map((due) => due.did)).toEqual([A]);
    expect((await accounts.dueJobs("confirm_deletion", 10)).map((due) => due.did)).toEqual([D]);
    expect(await accounts.dueJobs("confirm_status", 10)).toEqual([]); // claimed: not taken twice
  });

  test("account.confirmed_active_reveals_and_queues_a_backfill", async () => {
    await accounts.confirmed(job(A, "confirm_status"), { kind: "active" });
    expect(state(A)).toEqual(["t|-"]);
    expect(jobs(A)).toEqual(["backfill"]);
    expect(lines(`SELECT count(*) FROM idx.visible_account WHERE did = '${A}'`)).toEqual(["1"]);
  });

  test("account.confirmed_inactive_stays_hidden", async () => {
    sql(`UPDATE idx.account SET pds_active = false WHERE did = '${A}'`);
    sql(`INSERT INTO idx.account_job (did, kind, due_at, attempts, first_queued_at)
      VALUES ('${A}', 'confirm_status', now(), 0, now())`);
    await accounts.confirmed(job(A, "confirm_status"), { kind: "inactive", status: "takendown" });
    expect(state(A)).toEqual(["f|takendown"]);
    expect(jobs(A)).toEqual(["backfill"]);
  });

  test("account.active_never_overrides_a_pending_deletion", async () => {
    sql(`INSERT INTO idx.account_job (did, kind, due_at, attempts, first_queued_at)
      VALUES ('${D}', 'confirm_status', now(), 0, now())`);
    await accounts.confirmed(job(D, "confirm_status"), { kind: "active" });
    expect(state(D)).toEqual(["f|deleted"]);
    expect(jobs(D)).toEqual(["confirm_deletion"]);
  });

  test("account.a_takedown_during_the_read_is_not_undone", async () => {
    // The pass reads "active" for T; before it applies, the stream takes T down. The older answer must not reveal T.
    const T = "did:plc:tttttttttttttttttttttttt";
    account(T, false, null);
    const claimed = job(T, "confirm_status");
    await index.apply({ kind: "account", seq: 1, did: T, active: false, status: "takendown" });
    await accounts.confirmed(claimed, { kind: "active" });
    expect(state(T)).toEqual(["f|takendown"]);
    expect(lines(`SELECT due_at <= now() FROM idx.account_job WHERE did = '${T}'`)).toEqual(["t"]);
    expect(lines("SELECT value FROM idx.ingest_stat WHERE name = 'account_job_superseded'")).toEqual(["1"]);
  });

  test("account.not_found_hides_and_asks_for_deletion", async () => {
    account(N, true, null, "confirm_status");
    await accounts.confirmed(job(N, "confirm_status"), { kind: "not_found" });
    expect(state(N)).toEqual(["f|deleted"]);
    expect(jobs(N)).toEqual(["confirm_deletion"]);
  });

  test("account.confirmed_deletion_erases_the_account", async () => {
    await accounts.confirmed(job(D, "confirm_deletion"), { kind: "not_found" });
    await accounts.confirmed(job(N, "confirm_deletion"), { kind: "inactive", status: "deleted" });
    expect([erased(D), erased(N)]).toEqual([true, true]);
    expect(lines(`SELECT count(*) FROM idx.account WHERE did IN ('${D}', '${N}')`)).toEqual(["0"]);
    expect(lines("SELECT value FROM idx.ingest_stat WHERE name = 'account_deletion_erased'")).toEqual(["2"]);
    // The erasure is recorded by the indexer's session, without the person (core.erase_did step 8).
    expect(
      lines(
        "SELECT c.action || ' ' || c.writer || ' ' || (b.subject IS NULL) FROM audit.chain c " +
          "JOIN audit.event_body b USING (lane, seq) WHERE c.lane = 'sec' ORDER BY c.seq DESC LIMIT 1",
      ),
    ).toEqual(["account.erased indexer true"]);
    expect((await index.health()).deletionsNotErased).toBe(0);
  });

  test("account.erasure_refuses_an_account_not_confirmed_deleted", async () => {
    const X = "did:plc:xxxxxxxxxxxxxxxxxxxxxxxx";
    const U = "did:plc:uuuuuuuuuuuuuuuuuuuuuuuu";
    account(X, true, null);
    const refuse = (did: string) =>
      expect(asIndexer("SELECT idx.erase_deleted_account($1)", did)).rejects.toThrow("erase_not_confirmed_deleted");
    await refuse(X); // active
    sql(`UPDATE idx.account SET pds_active = false, pds_status = 'takendown' WHERE did = '${X}'`);
    await refuse(X); // hidden for another reason
    sql(`UPDATE idx.account SET pds_active = true, pds_status = 'deleted' WHERE did = '${X}'`);
    await refuse(X); // deleted but still shown: not the state confirm_deletion writes
    await refuse(U); // not tracked
    expect(erased(X)).toBe(false);
    // And the indexer still cannot reach core.erase_did itself, with any reason.
    await expect(asIndexer("SELECT core.erase_did($1, 'user_request')", X)).rejects.toThrow("permission denied");
  });

  test("account.erasure_stops_at_its_hourly_cap", async () => {
    const C = "did:plc:cccccccccccccccccccccccc";
    account(C, false, "deleted", "confirm_deletion");
    // With D and N above, twenty account_deleted erasures in the last hour (the cap), as a runaway indexer would leave.
    sql(`INSERT INTO core.erased_did (did_hmac, erased_at, why, outcome)
      SELECT public.gen_random_bytes(32), now(), 'account_deleted', 'erased' FROM generate_series(1, 18)`);
    await accounts.confirmed(job(C, "confirm_deletion"), { kind: "not_found" });
    expect(erased(C)).toBe(false);
    expect(state(C)).toEqual(["f|deleted"]);
    expect(
      lines(`SELECT due_at > now() + interval '50 minutes' FROM idx.account_job WHERE did = '${C}'
        AND kind = 'confirm_deletion'`),
    ).toEqual(["t"]);
    expect(lines("SELECT value FROM idx.ingest_stat WHERE name = 'account_erase_capped'")).toEqual(["1"]);
    // An erasure an hour old no longer counts.
    sql("UPDATE core.erased_did SET erased_at = now() - interval '61 minutes' WHERE why = 'account_deleted'");
    await accounts.confirmed(job(C, "confirm_deletion"), { kind: "not_found" });
    expect(erased(C)).toBe(true);
  });

  test("account.unconfirmed_deletion_clears_the_status_but_stays_hidden", async () => {
    sql(`UPDATE idx.account SET pds_status = 'deleted' WHERE did = '${A}'`);
    await accounts.confirmed(job(A, "confirm_deletion"), { kind: "active" });
    expect(state(A)).toEqual(["f|-"]);
    expect(jobs(A)).toContain("confirm_status");
    expect(lines("SELECT value FROM idx.ingest_stat WHERE name = 'account_deletion_not_confirmed'")).toEqual(["1"]);
  });

  test("account.a_newer_status_during_the_deletion_read_wins", async () => {
    // The pass reads "gone" for R and Q; before it applies, the stream says R is active again and Q is taken down. The
    // older answers change nothing: no dead letter, the newer statuses stand, and each job asks afresh.
    const R = "did:plc:rrrrrrrrrrrrrrrrrrrrrrrr";
    const Q = "did:plc:qqqqqqqqqqqqqqqqqqqqqqqq";
    account(R, false, "deleted");
    account(Q, false, "deleted");
    const forR = job(R, "confirm_deletion");
    const forQ = job(Q, "confirm_deletion");
    await index.apply({ kind: "account", seq: 2, did: R, active: true, status: null });
    await index.apply({ kind: "account", seq: 3, did: Q, active: false, status: "takendown" });
    await accounts.confirmed(forR, { kind: "not_found" });
    await accounts.confirmed(forQ, { kind: "not_found" });
    expect(erased(R)).toBe(false);
    expect(erased(Q)).toBe(false);
    expect(state(Q)).toEqual(["f|takendown"]);
    expect(lines(`SELECT count(*) FROM idx.dead_letter WHERE did IN ('${R}', '${Q}')`)).toEqual(["0"]);
    expect(
      lines(`SELECT did, due_at <= now() FROM idx.account_job WHERE did IN ('${R}', '${Q}')
        AND kind = 'confirm_deletion' ORDER BY did`),
    ).toEqual([`${Q}|t`, `${R}|t`]);
  });

  test("account.active_after_a_deletion_asks_about_the_deletion_again", async () => {
    // An account held as deleted that our PDS now calls active is not left hidden for good: the deletion is asked
    // about again, and a "not deleted" answer clears it.
    const B = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
    account(B, false, "deleted", "confirm_status");
    await accounts.confirmed(job(B, "confirm_status"), { kind: "active" });
    expect(jobs(B)).toEqual(["confirm_deletion"]);
    await accounts.confirmed(job(B, "confirm_deletion"), { kind: "active" });
    expect(state(B)).toEqual(["f|-"]);
    expect(jobs(B)).toEqual(["confirm_status"]);
  });

  test("account.a_deletion_found_not_deleted_leaves_the_unerased_count", async () => {
    // A P3.06s dead letter for W, whose deletion our PDS now denies: W is no longer waiting for erasure, so health
    // stops counting it (the dead letter itself is append-only for indexer).
    const W = "did:plc:wwwwwwwwwwwwwwwwwwwwwwww";
    account(W, false, "deleted");
    sql(`INSERT INTO idx.dead_letter (kind, did, reason_code, attempts, first_seen, last_seen)
      VALUES ('track', '${W}', 'deletion_confirmed_not_erased', 1, now(), now())`);
    expect((await index.health()).deletionsNotErased).toBe(1);
    await accounts.confirmed(job(W, "confirm_deletion"), { kind: "active" });
    expect((await index.health()).deletionsNotErased).toBe(0);
  });

  test("account.erased_did_is_never_revealed", async () => {
    account(E, false, null, "confirm_status");
    await withClient(migrator, null, (c) => c.query("SELECT core.erase_did($1, 'user_request')", [E]));
    sql(`INSERT INTO idx.account (did, updated_at) VALUES ('${E}', now())`);
    await accounts.confirmed(job(E, "confirm_status"), { kind: "active" });
    expect(state(E)).toEqual(["f|-"]);
  });

  test("account.unavailable_backs_off_and_gives_up_after_seven_days", async () => {
    sql(`INSERT INTO idx.account_job (did, kind, due_at, attempts, first_queued_at)
      VALUES ('${A}', 'confirm_deletion', now(), 0, now()) ON CONFLICT DO NOTHING`);
    await accounts.failed(job(A, "confirm_deletion"));
    expect(
      lines(`SELECT attempts, due_at > now() + interval '50 seconds' FROM idx.account_job
        WHERE did = '${A}' AND kind = 'confirm_deletion'`),
    ).toEqual(["1|t"]);
    sql(`UPDATE idx.account_job SET first_queued_at = now() - interval '8 days' WHERE did = '${A}'`);
    await accounts.failed(job(A, "confirm_deletion", 9));
    expect(jobs(A)).not.toContain("confirm_deletion");
    expect(state(A)).toEqual(["f|-"]);
    expect(lines(`SELECT reason_code FROM idx.dead_letter WHERE did = '${A}'`)).toEqual([
      "confirm_deletion_unavailable",
    ]);
  });

  test("account.health_counts_deletions_still_waiting", async () => {
    const before = (await accounts.health()).deletionsWaiting;
    account("did:plc:gggggggggggggggggggggggg", false, "deleted", "confirm_deletion"); // waiting: counted
    account("did:plc:hhhhhhhhhhhhhhhhhhhhhhhh", false, "deleted"); // no job left: not waiting
    account("did:plc:iiiiiiiiiiiiiiiiiiiiiiii", true, null, "confirm_deletion"); // shown again: not held
    expect((await accounts.health()).deletionsWaiting).toBe(before + 1);
  });
});
