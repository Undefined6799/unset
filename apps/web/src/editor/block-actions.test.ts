// @vitest-environment jsdom
import { BlockNoteEditor } from "@blocknote/core";
import { afterEach, expect, test } from "vitest";
import { moveBlock, moveBlockNextTo } from "./block-actions.ts";
import { type ReadmeEditor, readmeSchema } from "./schema.ts";

let editor: ReadmeEditor;
afterEach(() => {
  editor?.unmount();
  document.body.replaceChildren();
});

function setup() {
  editor = BlockNoteEditor.create({
    schema: readmeSchema,
    _tiptapOptions: { injectCSS: false },
    initialContent: [
      { id: "a", type: "paragraph", content: "First" },
      {
        id: "b",
        type: "paragraph",
        content: "Second",
        children: [{ id: "child", type: "paragraph", content: "Nested" }],
      },
      { id: "c", type: "paragraph", content: "Third" },
    ],
  });
  const element = document.createElement("div");
  document.body.append(element);
  editor.mount(element);
}

test("moving_a_block_preserves_its_children_and_is_one_undo_step", () => {
  setup();
  const before = editor.document;
  moveBlock(editor, "b", "up");
  expect(editor.document.map((block) => block.id)).toEqual(["b", "a", "c"]);
  expect(editor.getBlock("b")?.children[0]?.id).toBe("child");
  editor.undo();
  expect(editor.document).toEqual(before);
});

test("move_down_and_boundary_actions_do_not_drop_content", () => {
  setup();
  moveBlock(editor, "a", "up");
  moveBlock(editor, "c", "down");
  expect(editor.document.map((block) => block.id)).toEqual(["a", "b", "c"]);
  moveBlock(editor, "a", "down");
  expect(editor.document.map((block) => block.id)).toEqual(["b", "a", "c"]);
});

test("moving_a_nested_block_stays_with_its_siblings", () => {
  setup();
  editor.insertBlocks([{ id: "child2", type: "paragraph", content: "Next" }], "child", "after");
  moveBlock(editor, "child2", "up");
  expect(editor.getBlock("b")?.children.map((block) => block.id)).toEqual(["child2", "child"]);
  expect(editor.document.map((block) => block.id)).toEqual(["a", "b", "c"]);
});

test("moving_is_separate_from_typing_before_and_after_it", () => {
  setup();
  editor.setTextCursorPosition("b", "end");
  editor.insertInlineContent(" before");
  const typed = editor.document;
  moveBlock(editor, "b", "up");
  const moved = editor.document;
  editor.insertInlineContent("after ");
  editor.undo();
  expect(editor.document).toEqual(moved);
  editor.undo();
  expect(editor.document).toEqual(typed);
  editor.undo();
  expect(editor.getBlock("b")?.content).toEqual([{ type: "text", text: "Second", styles: {} }]);
});

test("dragging_across_siblings_is_one_undo_and_cannot_enter_a_child", () => {
  setup();
  const before = editor.document;
  moveBlockNextTo(editor, "c", "a", "before");
  expect(editor.document.map((block) => block.id)).toEqual(["c", "a", "b"]);
  editor.undo();
  expect(editor.document).toEqual(before);
  moveBlockNextTo(editor, "b", "child", "after");
  expect(editor.document).toEqual(before);
});
