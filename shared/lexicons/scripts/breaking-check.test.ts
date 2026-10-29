import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { breakingProblems, publishedProblems } from "./breaking-check.ts";
import { readSchemas } from "./build.ts";

type Doc = { id: string; defs: Record<string, Record<string, unknown>> };
const original = (id: string): Doc => {
  const found = readSchemas().find((s) => s.file === `schemas/${id}.json`);
  if (!found) throw new Error(`no schema ${id}`);
  return structuredClone(found.doc) as Doc;
};
const record = (doc: Doc) =>
  doc.defs.main?.record as { required: string[]; properties: Record<string, Record<string, unknown>> };
const set = (doc: Doc) => doc.defs.main as { permissions: Record<string, unknown>[]; title: string };

describe("breaking-check", () => {
  test("published_lock_has_no_breaks", () => {
    expect(publishedProblems({})).toEqual([]);
  });

  test("breaking_check_compares_a_live_snapshot_before_publication", () => {
    // Records already sit in members' repos before P1.35 publishes the schema, so a snapshot in published/ is held
    // even while the lock has no entry for it.
    const root = mkdtempSync(join(tmpdir(), "unset-breaking-"));
    const next = original("sh.unset.profile");
    delete record(next).properties.bio;
    for (const dir of ["schemas", "published"]) mkdirSync(join(root, dir));
    writeFileSync(join(root, "schemas", "sh.unset.profile.json"), JSON.stringify(next));
    writeFileSync(join(root, "published", "sh.unset.profile.json"), JSON.stringify(original("sh.unset.profile")));
    writeFileSync(join(root, "published.lock.json"), "{}");
    try {
      expect(publishedProblems({}, root)).toEqual(["sh.unset.profile#main.bio: field removed"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("live_profile_snapshot_is_held", () => {
    expect(readSchemas().some((s) => s.file === "schemas/sh.unset.profile.json")).toBe(true);
    expect(existsSync(join(import.meta.dirname, "..", "published", "sh.unset.profile.json"))).toBe(true);
  });

  test("breaking_check_detects_removed_field", () => {
    const next = original("sh.unset.profile");
    delete record(next).properties.bio;
    expect(breakingProblems(next, original("sh.unset.profile"), {})).toEqual([
      "sh.unset.profile#main.bio: field removed",
    ]);
  });

  test("breaking_check_detects_new_required", () => {
    const next = original("sh.unset.profile");
    record(next).required.push("headline");
    expect(breakingProblems(next, original("sh.unset.profile"), {})).toEqual([
      "sh.unset.profile#main: headline became required",
    ]);
  });

  test("breaking_check_detects_narrowed_maxlength", () => {
    const next = original("sh.unset.profile");
    Object.assign(record(next).properties.displayName ?? {}, { maxGraphemes: 32 });
    expect(breakingProblems(next, original("sh.unset.profile"), {})).toEqual([
      "sh.unset.profile#main.displayName: maxGraphemes changed from 64 to 32",
    ]);
  });

  test("breaking_check_detects_other_narrowing", () => {
    const next = original("sh.unset.section");
    const props = record(next).properties;
    Object.assign(props.type ?? {}, { type: "integer" });
    Object.assign(props.position ?? {}, { minimum: 1 });
    next.defs.main = { ...next.defs.main, key: "literal:self" };
    expect(breakingProblems(next, original("sh.unset.section"), {})).toEqual([
      "sh.unset.section#main: record key changed from tid to literal:self",
      "sh.unset.section#main.type: type changed from string to integer",
      "sh.unset.section#main.position: minimum changed from 0 to 1",
    ]);
  });

  test("breaking_check_listed_absent_stays_not_listed", () => {
    const next = original("sh.unset.profile");
    Object.assign(record(next).properties.listed ?? {}, { default: true });
    expect(breakingProblems(next, original("sh.unset.profile"), {})).toEqual([
      "sh.unset.profile#main.listed: default changed from undefined to true",
    ]);
  });

  test("breaking_check_allows_new_optional", () => {
    const next = original("sh.unset.profile");
    record(next).properties.pronouns = { type: "string", maxGraphemes: 20, maxLength: 200 };
    expect(breakingProblems(next, original("sh.unset.profile"), {})).toEqual([]);
  });

  test("breaking_check_detects_widened_or_dropped_limit", () => {
    // atproto.com/specs/lexicon, "Lexicon Evolution": size and length limits can not be added, removed or changed,
    // because new data must stay valid under the old schema that other readers still hold.
    const next = original("sh.unset.profile");
    const props = record(next).properties;
    Object.assign(props.bio ?? {}, { maxGraphemes: 800 });
    delete props.displayName?.maxLength;
    expect(breakingProblems(next, original("sh.unset.profile"), {})).toEqual([
      "sh.unset.profile#main.displayName: maxLength changed from 640 to none",
      "sh.unset.profile#main.bio: maxGraphemes changed from 600 to 800",
    ]);
  });

  test("breaking_check_permission_set_add_requires_flag", () => {
    const next = original("sh.unset.authApp");
    set(next).permissions.push({ type: "permission", resource: "repo", collection: ["sh.unset.video"] });
    expect(breakingProblems(next, original("sh.unset.authApp"), {})).toEqual([
      "sh.unset.authApp: adds repo:sh.unset.video, which widens every existing grant; needs --approved-by-alex=<PR>",
    ]);
    expect(breakingProblems(next, original("sh.unset.authApp"), { approvedByAlex: 900 })).toEqual([]);
  });

  test("breaking_check_permission_set_removal_fails", () => {
    const next = original("sh.unset.authApp");
    set(next).permissions.pop();
    const removed =
      "sh.unset.authApp: removes repo:sh.unset.follow?action=create&action=delete; retire the feature first";
    expect(breakingProblems(next, original("sh.unset.authApp"), {})).toEqual([removed]);
    // Alex's flag does not make a removal pass here; it needs its own reviewed step.
    expect(breakingProblems(next, original("sh.unset.authApp"), { approvedByAlex: 900 })).toEqual([removed]);
  });

  test("breaking_check_permission_set_consent_text_requires_flag", () => {
    const next = original("sh.unset.authApp");
    set(next).title = "Something else";
    expect(breakingProblems(next, original("sh.unset.authApp"), {})).toEqual([
      "sh.unset.authApp: changes the consent text users see (title); needs --approved-by-alex=<PR>",
    ]);
    expect(breakingProblems(next, original("sh.unset.authApp"), { approvedByAlex: 900 })).toEqual([]);
  });
});
