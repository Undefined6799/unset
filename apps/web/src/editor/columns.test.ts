// The column shape the README stores (columns.ts): no empty column, and a list of one column reads as its blocks.
import { expect, test } from "vitest";
import { fixFor } from "./columns.ts";
import type { ReadmeBlock } from "./schema.ts";

const block = (type: string, children: ReadmeBlock[] = [], id = type): ReadmeBlock =>
  ({
    id,
    type,
    props: {},
    content: type === "paragraph" ? [{ type: "text", text: id, styles: {} }] : undefined,
    children,
  }) as unknown as ReadmeBlock;

test("columns_fix_leaves_a_list_of_two_full_columns", () => {
  const list = block("columnList", [block("column", [block("paragraph")]), block("column", [block("paragraph")])]);
  expect(fixFor(list)).toBeNull();
  expect(fixFor(block("paragraph"))).toBeNull();
});

test("columns_fix_unwraps_a_list_left_with_one_column", () => {
  const list = block("columnList", [block("column", [block("paragraph")]), block("column", [])]);
  expect(fixFor(list)?.map((fix) => fix.type)).toEqual(["paragraph"]);
});

test("columns_fix_drops_empty_columns", () => {
  const list = block("columnList", [
    block("column", [block("paragraph")]),
    block("column", []),
    block("column", [block("paragraph", [], "two")]),
  ]);
  const [fixed, ...rest] = fixFor(list) ?? [];
  expect(fixed?.children?.map((column) => column.type)).toEqual(["column", "column"]);
  expect(rest).toEqual([]);
});

test("columns_fix_drops_a_column_left_with_only_a_blank_block", () => {
  // Delete in the block menu, or deleting all its text, leaves one empty paragraph: the list goes back to one column.
  const blank = { ...block("paragraph", [], "blank"), content: [] } as unknown as ReadmeBlock;
  const list = block("columnList", [block("column", [block("paragraph")]), block("column", [blank])]);
  expect(fixFor(list)?.map((fix) => fix.id)).toEqual(["paragraph"]);
});

test("columns_fix_moves_a_block_out_of_the_list_not_into_a_column", () => {
  // Enter on an empty last line of a column, or Backspace at the start of the block below, lifts it into the list.
  const list = block("columnList", [
    block("paragraph", [], "above"),
    block("column", [block("paragraph")]),
    block("column", [block("paragraph", [], "two")]),
    block("heading", [], "below"),
  ]);
  expect(fixFor(list)?.map((fix) => fix.type)).toEqual(["paragraph", "columnList", "heading"]);
});

test("columns_fix_unwraps_a_column_outside_a_list", () => {
  expect(fixFor(block("column", [block("paragraph"), block("paragraph", [], "two")]))?.length).toBe(2);
});
