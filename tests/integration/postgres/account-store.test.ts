// P3.06s (infrastructure/postgres/accountStore.ts): what our PDS's answer to getRepoStatus does to an account, against
// real Postgres as the real `indexer` role (TE-2). Revealing waits for this confirmation; hiding never does. Until
// P3.06e grants the indexer core.erase_did, a confirmed deletion hides the account and leaves a visible dead letter.
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
let accounts: AccountStore;
let index: IndexStore;

const A = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const D = "did:plc:dddddddddddddddddddddddd";
const E = "did:plc:eeeeeeeeeeeeeeeeeeeeeeee";
const N = "did:plc:nnnnnnnnnnnnnnnnnnnnnnnn";
const sql = (query: string) => postgres.sql("unset", query);
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
  const indexer = pools.open(postgres, "unset", "indexer", indexerPassword);
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

  test("account.confirmed_deletion_hides_and_leaves_a_visible_dead_letter", async () => {
    await accounts.confirmed(job(D, "confirm_deletion"), { kind: "not_found" });
    await accounts.confirmed(job(N, "confirm_deletion"), { kind: "inactive", status: "deleted" });
    expect(state(D)).toEqual(["f|deleted"]);
    expect(jobs(D)).toEqual([]);
    expect(lines("SELECT did, reason_code FROM idx.dead_letter ORDER BY did")).toEqual([
      `${D}|deletion_confirmed_not_erased`,
      `${N}|deletion_confirmed_not_erased`,
    ]);
    // Confirmed twice, recorded once.
    await accounts.confirmed(job(D, "confirm_deletion"), { kind: "not_found" });
    expect((await index.health()).deletionsNotErased).toBe(2);
  });

  test("account.unconfirmed_deletion_clears_the_status_but_stays_hidden", async () => {
    sql(`UPDATE idx.account SET pds_status = 'deleted' WHERE did = '${A}'`);
    await accounts.confirmed(job(A, "confirm_deletion"), { kind: "active" });
    expect(state(A)).toEqual(["f|-"]);
    expect(jobs(A)).toContain("confirm_status");
    expect(lines("SELECT value FROM idx.ingest_stat WHERE name = 'account_deletion_not_confirmed'")).toEqual(["1"]);
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
});
