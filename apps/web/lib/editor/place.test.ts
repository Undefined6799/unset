import { expect, test } from "vitest";
import { countChars, countedChars } from "./place.ts";

const counted = (...pieces: string[]) => {
  const count = { chars: 0, space: false };
  for (const piece of pieces) countChars(piece, count);
  return count.chars;
};

test("a_place_counts_white_space_runs_as_one_and_none_before_the_first_word", () => {
  // The page's heading holds the markup's line breaks around its words; the editor's does not.
  expect(counted("\n  A weekly")).toBe(counted("A weekly"));
  expect(counted("A  weekly\n show")).toBe("A weekly show".length);
  // Across the pieces a block's words come in (marks, links), the same.
  expect(counted("A ", "weekly")).toBe("A weekly".length);
  // A space with no word after it yet is not counted.
  expect(counted("A weekly ")).toBe("A weekly".length);
});

test("a_place_counts_an_emoji_as_one_character", () => {
  // Two UTF-16 units, one character on the page: the editor must count it the same (caretAtPlace walks by code point).
  expect("🎧".length).toBe(2);
  expect(counted("A 🎧 show")).toBe(8);
  expect(countedChars("\n A  🎧 show ")).toBe(8);
});
