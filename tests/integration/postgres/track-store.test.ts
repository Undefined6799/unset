// P3.05s PR 2b (infrastructure/postgres/trackStore.ts): the track queue and the getRepo backfill against real
// Postgres, as the real `indexer` role (TE-2). Erasure runs as migrator, its only caller (migration 0022's header);
// pds_active is set as the superuser, as the account-state machine (P3.06s) will.
import { join } from "node:path";
import { type IndexChange, MAX_SECTIONS_PER_ACCOUNT } from "@unset/domains-profile";
import {
  type BackfillJob,
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
const B32 = "234567abcdefghijklmnopqrstuvwxyz";
/** A valid TID record key ending in n written in base32-sortable digits. */
const tid = (prefix: string, n: number) =>
  prefix + [3, 2, 1, 0].map((place) => B32[Math.floor(n / 32 ** place) % 32]).join("");
const rev = (n: number) => `3kaaaaaaaaa${String(n).padStart(2, "2")}`;
const lines = (query: string) => postgres.sql("unset", query).split("\n").filter(Boolean);
const sql = (query: string) => postgres.sql("unset", query);

const profile = (displayName = "Ada"): IndexChange => ({
  kind: "put",
  collection: "sh.unset.profile",
  rkey: "self",
  cid: CID,
  record: {
    $type: "sh.unset.profile",
    displayName,
    createdAt: T,
  },
});
/** The main page listing CARD_1 then CARD_2 (ADR 0091). */
const page: IndexChange = {
  kind: "put",
  collection: "sh.unset.page",
  rkey: "self",
  cid: CID,
  record: {
    $type: "sh.unset.page",
    cards: [CARD_1, CARD_2].map((rkey) => ({ uri: `at://${A}/sh.unset.card/${rkey}` })),
    createdAt: T,
  },
};
const section = (rkey: string): IndexChange => ({
  kind: "put",
  collection: "sh.unset.card",
  rkey,
  cid: CID,
  record: { $type: "sh.unset.card", content: { $type: "sh.unset.block.text", text: "hi" }, createdAt: T },
});
const request = (did: string) => sql(`INSERT INTO idx.track_request (did, requested_at) VALUES ('${did}', now())`);
const activate = (did: string) => sql(`UPDATE idx.account SET pds_active = true WHERE did = '${did}'`);
const jobs = (did: string) => lines(`SELECT kind FROM idx.account_job WHERE did = '${did}' ORDER BY kind`);
/** Takes the account's backfill job as the backfill pass would, queueing it first if needed, and returns the claim. */
const claim = (did: string, attempts = 0): BackfillJob => {
  const token = lines(`INSERT INTO idx.account_job (did, kind, due_at, attempts, first_queued_at)
    VALUES ('${did}', 'backfill', now() + interval '10 minutes', ${attempts}, now())
    ON CONFLICT (did, kind) DO UPDATE SET due_at = clock_timestamp() + interval '10 minutes', attempts = ${attempts}
    RETURNING due_at::text`)[0];
  return { did, attempts, claim: String(token) };
};
const snapshot = (did: string, at: string, records: IndexChange[]) => tracks.applySnapshot(claim(did), at, records);
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
    expect(await tracks.pendingTracks(10, [])).toEqual([A, F]);
    expect(await tracks.track(A, true)).toBe("tracked");
    expect(await tracks.track(F, false)).toBe("foreign");
    expect(lines("SELECT did, pds_active FROM idx.account")).toEqual([`${A}|f`]);
    expect(jobs(A)).toEqual(["backfill", "confirm_status"]);
    expect(await tracks.pendingTracks(10, [])).toEqual([]);
  });

  test("track.unresolved_did_is_skipped_then_dropped", async () => {
    const U = "did:plc:uuuuuuuuuuuuuuuuuuuuuuuu";
    request(U);
    request(F);
    expect(await tracks.pendingTracks(10, [U])).toEqual([F]);
    await tracks.dropUnresolved(U);
    expect(await tracks.pendingTracks(10, [])).toEqual([F]);
    expect(lines("SELECT value FROM idx.ingest_stat WHERE name = 'track_unresolved'")).toEqual(["1"]);
    await tracks.track(F, false);
  });

  test("track.inactive_account_backfill_writes_nothing", async () => {
    await snapshot(A, rev(3), [profile()]);
    expect(lines("SELECT count(*) FROM idx.profile")).toEqual(["0"]);
    expect(jobs(A)).toEqual(["confirm_status"]);
  });

  test("track.backfill_writes_the_snapshot", async () => {
    activate(A);
    await snapshot(A, rev(3), [profile(), page, section(CARD_1), section(CARD_2)]);
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
    await snapshot(A, rev(4), [profile(), section(CARD_1)]);
    expect(lines(`SELECT rkey FROM idx.section WHERE did = '${A}'`)).toEqual([CARD_1]);
  });

  test("track.backfill_older_than_the_index_writes_nothing_and_comes_again", async () => {
    // The repo was read at rev 5; before the snapshot is applied the stream hard-deletes CARD_1 at rev 6. The older
    // snapshot must not bring CARD_1 back: it writes nothing and the backfill runs again for a newer read.
    seq += 1;
    await index.apply({
      kind: "repoCommit",
      seq,
      did: A,
      rev: rev(6),
      changes: [section("3jzfcijpj2z2c"), { kind: "delete", collection: "sh.unset.card", rkey: CARD_1 }],
    });
    await snapshot(A, rev(5), [profile("Old"), section(CARD_1)]);
    expect(lines(`SELECT rkey FROM idx.section WHERE did = '${A}' ORDER BY rkey`)).toEqual(["3jzfcijpj2z2c"]);
    expect(lines(`SELECT display_name, last_rev FROM idx.profile JOIN idx.account USING (did)`)).toEqual([
      `Ada|${rev(6)}`,
    ]);
    expect(lines(`SELECT kind FROM idx.account_job WHERE did = '${A}' AND due_at <= now()`)).toContain("backfill");
    expect(lines("SELECT value FROM idx.ingest_stat WHERE name = 'backfill_stale'")).toEqual(["1"]);
  });

  test("track.backfill_drops_an_older_version_of_a_record_it_now_skips", async () => {
    await snapshot(A, rev(7), [
      { kind: "put", collection: "sh.unset.card", rkey: CARD_1, cid: CID, record: { $type: "sh.unset.card" } },
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
    await snapshot(E, rev(3), [profile(), section(CARD_1)]);
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
    await tracks.backfillFailed(claim(B), "failed");
    expect(
      lines(`SELECT attempts, due_at > now() FROM idx.account_job WHERE did = '${B}' AND kind = 'backfill'`),
    ).toEqual(["1|t"]);
    expect(await tracks.dueBackfills(10)).toEqual([]);
    await tracks.backfillFailed(claim(B, MAX_BACKFILL_ATTEMPTS - 1), "failed");
    expect(jobs(B)).toEqual(["confirm_status"]);
    expect(lines(`SELECT kind, did, reason_code FROM idx.dead_letter`)).toEqual([`backfill|${B}|backfill_failed`]);
  });

  test("track.gone_repo_ends_the_job_and_asks_for_the_status", async () => {
    sql(`UPDATE idx.account_job SET due_at = now() WHERE did = '${A}'`);
    sql(
      `INSERT INTO idx.account_job (did, kind, due_at, attempts, first_queued_at) VALUES ('${A}', 'backfill', now(), 0, now())`,
    );
    const [due] = await tracks.dueBackfills(10);
    expect(due?.did).toBe(A);
    expect(await tracks.dueBackfills(10)).toEqual([]); // claimed: a second pass does not take it too
    sql(`DELETE FROM idx.account_job WHERE did = '${A}' AND kind = 'confirm_status'`);
    await tracks.backfillFailed(due as BackfillJob, "gone");
    expect(jobs(A)).toEqual(["confirm_status"]); // getRepo refused the repo: only getRepoStatus says why
  });

  test("track.gone_repo_of_an_erased_did_queues_nothing", async () => {
    request(F);
    await tracks.track(F, true);
    const job = claim(F);
    await erase(F);
    await tracks.backfillFailed(job, "gone");
    expect(jobs(F)).toEqual([]);
  });

  test("track.a_backfill_asked_for_during_the_read_survives", async () => {
    // The pass claims A's job and reads the repo; meanwhile a sync frame (or a dead-lettered commit) asks for another
    // backfill. Applying the older read must not end that newer request.
    const job = claim(A);
    seq += 1;
    await index.apply({ kind: "sync", seq, did: A });
    await tracks.applySnapshot(job, rev(7), [profile()]);
    expect(lines(`SELECT due_at <= now() FROM idx.account_job WHERE did = '${A}' AND kind = 'backfill'`)).toEqual([
      "t",
    ]);
    // Nor does a failure of that older read back the newer request off.
    const again = claim(A);
    seq += 1;
    await index.apply({ kind: "sync", seq, did: A });
    await tracks.backfillFailed(again, "failed");
    expect(
      lines(`SELECT attempts, due_at <= now() FROM idx.account_job WHERE did = '${A}' AND kind = 'backfill'`),
    ).toEqual(["0|t"]);
  });

  test("track.missed_events_during_the_read_survive", async () => {
    // The stream lost events (OutdatedCursor) while a pass read A's repo. The recovery asks every account for a fresh
    // read, and applying the older read must not end that request: the lost events may postdate its snapshot.
    const job = claim(A);
    await index.missedEvents();
    await tracks.applySnapshot(job, rev(8), [profile()]);
    expect(lines(`SELECT due_at <= now() FROM idx.account_job WHERE did = '${A}' AND kind = 'backfill'`)).toEqual([
      "t",
    ]);
  });

  test("track.backfill_replaces_sections_at_the_cap", async () => {
    // A holds the cap of old sections; the repo now holds as many different ones. The old ones go first, so every new
    // one fits.
    sql(`DELETE FROM idx.section WHERE did = '${A}'`);
    const old = Array.from({ length: MAX_SECTIONS_PER_ACCOUNT }, (_, n) => section(tid("3kbbbbbbb", n)));
    seq += 1;
    await index.apply({ kind: "repoCommit", seq, did: A, rev: rev(32), changes: old });
    expect(lines(`SELECT count(*) FROM idx.section WHERE did = '${A}'`)).toEqual([String(MAX_SECTIONS_PER_ACCOUNT)]);
    const fresh = Array.from({ length: MAX_SECTIONS_PER_ACCOUNT }, (_, n) => section(tid("3kccccccc", n)));
    await snapshot(A, rev(33), fresh);
    expect(lines(`SELECT count(*) FROM idx.section WHERE did = '${A}' AND rkey LIKE '3kccccccc%'`)).toEqual([
      String(MAX_SECTIONS_PER_ACCOUNT),
    ]);
  });
});
