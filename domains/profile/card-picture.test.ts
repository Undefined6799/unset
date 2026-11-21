// P2.19b: a picture card (an sh.unset.block.images block, ADR 0070 and 0086) as the editor sends it and as it is written. The editor
// sends a draft id or nothing (keep the card's picture); the record carries the PDS blob once web has published it.
import { LIMITS, validateRecord } from "@unset/shared-lexicons";
import { describe, expect, test } from "vitest";
import { parseCardInput, pictureLink, toCardRecord } from "./card-edit.ts";
import type { CardContent } from "./cards.ts";

const NOW = "2026-11-20T22:00:00.000Z";
const T1 = "2026-11-01T00:00:00.000Z";
const DRAFT = "0b6a52d4-6c1f-4bde-9b8e-2a1f6d7c3e01";
const BLOB = {
  $type: "blob",
  ref: { $link: "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku" },
  mimeType: "image/jpeg",
  size: 1_200_000,
};
const OTHER_BLOB = { ...BLOB, ref: { $link: "bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bvhwoxxfuknnqdpe" } };
const stored = (content: Record<string, unknown>) => ({ $type: "sh.unset.card", content, createdAt: T1 });
const storedPicture = (extra: Record<string, unknown> = {}) =>
  stored({
    $type: "sh.unset.block.images",
    images: [{ image: OTHER_BLOB, alt: "Old words", aspectRatio: { width: 3, height: 2 }, caption: "Old caption" }],
    ...extra,
  });

const published = (alt = "A lake at dawn"): CardContent => ({
  kind: "image",
  picture: { kind: "published", blob: BLOB, width: 2560, height: 1707 },
  alt,
  caption: "Morning",
  fit: "contain",
});

describe("parseCardInput, picture", () => {
  test("image.parse_draft: a draft id, alt text, caption and fit are read", () => {
    expect(
      parseCardInput({ kind: "image", image: DRAFT, alt: " A lake \n at dawn ", caption: " Morning ", fit: "fill" }),
    ).toEqual({
      ok: true,
      width: "full",
      content: {
        kind: "image",
        picture: { kind: "draft", id: DRAFT },
        alt: "A lake \n at dawn",
        caption: "Morning",
        fit: "fill",
      },
    });
  });

  test("image.parse_keep: no image field keeps the card's picture, and fit defaults to contain", () => {
    expect(parseCardInput({ kind: "image", image: "", alt: "", caption: "" })).toMatchObject({
      ok: true,
      content: { kind: "image", picture: { kind: "kept" }, alt: "", caption: "", fit: "contain" },
    });
  });

  test.each([
    ["not a uuid", { image: "abc" }, "image"],
    ["an uppercase uuid", { image: DRAFT.toUpperCase() }, "image"],
    ["a path", { image: `../${DRAFT}` }, "image"],
    ["a fit the editor does not offer", { image: DRAFT, fit: "stretch" }, undefined],
    ["a caption on two lines", { image: DRAFT, caption: "a\nb" }, "caption"],
  ])("image.parse_refused: %s is refused", (_name, input, field) => {
    const parsed = parseCardInput({ kind: "image", ...input });
    expect(parsed).toMatchObject({ ok: false, code: "card.invalid" });
    if (field !== undefined) expect(parsed).toMatchObject({ field });
  });

  test("image.parse_too_long: alt text and caption past the lexicon's graphemes are refused by name", () => {
    expect(parseCardInput({ kind: "image", image: DRAFT, alt: "a".repeat(LIMITS.card.imageAlt + 1) })).toEqual({
      ok: false,
      code: "card.too_long",
      field: "alt",
    });
    expect(parseCardInput({ kind: "image", image: DRAFT, caption: "a".repeat(LIMITS.card.imageCaption + 1) })).toEqual({
      ok: false,
      code: "card.too_long",
      field: "caption",
    });
  });
});

describe("toCardRecord, picture", () => {
  test("image.record_published: the blob, alt text, aspect ratio, caption and fit are written and validate", () => {
    const built = toCardRecord(published(), "half", null, NOW);
    expect(built).toEqual({
      ok: true,
      record: {
        $type: "sh.unset.card",
        width: "half",
        content: {
          $type: "sh.unset.block.images",
          images: [
            { image: BLOB, alt: "A lake at dawn", aspectRatio: { width: 2560, height: 1707 }, caption: "Morning" },
          ],
          fit: "contain",
        },
        createdAt: NOW,
      },
    });
    expect(built.ok && validateRecord("sh.unset.card", built.record, "write").ok).toBe(true);
  });

  test("image.record_kept: keeping the picture keeps its blob and ratio and writes the new alt text", () => {
    const keep: CardContent = { kind: "image", picture: { kind: "kept" }, alt: "New words", caption: "", fit: "fill" };
    const built = toCardRecord(keep, "full", storedPicture({ future: "kept" }), NOW);
    expect(built).toMatchObject({
      ok: true,
      record: {
        content: {
          images: [{ image: OTHER_BLOB, alt: "New words", aspectRatio: { width: 3, height: 2 } }],
          fit: "cover",
          future: "kept",
        },
        createdAt: T1,
      },
    });
    const images = built.ok ? (built.record.content as { images: object[] }).images : [];
    expect(images.length === 1 && !("caption" in (images[0] ?? {}))).toBe(true);
  });

  test("image.record_keep_nothing: keeping a picture a card does not have is refused on the image field", () => {
    const keep: CardContent = { kind: "image", picture: { kind: "kept" }, alt: "", caption: "", fit: "contain" };
    expect(toCardRecord(keep, "full", null, NOW)).toEqual({ ok: false, code: "card.required", field: "image" });
    const readme = stored({ $type: "sh.unset.block.text", text: "Hi" });
    expect(toCardRecord(keep, "full", readme, NOW)).toEqual({ ok: false, code: "card.required", field: "image" });
  });

  test("image.record_unpublished: a draft that was never published is never written", () => {
    const draft: CardContent = {
      kind: "image",
      picture: { kind: "draft", id: DRAFT as never },
      alt: "",
      caption: "",
      fit: "contain",
    };
    expect(toCardRecord(draft, "full", null, NOW)).toEqual({ ok: false, code: "card.invalid" });
  });
});

describe("pictureLink", () => {
  // A record as listRecords answers it through @atproto/api is decoded: its blob is a BlobRef whose toJSON gives the
  // JSON form (@atproto/lexicon 0.7.19 dist/blob-refs.js, toJSON -> ipldToJson). This stand-in answers the same way.
  class DecodedBlob {
    toJSON() {
      return OTHER_BLOB;
    }
  }
  const decoded = stored({
    $type: "sh.unset.block.images",
    images: [{ image: new DecodedBlob(), alt: "", aspectRatio: { width: 3, height: 2 } }],
  });

  test("image.link: the blob a picture card shows is named by its CID, in JSON form or decoded", () => {
    expect(pictureLink(storedPicture())).toBe(OTHER_BLOB.ref.$link);
    expect(pictureLink(decoded)).toBe(OTHER_BLOB.ref.$link);
  });

  test("image.link_none: another kind, no record or a malformed picture shows no blob", () => {
    expect(pictureLink(stored({ $type: "sh.unset.block.text", text: "Hi" }))).toBeNull();
    expect(pictureLink(null)).toBeNull();
    expect(pictureLink(stored({ $type: "sh.unset.block.images", images: [{ image: { ref: 7 } }] }))).toBeNull();
  });
});
