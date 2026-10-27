import { closeHistory } from "prosemirror-history";
import type { ReadmeEditor } from "./schema.ts";

/** BlockNote 0.56.0's sibling API and transact keep nested content and make a move one undo step. */
export function moveBlock(editor: ReadmeEditor, id: string, direction: "up" | "down"): void {
  const neighbour = direction === "up" ? editor.getPrevBlock(id) : editor.getNextBlock(id);
  if (neighbour) moveBlockNextTo(editor, id, neighbour.id, direction === "up" ? "before" : "after");
}

export function moveBlockNextTo(
  editor: ReadmeEditor,
  id: string,
  targetId: string,
  placement: "before" | "after",
): void {
  const block = editor.getBlock(id);
  if (!block || id === targetId || !editor.getBlock(targetId)) return;
  if (editor.getParentBlock(id)?.id !== editor.getParentBlock(targetId)?.id) return;
  if ((placement === "before" ? editor.getNextBlock(id)?.id : editor.getPrevBlock(id)?.id) === targetId) return;
  // prosemirror-history 1.5.1 src/history.ts:367: a transaction boundary prevents typing from joining this move.
  editor.transact((transaction) => {
    closeHistory(transaction);
    editor.removeBlocks([id]);
    editor.insertBlocks([block], targetId, placement);
  });
  editor.setTextCursorPosition(id);
  editor.prosemirrorView.dispatch(closeHistory(editor.prosemirrorView.state.tr));
}
