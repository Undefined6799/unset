// Review-found gaps in safeReturnPath (P1.09): each case was accepted, or stayed green with its check removed.
import { describe, expect, test } from "vitest";
import { safeReturnPath } from "./index.ts";

describe("safeReturnPath review cases", () => {
  test("output_length_is_bounded", () => {
    expect(safeReturnPath(`/${"a".repeat(511)}`)).toBe(`/${"a".repeat(511)}`);
    expect(safeReturnPath(`/${"a".repeat(512)}`)).toBeNull();
    // 511 characters in, 516 out once the last one is percent-encoded: refused, so a result always re-validates.
    expect(safeReturnPath(`/${"a".repeat(509)}é`)).toBeNull();
    expect(safeReturnPath(`/${"é".repeat(300)}`)).toBeNull();
  });

  test.each([
    "/LOGIN",
    "/OAuth/callback",
    "/%6cogin",
    "/%6C%6F%67%69%6E",
    "/login%2fx",
    "/login%3Fnext",
    "/login.",
    "/login;x",
  ])("rejects_loop_target_spellings %s", (path) => {
    expect(safeReturnPath(path)).toBeNull();
  });

  test("loop_targets_need_a_boundary", () => {
    expect(safeReturnPath("/loginhelp")).toBe("/loginhelp");
    expect(safeReturnPath("/login/../x")).toBe("/x");
  });

  test("allow_prefixes_match_segments", () => {
    const settings = { allowPrefixes: ["/settings"] };
    expect(safeReturnPath("/settingsevil", settings)).toBeNull();
    expect(safeReturnPath("/settings-admin", settings)).toBeNull();
    expect(safeReturnPath("/settings", settings)).toBe("/settings");
    expect(safeReturnPath("/settings?tab=1", settings)).toBe("/settings?tab=1");
    expect(safeReturnPath("/@alice", { allowPrefixes: ["/@"] })).toBe("/@alice");
  });

  test("allow_prefixes_must_be_paths", () => {
    for (const prefix of ["", "settings", "//x"]) {
      expect(() => safeReturnPath("/me", { allowPrefixes: [prefix] }), prefix).toThrow();
    }
  });

  test.each([
    ["backslash inside", "/a\\b"],
    ["backslash after space", "/ \\"],
    ["tab inside", "/a\tb"],
    ["lone CR", "/\r"],
    ["lone high surrogate", "/\uD800"],
    ["lone low surrogate", "/a\uDC00b"],
  ])("rejects_what_only_one_check_catches %s", (_kind, path) => {
    expect(safeReturnPath(path)).toBeNull();
  });
});
