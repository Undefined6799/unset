import { expect, test } from "vitest";
import { acrossGroups, BLOCK_ITEMS, type BlockItem } from "./block-items.ts";

test("block_items_list_crepes_order_less_image", () => {
  expect(BLOCK_ITEMS).toEqual([
    "text",
    "heading1",
    "heading2",
    "heading3",
    "heading4",
    "heading5",
    "heading6",
    "quote",
    "divider",
    "bullets",
    "numbers",
    "tasks",
    "codeBlock",
    "table",
    "math",
  ]);
});

test("arrows_across_groups_go_to_the_next_first_or_the_previous_last_and_stop_at_the_ends", () => {
  const at = (item: BlockItem) => BLOCK_ITEMS.indexOf(item);
  expect(acrossGroups(BLOCK_ITEMS, at("heading3"), 1)).toBe(at("bullets"));
  expect(acrossGroups(BLOCK_ITEMS, at("bullets"), 1)).toBe(at("codeBlock"));
  expect(acrossGroups(BLOCK_ITEMS, at("table"), 1)).toBe(at("table"));
  expect(acrossGroups(BLOCK_ITEMS, at("table"), -1)).toBe(at("tasks"));
  expect(acrossGroups(BLOCK_ITEMS, at("numbers"), -1)).toBe(at("divider"));
  expect(acrossGroups(BLOCK_ITEMS, at("quote"), -1)).toBe(at("quote"));
  // Only the items shown count: a filter that leaves one group keeps the arrows where they are.
  const shown: BlockItem[] = ["heading1", "heading2"];
  expect(acrossGroups(shown, 1, 1)).toBe(1);
  expect(acrossGroups(shown, 1, -1)).toBe(1);
  expect(acrossGroups([], 0, 1)).toBe(0);
});
