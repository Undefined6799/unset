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
