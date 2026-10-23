// The profile's fields (Alex, 2026-10-23: profile is its own module). parseProfileFields reads untrusted form or JSON
// input once into checked fields; toProfileRecord builds the sh.unset.profile record we write to the member's PDS.
import { LIMITS, validateRecord } from "@unset/shared-lexicons";
import { describe, expect, test } from "vitest";
import { EMPTY_PROFILE, parseProfileFields, readProfileRecord, toProfileRecord } from "./profile.ts";

const good = {
  displayName: "Alice Moreau",
  headline: "Designer and front-end developer.",
  location: "Toronto, Ontario",
  website: "https://alice.dev",
  readme: "## About me\nhi\n:::\n## My projects\n- [Tidy](https://github.com/alicem/tidy)",
  links: "https://github.com/alicem\nhttps://bsky.app/profile/alice.bsky.social",
};
/** `good` as the record stores it: links are the lexicon's objects. */
const goodStored = {
  ...good,
  links: [{ uri: "https://github.com/alicem" }, { uri: "https://bsky.app/profile/alice.bsky.social" }],
};

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
    ["displayName", LIMITS.profile.displayName],
    ["headline", LIMITS.profile.headline],
    ["location", LIMITS.profile.location],
    ["readme", LIMITS.profile.readme],
  ] as const)("%s counts graphemes up to its limit", (field, limit) => {
    const family = "👩‍👩‍👧";
    expect(parseProfileFields({ [field]: family.repeat(limit) }).ok).toBe(true);
    expect(parseProfileFields({ [field]: family.repeat(limit + 1) })).toEqual({
      ok: false,
      field,
      code: "profile.too_long",
    });
  });

  test("one-line fields refuse line breaks", () => {
    expect(parseProfileFields({ headline: "a\nb" })).toEqual({ ok: false, field: "headline", code: "profile.invalid" });
  });

  test.each(["javascript:alert(1)", "ftp://x.example", "mailto:a@x.example", "https://user:pw@x.example"])(
    "website must be a plain http or https URL: %s",
    (website) => {
      expect(parseProfileFields({ website })).toEqual({ ok: false, field: "website", code: "profile.url_invalid" });
    },
  );
});

describe("toProfileRecord", () => {
  const NOW = "2026-10-23T04:00:00.000Z";

  test("a first profile writes only filled fields and passes the strict validator", () => {
    const built = toProfileRecord({ ...EMPTY_PROFILE, displayName: "Alice", readme: "hi" }, null, NOW);
    expect(built).toEqual({
      ok: true,
      record: { $type: "sh.unset.profile", displayName: "Alice", readme: "hi", createdAt: NOW, updatedAt: NOW },
    });
    expect(built.ok && validateRecord("sh.unset.profile", built.record, "write").ok).toBe(true);
  });

  test("an update keeps createdAt and the fields this page does not edit, and clears emptied ones", () => {
    const existing = {
      $type: "sh.unset.profile",
      displayName: "Old",
      headline: "Old line",
      bio: "Kept as it was.",
      listed: true,
      createdAt: "2026-10-01T00:00:00.000Z",
    };
    const built = toProfileRecord({ ...good, headline: "" }, existing, NOW);
    expect(built).toEqual({
      ok: true,
      record: {
        $type: "sh.unset.profile",
        bio: "Kept as it was.",
        listed: true,
        displayName: good.displayName,
        location: good.location,
        website: good.website,
        readme: good.readme,
        links: goodStored.links,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: NOW,
      },
    });
    expect(built.ok && validateRecord("sh.unset.profile", built.record, "write").ok).toBe(true);
  });

  test("a partial edit (Settings › Profile, or the README alone) keeps every field it does not send", () => {
    const existing = { $type: "sh.unset.profile", ...goodStored, createdAt: "2026-10-01T00:00:00.000Z" };
    const built = toProfileRecord({ readme: "new" }, existing, NOW);
    expect(built).toEqual({
      ok: true,
      record: { ...existing, readme: "new", updatedAt: NOW },
    });
    const cleared = toProfileRecord({ headline: "" }, existing, NOW);
    expect(cleared.ok && "headline" in cleared.record).toBe(false);
  });

  test("a partial edit cannot leave a profile without a display name", () => {
    expect(toProfileRecord({ readme: "hi" }, null, NOW)).toEqual({ ok: false, code: "profile.name_required" });
  });

  test("a profile without a display name cannot be published", () => {
    expect(toProfileRecord(EMPTY_PROFILE, null, NOW)).toEqual({ ok: false, code: "profile.name_required" });
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

  test("anything that is not an object reads as an empty profile", () => {
    for (const value of [null, "profile", 3, ["a"]]) expect(readProfileRecord(value)).toEqual(EMPTY_PROFILE);
  });
});

describe("links (Alex 2026-10-23 04:06Z: members add their own links)", () => {
  test("reads one URL a line, trimmed, blank lines dropped", () => {
    const parsed = parseProfileFields({ links: " https://a.example \r\n\n https://b.example/x \n" });
    expect(parsed).toEqual({ ok: true, fields: { links: "https://a.example\nhttps://b.example/x" } });
  });

  test("a web address typed without a scheme gains https://, for the website and each link", () => {
    expect(parseProfileFields({ website: "alice.dev", links: "github.com/alicem" })).toEqual({
      ok: true,
      fields: { website: "https://alice.dev", links: "https://github.com/alicem" },
    });
  });

  test("refuses a link that is not a plain http(s) URL", () => {
    for (const bad of ["javascript:alert(1)", "ftp://a.example", "https://u:p@a.example", "not a url"]) {
      expect(parseProfileFields({ links: `https://a.example\n${bad}` })).toEqual({
        ok: false,
        field: "links",
        code: "profile.url_invalid",
      });
    }
  });

  test("refuses more links than the lexicon allows, and a link past its byte bound", () => {
    const many = Array.from({ length: LIMITS.profile.linksMax + 1 }, (_, i) => `https://a.example/${i}`).join("\n");
    expect(parseProfileFields({ links: many })).toMatchObject({ ok: false, field: "links", code: "profile.too_long" });
    const long = `https://a.example/${"p".repeat(LIMITS.profile.linkUriBytes)}`;
    expect(parseProfileFields({ links: long })).toMatchObject({ ok: false, field: "links", code: "profile.too_long" });
  });

  test("are written as the lexicon's link objects and read back", () => {
    const built = toProfileRecord(
      { ...EMPTY_PROFILE, displayName: "Alice", links: good.links },
      null,
      "2026-10-23T04:10:00.000Z",
    );
    if (!built.ok) throw new Error(built.code);
    expect(built.record.links).toEqual([
      { uri: "https://github.com/alicem" },
      { uri: "https://bsky.app/profile/alice.bsky.social" },
    ]);
    expect(validateRecord("sh.unset.profile", built.record, "write").ok).toBe(true);
    expect(readProfileRecord(built.record).links).toBe(good.links);
  });

  test("a stored list another client broke reads as no links", () => {
    expect(readProfileRecord({ displayName: "A", links: [{ uri: "javascript:x" }] }).links).toBe("");
    expect(readProfileRecord({ displayName: "A", links: "https://a.example" }).links).toBe("");
  });
});
