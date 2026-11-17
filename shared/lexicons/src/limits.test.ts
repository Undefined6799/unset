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
// Card contents: unions carry their def's $type (https://atproto.com/specs/lexicon#union).
const card = (name: string, content: Record<string, unknown>) => ({
  $type: "sh.unset.section",
  content: { $type: `sh.unset.section#${name}`, ...content },
  createdAt: CREATED,
});
const links = (items: unknown[], extra: Record<string, unknown> = {}) => card("links", { items, ...extra });
const collection = (items: unknown[], extra: Record<string, unknown> = {}) => card("collection", { items, ...extra });
const buttons = (list: unknown[], extra: Record<string, unknown> = {}) =>
  card("buttons", { heading: "Hi", buttons: list, ...extra });
const linkButton = (extra: Record<string, unknown>) => ({
  $type: "sh.unset.section#linkButton",
  preset: "custom",
  uri: ORIGIN,
  ...extra,
});
const emailButton = (address: string) => ({ $type: "sh.unset.section#emailButton", address });

// One record per limit: the value exactly at the limit passes and one past it fails, which proves LIMITS equals the
// schema's constraint. A new LIMITS entry without a row here fails `every_limit_has_a_fixture`.
type Build = (n: number) => { nsid: "sh.unset.profile" | "sh.unset.section"; value: Record<string, unknown> };
const P =
  (field: (n: number) => Record<string, unknown>): Build =>
  (n) => ({ nsid: "sh.unset.profile", value: { ...profile, ...field(n) } });
const S =
  (value: (n: number) => Record<string, unknown>): Build =>
  (n) => ({ nsid: "sh.unset.section", value: value(n) });
const FIXTURES: Record<string, Build> = {
  "profile.displayName": P((n) => ({ displayName: text(n) })),
  "profile.headline": P((n) => ({ headline: text(n) })),
  "profile.avatarMaxSize": P((n) => ({ avatar: blob(n) })),
  "profile.avatarShapeBytes": P((n) => ({ avatarShape: text(n) })),
  "profile.location": P((n) => ({ location: text(n) })),
  "profile.websiteBytes": P((n) => ({ website: url(n) })),
  "profile.cardsMax": P((n) => ({ cards: many(n, "3jzfcijpj2z2a") })),
  "section.widthBytes": S((n) => ({ ...links([]), width: text(n) })),
  "section.textBytes": S((n) => card("readme", { text: text(n) })),
  "section.title": S((n) => links([], { title: text(n) })),
  "section.layoutBytes": S((n) => collection([], { layout: text(n) })),
  "section.linksMax": S((n) => links(many(n, { uri: ORIGIN }))),
  "section.linkUriBytes": S((n) => links([{ uri: url(n) }])),
  "section.linkLabel": S((n) => links([{ uri: ORIGIN, label: text(n) }])),
  "section.linkDescription": S((n) => links([{ uri: ORIGIN, description: text(n) }])),
  "section.entriesMax": S((n) => collection(many(n, { title: "a" }))),
  "section.entryTitle": S((n) => collection([{ title: text(n) }])),
  "section.entryTag": S((n) => collection([{ title: "a", tag: text(n) }])),
  "section.entryDescription": S((n) => collection([{ title: "a", description: text(n) }])),
  "section.entryUriBytes": S((n) => collection([{ title: "a", uri: url(n) }])),
  "section.buttonsHeading": S((n) => buttons([], { heading: text(n) })),
  "section.buttonsText": S((n) => buttons([], { text: text(n) })),
  "section.buttonsMax": S((n) => buttons(many(n, emailButton("a@a.example.com")))),
  "section.emailBytes": S((n) => buttons([emailButton(`${text(n - MAIL_DOMAIN.length)}${MAIL_DOMAIN}`)])),
  "section.presetBytes": S((n) => buttons([linkButton({ preset: text(n) })])),
  "section.buttonUriBytes": S((n) => buttons([linkButton({ uri: url(n) })])),
  "section.buttonLabel": S((n) => buttons([linkButton({ label: text(n) })])),
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

  test("an_unknown_card_kind_is_valid_since_the_union_is_open", () => {
    const value = { ...links([]), content: { $type: "sh.unset.section#video", id: "x" } };
    expect(validateRecord("sh.unset.section", value, "read").ok).toBe(true);
  });

  test("retired_profile_fields_are_gone_from_the_schema", () => {
    // ADR 0051: the profile keeps nine fields; a stored readme is just an unknown field now.
    const value = { ...profile, readme: "## Hi", bio: "x", links: [] };
    expect(validateRecord("sh.unset.profile", value, "read").ok).toBe(true);
  });
});
