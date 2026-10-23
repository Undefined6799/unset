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
};

describe("parseProfileFields", () => {
  test("accepts every field and trims the one-line ones", () => {
    const parsed = parseProfileFields({ ...good, displayName: "  Alice Moreau  " });
    expect(parsed).toEqual({ ok: true, fields: good });
  });

  test("missing fields read as empty", () => {
    expect(parseProfileFields({})).toEqual({ ok: true, fields: EMPTY_PROFILE });
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

  test.each(["javascript:alert(1)", "ftp://x.example", "//x.example", "x.example", "https://user:pw@x.example"])(
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
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: NOW,
      },
    });
    expect(built.ok && validateRecord("sh.unset.profile", built.record, "write").ok).toBe(true);
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
    expect(readProfileRecord({ $type: "sh.unset.profile", createdAt: "2026-10-23T03:00:00.000Z", ...good })).toEqual(
      good,
    );
  });

  test("a field another client wrote badly is dropped, the rest still shows", () => {
    const stored = {
      ...good,
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
