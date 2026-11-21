// The profile's fields (Alex, 2026-10-23: profile is its own module). parseProfileFields reads untrusted form or JSON
// input once into checked fields; toProfileRecord builds the sh.unset.profile record we write to the member's PDS.
import { LIMITS, validateRecord } from "@unset/shared-lexicons";
import { describe, expect, test } from "vitest";
import type { CardKey, RepoDid } from "./cards.ts";
import { MAX_RECORD_BYTES } from "./index-plan.ts";
import {
  APP_LIMITS,
  EMPTY_PROFILE,
  parseAvatarShape,
  parseProfileFields,
  readAvatarShape,
  readProfileRecord,
  toProfileRecord,
  withAvatarShape,
  withCardListed,
  withCardOrder,
  withCardUnlisted,
} from "./profile.ts";

const good = {
  displayName: "Alice Moreau",
  headline: "Designer and front-end developer.",
  location: "Toronto, Ontario",
  website: "https://alice.dev",
};
/** `good` as the record stores it: every field is a plain string. */
const goodStored = good;

describe("parseProfileFields", () => {
  test("accepts every field and trims the one-line ones", () => {
    const parsed = parseProfileFields({ ...good, displayName: "  Alice Moreau  " });
    expect(parsed).toEqual({ ok: true, fields: good });
  });

  test("only the fields sent are read, so a form that edits some leaves the rest alone", () => {
    expect(parseProfileFields({})).toEqual({ ok: true, fields: {} });
    expect(parseProfileFields({ headline: " Hi " })).toEqual({ ok: true, fields: { headline: "Hi" } });
  });

  test("a non-string field is refused", () => {
    expect(parseProfileFields({ ...good, headline: ["x"] })).toEqual({
      ok: false,
      field: "headline",
      code: "profile.invalid",
    });
  });

  test.each([
    ["displayName", APP_LIMITS.displayName],
    ["headline", APP_LIMITS.headline],
    ["location", APP_LIMITS.location],
  ] as const)("%s counts graphemes up to its limit", (field, limit) => {
    const family = "👩‍👩‍👧";
    expect(parseProfileFields({ [field]: family.repeat(limit) }).ok).toBe(true);
    expect(parseProfileFields({ [field]: family.repeat(limit + 1) })).toEqual({
      ok: false,
      field,
      code: "profile.too_long",
    });
  });

  test("app limits never exceed the lexicon's, which are permanent once published (ADR 0051)", () => {
    for (const field of ["displayName", "headline", "location"] as const) {
      expect(APP_LIMITS[field]).toBeLessThanOrEqual(LIMITS.profile[field]);
    }
  });

  test("one-line fields refuse line breaks", () => {
    expect(parseProfileFields({ headline: "a\nb" })).toEqual({ ok: false, field: "headline", code: "profile.invalid" });
  });

  // Staging break test 2026-11-21: a NUL in the location was saved, and the index then left the record out.
  test.each(["displayName", "headline", "location", "website"] as const)("%s refuses a control character", (field) => {
    for (const bad of ["a\u0000b", "a\u0007b", "a\u0085b", "a\ud800b"]) {
      expect(parseProfileFields({ [field]: `https://x.example/${bad}` })).toEqual({
        ok: false,
        field,
        code: "profile.invalid",
      });
    }
  });

  test("the display name refuses bidirectional controls and invisible characters, other fields keep them", () => {
    for (const mark of ["\u202e", "\u2067", "\u200b", "\ufeff"]) {
      expect(parseProfileFields({ displayName: `Ali${mark}ce` })).toEqual({
        ok: false,
        field: "displayName",
        code: "profile.invalid",
      });
    }
    expect(parseProfileFields({ displayName: "👩‍💻 Ada", headline: "a\u200bb" })).toEqual({
      ok: true,
      fields: { displayName: "👩‍💻 Ada", headline: "a\u200bb" },
    });
  });

  test.each(["javascript:alert(1)", "ftp://x.example", "mailto:a@x.example", "https://user:pw@x.example"])(
    "website must be a plain http or https URL: %s",
    (website) => {
      expect(parseProfileFields({ website })).toEqual({ ok: false, field: "website", code: "profile.url_invalid" });
    },
  );
});

describe("toProfileRecord", () => {
  test("a save the index would leave out is refused, so the public page never goes missing", () => {
    const existing = { $type: "sh.unset.profile", createdAt: NOW, ...goodStored, note: "x".repeat(MAX_RECORD_BYTES) };
    expect(toProfileRecord({ headline: "Hi" }, existing, NOW)).toEqual({ ok: false, code: "profile.too_long" });
  });

  const NOW = "2026-10-23T04:00:00.000Z";

  test("a first profile writes only filled fields and passes the strict validator", () => {
    const built = toProfileRecord({ ...EMPTY_PROFILE, displayName: "Alice", headline: "hi" }, null, NOW);
    expect(built).toEqual({
      ok: true,
      record: { $type: "sh.unset.profile", displayName: "Alice", headline: "hi", createdAt: NOW },
    });
    expect(built.ok && validateRecord("sh.unset.profile", built.record, "write").ok).toBe(true);
  });

  test("an update keeps createdAt and the fields this page does not edit, and clears emptied ones", () => {
    const existing = {
      $type: "sh.unset.profile",
      displayName: "Old",
      headline: "Old line",
      cards: [{ uri: "at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/sh.unset.card/3jzfcijpj2z2a" }],
      listed: true,
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    const built = toProfileRecord({ ...good, headline: "" }, existing, NOW);
    expect(built).toEqual({
      ok: true,
      record: {
        $type: "sh.unset.profile",
        cards: [{ uri: "at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/sh.unset.card/3jzfcijpj2z2a" }],
        listed: true,
        displayName: good.displayName,
        location: good.location,
        website: good.website,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    });
    expect(built.ok && validateRecord("sh.unset.profile", built.record, "write").ok).toBe(true);
  });

  test("a partial edit (Settings › Profile sends the profile fields only) keeps every field it does not send", () => {
    const existing = { $type: "sh.unset.profile", ...goodStored, createdAt: "2026-10-01T00:00:00.000Z" };
    const built = toProfileRecord({ location: "Montréal" }, existing, NOW);
    expect(built).toEqual({
      ok: true,
      record: { ...existing, location: "Montréal" },
    });
    const cleared = toProfileRecord({ headline: "" }, existing, NOW);
    expect(cleared.ok && "headline" in cleared.record).toBe(false);
  });

  test("a partial edit cannot leave a profile without a display name", () => {
    expect(toProfileRecord({ headline: "hi" }, null, NOW)).toEqual({ ok: false, code: "profile.name_required" });
  });

  test("a profile without a display name cannot be published", () => {
    expect(toProfileRecord(EMPTY_PROFILE, null, NOW)).toEqual({ ok: false, code: "profile.name_required" });
  });

  test("a stored field this version does not know is kept and the save goes through", () => {
    // atproto.com/specs/lexicon, "Authority and Control": unexpected fields are ignored and kept, so a field another
    // client or a newer release added never blocks a save, and is never dropped by one.
    const existing = { $type: "sh.unset.profile", ...goodStored, pronouns: "they/them", createdAt: NOW };
    expect(toProfileRecord({ location: "Montréal" }, existing, NOW)).toEqual({
      ok: true,
      record: { ...existing, location: "Montréal" },
    });
  });

  test("a stored record another client broke is refused, never written back", () => {
    expect(toProfileRecord(good, { listed: "yes", createdAt: "2026-10-01T00:00:00.000Z" }, NOW)).toEqual({
      ok: false,
      code: "profile.invalid",
    });
  });
});

describe("readProfileRecord", () => {
  test("reads the fields of a stored record", () => {
    const stored = { $type: "sh.unset.profile", createdAt: "2026-10-23T03:00:00.000Z", ...goodStored };
    expect(readProfileRecord(stored)).toEqual(good);
  });

  test("a field another client wrote badly is dropped, the rest still shows", () => {
    const stored = {
      ...goodStored,
      website: "javascript:alert(1)",
      headline: 7,
      location: "x".repeat(LIMITS.profile.location + 1),
    };
    expect(readProfileRecord(stored)).toEqual({ ...good, website: "", headline: "", location: "" });
  });

  test("a field another client wrote with a control character, or a name with a bidi override, reads as unset", () => {
    const stored = { ...goodStored, location: "a\u0000b", displayName: "\u202eecilA" };
    expect(readProfileRecord(stored)).toEqual({ ...good, location: "", displayName: "" });
  });

  test("a field another client wrote within the lexicon's limit shows, even past the editor's", () => {
    const headline = "h".repeat(APP_LIMITS.headline + 30);
    expect(readProfileRecord({ ...goodStored, headline }).headline).toBe(headline);
    expect(readProfileRecord({ ...goodStored, headline: "h".repeat(LIMITS.profile.headline + 1) }).headline).toBe("");
    expect(parseProfileFields({ headline })).toMatchObject({ ok: false, code: "profile.too_long" });
  });

  test("anything that is not an object reads as an empty profile", () => {
    for (const value of [null, "profile", 3, ["a"]]) expect(readProfileRecord(value)).toEqual(EMPTY_PROFILE);
  });
});

describe("withCardOrder", () => {
  const OWNER = "did:plc:ewvi7nxzyoun6zhxrhs64oiz" as RepoDid;
  const T = "2026-10-23T03:00:00.000Z";
  const stored = { $type: "sh.unset.profile", createdAt: T, ...goodStored, future: 1 };

  test("sets the order and keeps every other field", () => {
    const built = withCardOrder(OWNER, ["b", "a"] as CardKey[], stored, "2027-01-01T00:00:00.000Z");
    const uri = (key: string) => ({ uri: `at://${OWNER}/sh.unset.card/${key}` });
    expect(built).toEqual({ ok: true, record: { ...stored, cards: [uri("b"), uri("a")] } });
  });

  test("an empty order is written as no order", () => {
    const built = withCardOrder(OWNER, [], { ...stored, cards: [] }, T);
    expect(built.ok && "cards" in built.record).toBe(false);
  });

  test("an entry the order does not name stays, after the ordered cards, as it was stored", () => {
    // ADR 0086 point 3: only listed cards show, so dropping the entry of a card this version hides (a newer block,
    // another client's) would take it off the page for every reader (ADR 0038: kept, never a reason to refuse).
    const uri = (key: string) => ({ uri: `at://${OWNER}/sh.unset.card/${key}` });
    const other = { uri: "at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/sh.unset.card/x" };
    const list = [uri("a"), uri("hidden"), other, uri("b"), uri("a")];
    const built = withCardOrder(OWNER, ["b", "a"] as CardKey[], { ...stored, cards: list }, T);
    expect(built).toEqual({ ok: true, record: { ...stored, cards: [uri("b"), uri("a"), uri("hidden"), other] } });
  });

  test("there is no order without a profile", () => {
    expect(withCardOrder(OWNER, ["a"] as CardKey[], null, T)).toEqual({ ok: false, code: "profile.name_required" });
  });

  test("an order past the lexicon's count is too long", () => {
    const order = Array.from({ length: LIMITS.profile.cardsMax + 1 }, (_, i) => `k${i}`) as CardKey[];
    expect(withCardOrder(OWNER, order, stored, T)).toEqual({ ok: false, code: "profile.too_long" });
  });
});

describe("avatar shape", () => {
  const T = "2026-11-18T05:00:00.000Z";
  const stored = { $type: "sh.unset.profile", createdAt: T, ...goodStored, future: 1 };

  test("reads round when absent or unknown, and the stored known value otherwise", () => {
    expect(readAvatarShape(stored)).toBe("round");
    expect(readAvatarShape({ ...stored, avatarShape: "hexagon" })).toBe("round");
    expect(readAvatarShape({ ...stored, avatarShape: "rounded-square" })).toBe("roundedSquare");
    expect(readAvatarShape({ ...stored, avatarShape: "roundedSquare" })).toBe("round");
    expect(readAvatarShape(null)).toBe("round");
  });

  test("parses only the known shapes", () => {
    expect(parseAvatarShape("roundedSquare")).toBe("roundedSquare");
    expect(parseAvatarShape("round")).toBe("round");
    expect(parseAvatarShape("hexagon")).toBeNull();
    expect(parseAvatarShape(["round"])).toBeNull();
  });

  test("sets the shape and keeps every other field", () => {
    const built = withAvatarShape("roundedSquare", stored, "2027-01-01T00:00:00.000Z");
    expect(built).toEqual({ ok: true, record: { ...stored, avatarShape: "rounded-square" } });
  });

  test("there is no shape without a profile to hold it", () => {
    expect(withAvatarShape("round", null, T)).toEqual({ ok: false, code: "profile.name_required" });
  });
});

describe("withCardListed and withCardUnlisted (ADR 0086: a card shows only when the profile lists it)", () => {
  const OWNER = "did:plc:ewvi7nxzyoun6zhxrhs64oiz" as RepoDid;
  const T = "2026-10-23T03:00:00.000Z";
  const uri = (key: string) => ({ uri: `at://${OWNER}/sh.unset.card/${key}` });
  const other = { uri: "at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/sh.unset.card/x", note: "another client's" };
  const stored = { $type: "sh.unset.profile", createdAt: T, ...goodStored, future: 1, cards: [other, uri("a")] };

  test("a new card goes at the end, and every entry already stored is kept as it is", () => {
    const built = withCardListed(OWNER, "b" as CardKey, stored, "2027-01-01T00:00:00.000Z");
    expect(built).toEqual({ ok: true, record: { ...stored, cards: [other, uri("a"), uri("b")] } });
  });

  test("a card already listed is not listed twice", () => {
    expect(withCardListed(OWNER, "a" as CardKey, stored, T)).toEqual({ ok: true, record: stored });
  });

  test("a profile with no list starts one", () => {
    const { cards: _none, ...bare } = stored;
    expect(withCardListed(OWNER, "a" as CardKey, bare, T)).toEqual({
      ok: true,
      record: { ...bare, cards: [uri("a")] },
    });
  });

  test("there is no list without a profile, and none past the lexicon's count", () => {
    expect(withCardListed(OWNER, "a" as CardKey, null, T)).toEqual({ ok: false, code: "profile.name_required" });
    const full = { ...stored, cards: Array.from({ length: LIMITS.profile.cardsMax }, (_, i) => uri(`k${i}`)) };
    expect(withCardListed(OWNER, "new" as CardKey, full, T)).toEqual({ ok: false, code: "profile.too_long" });
  });

  test("a removed card leaves the list, every other entry stays", () => {
    const built = withCardUnlisted(OWNER, "a" as CardKey, { ...stored, cards: [uri("a"), other, uri("a")] }, T);
    expect(built).toEqual({ ok: true, record: { ...stored, cards: [other] } });
  });

  test("the last card removed takes the list away", () => {
    const built = withCardUnlisted(OWNER, "a" as CardKey, { ...stored, cards: [uri("a")] }, T);
    expect(built.ok && built.record !== null && "cards" in built.record).toBe(false);
  });

  test("nothing to write when the card is not listed or there is no profile", () => {
    expect(withCardUnlisted(OWNER, "b" as CardKey, stored, T)).toEqual({ ok: true, record: null });
    expect(withCardUnlisted(OWNER, "b" as CardKey, null, T)).toEqual({ ok: true, record: null });
  });
});
