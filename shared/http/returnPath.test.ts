import { describe, expect, test } from "vitest";
import { DENIED_TARGETS, safeReturnPath } from "./index.ts";

const ch = (code: number): string => String.fromCodePoint(code);

describe("safeReturnPath", () => {
  test.each(["/me", "/settings?tab=privacy", "/@alice/p/3k2a", "/me#x", "/logins", "/oauthy"])(
    "accepts_app_paths %s",
    (path) => {
      expect(safeReturnPath(path)).toBe(path);
    },
  );

  test("normalises_equivalent_paths", () => {
    expect(safeReturnPath("/./evil")).toBe("/evil");
    expect(safeReturnPath("/@élodie")).toBe("/@%C3%A9lodie");
    expect(safeReturnPath("/%2F%2Fevil.example")).toBe("/%2F%2Fevil.example");
  });

  test.each([
    "https://evil.example/",
    "//evil.example",
    "/\\evil",
    "\\\\evil",
    "chat",
    "javascript:alert(1)",
    "/chat/../https://x",
    "/..//evil",
    "",
    `/${"a".repeat(512)}`,
  ])("rejects_offsite %s", (input) => {
    expect(safeReturnPath(input)).toBeNull();
  });

  test.each([
    ["tab", ch(0x09)],
    ["CR", ch(0x0d)],
    ["LF", ch(0x0a)],
    ["NUL", ch(0x00)],
    ["DEL", ch(0x7f)],
    ["C1", ch(0x85)],
    ["line separator", ch(0x2028)],
    ["paragraph separator", ch(0x2029)],
    ["byte order mark", ch(0xfeff)],
  ])("rejects_control_chars %s", (_name, control) => {
    expect(safeReturnPath(`/${control}/evil.com`)).toBeNull();
  });

  test("rejects_double_slash_anywhere", () => {
    expect(safeReturnPath("/a//b")).toBeNull();
  });

  test("rejects_loop_targets", () => {
    expect(DENIED_TARGETS).toEqual(["/login", "/logout", "/oauth"]);
    for (const path of ["/login", "/logout?x", "/oauth/callback", "/login#top", "/./login"]) {
      expect(safeReturnPath(path), path).toBeNull();
    }
  });

  test("allow_prefixes", () => {
    const opts = { allowPrefixes: ["/settings"] };
    expect(safeReturnPath("/me", opts)).toBeNull();
    expect(safeReturnPath("/settings/export", opts)).toBe("/settings/export");
  });

  test("non_string", () => {
    for (const input of [undefined, null, 42, ["/me"], { toString: () => "/me" }]) {
      expect(safeReturnPath(input)).toBeNull();
    }
  });
});
