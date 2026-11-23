import { describe, expect, test } from "vitest";
import { IMAGE_ACCEPT, LIMITS } from "./limits.ts";
import { validateRecord } from "./validate.ts";

const CREATED = "2026-10-12T00:00:00.000Z";
const profile = { $type: "sh.unset.profile", displayName: "Ada", createdAt: CREATED };
const text = (n: number) => "x".repeat(n);
const ORIGIN = "https://a.example.com/";
const url = (bytes: number) => `${ORIGIN}${"p".repeat(bytes - ORIGIN.length)}`;
const MAIL_DOMAIN = "@a.example.com";
const blob = (size: number) => ({
  $type: "blob",
  ref: { $link: "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku" },
  mimeType: IMAGE_ACCEPT[0],
  size,
});
const many = <T>(n: number, item: T) => Array.from({ length: n }, () => item);
// A card holds one block; a block's $type is its NSID (https://atproto.com/specs/lexicon#union).
const card = (block: string, content: Record<string, unknown>) => ({
  $type: "sh.unset.card",
  content: { $type: `sh.unset.block.${block}`, ...content },
  createdAt: CREATED,
});
const links = (items: unknown[], extra: Record<string, unknown> = {}) => card("links", { items, ...extra });
const showcase = (items: unknown[], extra: Record<string, unknown> = {}) => card("showcase", { items, ...extra });
const buttons = (list: unknown[], extra: Record<string, unknown> = {}) =>
  card("buttons", { heading: "Hi", buttons: list, ...extra });
const linkButton = (extra: Record<string, unknown>) => ({
  $type: "sh.unset.block.buttons#link",
  preset: "hire",
  uri: ORIGIN,
  ...extra,
});
const emailButton = (address: string) => ({ $type: "sh.unset.block.buttons#email", address });
// The shared picture (sh.unset.block.defs#image): file, alt text, proportions, optional caption.
const picture = (extra: Record<string, unknown> = {}) => ({
  image: { ...blob(1000), mimeType: "image/jpeg" },
  alt: "",
  aspectRatio: { width: 4, height: 3 },
  ...extra,
});
const images = (list: unknown[], extra: Record<string, unknown> = {}) => card("images", { images: list, ...extra });
// One line's fingerprint (sh.unset.block.text#lineFingerprint): 8 characters.
const FP = "567b4f30";
// One table cell side (sh.unset.block.text#edge): the top of the first header cell.
const edge = (extra: Record<string, unknown> = {}) => ({ direction: "horizontal", line: 0, cell: 0, ...extra });
const oneTable = (extra: Record<string, unknown> = {}) => ({ lines: [FP], edges: [edge()], ...extra });
const tableText = (tableStyle: Record<string, unknown>) => card("text", { text: "| a |\n| - |", tableStyle });
const align = (extra: Record<string, unknown> = {}) => ({ lines: [FP], value: "center", ...extra });
const alignedText = (textStyle: Record<string, unknown>) => card("text", { text: "# a", textStyle });
const cardRef = { uri: "at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/sh.unset.card/3jzfcijpj2z2a" };

// One record per limit: the value exactly at the limit passes and one past it fails, which proves LIMITS equals the
// schema's constraint. A new LIMITS entry without a row here fails `every_limit_has_a_fixture`.
type Build = (n: number) => {
  nsid: "sh.unset.profile" | "sh.unset.page" | "sh.unset.card";
  value: Record<string, unknown>;
};
const P =
  (field: (n: number) => Record<string, unknown>): Build =>
  (n) => ({ nsid: "sh.unset.profile", value: { ...profile, ...field(n) } });
const PAGE = { $type: "sh.unset.page", createdAt: profile.createdAt };
const G =
  (field: (n: number) => Record<string, unknown>): Build =>
  (n) => ({ nsid: "sh.unset.page", value: { ...PAGE, ...field(n) } });
const C =
  (value: (n: number) => Record<string, unknown>): Build =>
  (n) => ({ nsid: "sh.unset.card", value: value(n) });
const FIXTURES: Record<string, Build> = {
  "profile.displayName": P((n) => ({ displayName: text(n) })),
  "profile.headline": P((n) => ({ headline: text(n) })),
  "profile.avatarMaxSize": P((n) => ({ avatar: blob(n) })),
  "profile.avatarShapeBytes": P((n) => ({ avatarShape: text(n) })),
  "profile.location": P((n) => ({ location: text(n) })),
  "profile.websiteBytes": P((n) => ({ website: url(n) })),
  "page.cardsMax": G((n) => ({ cards: many(n, cardRef) })),
  "page.visibilityBytes": G((n) => ({ visibility: text(n) })),
  "card.widthBytes": C((n) => ({ ...links([]), width: text(n) })),
  "card.surfaceBytes": C((n) => ({ ...links([]), surface: text(n) })),
  "card.textBytes": C((n) => card("text", { text: text(n) })),
  "card.styledTablesMax": C((n) => tableText({ tables: many(n, oneTable()) })),
  "card.tableEdgesMax": C((n) => tableText({ tables: [oneTable({ edges: many(n, edge()) })] })),
  "card.edgeDirectionBytes": C((n) => tableText({ tables: [oneTable({ edges: [edge({ direction: text(n) })] })] })),
  "card.edgeLineHighest": C((n) => tableText({ tables: [oneTable({ edges: [edge({ line: n })] })] })),
  "card.edgeCellHighest": C((n) => tableText({ tables: [oneTable({ edges: [edge({ cell: n })] })] })),
  "card.alignedBlocksMax": C((n) => alignedText({ align: many(n, align()) })),
  "card.alignValueBytes": C((n) => alignedText({ align: [align({ value: text(n) })] })),
  "card.lookLinesMax": C((n) => alignedText({ align: [align({ lines: many(n, FP) })] })),
  "card.lineFingerprintBytes": C((n) => alignedText({ align: [align({ lines: [text(n)] })] })),
  "card.title": C((n) => links([], { title: text(n) })),
  "card.layoutBytes": C((n) => showcase([], { layout: text(n) })),
  "card.linksMax": C((n) => links(many(n, { uri: ORIGIN }))),
  "card.linkUriBytes": C((n) => links([{ uri: url(n) }])),
  "card.linkLabel": C((n) => links([{ uri: ORIGIN, label: text(n) }])),
  "card.linkDescription": C((n) => links([{ uri: ORIGIN, description: text(n) }])),
  "card.entriesMax": C((n) => showcase(many(n, { title: "a" }))),
  "card.entryTitle": C((n) => showcase([{ title: text(n) }])),
  "card.entryTag": C((n) => showcase([{ title: "a", tag: text(n) }])),
  "card.entryDescription": C((n) => showcase([{ title: "a", description: text(n) }])),
  "card.entryUriBytes": C((n) => showcase([{ title: "a", uri: url(n) }])),
  "card.buttonsHeading": C((n) => buttons([], { heading: text(n) })),
  "card.buttonsText": C((n) => buttons([], { text: text(n) })),
  "card.buttonsMax": C((n) => buttons(many(n, emailButton("a@a.example.com")))),
  "card.emailBytes": C((n) => buttons([emailButton(`${text(n - MAIL_DOMAIN.length)}${MAIL_DOMAIN}`)])),
  "card.presetBytes": C((n) => buttons([linkButton({ preset: text(n) })])),
  "card.buttonUriBytes": C((n) => buttons([linkButton({ uri: url(n) })])),
  "card.buttonLabel": C((n) => buttons([linkButton({ label: text(n) })])),
  "card.imageMaxSize": C((n) => images([picture({ image: { ...blob(n), mimeType: "image/jpeg" } })])),
  "card.imageAlt": C((n) => images([picture({ alt: text(n) })])),
  "card.imageCaption": C((n) => images([picture({ caption: text(n) })])),
  "card.fitBytes": C((n) => images([picture()], { fit: text(n) })),
  "card.galleryTitle": C((n) => images([picture()], { title: text(n) })),
  "card.galleryMax": C((n) => images(many(n, picture()))),
};
const limitEntries = Object.entries(LIMITS).flatMap(([record, fields]) =>
  Object.entries(fields).map(([field, limit]) => [`${record}.${field}`, limit] as const),
);

describe("LIMITS", () => {
  test("every_limit_has_a_fixture", () => {
    expect(limitEntries.map(([key]) => key).sort()).toEqual(Object.keys(FIXTURES).sort());
  });

  test("limits_enforced", () => {
    for (const [key, limit] of limitEntries) {
      const build = FIXTURES[key];
      if (!build) throw new Error(`no fixture for ${key}`);
      const at = build(limit);
      const over = build(limit + 1);
      expect(validateRecord(at.nsid, at.value, "write").ok, `${key} at ${limit}`).toBe(true);
      expect(validateRecord(over.nsid, over.value, "write").ok, `${key} over ${limit}`).toBe(false);
    }
  });

  test("picture_shapes: one images block for one picture or many, and a showcase entry's picture", () => {
    const write = (value: Record<string, unknown>) => validateRecord("sh.unset.card", value, "write").ok;
    expect(write(images([picture({ caption: "Dusk" })], { fit: "cover" }))).toBe(true);
    expect(write(images([picture(), picture()], { title: "Work", fit: "contain" }))).toBe(true);
    expect(write(showcase([{ title: "a", image: picture() }]))).toBe(true);
    // No minimum in the lexicon (the editor keeps "at least one"); alt and proportions always present, at least 1.
    expect(write(images([]))).toBe(true);
    expect(write(images([{ image: picture().image, aspectRatio: { width: 1, height: 1 } }]))).toBe(false);
    expect(write(images([{ image: picture().image, alt: "" }]))).toBe(false);
    expect(write(images([picture({ aspectRatio: { width: 0, height: 1 } })]))).toBe(false);
    expect(write(images([picture({ image: blob(1000) })]))).toBe(true);
    expect(write(card("images", {}))).toBe(false);
  });

  test("picture_unknown_fields: a write refuses a field the shared image does not define", () => {
    const write = (value: Record<string, unknown>) => validateRecord("sh.unset.card", value, "write");
    expect(write(images([picture({ exif: "GPS" })]))).toEqual({
      ok: false,
      errors: ["$.content.images[0].exif: unknown field"],
    });
    expect(write(images([picture({ aspectRatio: { width: 4, height: 3, depth: 1 } })]))).toEqual({
      ok: false,
      errors: ["$.content.images[0].aspectRatio.depth: unknown field"],
    });
    expect(write(links([{ uri: ORIGIN, icon: "x" }]))).toEqual({
      ok: false,
      errors: ["$.content.items[0].icon: unknown field"],
    });
    const read = validateRecord("sh.unset.card", images([picture({ exif: "GPS" })]), "read");
    expect(read.ok).toBe(true);
  });

  test("an_unknown_block_is_valid_since_the_union_is_open", () => {
    const value = { ...links([]), content: { $type: "com.example.video", id: "x" } };
    expect(validateRecord("sh.unset.card", value, "read").ok).toBe(true);
  });

  test("text_looks: optional, beside unchanged Markdown, each named by its block's line fingerprints", () => {
    const write = (value: Record<string, unknown>) => validateRecord("sh.unset.card", value, "write").ok;
    // ADR 0110: every part is optional, so a text card without them is unchanged.
    expect(write(card("text", { text: "| a |\n| - |" }))).toBe(true);
    expect(write(tableText({}))).toBe(true);
    expect(write(alignedText({}))).toBe(true);
    const switches = { hideHeaderLine: true, hideRowLines: false, showColumnLines: true, showOutline: true };
    expect(write(tableText(switches))).toBe(true);
    expect(
      write(tableText({ tables: [oneTable({ edges: [edge(), edge({ direction: "vertical", hide: true })] })] })),
    ).toBe(true);
    expect(write(alignedText({ align: [align(), align({ value: "end", lines: [FP, FP, FP] })] }))).toBe(true);
    // A look names its block: its line fingerprints are required, and so is what it sets.
    for (const part of ["lines", "value"]) {
      const partial: Record<string, unknown> = align();
      delete partial[part];
      expect(write(alignedText({ align: [partial] })), part).toBe(false);
    }
    for (const part of ["lines", "edges"]) {
      const partial: Record<string, unknown> = oneTable();
      delete partial[part];
      expect(write(tableText({ tables: [partial] })), part).toBe(false);
    }
    for (const part of ["direction", "line", "cell"]) {
      const partial: Record<string, unknown> = edge();
      delete partial[part];
      expect(write(tableText({ tables: [oneTable({ edges: [partial] })] })), part).toBe(false);
    }
    // A line's fingerprint is exactly 8 characters, and a block has at least one line.
    expect(write(alignedText({ align: [align({ lines: [FP.slice(1)] })] }))).toBe(false);
    expect(write(alignedText({ align: [align({ lines: [] })] }))).toBe(false);
    expect(write(tableText({ tables: [oneTable({ edges: [edge({ line: -1 })] })] }))).toBe(false);
    expect(write(tableText({ tables: [oneTable({ edges: [edge({ cell: 1.5 })] })] }))).toBe(false);
    expect(write(tableText({ hideRowLines: "yes" }))).toBe(false);
    // Writing refuses anything a look does not define, so no CSS, colour or link can ride along.
    expect(write(alignedText({ align: [align({ colour: "red" })] }))).toBe(false);
    expect(write(tableText({ css: "x" }))).toBe(false);
    expect(write(tableText({ tables: [oneTable({ edges: [edge({ href: "https://example.com" })] })] }))).toBe(false);
    // Later values are open (knownValues), so an older reader still accepts the record.
    const later = tableText({ tables: [oneTable({ edges: [edge({ direction: "diagonal" })] })] });
    expect(validateRecord("sh.unset.card", later, "read").ok).toBe(true);
    expect(validateRecord("sh.unset.card", alignedText({ align: [align({ value: "justify" })] }), "read").ok).toBe(
      true,
    );
  });

  test("the_page_lists_cards_by_address", () => {
    const write = (cards: unknown) => validateRecord("sh.unset.page", { ...PAGE, cards }, "write").ok;
    expect(write([cardRef])).toBe(true);
    expect(write(["3jzfcijpj2z2a"])).toBe(false);
    expect(write([{ uri: "not an address" }])).toBe(false);
  });

  test("the_profile_no_longer_holds_cards", () => {
    // ADR 0091: the card list moved to sh.unset.page; on the profile it is an unknown field, refused on write.
    expect(validateRecord("sh.unset.profile", { ...profile, cards: [cardRef] }, "write").ok).toBe(false);
    expect(validateRecord("sh.unset.profile", { ...profile, cards: [cardRef] }, "read").ok).toBe(true);
  });

  test("retired_profile_fields_are_gone_from_the_schema", () => {
    // ADR 0051: the profile keeps nine fields; a stored readme is just an unknown field now.
    const value = { ...profile, readme: "## Hi", bio: "x", links: [] };
    expect(validateRecord("sh.unset.profile", value, "read").ok).toBe(true);
  });
});
