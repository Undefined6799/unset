// @vitest-environment jsdom
// Copy and paste without HTML (ADR 0037 point 5): the owner's own copy keeps its formatting, anything else arrives as
// plain text. The editor runs mounted in jsdom; nothing is doubled (rule TE-1).
import { BlockNoteEditor } from "@blocknote/core";
import { afterEach, expect, test } from "vitest";
import { type Copied, pasteText, selectionText } from "./clipboard.ts";
import { type ReadmeEditor, type ReadmePartialBlock, readmeSchema } from "./schema.ts";

// jsdom has no ClipboardEvent; ProseMirror's pasteText (prosemirror-view 1.42.6 dist/index.js:5875) builds one to
// hand its paste handlers, which read nothing from it here.
globalThis.ClipboardEvent ??= class extends Event {
  readonly clipboardData = null;
};

let mounted: ReadmeEditor | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function editorWith(blocks: ReadmePartialBlock[]): ReadmeEditor {
  const editor = BlockNoteEditor.create({
    schema: readmeSchema,
    initialContent: blocks,
    _tiptapOptions: { injectCSS: false },
  });
  const element = document.createElement("div");
  document.body.append(element);
  editor.mount(element);
  mounted = editor;
  return editor;
}

const TWO_BLOCKS: ReadmePartialBlock[] = [
  { id: "a", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Hello", styles: { bold: true } }] },
  { id: "b", type: "paragraph", content: "World" },
];

function selectAll(editor: ReadmeEditor): void {
  editor.setSelection("a", "b");
}

test("selection_text_separates_blocks_with_a_blank_line", () => {
  const editor = editorWith(TWO_BLOCKS);
  selectAll(editor);
  expect(selectionText(editor)).toBe("Hello\n\nWorld");
});

test("paste_of_own_copy_keeps_formatting", () => {
  const editor = editorWith(TWO_BLOCKS);
  selectAll(editor);
  const copied: Copied = { text: selectionText(editor), slice: editor.prosemirrorView.state.selection.content() };
  editor.setTextCursorPosition("b", "end");
  pasteText(editor, copied.text, copied);
  // ProseMirror opens the copied slice at the cursor: the heading's text joins "World" with its bold kept, and the
  // rest of the slice follows as its own block.
  expect(editor.document.map((block) => [block.type, block.content])).toEqual([
    ["heading", [{ type: "text", text: "Hello", styles: { bold: true } }]],
    [
      "paragraph",
      [
        { type: "text", text: "World", styles: {} },
        { type: "text", text: "Hello", styles: { bold: true } },
      ],
    ],
    ["paragraph", [{ type: "text", text: "World", styles: {} }]],
  ]);
});

test("paste_of_other_text_is_plain", () => {
  const editor = editorWith(TWO_BLOCKS);
  selectAll(editor);
  const copied: Copied = { text: selectionText(editor), slice: editor.prosemirrorView.state.selection.content() };
  editor.setTextCursorPosition("b", "end");
  pasteText(editor, "<b>Hello</b>", copied);
  expect(editor.document.map((block) => block.type)).toEqual(["heading", "paragraph"]);
  expect(editor.document[1]?.content).toEqual([{ type: "text", text: "World<b>Hello</b>", styles: {} }]);
});
