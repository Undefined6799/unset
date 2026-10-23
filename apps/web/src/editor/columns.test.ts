// The column shape the README stores (columns.ts): no empty column, and a list of one column reads as its blocks.
import { expect, test } from "vitest";
import { fixFor } from "./columns.ts";
import type { ReadmeBlock } from "./schema.ts";

const block = (type: string, children: ReadmeBlock[] = [], id = type): ReadmeBlock =>
  ({ id, type, props: {}, content: type === "paragraph" ? [] : undefined, children }) as unknown as ReadmeBlock;

test("columns_fix_leaves_a_list_of_two_full_columns", () => {
  const list = block("columnList", [block("column", [block("paragraph")]), block("column", [block("paragraph")])]);
  expect(fixFor(list)).toBeNull();
  expect(fixFor(block("paragraph"))).toBeNull();
});

test("columns_fix_unwraps_a_list_left_with_one_column", () => {
  const list = block("columnList", [block("column", [block("paragraph")]), block("column", [])]);
  expect(fixFor(list)?.map((fix) => fix.type)).toEqual(["paragraph"]);
});

test("columns_fix_drops_empty_columns_and_wraps_a_stray_block", () => {
  const list = block("columnList", [
    block("column", [block("paragraph")]),
    block("column", []),
    block("paragraph", [], "stray"),
  ]);
  const [fixed] = fixFor(list) ?? [];
  expect(fixed?.type).toBe("columnList");
  expect(fixed?.children?.map((column) => column.type)).toEqual(["column", "column"]);
});

test("columns_fix_unwraps_a_column_outside_a_list", () => {
  expect(fixFor(block("column", [block("paragraph"), block("paragraph", [], "two")]))?.length).toBe(2);
});
