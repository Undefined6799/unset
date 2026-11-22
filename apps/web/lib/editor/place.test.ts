import { expect, test } from "vitest";
import { countChars, emptyCount, placeOf, startLine } from "./place.ts";

const counted = (...pieces: string[]) => {
  const count = emptyCount();
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
  expect(counted("\n A  🎧 show ")).toBe(8);
});

test("a_place_counts_the_start_of_another_line_as_a_space", () => {
  // The page draws a list as <li>one</li><li>two</li>, nothing between the words; the editor as two text blocks.
  const count = emptyCount();
  startLine(count);
  countChars("one", count);
  startLine(count);
  expect(count).toEqual({ chars: 3, space: true, pending: 0 });
  countChars("two", count);
  expect(count.chars).toBe("one two".length);
});

test("a_place_in_a_code_block_counts_each_white_space_character", () => {
  // Codex on 921401f: both drawings keep a code block's indentation, so a place inside it is told apart.
  const count = emptyCount();
  countChars("    ", count, true);
  expect(placeOf(count)).toEqual({ chars: 4, space: false });
  countChars("foo\n", count, true);
  // The code's last line ending is not counted, as the editor holds none.
  expect(count.chars).toBe("    foo".length);
});

test("a_place_after_a_line_break_is_the_start_of_another_line", () => {
  // Codex on 921401f: the page draws a hard line break as <br>, nothing between the two lines' words.
  const count = emptyCount();
  countChars("left", count);
  startLine(count);
  expect(placeOf(count)).toEqual({ chars: 4, space: true });
});
