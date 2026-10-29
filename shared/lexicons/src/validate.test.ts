import { describe, expect, test } from "vitest";
import profileSchema from "../schemas/sh.unset.profile.json" with { type: "json" };
import { validateRecord } from "./validate.ts";

const CREATED = "2026-10-12T00:00:00.000Z";
const DID = `did:plc:${"a".repeat(24)}`;
const profile = { $type: "sh.unset.profile", displayName: "Ada", createdAt: CREATED };
const follow = { $type: "sh.unset.follow", subject: DID, createdAt: CREATED };

describe("validateRecord", () => {
  test("validate_write_rejects_unknown_field", () => {
    const top = validateRecord("sh.unset.profile", { ...profile, published: true }, "write");
    expect(top).toEqual({ ok: false, errors: ["$.published: unknown field"] });
    // Unknown fields are found inside nested objects and array items too.
    const nested = validateRecord(
      "sh.unset.profile",
      { ...profile, stats: [{ label: "a", value: "1", x: 1 }] },
      "write",
    );
    expect(nested).toEqual({ ok: false, errors: ["$.stats[0].x: unknown field"] });
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
    // README blocks and text runs sit in unions; the member named by `$type` is checked like any nested object.
    const P = "sh.unset.profile";
    const run = { $type: `${P}#textRun`, text: "hi" };
    const readme = (blocks: unknown[]) => ({ ...profile, readme: { blocks } });
    const block = validateRecord(P, readme([{ $type: `${P}#paragraph`, content: [], unexpected: true }]), "write");
    expect(block).toEqual({ ok: false, errors: ["$.readme.blocks[0].unexpected: unknown field"] });
    const inRun = validateRecord(P, readme([{ $type: `${P}#paragraph`, content: [{ ...run, x: 1 }] }]), "write");
    expect(inRun).toEqual({ ok: false, errors: ["$.readme.blocks[0].content[0].x: unknown field"] });
    const column = { $type: `${P}#column`, blocks: [{ $type: `${P}#quote`, content: [run], x: 1 }] };
    const columns = { $type: `${P}#columns`, columns: [column, { $type: `${P}#column`, blocks: [] }] };
    expect(validateRecord(P, readme([columns]), "write")).toEqual({
      ok: false,
      errors: ["$.readme.blocks[0].columns[0].blocks[0].x: unknown field"],
    });
    const clean = readme([{ $type: `${P}#paragraph`, content: [run] }]);
    expect(validateRecord(P, clean, "write")).toEqual({ ok: true, value: clean });
    expect(validateRecord(P, readme([{ $type: `${P}#paragraph`, content: [], x: 1 }]), "read").ok).toBe(true);
  });

  test("validate_write_accepts_nested_type_discriminator", () => {
    // An object behind a ref may name its def (atproto.com/specs/lexicon, "$type"); the generated validator accepts it.
    const typed = { ...profile, stats: [{ $type: "sh.unset.profile#stat", label: "a", value: "1" }] };
    expect(validateRecord("sh.unset.profile", typed, "write")).toEqual({ ok: true, value: typed });
    const wrong = { ...profile, stats: [{ $type: "sh.unset.profile#other", label: "a", value: "1" }] };
    expect(validateRecord("sh.unset.profile", wrong, "write").ok).toBe(false);
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
    const full = { ...profile, avatar: blob, listed: true, stats: [{ label: "a", value: "1" }], cta: { label: "Hi" } };
    expect(validateRecord("sh.unset.profile", full, "write")).toEqual({ ok: true, value: full });
    const section = { $type: "sh.unset.section", type: "links", title: "Links", position: 0, createdAt: CREATED };
    expect(validateRecord("sh.unset.section", { ...section, items: [{ title: "x" }] }, "write").ok).toBe(true);
    const bsky = { $type: "app.bsky.actor.profile", displayName: "Ada", createdAt: CREATED };
    expect(validateRecord("app.bsky.actor.profile", bsky, "write").ok).toBe(true);
  });

  test("follow_record_shape", () => {
    expect(validateRecord("sh.unset.follow", follow, "write").ok).toBe(true);
    const { subject: _, ...missing } = follow;
    expect(validateRecord("sh.unset.follow", missing, "write").ok).toBe(false);
    expect(validateRecord("sh.unset.follow", { ...follow, subject: "alice.example" }, "write").ok).toBe(false);
  });

  test("type_mismatch_fails", () => {
    expect(validateRecord("sh.unset.section", profile, "read")).toEqual({
      ok: false,
      errors: ['$.$type: expected "sh.unset.section"'],
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
