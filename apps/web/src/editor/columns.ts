// Columns by drag (Alex 2026-10-23 23:31Z: dragging a block beside another makes two columns, as BlockNote does). A
// block dragged by its handle and dropped on another block goes beside it, on the side of the half it was dropped on
// (Alex 23:56Z: dropping it on top splits, so no aiming at the far edge): two top-level
// blocks become a columnList of two columns, and a block dropped beside one inside a column adds a column next to it,
// up to the README's three (LIMITS.profile.readmeColumnsMax). Anywhere else the drop is ProseMirror's own move.
// normalizeColumns then keeps the shape the README stores: no empty column, a list of one column reads as its blocks,
// and a block that falls into a list but not into a column goes back out of it.
import { NodeSelection } from "prosemirror-state";
import type { ReadmeBlock, ReadmeEditor, ReadmePartialBlock } from "./schema.ts";

/** shared/lexicons LIMITS.profile.readmeColumnsMax, kept here so the editor chunk does not load the lexicons. */
const COLUMNS_MAX = 3;
/** The top and bottom share of a block where a drop stays ProseMirror's move between blocks. */
const BETWEEN = 0.25;

export type ColumnDrop = {
  /** The block being moved. */
  readonly dragged: string;
  readonly target: string;
  readonly side: "left" | "right";
  readonly rect: DOMRect;
};

/** The block the handle is dragging: startBlockDrag selects it as a node. */
export function draggedId(editor: ReadmeEditor): string | null {
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

/** The block under `element` that holds text (not a column list or a column), as its id and content element. */
export function textBlockAt(element: Element | null): { id: string; content: HTMLElement } | null {
  const container = element?.closest('[data-node-type="blockContainer"]');
  const content = container?.querySelector(":scope > [data-content-type]");
  const id = container?.getAttribute("data-id");
  if (!(content instanceof HTMLElement) || typeof id !== "string") return null;
  return CONTAINERS.has(content.dataset.contentType ?? "") ? null : { id, content };
}

/** Where a block drag over `event` would make columns, or null for an ordinary move. */
export function columnDrop(editor: ReadmeEditor, event: DragEvent): ColumnDrop | null {
  const dragged = draggedId(editor);
  if (editor.prosemirrorView.dragging === null || dragged === null) return null;
  return columnDropAt(
    editor,
    dragged,
    event.target instanceof Element ? event.target : null,
    event.clientX,
    event.clientY,
  );
}

/** Where dropping `dragged` at the point (x, y), over `element`, would make columns (a mouse drag or a touch hold). */
export function columnDropAt(
  editor: ReadmeEditor,
  dragged: string,
  element: Element | null,
  x: number,
  y: number,
): ColumnDrop | null {
  const block = textBlockAt(element);
  if (block === null || block.id === dragged) return null;
  const { id } = block;
  const rect = block.content.getBoundingClientRect();
  const band = rect.height * BETWEEN;
  if (y < rect.top + band || y > rect.bottom - band) return null;
  const side = x < rect.left + rect.width / 2 ? "left" : "right";
  const parent = editor.getParentBlock(id);
  if (parent === undefined) return { dragged, target: id, side, rect };
  if (parent.type !== "column") return null;
  const list = editor.getParentBlock(parent.id);
  const others = list?.children.filter((column) => !column.children.every((child) => child.id === dragged)) ?? [];
  return others.length < COLUMNS_MAX ? { dragged, target: id, side, rect } : null;
}

/** Puts the dragged block beside the drop's target, in one undo step; both keep their ids, since each is removed
 * before it is inserted again. */
export function dropIntoColumns(editor: ReadmeEditor, drop: ColumnDrop): void {
  const { dragged } = drop;
  const moving = editor.getBlock(dragged);
  if (moving === undefined) return;
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

/** Moves `dragged` before or after `target`, in one undo step, keeping its id (a touch hold's ordinary move). */
export function moveBlock(editor: ReadmeEditor, dragged: string, target: string, placement: "before" | "after"): void {
  const moving = editor.getBlock(dragged);
  if (moving === undefined || dragged === target) return;
  editor.transact(() => {
    editor.removeBlocks([dragged]);
    if (editor.getBlock(target) !== undefined) editor.insertBlocks([moving], target, placement);
  });
  if (editor.getBlock(dragged) !== undefined) editor.setTextCursorPosition(dragged, "end");
}

/** A block with no text and nothing nested: what Delete, or deleting all its text, leaves in a column. */
function isBlank(block: ReadmeBlock): boolean {
  return block.children.length === 0 && (!Array.isArray(block.content) || block.content.length === 0);
}

/**
 * The fix one top-level block needs to keep the README's column shape, or null when it has the shape. A block that
 * lands straight in a column list (Enter on an empty last line of a column, Backspace at the start of the block below,
 * an ordinary move) leaves it, above the list if it came before the first column and below otherwise, so only the
 * blocks put side by side are columns (Alex 2026-10-23 23:42Z).
 */
export function fixFor(block: ReadmeBlock): ReadmePartialBlock[] | null {
  if (block.type === "column") return block.children.map(copy);
  if (block.type !== "columnList") return null;
  const first = block.children.findIndex((child) => child.type === "column");
  const strays = block.children.filter((child) => child.type !== "column");
  // A column left with only blank blocks goes, so deleting what was beside a block takes it back to one column
  // (Alex 2026-10-23 23:54Z).
  const columns = block.children.filter((child) => child.type === "column" && !child.children.every(isBlank));
  if (strays.length === 0 && columns.length === block.children.length && columns.length >= 2) return null;
  const above = block.children.slice(0, Math.max(first, 0)).filter((child) => child.type !== "column");
  const below = strays.filter((child) => !above.includes(child));
  const list: ReadmePartialBlock[] =
    columns.length >= 2
      ? [
          {
            type: "columnList",
            children: columns.map((column) => ({ type: "column", children: column.children })),
          },
        ]
      : columns.flatMap((column) => column.children);
  // Every block keeps its id (the list is removed before they are inserted), so the caret can stay in its block.
  return [...above, ...list, ...below];
}

/** Removes empty columns and unwraps a list of one column; called after every change. */
export function normalizeColumns(editor: ReadmeEditor): void {
  const fixes = editor.document.flatMap((block) => {
    const fix = fixFor(block);
    return fix === null ? [] : [{ id: block.id, fix }];
  });
  if (fixes.length === 0) return;
  const caret = editor.getTextCursorPosition().block.id;
  editor.transact(() => {
    for (const { id, fix } of fixes) {
      if (fix.length === 0) editor.removeBlocks([id]);
      else editor.replaceBlocks([id], fix);
    }
  });
  if (editor.getBlock(caret) !== undefined) editor.setTextCursorPosition(caret, "start");
}
