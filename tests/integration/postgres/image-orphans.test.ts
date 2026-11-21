// P2.19b (interfaces/web/src/lib/server/image-orphans.ts): the orphan-object sweep against the real image store,
// connected as `web` (TE-2). It deletes only folders under `drafts/` that no image row names, listed before the rows
// are read, and nothing at all over the governor or when the listing fails. Only the object store is a double: it is
// an unmanaged dependency here (TE-1), and tests/integration/storage/object-store.test.ts covers the real one.
import { relative } from "node:path";
import { SWEEP_GOVERNOR } from "@unset/domains-content";
import type { Did } from "@unset/domains-identity";
import { createImageStore, createPool, type Pool, withClient } from "@unset/infrastructure-postgres";
import { afterAll, describe, expect, inject, test } from "vitest";
import { type DraftObjects, sweepOrphanImages } from "../../../interfaces/web/src/lib/server/image-orphans.ts";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const connection = { host: provided.host, port: provided.port, ...provided.roles.web, database, ssl: false };
const web: Pool = createPool({ connection, service: "image-orphans-test", max: 4, connectTimeoutMs: 5000 });
afterAll(() => web.end());
const store = createImageStore(web);
const rows = { named: (ids: readonly string[]) => store.named(ids, null) };

const sql = <T extends Record<string, unknown>>(text: string, values: unknown[] = []) =>
  withClient(web, null, async (client) => (await client.query<T>(text, values)).rows);

let dids = 0;
async function member(): Promise<Did> {
  dids += 1;
  // Decimal digits spelt as letters a to j, which the did:plc alphabet allows.
  const tail = String(dids).replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)] ?? "a");
  const did = `did:plc:${tail.padStart(24, "o")}` as Did;
  await sql("INSERT INTO app.account (did, first_seen_at) VALUES ($1, now())", [did]);
  return did;
}

async function stored(did: Did): Promise<string> {
  const result = await store.store(did, { kind: "image", width: 2560, height: 1707, bytes: 2_400_000 }, null);
  if (!result.ok) throw new Error(result.code);
  return result.id;
}

const randomId = () => crypto.randomUUID();
const folder = (did: string, id: string) => `drafts/${did}/i/${id}/`;
const files = (did: string, id: string) => [`${folder(did, id)}main.jpeg`, `${folder(did, id)}w480.webp`];

/** The draft store: the keys it lists, and what the sweep asked of it, in order. */
function objects(keys: string[]) {
  const order: string[] = [];
  const deleted: string[] = [];
  let listing: Awaited<ReturnType<DraftObjects["list"]>> = { ok: true, keys };
  let failing = new Set<string>();
  const store: DraftObjects = {
    list: async (prefix) => {
      order.push(`list ${prefix}`);
      return listing;
    },
    deletePrefix: async (prefix) => {
      deleted.push(prefix);
      return failing.has(prefix) ? { ok: false, code: "objects.unavailable" } : { ok: true, deleted: 2 };
    },
  };
  return {
    store,
    order,
    deleted,
    failListing: () => {
      listing = { ok: false, code: "objects.unavailable" };
    },
    failDelete: (prefix: string) => {
      failing = new Set([prefix]);
    },
  };
}

describe("sweepOrphanImages over the image store", () => {
  test("image.orphan_deleted: only a folder no row names goes, after the listing and then the rows", async () => {
    const alice = await member();
    const bob = await member();
    const [kept, theirs, gone] = [await stored(alice), await stored(bob), randomId()];
    const drafts = objects([...files(alice, kept), ...files(alice, gone), ...files(bob, theirs)]);
    const read = { named: async (ids: readonly string[]) => (drafts.order.push("rows"), rows.named(ids)) };
    await sweepOrphanImages(drafts.store, read);
    expect(drafts.order).toEqual(["list drafts/", "rows"]);
    expect(drafts.deleted).toEqual([folder(alice, gone)]);
  });

  test("image.orphan_other_member: a row with the folder's id but another member's DID does not keep it", async () => {
    const alice = await member();
    const bob = await member();
    const id = await stored(alice);
    const drafts = objects(files(bob, id));
    await sweepOrphanImages(drafts.store, rows);
    expect(drafts.deleted).toEqual([folder(bob, id)]);
  });

  test("image.orphan_unknown_shape: keys outside drafts/<did>/i/<uuid>/<file> are left alone", async () => {
    const alice = await member();
    const id = randomId();
    const drafts = objects([
      `drafts/not-a-did/i/${id}/main.jpeg`,
      `drafts/${alice}/i/not-a-uuid/main.jpeg`,
      `drafts/${alice}/x/${id}/main.jpeg`,
      `drafts/${alice}/i/${id}/deeper/main.jpeg`,
      `drafts/${alice}/i/${id.toUpperCase()}/main.jpeg`,
      `drafts/${alice}/i/${id}`,
    ]);
    await sweepOrphanImages(drafts.store, rows);
    expect(drafts.deleted).toEqual([]);
  });

  test("image.orphan_listing_fails: an unavailable listing deletes nothing and is thrown", async () => {
    const alice = await member();
    const drafts = objects(files(alice, randomId()));
    drafts.failListing();
    await expect(sweepOrphanImages(drafts.store, rows)).rejects.toThrow("could not list");
    expect(drafts.deleted).toEqual([]);
  });

  test("image.orphan_governor: more orphans than the governor allows deletes nothing and is thrown", async () => {
    const alice = await member();
    await stored(alice);
    const [{ live } = { live: 0 }] = await sql<{ live: number }>("SELECT count(*)::int AS live FROM app.image");
    const allowed = Math.max(SWEEP_GOVERNOR.floor, Math.floor(live * SWEEP_GOVERNOR.share));
    const ids = Array.from({ length: allowed + 1 }, randomId);
    const over = objects(ids.flatMap((id) => files(alice, id)));
    await expect(sweepOrphanImages(over.store, rows)).rejects.toThrow("governor");
    expect(over.deleted).toEqual([]);
    const fits = objects(ids.slice(0, allowed).flatMap((id) => files(alice, id)));
    await sweepOrphanImages(fits.store, rows);
    expect(fits.deleted).toHaveLength(allowed);
  });

  test("image.orphan_delete_fails: one failed delete still lets the rest go, then is thrown", async () => {
    const alice = await member();
    const [a, b] = [randomId(), randomId()];
    const drafts = objects([...files(alice, a), ...files(alice, b)]);
    drafts.failDelete(folder(alice, a));
    await expect(sweepOrphanImages(drafts.store, rows)).rejects.toThrow("could not delete");
    expect(drafts.deleted).toEqual(expect.arrayContaining([folder(alice, a), folder(alice, b)]));
    expect(drafts.deleted).toHaveLength(2);
  });
});
