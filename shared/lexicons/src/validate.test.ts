import { describe, expect, test } from "vitest";
import profileSchema from "../schemas/sh.unset.profile.json" with { type: "json" };
import { validateRecord } from "./validate.ts";

const CREATED = "2026-10-12T00:00:00.000Z";
const DID = `did:plc:${"a".repeat(24)}`;
const profile = { $type: "sh.unset.profile", displayName: "Ada", createdAt: CREATED };
const S = "sh.unset.card";
const B = "sh.unset.block";
const ORIGIN = "https://a.example.com/";
const card = (block: string, content: Record<string, unknown>) => ({
  $type: S,
  content: { $type: `${B}.${block}`, ...content },
  createdAt: CREATED,
});
const links = (items: unknown[], extra: Record<string, unknown> = {}) => card("links", { items, ...extra });

describe("validateRecord", () => {
  test("validate_write_rejects_unknown_field", () => {
    const top = validateRecord("sh.unset.profile", { ...profile, published: true }, "write");
    expect(top).toEqual({ ok: false, errors: ["$.published: unknown field"] });
    // Unknown fields are found inside nested objects and array items too.
    const nested = validateRecord(S, links([{ uri: ORIGIN, x: 1 }]), "write");
    expect(nested).toEqual({ ok: false, errors: ["$.content.items[0].x: unknown field"] });
    // A field named after an Object.prototype member is unknown like any other.
    for (const key of ["constructor", "toString", "__proto__"]) {
      const inherited = validateRecord(
        "sh.unset.profile",
        JSON.parse(`{"$type":"sh.unset.profile","displayName":"Ada","createdAt":"${CREATED}","${key}":"x"}`),
        "write",
      );
      expect(inherited, key).toEqual({ ok: false, errors: [`$.${key}: unknown field`] });
    }
  });

  test("validate_write_rejects_unknown_field_in_union_member", () => {
    // A card's block and its buttons sit in unions; the member named by `$type` is checked like any nested object.
    const content = validateRecord(S, card("text", { text: "hi", unexpected: true }), "write");
    expect(content).toEqual({ ok: false, errors: ["$.content.unexpected: unknown field"] });
    const button = { $type: `${B}.buttons#email`, address: "a@a.example.com", x: 1 };
    const inButton = validateRecord(S, card("buttons", { heading: "Hi", buttons: [button] }), "write");
    expect(inButton).toEqual({ ok: false, errors: ["$.content.buttons[0].x: unknown field"] });
    const clean = card("text", { text: "hi" });
    expect(validateRecord(S, clean, "write")).toEqual({ ok: true, value: clean });
    expect(validateRecord(S, card("text", { text: "hi", x: 1 }), "read").ok).toBe(true);
  });

  test("validate_write_accepts_nested_type_discriminator", () => {
    // An object behind a ref may name its def (atproto.com/specs/lexicon, "$type"); the generated validator accepts it.
    const typed = links([{ $type: `${B}.links#link`, uri: ORIGIN }]);
    expect(validateRecord(S, typed, "write")).toEqual({ ok: true, value: typed });
    const wrong = links([{ $type: `${B}.links#other`, uri: ORIGIN }]);
    expect(validateRecord(S, wrong, "write").ok).toBe(false);
  });

  test("validate_read_accepts_unknown_field", () => {
    // Forward compatibility: a newer writer may add optional fields we do not know yet.
    const value = { ...profile, published: true };
    expect(validateRecord("sh.unset.profile", value, "read")).toEqual({ ok: true, value });
  });

  test("listed_absent_is_not_listed", () => {
    // Fails closed (architecture ruling on P1.31): neither the schema nor validation supplies a default, so a profile
    // that never chose stays out of the directory.
    expect(profileSchema.defs.main.record.properties.listed).not.toHaveProperty("default");
    const result = validateRecord("sh.unset.profile", profile, "write");
    expect(result).toEqual({ ok: true, value: profile });
    expect(result.ok && "listed" in result.value).toBe(false);
  });

  test("valid_records_pass", () => {
    const blob = {
      $type: "blob",
      ref: { $link: "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku" },
      mimeType: "image/webp",
      size: 1000,
    };
    const full = {
      ...profile,
      avatar: blob,
      avatarShape: "rounded-square",
      listed: true,
    };
    expect(validateRecord("sh.unset.profile", full, "write")).toEqual({ ok: true, value: full });
    const page = {
      $type: "sh.unset.page",
      cards: [{ uri: `at://${DID}/sh.unset.card/3jzfcijpj2z2a` }],
      createdAt: CREATED,
    };
    expect(validateRecord("sh.unset.page", page, "write")).toEqual({ ok: true, value: page });
    for (const value of [
      { ...card("text", { text: "# Hi" }), width: "half" },
      links([{ uri: ORIGIN, label: "Site", description: "Mine" }], { title: "Elsewhere", layout: "grid" }),
      card("showcase", { items: [{ title: "x", tag: "Radio", description: "d", uri: ORIGIN }] }),
      card("buttons", {
        heading: "Hi",
        buttons: [
          { $type: `${B}.buttons#email`, address: "a@a.example.com" },
          { $type: `${B}.buttons#link`, preset: "book-call", uri: ORIGIN },
        ],
      }),
    ]) {
      expect(validateRecord(S, value, "write"), JSON.stringify(value.content)).toEqual({ ok: true, value });
    }
    const bsky = { $type: "app.bsky.actor.profile", displayName: "Ada", createdAt: CREATED };
    expect(validateRecord("app.bsky.actor.profile", bsky, "write").ok).toBe(true);
  });

  test("type_mismatch_fails", () => {
    expect(validateRecord(S, profile, "read")).toEqual({
      ok: false,
      errors: ['$.$type: expected "sh.unset.card"'],
    });
    expect(validateRecord("sh.unset.profile", "not an object", "read").ok).toBe(false);
    expect(validateRecord("sh.unset.profile", null, "read").ok).toBe(false);
  });

  test("invalid_values_fail_with_paths", () => {
    const result = validateRecord("sh.unset.profile", { ...profile, createdAt: "yesterday" }, "read");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join(" ")).toContain("$.createdAt");
  });
});
