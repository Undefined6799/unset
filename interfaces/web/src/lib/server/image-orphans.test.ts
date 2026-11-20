// P2.19b (image-orphans.ts): the orphan-object sweep deletes only folders under `drafts/` that no image row names,
// listed before the rows are read, and nothing at all over the governor or when the listing fails. The store and the
// rows are doubles (unmanaged here); tests/integration/postgres/image-store.test.ts covers the rows' real query.
import { describe, expect, test } from "vitest";
import { type DraftObjects, type ImageRowsLookup, sweepOrphanImages } from "./image-orphans.ts";

const ALICE = "did:plc:abcdefghijklmnopqrstuvwx";
const BOB = "did:web:example.com";
const A = "0b6a52d4-6c1f-4bde-9b8e-2a1f6d7c3e01";
const B = "5f0c1a9e-2d3b-4c4d-8e5f-6a7b8c9d0e02";
const C = "9e8d7c6b-5a4f-4e3d-9c2b-1a0f9e8d7c03";
const folder = (did: string, id: string) => `drafts/${did}/i/${id}/`;
const files = (did: string, id: string) => [`${folder(did, id)}main.jpeg`, `${folder(did, id)}w480.webp`];

function stack(keys: string[], rows: { did: string; id: string }[], live = 1000) {
  const order: string[] = [];
  const deleted: string[] = [];
  const asked: string[][] = [];
  let listing: { ok: true; keys: string[] } | { ok: false; code: "objects.unavailable" } = { ok: true, keys };
  let failing = new Set<string>();
  const objects: DraftObjects = {
    list: async (prefix) => {
      order.push(`list ${prefix}`);
      return listing;
    },
    deletePrefix: async (prefix) => {
      deleted.push(prefix);
      return failing.has(prefix) ? { ok: false, code: "objects.unavailable" } : { ok: true, deleted: 2 };
    },
  };
  const lookup: ImageRowsLookup = {
    named: async (ids) => {
      order.push("rows");
      asked.push([...ids]);
      return { live, images: rows.filter((row) => ids.includes(row.id)) as never };
    },
  };
  return {
    run: () => sweepOrphanImages(objects, lookup),
    order,
    deleted,
    asked,
    failListing: () => {
      listing = { ok: false, code: "objects.unavailable" };
    },
    failDelete: (prefix: string) => {
      failing = new Set([prefix]);
    },
  };
}

describe("sweepOrphanImages", () => {
  test("image.orphan_deleted: only a folder no row names goes, after the listing and then the rows", async () => {
    const s = stack(
      [...files(ALICE, A), ...files(ALICE, B), ...files(BOB, C)],
      [
        { did: ALICE, id: A },
        { did: BOB, id: C },
      ],
    );
    await s.run();
    expect(s.order).toEqual(["list drafts/", "rows"]);
    expect(s.asked).toEqual([[A, B, C]]);
    expect(s.deleted).toEqual([folder(ALICE, B)]);
  });

  test("image.orphan_other_member: a row with the folder's id but another member's DID does not keep it", async () => {
    const s = stack(files(BOB, A), [{ did: ALICE, id: A }]);
    await s.run();
    expect(s.deleted).toEqual([folder(BOB, A)]);
  });

  test("image.orphan_unknown_shape: keys outside drafts/<did>/i/<uuid>/<file> are left alone", async () => {
    const s = stack(
      [
        "drafts/not-a-did/i/0b6a52d4-6c1f-4bde-9b8e-2a1f6d7c3e01/main.jpeg",
        `drafts/${ALICE}/i/not-a-uuid/main.jpeg`,
        `drafts/${ALICE}/x/${A}/main.jpeg`,
        `drafts/${ALICE}/i/${A}/deeper/main.jpeg`,
        `drafts/${ALICE}/i/${A.toUpperCase()}/main.jpeg`,
        `drafts/${ALICE}/i/${A}`,
      ],
      [],
    );
    await s.run();
    expect(s.asked).toEqual([]);
    expect(s.deleted).toEqual([]);
  });

  test("image.orphan_listing_fails: an unavailable listing deletes nothing and is thrown", async () => {
    const s = stack(files(ALICE, A), []);
    s.failListing();
    await expect(s.run()).rejects.toThrow("could not list");
    expect(s.deleted).toEqual([]);
  });

  test("image.orphan_governor: more orphans than the governor allows deletes nothing and is thrown", async () => {
    const ids = Array.from({ length: 501 }, (_, n) => `0b6a52d4-6c1f-4bde-9b8e-${String(n).padStart(12, "0")}`);
    const s = stack(
      ids.flatMap((id) => files(ALICE, id)),
      [],
      1000,
    );
    await expect(s.run()).rejects.toThrow("governor");
    expect(s.deleted).toEqual([]);
    const fits = stack(
      ids.slice(0, 500).flatMap((id) => files(ALICE, id)),
      [],
      1000,
    );
    await fits.run();
    expect(fits.deleted).toHaveLength(500);
  });

  test("image.orphan_delete_fails: one failed delete still lets the rest go, then is thrown", async () => {
    const s = stack([...files(ALICE, A), ...files(ALICE, B)], []);
    s.failDelete(folder(ALICE, A));
    await expect(s.run()).rejects.toThrow("could not delete");
    expect(s.deleted).toEqual([folder(ALICE, A), folder(ALICE, B)]);
  });
});
