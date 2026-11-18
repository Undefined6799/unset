// P3.05s PR 2b (infrastructure/postgres/trackStore.ts): the track queue and the getRepo backfill against real
// Postgres, as the real `indexer` role (TE-2). Erasure runs as migrator, its only caller (migration 0022's header);
// pds_active is set as the superuser, as the account-state machine (P3.06s) will.
import { join } from "node:path";
import type { IndexChange } from "@unset/domains-profile";
import {
  createIndexStore,
  createTrackStore,
  type IndexStore,
  MAX_BACKFILL_ATTEMPTS,
  type Pool,
  type TrackStore,
  withClient,
  withTransaction,
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
const pools = testPools("track-store-test");
let postgres: PostgresContainer;
let migrator: Pool;
let tracks: TrackStore;
let index: IndexStore;
let seq = 0;

const A = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const E = "did:plc:eeeeeeeeeeeeeeeeeeeeeeee";
const F = "did:plc:ffffffffffffffffffffffff";
const T = "2026-11-18T00:00:00.000Z";
const CID = "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5xzrgnw3hj6aoqe";
const CARD_1 = "3jzfcijpj2z2a";
const CARD_2 = "3jzfcijpj2z2b";
const rev = (n: number) => `3kaaaaaaaaa${String(n).padStart(2, "2")}`;
const lines = (query: string) => postgres.sql("unset", query).split("\n").filter(Boolean);
const sql = (query: string) => postgres.sql("unset", query);

const profile = (displayName = "Ada"): IndexChange => ({
  kind: "put",
  collection: "sh.unset.profile",
  rkey: "self",
  cid: CID,
  record: { $type: "sh.unset.profile", displayName, createdAt: T, cards: [CARD_1, CARD_2] },
});
const section = (rkey: string): IndexChange => ({
  kind: "put",
  collection: "sh.unset.section",
  rkey,
  cid: CID,
  record: { $type: "sh.unset.section", content: { $type: "sh.unset.section#readme", text: "hi" }, createdAt: T },
});
const request = (did: string) => sql(`INSERT INTO idx.track_request (did, requested_at) VALUES ('${did}', now())`);
const activate = (did: string) => sql(`UPDATE idx.account SET pds_active = true WHERE did = '${did}'`);
const jobs = (did: string) => lines(`SELECT kind FROM idx.account_job WHERE did = '${did}' ORDER BY kind`);
const erase = (did: string) =>
  withClient(migrator, null, (c) => c.query("SELECT core.erase_did($1, 'user_request')", [did]));

beforeAll(async () => {
  postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  await migrateAsMigrator(postgres, migratorPassword);
  postgres.sql("postgres", `ALTER ROLE indexer PASSWORD '${indexerPassword}'`);
  const indexer = pools.open(postgres, "unset", "indexer", indexerPassword);
  migrator = pools.open(postgres, "unset", "migrator", migratorPassword);
  tracks = createTrackStore(indexer, { timeoutMs: 5_000 });
  index = createIndexStore(indexer, { source: "pds", timeoutMs: 5_000 });
}, 120_000);
afterAll(() => stopAllPostgresAfter(pools.end), STOP_ALL_MS);

describe("track store", () => {
  test("track.hosted_did_gets_an_inactive_row_and_its_jobs", async () => {
    request(A);
    request(F);
    expect(await tracks.pendingTracks(10)).toEqual([A, F]);
    expect(await tracks.track(A, true)).toBe("tracked");
    expect(await tracks.track(F, false)).toBe("foreign");
    expect(lines("SELECT did, pds_active FROM idx.account")).toEqual([`${A}|f`]);
    expect(jobs(A)).toEqual(["backfill", "confirm_status"]);
    expect(await tracks.pendingTracks(10)).toEqual([]);
  });

  test("track.inactive_account_backfill_writes_nothing", async () => {
    await tracks.applySnapshot(A, rev(3), [profile()]);
    expect(lines("SELECT count(*) FROM idx.profile")).toEqual(["0"]);
    expect(jobs(A)).toEqual(["confirm_status"]);
  });

  test("track.backfill_writes_the_snapshot", async () => {
    activate(A);
    await tracks.applySnapshot(A, rev(3), [profile(), section(CARD_1), section(CARD_2)]);
    expect(lines(`SELECT rkey, position FROM idx.section WHERE did = '${A}' ORDER BY rkey`)).toEqual([
      `${CARD_1}|0`,
      `${CARD_2}|1`,
    ]);
    expect(lines(`SELECT last_rev, backfilled_at IS NOT NULL FROM idx.account WHERE did = '${A}'`)).toEqual([
      `${rev(3)}|t`,
    ]);
  });

  test("track.backfill_removes_records_the_repo_no_longer_holds", async () => {
    // A delete of CARD_2 was missed (dead-lettered, say): the next snapshot no longer holds it.
    await tracks.applySnapshot(A, rev(4), [profile(), section(CARD_1)]);
    expect(lines(`SELECT rkey FROM idx.section WHERE did = '${A}'`)).toEqual([CARD_1]);
  });

  test("track.backfill_keeps_a_record_a_later_commit_wrote", async () => {
    // The stream applied rev 6 before an older snapshot (rev 5) was written: the newer section stays.
    seq += 1;
    await index.apply({ kind: "repoCommit", seq, did: A, rev: rev(6), changes: [section("3jzfcijpj2z2c")] });
    await tracks.applySnapshot(A, rev(5), [profile("Old"), section(CARD_1)]);
    expect(lines(`SELECT rkey FROM idx.section WHERE did = '${A}' ORDER BY rkey`)).toEqual([CARD_1, "3jzfcijpj2z2c"]);
    expect(lines(`SELECT last_rev FROM idx.account WHERE did = '${A}'`)).toEqual([rev(6)]);
  });

  test("track.backfill_drops_an_older_version_of_a_record_it_now_skips", async () => {
    await tracks.applySnapshot(A, rev(7), [
      { kind: "put", collection: "sh.unset.section", rkey: CARD_1, cid: CID, record: { $type: "sh.unset.section" } },
    ]);
    expect(lines(`SELECT count(*) FROM idx.section WHERE did = '${A}' AND rkey = '${CARD_1}'`)).toEqual(["0"]);
    expect(lines(`SELECT count(*) FROM idx.profile WHERE did = '${A}'`)).toEqual(["0"]);
  });

  test("track.erased_did_is_never_tracked_again", async () => {
    request(E);
    await tracks.track(E, true);
    await erase(E);
    request(E); // the member signs in again after erasure
    expect(await tracks.track(E, true)).toBe("erased");
    expect(lines(`SELECT count(*) FROM idx.account WHERE did = '${E}'`)).toEqual(["0"]);
  });

  test("track.erased_did_stays_erased_under_backfill", async () => {
    // Even with an account row recreated by mistake and active, a backfill writes nothing for an erased DID.
    sql(`INSERT INTO idx.account (did, pds_active, updated_at) VALUES ('${E}', true, now())`);
    await tracks.applySnapshot(E, rev(3), [profile(), section(CARD_1)]);
    expect(lines(`SELECT count(*) FROM idx.profile WHERE did = '${E}'`)).toEqual(["0"]);
    expect(lines(`SELECT count(*) FROM idx.section WHERE did = '${E}'`)).toEqual(["0"]);
  });

  test("track.waits_for_an_erasure_under_way", async () => {
    // Erasure holds its per-DID lock until its tombstone commits; a track request settled meanwhile must wait for it
    // and then see the DID as erased, never recreate its account row.
    const W = "did:plc:wwwwwwwwwwwwwwwwwwwwwwww";
    request(W);
    let settled = false;
    let outcome: Promise<string> = Promise.resolve("");
    await withTransaction(migrator, null, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('erase:' || $1::text))", [W]);
      outcome = tracks.track(W, true).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await c.query("SELECT core.erase_did($1, 'user_request')", [W]);
    });
    expect(await outcome).toBe("erased");
    expect(lines(`SELECT count(*) FROM idx.account WHERE did = '${W}'`)).toEqual(["0"]);
  });

  test("track.failed_backfill_backs_off_then_dead_letters", async () => {
    request(B);
    await tracks.track(B, true);
    await tracks.backfillFailed({ did: B, attempts: 0 }, "failed");
    expect(
      lines(`SELECT attempts, due_at > now() FROM idx.account_job WHERE did = '${B}' AND kind = 'backfill'`),
    ).toEqual(["1|t"]);
    expect(await tracks.dueBackfills(10)).toEqual([]);
    await tracks.backfillFailed({ did: B, attempts: MAX_BACKFILL_ATTEMPTS - 1 }, "failed");
    expect(jobs(B)).toEqual(["confirm_status"]);
    expect(lines(`SELECT kind, did, reason_code FROM idx.dead_letter`)).toEqual([`backfill|${B}|backfill_failed`]);
  });

  test("track.gone_repo_ends_the_job", async () => {
    sql(`UPDATE idx.account_job SET due_at = now() WHERE did = '${A}'`);
    sql(
      `INSERT INTO idx.account_job (did, kind, due_at, attempts, first_queued_at) VALUES ('${A}', 'backfill', now(), 0, now())`,
    );
    expect((await tracks.dueBackfills(10)).map((job) => job.did)).toEqual([A]);
    await tracks.backfillFailed({ did: A, attempts: 0 }, "gone");
    expect(jobs(A)).not.toContain("backfill");
  });
});
