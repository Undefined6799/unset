// Copy, paste and block dragging without HTML (ADR 0037 point 5). Our pages enforce Trusted Types with no policy, so
// no string may become markup. BlockNote 0.56.0 writes and reads HTML for all three: its copy extension assigns
// innerHTML (src/api/clipboard/toClipboard/copyExtension.ts), HTML paste goes through ProseMirror's clipboard parser
// (prosemirror-view src/clipboard.ts readHTML), and a side-menu drag sets and parses `blocknote/html`
// (src/extensions/SideMenu/dragging.ts, blockDropHandling.ts). Each of those throws under Trusted Types, so here:
// - copy and cut put plain text on the clipboard and remember the copied slice in memory;
// - paste inserts that slice when the clipboard still holds its text, and plain text otherwise;
// - a block drag hands ProseMirror the block's slice as `view.dragging`, which its own drop handler moves
//   (prosemirror-view 1.42 src/input.ts handleDrop reads `view.dragging.slice` before any clipboard data).
import type { Slice } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type { ReadmeEditor } from "./schema.ts";

/** What the owner last copied in this tab: its text as the clipboard holds it, and the content itself. */
export type Copied = { readonly text: string; readonly slice: Slice };

/** The plain text of a selection: blocks separated by a blank line, hard breaks by a newline. */
export function selectionText(editor: ReadmeEditor): string {
  const { state } = editor.prosemirrorView;
  return state.doc.textBetween(state.selection.from, state.selection.to, "\n\n", "\n");
}

/** Handles a copy or cut event in place of BlockNote's; returns what was copied. */
export function copySelection(editor: ReadmeEditor, event: ClipboardEvent): Copied {
  const view = editor.prosemirrorView;
  const copied = { text: selectionText(editor), slice: view.state.selection.content() };
  event.clipboardData?.setData("text/plain", copied.text);
  event.preventDefault();
  event.stopPropagation();
  if (event.type === "cut") view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
  return copied;
}

/** Pastes `text`: the remembered slice when it is what was copied here, plain text otherwise. */
export function pasteText(editor: ReadmeEditor, text: string, copied: Copied | null): void {
  const view = editor.prosemirrorView;
  if (copied !== null && copied.text === text) view.dispatch(view.state.tr.replaceSelection(copied.slice));
  else editor.pasteText(text);
}

/** The document position before the block with `id`, or -1. */
function blockPosition(editor: ReadmeEditor, id: string): number {
  let found = -1;
  editor.prosemirrorView.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === "blockContainer" && node.attrs.id === id) found = pos;
    return found < 0;
  });
  return found;
}

/** Starts dragging one block from the handle: ProseMirror moves its slice on drop, with no HTML on the way. */
export function startBlockDrag(editor: ReadmeEditor, event: DragEvent, blockId: string): void {
  const view = editor.prosemirrorView;
  const pos = blockPosition(editor, blockId);
  if (pos < 0 || event.dataTransfer === null) return;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
  event.dataTransfer.clearData();
  event.dataTransfer.setData("text/plain", selectionText(editor));
  event.dataTransfer.effectAllowed = "move";
  const block = view.nodeDOM(pos);
  if (block instanceof HTMLElement) event.dataTransfer.setDragImage(block, 0, 0);
  view.dragging = { slice: view.state.selection.content(), move: true };
}

/** Ends a block drag, whether or not it dropped. */
export function endBlockDrag(editor: ReadmeEditor): void {
  editor.prosemirrorView.dragging = null;
}
