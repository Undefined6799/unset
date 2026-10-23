// Columns by drag (Alex 2026-10-23 23:31Z: dragging a block beside another makes two columns, as BlockNote does). A
// block dragged by its handle and dropped on the left or right edge of another block goes beside it: two top-level
// blocks become a columnList of two columns, and a block dropped beside one inside a column adds a column next to it,
// up to the README's three (LIMITS.profile.readmeColumnsMax). Anywhere else the drop is ProseMirror's own move.
// normalizeColumns then keeps the shape the README stores: no empty column, and a list of one column reads as its
// blocks.
import { NodeSelection } from "prosemirror-state";
import type { ReadmeBlock, ReadmeEditor, ReadmePartialBlock } from "./schema.ts";

/** shared/lexicons LIMITS.profile.readmeColumnsMax, kept here so the editor chunk does not load the lexicons. */
const COLUMNS_MAX = 3;
/** How far in from a block's side a drop counts as beside it. */
const EDGE = 0.2;

export type ColumnDrop = { readonly target: string; readonly side: "left" | "right"; readonly rect: DOMRect };

/** The block the handle is dragging: startBlockDrag selects it as a node. */
function draggedId(editor: ReadmeEditor): string | null {
  const selection = editor.prosemirrorView.state.selection;
  const id: unknown = selection instanceof NodeSelection ? selection.node.attrs.id : null;
  return typeof id === "string" ? id : null;
}

const CONTAINERS: ReadonlySet<string> = new Set(["columnList", "column"]);

/** A copy of the block without ids, so moving it never leaves two blocks with one id. */
function copy(block: ReadmeBlock): ReadmePartialBlock {
  const { id: _id, children, ...rest } = block;
  return { ...rest, children: children.map(copy) } as ReadmePartialBlock;
}

/** Where a block drag over `event` would make columns, or null for an ordinary move. */
export function columnDrop(editor: ReadmeEditor, event: DragEvent): ColumnDrop | null {
  const dragged = draggedId(editor);
  if (editor.prosemirrorView.dragging === null || dragged === null) return null;
  const container = event.target instanceof Element ? event.target.closest('[data-node-type="blockContainer"]') : null;
  const content = container?.querySelector(":scope > [data-content-type]");
  const id = container?.getAttribute("data-id");
  if (!(content instanceof HTMLElement) || typeof id !== "string" || id === dragged) return null;
  if (CONTAINERS.has(content.dataset.contentType ?? "")) return null;
  const rect = content.getBoundingClientRect();
  const edge = rect.width * EDGE;
  const side = event.clientX < rect.left + edge ? "left" : event.clientX > rect.right - edge ? "right" : null;
  if (side === null) return null;
  const parent = editor.getParentBlock(id);
  if (parent === undefined) return { target: id, side, rect };
  if (parent.type !== "column") return null;
  const list = editor.getParentBlock(parent.id);
  const others = list?.children.filter((column) => !column.children.every((block) => block.id === dragged)) ?? [];
  return others.length < COLUMNS_MAX ? { target: id, side, rect } : null;
}

/** Puts the dragged block beside the drop's target, in one undo step; both keep their ids, since each is removed
 * before it is inserted again. */
export function dropIntoColumns(editor: ReadmeEditor, drop: ColumnDrop): void {
  const dragged = draggedId(editor);
  const moving = dragged === null ? undefined : editor.getBlock(dragged);
  if (dragged === null || moving === undefined) return;
  editor.transact(() => {
    editor.removeBlocks([dragged]);
    const parent = editor.getParentBlock(drop.target);
    const placement = drop.side === "left" ? "before" : "after";
    if (parent?.type === "column") {
      editor.insertBlocks([{ type: "column", children: [moving] }], parent.id, placement);
      return;
    }
    const target = editor.getBlock(drop.target);
    if (target === undefined) return;
    const pair = drop.side === "left" ? [moving, target] : [target, moving];
    editor.replaceBlocks(
      [drop.target],
      [{ type: "columnList", children: pair.map((block) => ({ type: "column", children: [block] })) }],
    );
  });
  // The caret goes into the moved block, so no container is left selected.
  editor.setTextCursorPosition(dragged, "end");
  editor.focus();
}

/** The fix one top-level block needs to keep the README's column shape, or null when it has the shape. */
export function fixFor(block: ReadmeBlock): ReadmePartialBlock[] | null {
  if (block.type === "column") return block.children.map(copy);
  if (block.type !== "columnList") return null;
  // A block dropped straight into the list by an ordinary move becomes a column of its own.
  const columns = block.children
    .map((child) => (child.type === "column" ? child.children : [child]))
    .filter((blocks) => blocks.length > 0);
  if (columns.length < 2) return columns.flat().map(copy);
  const same = columns.length === block.children.length && block.children.every((child) => child.type === "column");
  if (same) return null;
  return [{ type: "columnList", children: columns.map((blocks) => ({ type: "column", children: blocks.map(copy) })) }];
}

/** Removes empty columns and unwraps a list of one column; called after every change. */
export function normalizeColumns(editor: ReadmeEditor): void {
  const fixes = editor.document.flatMap((block) => {
    const fix = fixFor(block);
    return fix === null ? [] : [{ id: block.id, fix }];
  });
  if (fixes.length === 0) return;
  editor.transact(() => {
    for (const { id, fix } of fixes) {
      if (fix.length === 0) editor.removeBlocks([id]);
      else editor.replaceBlocks([id], fix);
    }
  });
}
