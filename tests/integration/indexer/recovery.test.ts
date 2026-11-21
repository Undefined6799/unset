// Recovery after missed events (interfaces/indexer track.ts and account-jobs.ts over infrastructure/postgres): the
// stream lost events (OutdatedCursor, or a first start with no cursor) and among them an account's deactivation or
// deletion. The real backfill and confirm passes run against real Postgres as the real `indexer` role (TE-2); only our
// PDS's two reads are doubles (TE-1: an unmanaged dependency). Whatever the lost events held, once recovery has run a
// deactivated account is hidden and a deleted one erased, so neither stays in the public views web reads, and a
// reactivated one is shown again.
import { join } from "node:path";
import type { IndexChange } from "@unset/domains-profile";
import { RepoReadError, type RepoSnapshot, type RepoStatus } from "@unset/infrastructure-firehose";
import { createAccountStore, createIndexStore, createTrackStore } from "@unset/infrastructure-postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { confirmPass } from "../../../interfaces/indexer/account-jobs.ts";
import { backfillPass } from "../../../interfaces/indexer/track.ts";
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
const pools = testPools("indexer-recovery-test");
let postgres: PostgresContainer;
let deps: ReturnType<typeof stores>;

/** Still active on our PDS. */
const A = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
/** Deactivated while the stream's events were lost. */
const B = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
/** Deleted while the stream's events were lost. */
const D = "did:plc:dddddddddddddddddddddddd";
/** Hidden as deactivated, and reactivated while the stream's events were lost. */
const R = "did:plc:rrrrrrrrrrrrrrrrrrrrrrrr";
/** Hidden; our PDS calls it active yet keeps refusing its repo (a PDS fault, or a race inside it). */
const L = "did:plc:llllllllllllllllllllllll";
const CID = "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5xzrgnw3hj6aoqe";
const REV = "3kaaaaaaaaa22";
const profile: Extract<IndexChange, { kind: "put" }> = {
  kind: "put",
  collection: "sh.unset.profile",
  rkey: "self",
  cid: CID,
  record: { $type: "sh.unset.profile", displayName: "Ada", createdAt: "2026-11-18T00:00:00.000Z" },
};
const lines = (query: string) => postgres.sql("unset", query).split("\n").filter(Boolean);
const publicDids = () => lines("SELECT did FROM idx.public_profile ORDER BY did");

/** What our PDS answers now: getRepo refuses a deactivated or deleted repo with 400 (infrastructure/firehose/repo.ts). */
const readRepo = async (did: string): Promise<RepoSnapshot> => {
  if (did !== A && did !== R) throw new RepoReadError("not_found");
  return { rev: "3kaaaaaaaaa23", records: [profile] };
};
const readStatus = async (did: string): Promise<RepoStatus> =>
  did === A || did === R || did === L
    ? { kind: "active" }
    : did === B
      ? { kind: "inactive", status: "deactivated" }
      : { kind: "not_found" };

function stores(indexer: ReturnType<typeof pools.open>) {
  return {
    index: createIndexStore(indexer, { source: "pds", timeoutMs: 5_000 }),
    tracks: createTrackStore(indexer, { timeoutMs: 5_000 }),
    accounts: createAccountStore(indexer, { timeoutMs: 5_000 }),
  };
}

const stop = new AbortController().signal;
const backfill = () => backfillPass({ store: deps.tracks, readRepo, timeoutMs: 5_000, signal: stop });
const confirm = () => confirmPass({ store: deps.accounts, readStatus, timeoutMs: 5_000, signal: stop });

beforeAll(async () => {
  postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  await migrateAsMigrator(postgres, migratorPassword);
  postgres.sql("postgres", `ALTER ROLE indexer PASSWORD '${indexerPassword}'`);
  deps = stores(pools.open(postgres, "unset", "indexer", indexerPassword));
  // Three members, each confirmed active with a published profile and no job left: the index as it stood when the
  // stream's events started to be lost.
  let seq = 0;
  for (const did of [A, B, D]) {
    lines(`INSERT INTO idx.account (did, pds_active, updated_at) VALUES ('${did}', true, now())`);
    seq += 1;
    await deps.index.apply({ kind: "repoCommit", seq, did, rev: REV, changes: [profile] });
  }
  lines(
    `INSERT INTO idx.account (did, pds_active, pds_status, updated_at) VALUES ('${R}', false, 'deactivated', now())`,
  );
  expect(publicDids()).toEqual([A, B, D]);
}, 120_000);
afterAll(() => stopAllPostgresAfter(pools.end), STOP_ALL_MS);

describe("recovery after missed events", () => {
  test("recovery.missed_status_changes_reach_the_public_views", async () => {
    await deps.index.missedEvents();
    // Each pass as the process runs it on its timer (interfaces/indexer/run.ts): backfill, then confirm, twice over,
    // since a confirmed status may queue the next job (confirm_deletion, a backfill).
    for (let round = 0; round < 2; round += 1) {
      await backfill();
      await confirm();
    }
    expect(publicDids()).toEqual([A, R]);
    expect(lines(`SELECT pds_active, pds_status FROM idx.account WHERE did = '${B}'`)).toEqual(["f|deactivated"]);
    expect(lines(`SELECT idx.is_erased('${D}')`)).toEqual(["t"]);
    expect(lines(`SELECT count(*) FROM idx.account WHERE did = '${D}'`)).toEqual(["0"]);
    // The active member is read again and stays shown, the reactivated one is shown again; nothing is left waiting.
    expect(lines(`SELECT did, pds_active FROM idx.account WHERE did IN ('${A}', '${R}') ORDER BY did`)).toEqual([
      `${A}|t`,
      `${R}|t`,
    ]);
    expect(lines("SELECT count(*) FROM idx.account_job WHERE due_at <= now()")).toEqual(["0"]);
  });

  test("recovery.status_and_a_refused_repo_do_not_feed_each_other", async () => {
    // confirm_status reveals L and queues a backfill; getRepo refuses it, which queues confirm_status; L is shown by
    // then, so that confirmation queues nothing more (accountStore.ts confirmStatus: only a reveal queues a backfill).
    lines(
      `INSERT INTO idx.account (did, pds_active, pds_status, updated_at) VALUES ('${L}', false, 'deactivated', now())`,
    );
    await deps.index.missedEvents();
    for (let round = 0; round < 4; round += 1) {
      await backfill();
      await confirm();
    }
    expect(lines(`SELECT pds_active FROM idx.account WHERE did = '${L}'`)).toEqual(["t"]);
    expect(lines(`SELECT count(*) FROM idx.account_job WHERE did = '${L}'`)).toEqual(["0"]);
  });
});
