// P2.18 (infrastructure/postgres/imageStore.ts, migration 0035): a member's image library against real Postgres,
// connected as `web` (TE-2). Limits and the quota hold under concurrency, every call is scoped to its member, a shared
// image stays while any record uses it, and the sweep deletes only what has expired, all or nothing.
import { relative } from "node:path";
import type { Did } from "@unset/domains-identity";
import { createImageStore, createPool, type Pool, withClient } from "@unset/infrastructure-postgres";
import { afterAll, beforeEach, describe, expect, inject, test } from "vitest";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const connection = { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false };
const web: Pool = createPool({ connection, service: "image-store-test", max: 8, connectTimeoutMs: 5000 });
afterAll(() => web.end());
const store = createImageStore(web);

const GIB = 1024 ** 3;
const sql = <T extends Record<string, unknown>>(text: string, values: unknown[] = []) =>
  withClient(web, null, async (client) => (await client.query<T>(text, values)).rows);

let dids = 0;
async function member(): Promise<Did> {
  dids += 1;
  // Decimal digits spelt as letters a to j, which the did:plc alphabet allows.
  const tail = String(dids).replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)] ?? "a");
  const did = `did:plc:${tail.padStart(24, "m")}` as Did;
  await sql("INSERT INTO app.account (did, first_seen_at) VALUES ($1, now())", [did]);
  return did;
}

const picture = { kind: "image" as const, width: 2560, height: 1707, bytes: 2_400_000 };
const record = (did: Did, rkey = "3kaaaaaaaaaaa") => `at://${did}/sh.unset.card/${rkey}`;

async function stored(did: Did, bytes = picture.bytes): Promise<string> {
  const result = await store.store(did, { ...picture, bytes }, null);
  if (!result.ok) throw new Error(result.code);
  return result.id;
}

/** An image row written as `ago` old, with its own state and last-use time, as web may insert it. */
async function aged(did: Did, state: string, createdAgo: string, unusedAgo: string | null = null) {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO app.image (id, did, kind, state, width, height, bytes, created_at)
     VALUES (gen_random_uuid(), $1, 'image', $2, 10, 10, 10, now() - $3::interval) RETURNING id`,
    [did, state, createdAgo],
  );
  const id = String(row?.id);
  if (unusedAgo !== null)
    await sql("UPDATE app.image SET unused_since = now() - $2::interval WHERE id = $1", [id, unusedAgo]);
  return id;
}

const exists = async (id: string) => (await sql("SELECT 1 FROM app.image WHERE id = $1", [id])).length === 1;

describe("image store", () => {
  test("image.admit: an upload is counted, and the 121st in an hour and the 1,001st in a day are refused", async () => {
    const did = await member();
    expect(await store.admit(did, null)).toEqual({ ok: true });
    await sql("INSERT INTO app.image_upload (did, admitted_at) SELECT $1, now() FROM generate_series(1, 119)", [did]);
    expect(await store.admit(did, null)).toEqual({ ok: false, code: "image.hourly_limit" });

    const busy = await member();
    await sql(
      "INSERT INTO app.image_upload (did, admitted_at) SELECT $1, now() - interval '2 hours' FROM generate_series(1, 1000)",
      [busy],
    );
    expect(await store.admit(busy, null)).toEqual({ ok: false, code: "image.daily_limit" });
    // A day-old upload no longer counts.
    const yesterday = await member();
    await sql(
      "INSERT INTO app.image_upload (did, admitted_at) SELECT $1, now() - interval '25 hours' FROM generate_series(1, 1000)",
      [yesterday],
    );
    expect(await store.admit(yesterday, null)).toEqual({ ok: true });
  });

  test("image.admit_concurrent: twenty admissions at once for one member with one left are one admission", async () => {
    const did = await member();
    await sql("INSERT INTO app.image_upload (did, admitted_at) SELECT $1, now() FROM generate_series(1, 119)", [did]);
    const results = await Promise.all(Array.from({ length: 20 }, () => store.admit(did, null)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  test("image.quota_concurrent: two stores at once that each fit but not together leave one row", async () => {
    const did = await member();
    await stored(did, 2 * GIB - 5);
    const results = await Promise.all([1, 2].map(() => store.store(did, { ...picture, bytes: 3 }, null)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, code: "image.quota" }]);
    expect(await store.admit(did, null)).toEqual({ ok: true });
  });

  test("image.scoped: another member can neither see, use nor discard an image", async () => {
    const owner = await member();
    const other = await member();
    const id = await stored(owner);
    expect(await store.list(other, null)).toEqual([]);
    expect(await store.addUse(other, id, record(other), null)).toBeNull();
    expect(await store.addUse(owner, id, record(other), null)).toBeNull();
    expect(await store.discard(other, id, null)).toBe(false);
    const lease = "6c1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";
    await store.removeUse(other, id, record(owner), lease, null);
    expect(await exists(id)).toBe(true);
    expect(await store.list(owner, null)).toEqual([
      expect.objectContaining({ id, state: "uploaded", inUse: false, bytes: picture.bytes }),
    ]);
  });

  test("image.shared: removing one use keeps an image another record still uses", async () => {
    const did = await member();
    const id = await stored(did);
    const size = { width: 2560, height: 1707 };
    const a = await store.addUse(did, id, record(did, "3kaaaaaaaaaaa"), null);
    expect(a).toEqual({ ...size, created: true, lease: expect.any(String) });
    const first = await store.addUse(did, id, record(did, "3kbbbbbbbbbbb"), null);
    expect(first).toMatchObject({ ...size, created: true });
    // Asked again for a record that already has it, the use is not made a second time; the second save holds it too.
    const b = await store.addUse(did, id, record(did, "3kbbbbbbbbbbb"), null);
    expect(b).toMatchObject({ ...size, created: false });
    await store.removeUse(did, id, record(did, "3kaaaaaaaaaaa"), String(a?.lease), null);
    expect(await store.discard(did, id, null)).toBe(false);
    const [kept] = await sql<{ state: string; unused_since: Date | null }>(
      "SELECT state, unused_since FROM app.image WHERE id = $1",
      [id],
    );
    expect(kept).toEqual({ state: "published", unused_since: null });
    await store.removeUse(did, id, record(did, "3kbbbbbbbbbbb"), String(b?.lease), null);
    expect(await store.discard(did, id, null)).toBe(false);
    await store.removeUse(did, id, record(did, "3kbbbbbbbbbbb"), String(first?.lease), null);
    const [dropped] = await sql<{ unused_since: Date | null }>("SELECT unused_since FROM app.image WHERE id = $1", [
      id,
    ]);
    expect(dropped?.unused_since).toBeInstanceOf(Date);
  });

  test("image.settle: a landed write keeps the use of the picture its record shows and takes back the rest", async () => {
    const did = await member();
    const other = await member();
    const [old, fresh, theirs] = [await stored(did), await stored(did), await stored(other)];
    const [OLD, FRESH] = [
      "bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bvhwoxxfuknnqdpe",
      "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
    ];
    await store.addUse(did, old, record(did), null);
    await store.notePublished(did, old, OLD, null);
    await store.settleUse(did, record(did), "3kcommit2aaaa", OLD, [], null);
    const made = await store.addUse(did, fresh, record(did), null);
    await store.addUse(other, theirs, record(other), null);
    await store.notePublished(did, fresh, FRESH, null);
    // Another member's call names nothing of theirs.
    await store.notePublished(other, fresh, OLD, null);
    await store.settleUse(other, record(did), "3kcommit2zzzz", null, [], null);
    await store.settleUse(did, record(did), "3kcommit2bbbb", FRESH, [{ id: fresh, lease: String(made?.lease) }], null);
    const rows = await sql<{ id: string; unused: boolean; uses: number; cid: string | null; rev: string | null }>(
      `SELECT id::text, unused_since IS NOT NULL AS unused, blob_cid AS cid,
              (SELECT count(*)::int FROM app.image_use u WHERE u.image_id = app.image.id) AS uses,
              (SELECT max(settled_rev) FROM app.image_use u WHERE u.image_id = app.image.id) AS rev
         FROM app.image WHERE id = ANY($1::uuid[])`,
      [[old, fresh, theirs]],
    );
    expect(Object.fromEntries(rows.map((row) => [row.id, [row.unused, row.uses, row.cid, row.rev]]))).toEqual({
      [old]: [true, 0, OLD, null],
      [fresh]: [false, 1, FRESH, "3kcommit2bbbb"],
      [theirs]: [false, 1, null, null],
    });
    // The record gone: another member's call reaches nothing of theirs, and the member's drops its last use.
    await store.dropUses(other, record(did), null);
    expect(await sql("SELECT 1 FROM app.image_use WHERE image_id = $1", [fresh])).toHaveLength(1);
    await store.dropUses(did, record(did), null);
    expect(await sql("SELECT 1 FROM app.image_use WHERE image_id = $1", [fresh])).toHaveLength(0);
  });

  test("image.settle_order: saves of one card settle by commit revision, whichever settles first", async () => {
    // The card shows A. Save 1 writes B (rev ...b); save 2 puts A back (rev ...c). Either settling order ends with
    // A's use alone (Codex review of #1860).
    for (const order of [
      ["b", "c"],
      ["c", "b"],
    ]) {
      const did = await member();
      const [a, b] = [await stored(did), await stored(did)];
      const [A, B] = [
        "bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bvhwoxxfuknnqdpe",
        "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
      ];
      await store.addUse(did, a, record(did), null);
      await store.notePublished(did, a, A, null);
      await store.settleUse(did, record(did), "3kcommit2aaaa", A, [], null);
      const one = await store.addUse(did, b, record(did), null);
      await store.notePublished(did, b, B, null);
      const two = await store.addUse(did, a, record(did), null);
      expect(two).toMatchObject({ created: false });
      const settle = {
        b: () => store.settleUse(did, record(did), "3kcommit2bbbb", B, [{ id: b, lease: String(one?.lease) }], null),
        c: () => store.settleUse(did, record(did), "3kcommit2cccc", A, [], null),
      } as const;
      for (const step of order) await settle[step as "b" | "c"]();
      const uses = await sql<{ id: string; rev: string | null }>(
        "SELECT image_id::text AS id, settled_rev AS rev FROM app.image_use WHERE record_uri = $1",
        [record(did)],
      );
      expect(uses).toEqual([{ id: a, rev: "3kcommit2cccc" }]);
      const [unused] = await sql<{ unused: boolean }>(
        "SELECT unused_since IS NOT NULL AS unused FROM app.image WHERE id = $1",
        [a],
      );
      expect(unused?.unused).toBe(false);
    }
  });

  test("image.settle_fence: a write that leaves no picture, or a delete, still fences older settling", async () => {
    // The card shows A. Save 1 writes B (rev ...b) and stalls; save 2 makes it a text card (rev ...c), or the card is
    // deleted, and settles first. Save 1 settling late must not give B a use (Codex review of #1860).
    for (const last of ["text", "delete"] as const) {
      const did = await member();
      const [a, b] = [await stored(did), await stored(did)];
      const [A, B] = [
        "bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bvhwoxxfuknnqdpe",
        "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
      ];
      await store.addUse(did, a, record(did), null);
      await store.notePublished(did, a, A, null);
      await store.settleUse(did, record(did), "3kcommit2aaaa", A, [], null);
      const one = await store.addUse(did, b, record(did), null);
      await store.notePublished(did, b, B, null);
      if (last === "text") await store.settleUse(did, record(did), "3kcommit2cccc", null, [], null);
      else await store.dropUses(did, record(did), null);
      await store.settleUse(did, record(did), "3kcommit2bbbb", B, [{ id: b, lease: String(one?.lease) }], null);
      expect(await sql("SELECT 1 FROM app.image_use WHERE record_uri = $1", [record(did)])).toHaveLength(0);
      const rows = await sql<{ unused: boolean }>(
        "SELECT unused_since IS NOT NULL AS unused FROM app.image WHERE id = ANY($1::uuid[])",
        [[a, b]],
      );
      expect(rows).toEqual([{ unused: true }, { unused: true }]);
    }
  });

  test("image.release_lease: a failed save gives up its own hold; the use goes when no save holds it", async () => {
    const did = await member();
    const id = await stored(did);
    const CID = "bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bvhwoxxfuknnqdpe";
    const uses = async () => (await sql("SELECT 1 FROM app.image_use WHERE image_id = $1", [id])).length;
    // Two saves, in either order of failing, ask for the same picture on the same card; the second did not make the
    // use (Codex review of #1860: both failing must still take it back).
    for (const order of ["first", "second"] as const) {
      const one = await store.addUse(did, id, record(did), null);
      const two = await store.addUse(did, id, record(did), null);
      expect([one?.created, two?.created]).toEqual([true, false]);
      expect(two?.lease).not.toBe(one?.lease);
      const [early, late] = order === "first" ? [one, two] : [two, one];
      await store.removeUse(did, id, record(did), String(early?.lease), null);
      expect(await uses()).toBe(1);
      await store.removeUse(did, id, record(did), String(late?.lease), null);
      expect(await uses()).toBe(0);
    }
    // One save fails while the other's write lands: the landed one keeps the use whichever finishes first.
    const failed = await store.addUse(did, id, record(did), null);
    const winner = await store.addUse(did, id, record(did), null);
    await store.notePublished(did, id, CID, null);
    await store.settleUse(did, record(did), "3kcommit2aaaa", CID, [{ id, lease: String(winner?.lease) }], null);
    await store.removeUse(did, id, record(did), String(failed?.lease), null);
    expect(await uses()).toBe(1);
    await store.dropUses(did, record(did), null);
    expect(await uses()).toBe(0);
    const other = record(did, "3kbbbbbbbbbbb");
    // A use a landed write settled is never taken back by a release, even under the lease that made it.
    const made = await store.addUse(did, id, other, null);
    await store.settleUse(did, other, "3kcommit2aaaa", CID, [], null);
    await store.removeUse(did, id, other, String(made?.lease), null);
    expect(await uses()).toBe(1);
  });

  test("image.discard_during_use: a discard waiting on a save's open use leaves the image and its use", async () => {
    const did = await member();
    const id = await stored(did);
    const client = await web.connect();
    let discarded: Promise<boolean> = Promise.resolve(true);
    try {
      await client.query("BEGIN");
      await client.query("UPDATE app.image SET state = 'published', unused_since = NULL WHERE id = $1", [id]);
      discarded = store.discard(did, id, null);
      // Give the discard time to reach the row lock the open use holds.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await client.query("INSERT INTO app.image_use (image_id, record_uri) VALUES ($1, $2)", [id, record(did)]);
      // Still waiting on the row lock: had it gone first, the discard would already have settled.
      const pending = Symbol("pending");
      const early = await Promise.race([discarded, new Promise((resolve) => setTimeout(resolve, 100, pending))]);
      expect(early).toBe(pending);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    expect(await discarded).toBe(false);
    expect(await exists(id)).toBe(true);
    expect(await sql("SELECT 1 FROM app.image_use WHERE image_id = $1", [id])).toHaveLength(1);
  });

  test("image.remove_concurrent: removing an image's last two uses at once marks it unused", async () => {
    const did = await member();
    const id = await stored(did);
    const leases = new Map<string, string>();
    for (const rkey of ["3kaaaaaaaaaaa", "3kbbbbbbbbbbb"])
      leases.set(rkey, String((await store.addUse(did, id, record(did, rkey), null))?.lease));
    await Promise.all([...leases].map(([rkey, lease]) => store.removeUse(did, id, record(did, rkey), lease, null)));
    const [row] = await sql<{ unused_since: Date | null }>("SELECT unused_since FROM app.image WHERE id = $1", [id]);
    expect(row?.unused_since).toBeInstanceOf(Date);
  });

  describe("sweep", () => {
    beforeEach(() => sql("DELETE FROM app.image"));

    test("image.sweep_expiry: unused uploads go after a day, dropped copies after a week, nothing in use", async () => {
      const did = await member();
      const fresh = await aged(did, "uploaded", "23 hours");
      const stale = await aged(did, "uploaded", "24 hours 1 minute");
      const recentlyDropped = await aged(did, "published", "30 days", "6 days");
      const longDropped = await aged(did, "published", "30 days", "7 days 1 minute");
      const inUse = await aged(did, "published", "30 days");
      await sql("INSERT INTO app.image_use (image_id, record_uri) VALUES ($1, $2)", [inUse, record(did)]);
      const held = await aged(did, "held", "30 days");
      const result = await store.sweep(null);
      expect(result).toEqual({
        kind: "deleted",
        images: expect.arrayContaining([
          { did, id: stale },
          { did, id: longDropped },
        ]),
      });
      expect(result.kind === "deleted" && result.images).toHaveLength(2);
      for (const id of [fresh, recentlyDropped, inUse, held]) expect(await exists(id)).toBe(true);
    });

    test("image.sweep_use_first: an expired upload a save used before the sweep is kept", async () => {
      const did = await member();
      const id = await aged(did, "uploaded", "2 days");
      expect(await store.addUse(did, id, record(did), null)).toEqual({
        width: 10,
        height: 10,
        created: true,
        lease: expect.any(String),
      });
      expect(await store.sweep(null)).toEqual({ kind: "deleted", images: [] });
      expect(await exists(id)).toBe(true);
    });

    test("image.sweep_during_use: a sweep while a save's use is still open leaves the image", async () => {
      const did = await member();
      const id = await aged(did, "uploaded", "2 days");
      const client = await web.connect();
      try {
        // The use's own statements, held open inside their transaction while the sweep runs.
        await client.query("BEGIN");
        await client.query("UPDATE app.image SET state = 'published', unused_since = NULL WHERE id = $1", [id]);
        expect(await store.sweep(null)).toEqual({ kind: "deleted", images: [] });
        await client.query("INSERT INTO app.image_use (image_id, record_uri) VALUES ($1, $2)", [id, record(did)]);
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      expect(await exists(id)).toBe(true);
      expect(await store.sweep(null)).toEqual({ kind: "deleted", images: [] });
    });

    test("image.governor: a run that would delete 501 of 1,000 images deletes nothing", async () => {
      const did = await member();
      await sql(
        `INSERT INTO app.image (id, did, kind, state, width, height, bytes, created_at)
         SELECT gen_random_uuid(), $1, 'image', 'uploaded', 10, 10, 10,
                CASE WHEN n <= 501 THEN now() - interval '2 days' ELSE now() END
           FROM generate_series(1, 1000) n`,
        [did],
      );
      expect(await store.sweep(null)).toEqual({ kind: "refused", due: 501, live: 1000 });
      expect((await store.list(did, null)).length).toBe(1000);
    });

    test("image.named: the orphan sweep's read names only ids with a row, with their member, and counts every row", async () => {
      const did = await member();
      const other = await member();
      const mine = await stored(did);
      const theirs = await stored(other);
      const gone = "0b6a52d4-6c1f-4bde-9b8e-2a1f6d7c3e01";
      const named = await store.named([mine, gone, theirs], null);
      expect(named.live).toBe(2);
      expect(named.images).toEqual(
        expect.arrayContaining([
          { did, id: mine },
          { did: other, id: theirs },
        ]),
      );
      expect(named.images).toHaveLength(2);
      expect(await store.named([gone], null)).toEqual({ live: 2, images: [] });
    });

    test("image.ledger_pruned: upload times older than a day go with the sweep", async () => {
      const did = await member();
      await sql(
        "INSERT INTO app.image_upload (did, admitted_at) VALUES ($1, now() - interval '25 hours'), ($1, now())",
        [did],
      );
      await store.sweep(null);
      expect(await sql("SELECT 1 FROM app.image_upload WHERE did = $1", [did])).toHaveLength(1);
    });
  });
});
