// P3.05s (infrastructure/postgres/indexStore.ts): the index's writer against real Postgres, connected as the real
// `indexer` role (TE-2). Account rows and pds_active are set as the superuser, as the track loop (P3.02s) and the
// account-state machine (P3.06s) will. The tests run in order on one database of their own container.
import { join } from "node:path";
import { type IndexChange, MAX_PAGE_BYTES, MAX_SECTIONS_PER_ACCOUNT, recordBytes } from "@unset/domains-profile";
import {
  createIndexStore,
  type IndexStore,
  type Pool,
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
const pools = testPools("index-store-test");
let postgres: PostgresContainer;
let indexer: Pool;
let migrator: Pool;
let store: IndexStore;
let seq = 0;

const A = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const E = "did:plc:eeeeeeeeeeeeeeeeeeeeeeee";
const C = "did:plc:cccccccccccccccccccccccc";
const D = "did:plc:dddddddddddddddddddddddd";
const G = "did:plc:gggggggggggggggggggggggg";
const H = "did:plc:hhhhhhhhhhhhhhhhhhhhhhhh";
const I = "did:plc:iiiiiiiiiiiiiiiiiiiiiiii";
const T = "2026-11-18T00:00:00.000Z";
const CID = "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5xzrgnw3hj6aoqe";
const BLOB = "bafkreibme22gw2h7y2h7tg2fhqotaqjucnbc24deqo72b6mkl2egezxhvy";
const CARD_1 = "3jzfcijpj2z2a";
const CARD_2 = "3jzfcijpj2z2b";
/** A page's card list as it is written: the addresses of A's cards (ADR 0086). */
const listOf = (...rkeys: string[]) => rkeys.map((rkey) => ({ uri: `at://${A}/sh.unset.card/${rkey}` }));
const rev = (n: number) => `3kaaaaaaaaa${String(n).padStart(2, "2")}`; // TIDs that sort as n does, for n in 2..9
const sql = (query: string) => postgres.sql("unset", query);
const lines = (query: string) => postgres.sql("unset", query).split("\n").filter(Boolean);
const stat = (name: string) => lines(`SELECT value FROM idx.ingest_stat WHERE name = '${name}'`)[0] ?? "0";

const profile = (extra: Record<string, unknown> = {}): IndexChange => ({
  kind: "put",
  collection: "sh.unset.profile",
  rkey: "self",
  cid: CID,
  record: { $type: "sh.unset.profile", displayName: "Ada", createdAt: T, ...extra },
});
/** The main page listing `cards` (ADR 0091). */
const page = (cards: readonly { uri: string }[], rkey = "self"): IndexChange => ({
  kind: "put",
  collection: "sh.unset.page",
  rkey,
  cid: CID,
  record: { $type: "sh.unset.page", cards, createdAt: T },
});
const section = (rkey: string): IndexChange => ({
  kind: "put",
  collection: "sh.unset.card",
  rkey,
  cid: CID,
  record: { $type: "sh.unset.card", content: { $type: "sh.unset.block.text", text: "hi" }, createdAt: T },
});
const commit = (did: string, r: string | null, changes: IndexChange[]) =>
  store.apply({ kind: "repoCommit", seq: ++seq, did, rev: r, changes });

function track(did: string, active: boolean): void {
  postgres.sql("unset", `INSERT INTO idx.account (did, pds_active, updated_at) VALUES ('${did}', ${active}, now())`);
}

beforeAll(async () => {
  postgres = await startPostgres({
    initDir: join(REPOSITORY, "deployment", "postgres", "init"),
    secrets: { pg_migrator_password: migratorPassword, pg_tap_password: randomPassword() },
  });
  await migrateAsMigrator(postgres, migratorPassword);
  postgres.sql("postgres", `ALTER ROLE indexer PASSWORD '${indexerPassword}'`);
  indexer = pools.open(postgres, "unset", "indexer", indexerPassword);
  migrator = pools.open(postgres, "unset", "migrator", migratorPassword);
  store = createIndexStore(indexer, { source: "pds", timeoutMs: 5_000 });
  track(A, true);
}, 120_000);
afterAll(() => stopAllPostgresAfter(pools.end), STOP_ALL_MS);

describe("index store", () => {
  test("index.cursor_starts_null_and_advances_only_with_a_frame", async () => {
    expect(await store.cursor()).toBeNull();
    await commit(A, rev(3), [profile({ avatar: blob() }), page(listOf(CARD_2, CARD_1))]);
    expect(await store.cursor()).toBe(seq);
    expect(lines(`SELECT display_name, avatar_cid, rev FROM idx.profile WHERE did = '${A}'`)).toEqual([
      `Ada|${BLOB}|${rev(3)}`,
    ]);
    expect(lines(`SELECT cid FROM idx.record_blob WHERE did = '${A}'`)).toEqual([BLOB]);
    expect(lines(`SELECT last_rev FROM idx.account WHERE did = '${A}'`)).toEqual([rev(3)]);
  });

  test("index.sections_take_their_place_in_the_card_list", async () => {
    await commit(A, rev(4), [section(CARD_1), section(CARD_2), section("3jzfcijpj2z2c")]);
    expect(
      lines(`SELECT rkey, coalesce(position::text, '-') FROM idx.section WHERE did = '${A}' ORDER BY rkey`),
    ).toEqual([`${CARD_1}|1`, `${CARD_2}|0`, "3jzfcijpj2z2c|-"]);
    await commit(A, rev(4), [profile(), page(listOf(CARD_1))]); // an equal rev applies (book P3.05, F-05)
    expect(lines(`SELECT rkey FROM idx.section WHERE did = '${A}' AND position = 0`)).toEqual([CARD_1]);
    expect(lines(`SELECT count(*) FROM idx.record_blob WHERE did = '${A}'`)).toEqual(["0"]);
  });

  test("index.replayed_frame_is_a_counted_no_op", async () => {
    const before = seq;
    for (const replayed of [1, before]) {
      const changes = [profile({ displayName: "Eve" })];
      await store.apply({ kind: "repoCommit", seq: replayed, did: A, rev: rev(9), changes });
    }
    expect(await store.cursor()).toBe(before);
    expect(lines(`SELECT display_name FROM idx.profile WHERE did = '${A}'`)).toEqual(["Ada"]);
    expect(stat("ingest_replayed")).toBe("2");
  });

  test("index.stale_commit_changes_nothing_but_the_cursor", async () => {
    await commit(A, rev(2), [profile({ displayName: "Old" })]);
    expect(lines(`SELECT display_name FROM idx.profile WHERE did = '${A}'`)).toEqual(["Ada"]);
    expect(await store.cursor()).toBe(seq);
    expect(stat("ingest_stale")).toBe("1");
  });

  test("index.unsigned_rev_never_moves_the_watermark", async () => {
    await commit(A, null, []);
    expect(lines(`SELECT last_rev FROM idx.account WHERE did = '${A}'`)).toEqual([rev(4)]);
    expect(stat("ingest_unsigned")).toBe("1");
  });

  test("index.a_page_other_than_the_main_one_is_ignored", async () => {
    // ADR 0091: only the main page shows today, so another page neither moves a card nor counts as refused.
    const before = stat("ingest_invalid");
    await commit(A, rev(4), [page(listOf(CARD_2), "work")]);
    expect(lines(`SELECT rkey FROM idx.section WHERE did = '${A}' AND position = 0`)).toEqual([CARD_1]);
    expect(lines(`SELECT count(*) FROM idx.page WHERE did = '${A}'`)).toEqual(["1"]);
    expect(stat("ingest_invalid")).toBe(before);
  });

  test("index.delete_removes_the_record_and_its_place", async () => {
    await commit(A, rev(5), [{ kind: "delete", collection: "sh.unset.profile", rkey: "self" }]);
    expect(lines(`SELECT count(*) FROM idx.profile WHERE did = '${A}'`)).toEqual(["0"]);
    // The main page holds the order, so the cards keep their places until it goes (ADR 0091).
    expect(lines(`SELECT count(*) FROM idx.section WHERE did = '${A}' AND position IS NOT NULL`)).toEqual(["1"]);
    await commit(A, rev(5), [{ kind: "delete", collection: "sh.unset.page", rkey: "self" }]);
    expect(lines(`SELECT count(*) FROM idx.page WHERE did = '${A}'`)).toEqual(["0"]);
    expect(lines(`SELECT count(*) FROM idx.section WHERE did = '${A}' AND position IS NOT NULL`)).toEqual(["0"]);
    await commit(A, rev(5), [{ kind: "delete", collection: "sh.unset.card", rkey: CARD_1 }]);
    expect(lines(`SELECT rkey FROM idx.section WHERE did = '${A}' ORDER BY rkey`)).toEqual([CARD_2, "3jzfcijpj2z2c"]);
  });

  test("index.invalid_op_is_skipped_and_counted", async () => {
    await commit(A, rev(6), [profile({ displayName: 7 }), section(CARD_1)]);
    expect(lines(`SELECT count(*) FROM idx.profile WHERE did = '${A}'`)).toEqual(["0"]);
    expect(lines(`SELECT count(*) FROM idx.section WHERE did = '${A}' AND rkey = '${CARD_1}'`)).toEqual(["1"]);
    expect(stat("ingest_invalid")).toBe("1");
  });

  test("index.invalid_replacement_removes_the_older_version", async () => {
    // A rebuild of this repo would index nothing under the key (trackStore.ts applySnapshot), so the stream does the
    // same: the member's older version does not stay public.
    await commit(A, rev(6), [profile({ displayName: "Ada" }), section(CARD_1)]);
    await commit(A, rev(7), [
      profile({ displayName: 7 }),
      { kind: "put", collection: "sh.unset.card", rkey: CARD_1, cid: CID, record: { $type: "x" } },
    ]);
    expect(lines(`SELECT count(*) FROM idx.profile WHERE did = '${A}'`)).toEqual(["0"]);
    expect(lines(`SELECT count(*) FROM idx.section WHERE did = '${A}' AND rkey = '${CARD_1}'`)).toEqual(["0"]);
  });

  test("index.inactive_account_keeps_nothing_new", async () => {
    track(B, false);
    await commit(B, rev(3), [profile()]);
    expect(lines(`SELECT count(*) FROM idx.profile WHERE did = '${B}'`)).toEqual(["0"]);
    expect(lines(`SELECT last_rev FROM idx.account WHERE did = '${B}'`)).toEqual([rev(3)]);
  });

  test("index.untracked_did_is_dropped", async () => {
    await commit("did:plc:zzzzzzzzzzzzzzzzzzzzzzzz", rev(3), [profile()]);
    expect(lines("SELECT count(*) FROM idx.profile")).toEqual(["0"]);
    expect(stat("ingest_untracked")).toBe("1");
  });

  test("index.erased_did_stays_erased_after_a_later_put", async () => {
    track(E, true);
    // Erasure runs as migrator, its only caller until a step grants it (migration 0022's header).
    await withClient(migrator, null, (c) => c.query("SELECT core.erase_did($1, 'user_request')", [E]));
    // Even a row recreated by mistake does not let the frame through: the tombstone is checked first.
    track(E, true);
    await commit(E, rev(3), [profile()]);
    await store.apply({ kind: "identity", seq: ++seq, did: E });
    expect(lines(`SELECT count(*) FROM idx.profile WHERE did = '${E}'`)).toEqual(["0"]);
    expect(lines(`SELECT count(*) FROM idx.account_job WHERE did = '${E}'`)).toEqual(["0"]);
    expect(stat("ingest_erased")).toBe("2");
    expect(await store.cursor()).toBe(seq);
  });

  test("index.identity_and_sync_queue_their_jobs", async () => {
    await store.apply({ kind: "identity", seq: ++seq, did: A });
    await store.apply({ kind: "sync", seq: ++seq, did: A });
    expect(lines(`SELECT kind FROM idx.account_job WHERE did = '${A}' ORDER BY kind`)).toEqual([
      "backfill",
      "handle_check",
    ]);
  });

  test("index.missed_events_queue_every_account_once", async () => {
    await store.missedEvents();
    await store.missedEvents();
    expect(lines("SELECT count(*) FROM idx.account_job WHERE kind = 'backfill'")).toEqual(["3"]);
    // A lost #account event is recovered by asking our PDS for each account's status (book P3.06).
    expect(lines("SELECT count(*) FROM idx.account_job WHERE kind = 'confirm_status'")).toEqual(["3"]);
  });

  test("index.record_jsonb_refuses_is_skipped_not_retried", async () => {
    const before = stat("ingest_invalid");
    await commit(A, rev(7), [profile({ displayName: "A\0da" })]);
    expect(Number(stat("ingest_invalid"))).toBe(Number(before) + 1);
    expect(await store.cursor()).toBe(seq);
  });

  test("index.dead_letter_moves_the_cursor_and_queues_a_backfill", async () => {
    postgres.sql("unset", `DELETE FROM idx.account_job WHERE did = '${A}'`);
    const firstSeen = new Date("2026-11-18T00:00:00Z");
    await store.deadLetter({ kind: "repoCommit", seq: ++seq, did: A, rev: rev(8), changes: [] }, 5, firstSeen);
    expect(await store.cursor()).toBe(seq);
    expect(lines(`SELECT kind, reason_code, attempts FROM idx.dead_letter WHERE did = '${A}'`)).toEqual([
      "event|apply_failed|5",
    ]);
    expect(lines(`SELECT kind FROM idx.account_job WHERE did = '${A}'`)).toEqual(["backfill"]);
    const health = await store.health();
    expect(health).toMatchObject({ cursor: seq, deadLetters: 1 });
    expect(health.counters).toMatchObject({ ingest_dead_letter: 1, ingest_replayed: 2, ingest_erased: 2 });
  });

  test("index.health_shows_how_long_jobs_have_waited_and_failed", async () => {
    // A backfill due two minutes ago that no pass took, and a confirmation failing for an hour (backed off, so not due).
    const J = "did:plc:jjjjjjjjjjjjjjjjjjjjjjjj";
    track(J, true);
    postgres.sql(
      "unset",
      `DELETE FROM idx.account_job WHERE did = '${J}';
       INSERT INTO idx.account_job (did, kind, due_at, attempts, first_queued_at) VALUES
         ('${J}', 'backfill', now() - interval '2 minutes', 0, now() - interval '2 minutes'),
         ('${J}', 'confirm_status', now() + interval '1 hour', 3, now() - interval '1 hour')`,
    );
    const { jobs } = await store.health();
    expect(jobs.backfill?.oldestDueS).toBeGreaterThanOrEqual(120);
    expect(jobs.confirm_status?.oldestFailingS).toBeGreaterThanOrEqual(3600);
    postgres.sql("unset", `DELETE FROM idx.account WHERE did = '${J}'`);
  });

  test("index.dead_letter_keeps_no_did_of_an_erased_or_untracked_account", async () => {
    const firstSeen = new Date("2026-11-18T00:00:00Z");
    const jobs = () => lines("SELECT did, kind FROM idx.account_job ORDER BY did, kind");
    const before = jobs();
    for (const did of [E, "did:plc:zzzzzzzzzzzzzzzzzzzzzzzz"]) {
      await store.deadLetter({ kind: "identity", seq: ++seq, did }, 5, firstSeen);
    }
    expect(lines("SELECT coalesce(did, '-') FROM idx.dead_letter ORDER BY id")).toEqual([A, "-", "-"]);
    expect(jobs()).toEqual(before);
    expect(await store.cursor()).toBe(seq);
  });

  test("index.erasure_clears_dead_letters", async () => {
    track(D, true);
    await store.deadLetter({ kind: "identity", seq: ++seq, did: D }, 5, new Date());
    await withClient(migrator, null, (c) => c.query("SELECT core.erase_did($1, 'user_request')", [D]));
    expect(lines(`SELECT count(*) FROM idx.dead_letter WHERE did = '${D}'`)).toEqual(["0"]);
  });

  test("index.dead_letter_waits_for_an_erasure_under_way", async () => {
    // An erasure holds its per-DID lock from before its deletes until its tombstone commits. A dead letter for the
    // same DID must wait for it, then see the tombstone and keep no DID (Codex review, #1688). The lock is taken
    // first on its own, so the wait is the lock's and not a row lock's.
    track(G, true);
    let settled = false;
    let pending: Promise<void> = Promise.resolve();
    await withTransaction(migrator, null, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('erase:' || $1::text))", [G]);
      pending = store.deadLetter({ kind: "identity", seq: ++seq, did: G }, 5, new Date()).then(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await c.query("SELECT core.erase_did($1, 'user_request')", [G]);
    });
    await pending;
    expect(lines(`SELECT count(*) FROM idx.dead_letter WHERE did = '${G}'`)).toEqual(["0"]);
  });

  test("index.section_cap_counts_the_commits_own_deletes", async () => {
    track(H, true);
    sql(
      `INSERT INTO idx.section (uri, did, rkey, cid, rev, record, indexed_at)
       SELECT 'at://${H}/sh.unset.card/old' || n, '${H}', 'old' || n, '${CID}', '${rev(2)}', '{}', now()
         FROM generate_series(1, ${MAX_SECTIONS_PER_ACCOUNT}) AS n`,
    );
    const drop: IndexChange = { kind: "delete", collection: "sh.unset.card", rkey: "3jzfcijpj2z2a" };
    sql(`UPDATE idx.section SET rkey = '3jzfcijpj2z2a', uri = 'at://${H}/sh.unset.card/3jzfcijpj2z2a'
         WHERE uri = 'at://${H}/sh.unset.card/old1'`);
    await commit(H, rev(3), [section("3jzfcijpj2z2d"), drop]);
    expect(lines(`SELECT count(*) FROM idx.section WHERE did = '${H}'`)).toEqual([String(MAX_SECTIONS_PER_ACCOUNT)]);
    expect(lines(`SELECT count(*) FROM idx.section WHERE did = '${H}' AND rkey = '3jzfcijpj2z2d'`)).toEqual(["1"]);
  });

  // Review of #1911: one member's cards together stay within what one page holds, counted as the save counts them.
  test("index.a_card_past_the_page_budget_is_skipped_counted_and_its_older_version_removed", async () => {
    track(I, true);
    const first = section(CARD_1);
    await commit(I, rev(3), [first]);
    if (first.kind !== "put") throw new Error("a put");
    expect(lines(`SELECT bytes FROM idx.section WHERE did = '${I}'`)).toEqual([String(recordBytes(first.record))]);
    sql(
      `INSERT INTO idx.section (uri, did, rkey, cid, rev, record, bytes, indexed_at)
       VALUES ('at://${I}/sh.unset.card/big', '${I}', 'big', '${CID}', '${rev(3)}', '{}', ${MAX_PAGE_BYTES - 10}, now())`,
    );
    const before = Number(stat("ingest_over_budget"));
    // CARD_1 grows and CARD_2 is new: neither fits. A card that does not grow would stay (the test below).
    const grown: IndexChange = {
      kind: "put",
      collection: "sh.unset.card",
      rkey: CARD_1,
      cid: CID,
      record: {
        $type: "sh.unset.card",
        content: { $type: "sh.unset.block.text", text: "a".repeat(2_000) },
        createdAt: T,
      },
    };
    await commit(I, rev(4), [grown, section(CARD_2)]);
    expect(lines(`SELECT rkey FROM idx.section WHERE did = '${I}' ORDER BY rkey`)).toEqual(["big"]);
    expect(Number(stat("ingest_over_budget"))).toBe(before + 2);
  });

  test("index.a_commit_within_the_budget_is_indexed_whole_whichever_card_comes_first", async () => {
    // Codex review of #1911: a Save that grows one card and shrinks another, near the budget, keeps both.
    const J = "did:plc:jjjjjjjjjjjjjjjjjjjjjjjj";
    track(J, true);
    await commit(J, rev(3), [section(CARD_1)]);
    sql(
      `INSERT INTO idx.section (uri, did, rkey, cid, rev, record, bytes, indexed_at)
       VALUES ('at://${J}/sh.unset.card/${CARD_2}', '${J}', '${CARD_2}', '${CID}', '${rev(3)}', '{}',
               ${MAX_PAGE_BYTES - 1_000}, now())`,
    );
    const grown: IndexChange = {
      kind: "put",
      collection: "sh.unset.card",
      rkey: CARD_1,
      cid: CID,
      record: {
        $type: "sh.unset.card",
        content: { $type: "sh.unset.block.text", text: "a".repeat(2_000) },
        createdAt: T,
      },
    };
    const before = Number(stat("ingest_over_budget"));
    await commit(J, rev(4), [grown, section(CARD_2)]);
    expect(lines(`SELECT rkey FROM idx.section WHERE did = '${J}' ORDER BY rkey`)).toEqual([CARD_1, CARD_2]);
    expect(Number(stat("ingest_over_budget"))).toBe(before);
  });

  test("index.a_card_that_shrinks_is_kept_on_a_page_already_past_the_budget", async () => {
    // Codex review of #1911: a page indexed before the budget may be past it; a write that makes it smaller stays.
    const K = "did:plc:kkkkkkkkkkkkkkkkkkkkkkkk";
    track(K, true);
    sql(
      `INSERT INTO idx.section (uri, did, rkey, cid, rev, record, bytes, indexed_at)
       VALUES ('at://${K}/sh.unset.card/${CARD_1}', '${K}', '${CARD_1}', '${CID}', '${rev(3)}', '{}', 100000, now()),
              ('at://${K}/sh.unset.card/${CARD_2}', '${K}', '${CARD_2}', '${CID}', '${rev(3)}', '{}',
               ${MAX_PAGE_BYTES}, now())`,
    );
    const before = Number(stat("ingest_over_budget"));
    await commit(K, rev(4), [section(CARD_1)]);
    expect(lines(`SELECT rkey FROM idx.section WHERE did = '${K}' AND bytes < 100000`)).toEqual([CARD_1]);
    expect(Number(stat("ingest_over_budget"))).toBe(before);
  });

  test("index.active_status_is_only_queued_for_confirmation", async () => {
    track(C, false);
    await store.apply({ kind: "account", seq: ++seq, did: C, active: true, status: null });
    expect(lines(`SELECT pds_active FROM idx.account WHERE did = '${C}'`)).toEqual(["f"]);
    expect(lines(`SELECT kind FROM idx.account_job WHERE did = '${C}'`)).toEqual(["confirm_status"]);
  });

  test("index.inactive_status_applies_at_once", async () => {
    await store.apply({ kind: "account", seq: ++seq, did: A, active: false, status: "takendown" });
    expect(lines(`SELECT pds_active, pds_status FROM idx.account WHERE did = '${A}'`)).toEqual(["f|takendown"]);
    expect(lines(`SELECT count(*) FROM idx.visible_account WHERE did = '${A}'`)).toEqual(["0"]);
    await store.apply({ kind: "account", seq: ++seq, did: A, active: false, status: "deleted" });
    expect(lines(`SELECT kind FROM idx.account_job WHERE did = '${A}' ORDER BY kind`)).toEqual([
      "backfill",
      "confirm_deletion",
    ]);
    expect(await store.cursor()).toBe(seq);
  });
});

describe("account state (P3.06s)", () => {
  const S = "did:plc:ssssssssssssssssssssssss";
  const sessions = (status: string | null) => {
    // The fixture's one session is removed by its id: only migration 0014 deletes a DID's sessions (session store test).
    sql(`DELETE FROM app.session WHERE id_hash = decode('${"ab".repeat(32)}', 'hex');
      DELETE FROM app.oauth_session WHERE did = '${S}';
      INSERT INTO app.account (did, first_seen_at) VALUES ('${S}', now()) ON CONFLICT DO NOTHING;
      INSERT INTO app.oauth_session (did, sealed, client_kid, updated_at) VALUES ('${S}', 's1.k1.x', 'kid', now());
      INSERT INTO app.session (id_hash, did, created_at, last_seen_at, absolute_expires_at)
        VALUES (decode('${"ab".repeat(32)}', 'hex'), '${S}', now(), now(), now() + interval '1 day')`);
    return store.apply({ kind: "account", seq: ++seq, did: S, active: false, status });
  };
  const left = () =>
    lines(`SELECT (SELECT count(*) FROM app.session WHERE did = '${S}') || '|' ||
      (SELECT count(*) FROM app.oauth_session WHERE did = '${S}')`);

  test("index.inactive_status_ends_the_members_sessions", async () => {
    track(S, true);
    await sessions("takendown");
    expect(left()).toEqual(["0|0"]);
    // A deactivated account keeps its token set, so the member can reactivate (migration 0014's allow-list).
    await sessions("deactivated");
    expect(left()).toEqual(["0|1"]);
    // A status outside the function's closed list ends sessions as 'unknown'.
    await sessions("desynchronized");
    expect(left()).toEqual(["0|0"]);
    await sessions(null);
    expect(left()).toEqual(["0|0"]);
  });
});

function blob() {
  return { $type: "blob", ref: { $link: BLOB }, mimeType: "image/png", size: 10 };
}
