// What text a member may write on their page (staging break test 2026-11-21: a NUL in the location was saved, and the
// index then refused the whole record, so the public page went missing while the owner's page still showed).
import { describe, expect, test } from "vitest";
import { isPlainName, isPlainText } from "./member-text.ts";

describe("isPlainText", () => {
  test("ordinary text in any script, emoji sequences included, is plain", () => {
    for (const text of ["Toronto, Ontario", "Zoë Ñúñez", "東京", "تورنتو", "👩‍👩‍👧 family", "می‌خواهم", ""]) {
      expect(isPlainText(text, false)).toBe(true);
    }
  });

  test("a NUL or any other control character is refused", () => {
    for (const text of ["a\u0000b", "a\u0007b", "a\tb", "a\u001bb", "a\u007fb", "a\u0085b", "a\u009fb"]) {
      expect(isPlainText(text, false)).toBe(false);
    }
  });

  test("a lone surrogate is refused, as no store keeps it as written", () => {
    expect(isPlainText("a\ud800b", false)).toBe(false);
    expect(isPlainText("a\udc00", true)).toBe(false);
  });

  test("multi-line text keeps line breaks and tabs and refuses every other control", () => {
    expect(isPlainText("one\ntwo\n\tindented", true)).toBe(true);
    expect(isPlainText("one\ntwo", false)).toBe(false);
    expect(isPlainText("one\u0000two", true)).toBe(false);
    expect(isPlainText("one\rtwo", true)).toBe(false);
  });
});

describe("isPlainName", () => {
  test("a name in any script, with joiners inside words and emoji, is plain", () => {
    for (const name of ["Alice Moreau", "محمد", "می‌خواهم", "👩‍💻 Ada", "Zoë"]) expect(isPlainName(name)).toBe(true);
  });

  test("a name with bidirectional controls is refused, so it cannot show reversed or out of order", () => {
    for (const mark of ["‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩"]) {
      expect(isPlainName(`Ali${mark}ce`)).toBe(false);
    }
  });

  test("a name with invisible characters is refused, so two names that look the same are not", () => {
    for (const mark of ["​", "⁠", "﻿", "­", "᠎", "ᅟ", "ᅠ", "ㅤ", "ﾠ"]) {
      expect(isPlainName(`Ali${mark}ce`)).toBe(false);
    }
  });

  test("a name with a control character is refused, as any text is", () => {
    expect(isPlainName("a\u0000b")).toBe(false);
  });
});
