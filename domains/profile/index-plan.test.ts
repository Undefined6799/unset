// The index's rules for one commit (index-plan.ts, book P3.05s). Pure: the store's tests cover the transaction.
import { describe, expect, test } from "vitest";
import { type IndexChange, MAX_RECORD_BYTES, planCommit } from "./index-plan.ts";

const T = "2026-11-18T00:00:00.000Z";
const TID = "3jzfcijpj2z2a";
const CID = "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5xzrgnw3hj6aoqe";
const BLOB = "bafkreibme22gw2h7y2h7tg2fhqotaqjucnbc24deqo72b6mkl2egezxhvy";
const avatar = { $type: "blob", ref: { $link: BLOB }, mimeType: "image/png", size: 1000 };

const profile = (extra: Record<string, unknown> = {}): IndexChange => ({
  kind: "put",
  collection: "sh.unset.profile",
  rkey: "self",
  cid: CID,
  record: { $type: "sh.unset.profile", displayName: "Ada", createdAt: T, ...extra },
});
const section = (rkey = TID, content: Record<string, unknown> = { $type: "sh.unset.section#readme", text: "hi" }) =>
  ({
    kind: "put",
    collection: "sh.unset.section",
    rkey,
    cid: CID,
    record: { $type: "sh.unset.section", content, createdAt: T },
  }) satisfies IndexChange;
const active = { lastRev: "3jzfcijpj2z2b", active: true };

// Staging break test 2026-11-21: a 95 KB Text card saved but never showed publicly, as the index then kept records of
// at most 64 KiB. The index now keeps every record Alex's limits let a member save (book P3.12v).
describe("the largest cards a member may save are indexed", () => {
  // As tests/integration/web/app/member-page.test.ts builds the largest collection: one grapheme of nine bytes.
  const heavy = (graphemes: number) => "a\u0301\u0301\u0301\u0301".repeat(graphemes);
  const entry = {
    title: heavy(120),
    tag: heavy(40),
    description: heavy(300),
    uri: `https://a.example/${"x".repeat(1982)}`,
  };
  const largest = {
    "a Text card of 100,000 bytes, each one a character JSON escapes": {
      $type: "sh.unset.section#readme",
      text: '"'.repeat(100_000),
    },
    "a collection of 100 entries at every field's limit": {
      $type: "sh.unset.section#collection",
      title: heavy(100),
      items: Array.from({ length: 100 }, () => ({ $type: "sh.unset.section#entry", ...entry })),
    },
  };
  test.each(Object.entries(largest))("index.keeps_%s", (_name, content) => {
    expect(planCommit(active, "3jzfcijpj2z2c", [section(TID, content)])).toMatchObject({ kind: "apply", skipped: 0 });
  });
});

describe("planCommit", () => {
  test("index.null_watermark_first_commit_applies", () => {
    const plan = planCommit({ lastRev: null, active: true }, "3jzfcijpj2z2a", [profile()]);
    expect(plan).toMatchObject({ kind: "apply", rev: "3jzfcijpj2z2a", skipped: 0 });
  });

  test("index.older_rev_is_stale", () => {
    expect(planCommit(active, "3jzfcijpj2z2a", [profile()])).toEqual({ kind: "stale" });
  });

  test("index.equal_rev_applies", () => {
    // A backfill's records share one rev with the commit that follows it (book P3.05, findings F-05).
    expect(planCommit(active, active.lastRev, [profile()]).kind).toBe("apply");
  });

  test("index.unsigned_rev_applies_nothing", () => {
    expect(planCommit(active, null, [profile()])).toEqual({ kind: "unsigned" });
  });

  test("index.inactive_account_moves_only_the_watermark", () => {
    expect(planCommit({ lastRev: null, active: false }, "3jzfcijpj2z2c", [profile()])).toEqual({
      kind: "inactive",
      rev: "3jzfcijpj2z2c",
    });
  });

  test("index.profile_promotes_its_columns_and_blobs", () => {
    const plan = planCommit(active, "3jzfcijpj2z2c", [profile({ listed: true, avatar })]);
    expect(plan).toMatchObject({
      kind: "apply",
      writes: [
        {
          kind: "profile",
          cid: CID,
          displayName: "Ada",
          discoverable: true,
          avatarCid: BLOB,
          blobs: [{ cid: BLOB, mime: "image/png", size: 1000 }],
        },
      ],
    });
  });

  test("index.gallery_records_each_picture_once", () => {
    // ADR 0070: the media proxy serves only blobs a record references, so every picture of a gallery is recorded,
    // and a picture used twice is recorded once.
    const OTHER = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";
    const picture = (link: string) => ({
      image: {
        image: { $type: "blob", ref: { $link: link }, mimeType: "image/jpeg", size: 1000 },
        alt: "",
        aspectRatio: { width: 4, height: 3 },
      },
    });
    const content = { $type: "sh.unset.section#gallery", images: [picture(BLOB), picture(OTHER), picture(BLOB)] };
    expect(planCommit(active, "3jzfcijpj2z2c", [section(TID, content)])).toMatchObject({
      kind: "apply",
      writes: [
        {
          kind: "section",
          blobs: [
            { cid: BLOB, mime: "image/jpeg", size: 1000 },
            { cid: OTHER, mime: "image/jpeg", size: 1000 },
          ],
        },
      ],
    });
  });

  test("index.ignores_other_collections", () => {
    const other: IndexChange = { kind: "delete", collection: "app.bsky.feed.post", rkey: TID };
    expect(planCommit(active, "3jzfcijpj2z2c", [other])).toEqual({
      kind: "apply",
      rev: "3jzfcijpj2z2c",
      writes: [],
      skipped: 0,
    });
  });

  test.each([
    ["a profile not at self", { ...profile(), rkey: TID }],
    ["a section key that is not a TID", section("self")],
    ["a delete under a bad key", { kind: "delete", collection: "sh.unset.profile", rkey: TID } as IndexChange],
  ])("index.skips_%s", (_name, change) => {
    expect(planCommit(active, "3jzfcijpj2z2c", [change, section()])).toMatchObject({
      kind: "apply",
      writes: [{ kind: "section", rkey: TID }],
      skipped: 1,
    });
  });

  // The repo now holds this record in a form we do not index, so any older version indexed under its key goes, as a
  // backfill of the same repo would remove it (trackStore.ts applySnapshot): the stream and a rebuild agree.
  test.each([
    ["a record of another type", { ...profile(), record: { $type: "sh.unset.section", createdAt: T } }],
    ["a record the lexicon refuses", profile({ displayName: 7 })],
    ["a record over the size cap", profile({ note: "x".repeat(MAX_RECORD_BYTES) })],
    ["a record with a NUL character", profile({ displayName: "A\0da" })],
    ["a record with a lone surrogate", profile({ displayName: "A\uD800da" })],
    ["a record with a NUL in a key", profile({ "a\0b": 1 })],
  ])("index.skips_and_removes_the_older_version_of_%s", (_name, change) => {
    expect(planCommit(active, "3jzfcijpj2z2c", [change, section()])).toMatchObject({
      kind: "apply",
      writes: [
        { kind: "delete", collection: "sh.unset.profile", rkey: "self" },
        { kind: "section", rkey: TID },
      ],
      skipped: 1,
    });
  });

  test("index.keeps_fields_a_newer_client_adds", () => {
    const plan = planCommit(active, "3jzfcijpj2z2c", [profile({ pronouns: "she/her" })]);
    expect(plan.kind === "apply" && plan.writes[0]).toMatchObject({ record: { pronouns: "she/her" } });
  });

  // ADR 0078: the page and the sitemap read who sees the page from the indexed record, so the index keeps it as sent.
  test("index.keeps_a_profile_visibility_known_or_not", () => {
    for (const visibility of ["ownerOnly", "friends"]) {
      const plan = planCommit(active, "3jzfcijpj2z2c", [profile({ visibility })]);
      expect(plan.kind === "apply" && plan.writes[0]).toMatchObject({ record: { visibility } });
    }
  });

  test("index.keeps_a_card_surface_known_or_not", () => {
    for (const surface of ["plain", "future"]) {
      const card = section(TID);
      const change = { ...card, record: { ...card.record, surface } };
      const plan = planCommit(active, "3jzfcijpj2z2c", [change]);
      expect(plan.kind === "apply" && plan.writes[0]).toMatchObject({ record: { surface } });
    }
  });

  test("index.delete_passes_through", () => {
    const del: IndexChange = { kind: "delete", collection: "sh.unset.section", rkey: TID };
    expect(planCommit(active, "3jzfcijpj2z2c", [del])).toMatchObject({
      writes: [{ kind: "delete", collection: "sh.unset.section", rkey: TID }],
    });
  });
});
