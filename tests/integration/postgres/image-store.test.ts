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
const record = (did: Did, rkey = "3kaaaaaaaaaaa") => `at://${did}/sh.unset.section/${rkey}`;

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
    await store.removeUse(other, id, record(owner), null);
    expect(await exists(id)).toBe(true);
    expect(await store.list(owner, null)).toEqual([
      expect.objectContaining({ id, state: "uploaded", inUse: false, bytes: picture.bytes }),
    ]);
  });

  test("image.shared: removing one use keeps an image another record still uses", async () => {
    const did = await member();
    const id = await stored(did);
    const size = { width: 2560, height: 1707 };
    expect(await store.addUse(did, id, record(did, "3kaaaaaaaaaaa"), null)).toEqual({ ...size, created: true });
    expect(await store.addUse(did, id, record(did, "3kbbbbbbbbbbb"), null)).toEqual({ ...size, created: true });
    // Asked again for a record that already has it, the use is not made a second time (and not this call's to undo).
    expect(await store.addUse(did, id, record(did, "3kbbbbbbbbbbb"), null)).toEqual({ ...size, created: false });
    await store.removeUse(did, id, record(did, "3kaaaaaaaaaaa"), null);
    expect(await store.discard(did, id, null)).toBe(false);
    const [kept] = await sql<{ state: string; unused_since: Date | null }>(
      "SELECT state, unused_since FROM app.image WHERE id = $1",
      [id],
    );
    expect(kept).toEqual({ state: "published", unused_since: null });
    await store.removeUse(did, id, record(did, "3kbbbbbbbbbbb"), null);
    const [dropped] = await sql<{ unused_since: Date | null }>("SELECT unused_since FROM app.image WHERE id = $1", [
      id,
    ]);
    expect(dropped?.unused_since).toBeInstanceOf(Date);
  });

  test("image.drop_use: the picture a record no longer shows loses its use by CID; the record's other one stays", async () => {
    const did = await member();
    const other = await member();
    const [old, fresh, theirs] = [await stored(did), await stored(did), await stored(other)];
    const [OLD, FRESH] = [
      "bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bvhwoxxfuknnqdpe",
      "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku",
    ];
    await store.addUse(did, old, record(did), null);
    await store.addUse(did, fresh, record(did), null);
    await store.addUse(other, theirs, record(other), null);
    await store.notePublished(did, old, OLD, null);
    await store.notePublished(did, fresh, FRESH, null);
    // Another member's call names nothing of theirs.
    await store.notePublished(other, fresh, OLD, null);
    await store.dropUse(did, record(did), OLD, null);
    const rows = await sql<{ id: string; unused: boolean; uses: number; cid: string | null }>(
      `SELECT id::text, unused_since IS NOT NULL AS unused, blob_cid AS cid,
              (SELECT count(*)::int FROM app.image_use u WHERE u.image_id = app.image.id) AS uses
         FROM app.image WHERE id = ANY($1::uuid[])`,
      [[old, fresh, theirs]],
    );
    expect(Object.fromEntries(rows.map((row) => [row.id, [row.unused, row.uses, row.cid]]))).toEqual({
      [old]: [true, 0, OLD],
      [fresh]: [false, 1, FRESH],
      [theirs]: [false, 1, null],
    });
    // Another member's call reaches nothing of theirs, and null (the record is gone) drops its last use.
    await store.dropUse(other, record(did), null, null);
    expect(await sql("SELECT 1 FROM app.image_use WHERE image_id = $1", [fresh])).toHaveLength(1);
    await store.dropUse(did, record(did), null, null);
    expect(await sql("SELECT 1 FROM app.image_use WHERE image_id = $1", [fresh])).toHaveLength(0);
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
    await store.addUse(did, id, record(did, "3kaaaaaaaaaaa"), null);
    await store.addUse(did, id, record(did, "3kbbbbbbbbbbb"), null);
    await Promise.all(
      ["3kaaaaaaaaaaa", "3kbbbbbbbbbbb"].map((rkey) => store.removeUse(did, id, record(did, rkey), null)),
    );
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
      expect(await store.addUse(did, id, record(did), null)).toEqual({ width: 10, height: 10, created: true });
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
