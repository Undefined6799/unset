// The in-place editor's table tools (decision 7, target-look-decisions.md): a handle above the column and beside the
// row under the pointer, each opening its menu. The editing is preset-gfm 7.23.0's own table commands, the ones the
// official table block runs (@milkdown/components 7.23.0 lib/table-block/index.js, useOperation: selectColCommand or
// selectRowCommand, then the action on that selection); only the handles are ours (text-menus.svelte), so the editor
// holds no Vue (ADR 0073). Alignment is GFM's own delimiter row (`:---:`), so the words stay plain Markdown.
import { commandsCtx, type Editor, editorViewCtx } from "@milkdown/core";
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
  deleteSelectedCellsCommand,
  moveColCommand,
  moveRowCommand,
  selectColCommand,
  selectRowCommand,
  setAlignCommand,
} from "@milkdown/preset-gfm";
import type { Node as ProseNode, ResolvedPos } from "@milkdown/prose/model";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import type { Mappable } from "@milkdown/prose/transform";
import type { EditorView } from "@milkdown/prose/view";
import { $prose } from "@milkdown/utils";

export const COLUMN_ACTIONS = ["addLeft", "addRight", "alignLeft", "alignCenter", "alignRight", "delete"] as const;
export type ColumnAction = (typeof COLUMN_ACTIONS)[number];
export const ROW_ACTIONS = ["addAbove", "addBelow", "delete"] as const;
export type RowAction = (typeof ROW_ACTIONS)[number];
export type Alignment = "left" | "center" | "right";

/** The cell the handles are for, and which of its handles' menus is open; null when they are hidden. */
export type TableState = {
  readonly row: number;
  readonly column: number;
  /** The column's alignment, as its header cell holds it (null: none set). */
  readonly align: Alignment | null;
  readonly open: "column" | "row" | null;
} | null;

export type TableOptions = {
  /** The handles, placed inside the element that holds them and the editor (their offset parent). */
  readonly columnHandle: HTMLElement;
  readonly rowHandle: HTMLElement;
  /** The line drawn where a dragged column or row would land. */
  readonly dropLine: HTMLElement;
  readonly onTable: (state: TableState) => void;
};

export type TableTools = {
  /** A press on a handle: opens its menu, or closes it when it is open (a second press, decision 12). */
  readonly toggle: (which: "column" | "row") => void;
  readonly close: () => void;
  readonly column: (action: ColumnAction) => void;
  /** The header row is never deleted and nothing goes above it: GFM's table starts with exactly one header row. */
  readonly row: (action: RowAction) => void;
};

/** Milkdown's context, as Editor.config hands it over. */
type Ctx = Parameters<Parameters<Editor["config"]>[0]>[0];

/** A cell of the table: the table's position, and the cell's row and column. */
type Cell = { readonly table: number; readonly row: number; readonly column: number };

const CELLS = new Set(["table_cell", "table_header"]);
const ROWS = new Set(["table_row", "table_header_row"]);

/** The cell holding `$pos`, if it is in a table: the innermost cell, its row's place in the table and its own. */
function cellAt($pos: ResolvedPos): Cell | null {
  for (let depth = $pos.depth; depth >= 2; depth -= 1) {
    if (!CELLS.has($pos.node(depth).type.name)) continue;
    const table = $pos.node(depth - 2);
    if (table.type.name !== "table" || !ROWS.has($pos.node(depth - 1).type.name)) return null;
    return { table: $pos.before(depth - 2), row: $pos.index(depth - 2), column: $pos.index(depth - 1) };
  }
  return null;
}

/** The cell under the pointer, if it is over one of the editor's tables. */
function cellUnder(view: EditorView, x: number, y: number): Cell | null {
  const found = view.posAtCoords({ left: x, top: y });
  if (found === null || found.inside < 0) return null;
  return cellAt(view.state.doc.resolve(found.inside));
}

/**
 * A cell's table moved by a change, or null when the change deleted it. A cell past the table's last row or column
 * (the change deleted it) becomes the last one, so the tools stay on cells that are there.
 */
function mapCell(cell: Cell | null, mapping: Mappable, doc: ProseNode): Cell | null {
  if (cell === null) return null;
  const moved = mapping.mapResult(cell.table, 1);
  const table = moved.deleted ? null : doc.nodeAt(moved.pos);
  if (table === null || table.type.name !== "table" || table.childCount === 0) return null;
  const row = Math.min(cell.row, table.childCount - 1);
  const column = Math.min(cell.column, table.child(row).childCount - 1);
  return column < 0 ? null : { table: moved.pos, row, column };
}

const sameCell = (a: Cell | null, b: Cell | null) =>
  a === b || (a !== null && b !== null && a.table === b.table && a.row === b.row && a.column === b.column);

/** Puts the column handle centred above the column's header cell and the row handle centred left of the row. */
function place(view: EditorView, cell: Cell, options: TableOptions) {
  const table = view.nodeDOM(cell.table);
  if (!(table instanceof HTMLElement)) return;
  const rows = table.querySelectorAll("tr");
  const head = rows[0]?.children[cell.column];
  const row = rows[cell.row];
  const parent = options.columnHandle.offsetParent;
  if (head === undefined || row === undefined || parent === null) return;
  const origin = parent.getBoundingClientRect();
  const box = table.getBoundingClientRect();
  const column = head.getBoundingClientRect();
  const line = row.getBoundingClientRect();
  const { columnHandle, rowHandle } = options;
  columnHandle.style.left = `${column.left - origin.left + (column.width - columnHandle.offsetWidth) / 2}px`;
  columnHandle.style.top = `${box.top - origin.top - columnHandle.offsetHeight}px`;
  rowHandle.style.left = `${box.left - origin.left - rowHandle.offsetWidth}px`;
  rowHandle.style.top = `${line.top - origin.top + (line.height - rowHandle.offsetHeight) / 2}px`;
}

/** Pixels a press moves before it is a drag rather than a press (a press opens the handle's menu). */
const DRAG_START = 4;

/**
 * Where a dragged column or row lands with the pointer at (x, y): the one under it, clamped to the
 * table. A row never lands on the header row (GFM's table starts with exactly one header row), and the header row is
 * never dragged.
 */
function landing(table: HTMLElement, which: "column" | "row", x: number, y: number): number {
  const rows = [...table.querySelectorAll("tr")];
  const spans =
    which === "row"
      ? rows.map((row) => row.getBoundingClientRect()).map((box) => [box.top, box.bottom] as const)
      : [...(rows[0]?.children ?? [])]
          .map((cell) => cell.getBoundingClientRect())
          .map((box) => [box.left, box.right] as const);
  const at = which === "row" ? y : x;
  const first = which === "row" ? 1 : 0;
  let to = spans.findIndex(([start, end]) => at >= start && at < end);
  if (to === -1) to = at < (spans[0]?.[0] ?? 0) ? first : spans.length - 1;
  return Math.max(to, first);
}

/** Draws the drop line on the edge of `to` that the dragged column or row would take: its top or left when it moves up. */
function drawLine(table: HTMLElement, which: "column" | "row", from: number, to: number, line: HTMLElement) {
  const rows = table.querySelectorAll("tr");
  const target = which === "row" ? rows[to] : rows[0]?.children[to];
  const parent = line.offsetParent;
  if (target === undefined || parent === null) return;
  const origin = parent.getBoundingClientRect();
  const box = table.getBoundingClientRect();
  const edge = target.getBoundingClientRect();
  const before = to < from;
  if (which === "row") {
    line.style.left = `${box.left - origin.left}px`;
    line.style.top = `${(before ? edge.top : edge.bottom) - origin.top - 1}px`;
    line.style.width = `${box.width}px`;
    line.style.height = "2px";
  } else {
    line.style.left = `${(before ? edge.left : edge.right) - origin.left - 1}px`;
    line.style.top = `${box.top - origin.top}px`;
    line.style.width = "2px";
    line.style.height = `${box.height}px`;
  }
  line.dataset.show = "true";
}

function alignOf(table: ProseNode, column: number): Alignment | null {
  const value = table.firstChild?.maybeChild(column)?.attrs.alignment;
  return value === "left" || value === "center" || value === "right" ? value : null;
}

export function withTables(editor: Editor, options: TableOptions): TableTools {
  /** The cell under the pointer while it is over the card (decision 10: nothing stays once it leaves). */
  let hovered: Cell | null = null;
  let open: "column" | "row" | null = null;
  let shown: Cell | null = null;
  /** A press on a handle that moved far enough to be a drag; its click then opens no menu. */
  let dragged = false;
  /** The caret's cell, once Alt+F10 has shown its handles; until the caret or the pointer leaves it. */
  let keyed: Cell | null = null;

  const update = (view: EditorView) => {
    // On a screen with no pointer that hovers, the caret's cell: a touch puts the caret there.
    const touch = window.matchMedia("(hover: none)").matches;
    const caret = touch ? cellAt(view.state.selection.$from) : null;
    if (keyed !== null && view.hasFocus() && !sameCell(cellAt(view.state.selection.$from), keyed)) keyed = null;
    const cell = open !== null ? shown : (hovered ?? keyed ?? caret);
    const node = cell === null ? null : view.state.doc.nodeAt(cell.table);
    if (cell === null || node === null || node.type.name !== "table" || cell.row >= node.childCount) {
      shown = null;
      open = null;
      options.columnHandle.dataset.show = "false";
      options.rowHandle.dataset.show = "false";
      options.onTable(null);
      return;
    }
    shown = cell;
    options.onTable({ row: cell.row, column: cell.column, align: alignOf(node, cell.column), open });
    options.columnHandle.dataset.show = "true";
    options.rowHandle.dataset.show = "true";
    place(view, cell, options);
  };

  /**
   * Dragging a handle moves its column or row (decision 7) by preset-gfm 7.23.0's moveColCommand / moveRowCommand
   * (prosemirror-tables 1.8.5 moveTableColumn / moveTableRow: `to` is the index it ends at), with a line where it
   * lands. The pointer is captured, so the hover under it does not move the handles meanwhile.
   */
  const dragFrom = (view: EditorView, which: "column" | "row", handle: HTMLElement) => {
    const down = (event: PointerEvent) => {
      const cell = shown;
      const table = cell === null ? null : view.nodeDOM(cell.table);
      if (event.button !== 0 || cell === null || !(table instanceof HTMLElement) || !view.editable) return;
      // The open menu sits inside the handle: a press on one of its items is that item's, never a drag.
      if ((event.target as Element).closest("[role='menu']") !== null) return;
      const from = which === "row" ? cell.row : cell.column;
      if (which === "row" && from === 0) return;
      let to = from;
      let moving = false;
      const move = (next: PointerEvent) => {
        if (!moving && Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) < DRAG_START) return;
        moving = true;
        to = landing(table, which, next.clientX, next.clientY);
        drawLine(table, which, from, to, options.dropLine);
      };
      const stop = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", stop);
        options.dropLine.dataset.show = "false";
      };
      // A drag the browser cancels (a touch it takes for scrolling) moves nothing.
      const up = () => {
        stop();
        if (!moving) return;
        dragged = true;
        // The click that follows this pointerup comes first; one that never comes (the pointer left the button) must
        // not swallow the next press.
        setTimeout(() => (dragged = false));
        if (to !== from) moveTo(view, which, cell, from, to);
      };
      (event.target as Element).setPointerCapture?.(event.pointerId);
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointerdown", down);
    return () => handle.removeEventListener("pointerdown", down);
  };
  const moveTo = (view: EditorView, which: "column" | "row", cell: Cell, from: number, to: number) =>
    editor.action((ctx) => {
      // The move finds its row or column through the selection (prosemirror-tables 1.8.5 getSelectionRangeInRow),
      // so it is selected first, as a press on the handle does.
      select(ctx, which, cell);
      const command = which === "row" ? moveRowCommand : moveColCommand;
      ctx.get(commandsCtx).call(command.key, { from, to, pos: cell.table + 1 });
      shown = which === "row" ? { ...cell, row: to } : { ...cell, column: to };
      hovered = shown;
      update(view);
      view.focus();
    });

  const area = options.columnHandle.parentElement;
  editor.use(
    $prose(
      () =>
        new Plugin({
          key: new PluginKey("UNSET_TABLE_TOOLS"),
          // The cells the tools hold follow the words before them; a table the change removed holds none.
          state: {
            init: () => null,
            apply: (tr) => {
              if (tr.docChanged) {
                hovered = mapCell(hovered, tr.mapping, tr.doc);
                shown = mapCell(shown, tr.mapping, tr.doc);
                keyed = mapCell(keyed, tr.mapping, tr.doc);
              }
              return null;
            },
          },
          // Alt+F10 in a cell shows its handles and puts the focus on the column's, so a keyboard reaches the menus a
          // pointer opens; Tab there goes on to the row's (Alt+F10 reaches an editor's toolbar, as in CKEditor 5:
          // https://ckeditor.com/docs/ckeditor5/latest/features/accessibility.html).
          props: {
            // A press back in the words closes an open menu, so the caret it puts in a cell keeps the keys.
            handleDOMEvents: {
              pointerdown: (view) => {
                if (open === null) return false;
                open = null;
                update(view);
                return false;
              },
            },
            handleKeyDown: (view, event) => {
              if (event.key !== "F10" || !event.altKey) return false;
              const cell = cellAt(view.state.selection.$from);
              if (cell === null) return false;
              keyed = cell;
              hovered = null;
              update(view);
              options.columnHandle.querySelector("button")?.focus();
              return true;
            },
          },
          view: (view) => {
            const moved = (event: PointerEvent) => {
              if (!view.dom.contains(event.target as Node)) return;
              const cell = cellUnder(view, event.clientX, event.clientY);
              if (cell === null || sameCell(cell, hovered)) return;
              hovered = cell;
              update(view);
            };
            const left = () => {
              hovered = null;
              keyed = null;
              open = null;
              update(view);
            };
            area?.addEventListener("pointermove", moved);
            area?.addEventListener("pointerleave", left);
            const stopRow = dragFrom(view, "row", options.rowHandle);
            const stopColumn = dragFrom(view, "column", options.columnHandle);
            return {
              update: () => update(view),
              destroy: () => {
                area?.removeEventListener("pointermove", moved);
                area?.removeEventListener("pointerleave", left);
                stopRow();
                stopColumn();
              },
            };
          },
        }),
    ),
  );

  const run = (act: (ctx: Ctx, cell: Cell) => void) => {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const cell = shown;
      if (cell === null || !view.editable) return;
      act(ctx, cell);
      open = null;
      update(view);
      view.focus();
    });
  };
  const select = (ctx: Ctx, which: "column" | "row", cell: Cell) => {
    const commands = ctx.get(commandsCtx);
    if (which === "column") commands.call(selectColCommand.key, { pos: cell.table + 1, index: cell.column });
    else commands.call(selectRowCommand.key, { pos: cell.table + 1, index: cell.row });
  };

  return {
    toggle: (which) =>
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (shown === null || dragged) return;
        open = open === which ? null : which;
        if (open !== null) select(ctx, which, shown);
        update(view);
      }),
    close: () =>
      editor.action((ctx) => {
        open = null;
        const view = ctx.get(editorViewCtx);
        update(view);
        view.focus();
      }),
    column: (action) =>
      run((ctx, cell) => {
        const commands = ctx.get(commandsCtx);
        select(ctx, "column", cell);
        if (action === "addLeft") commands.call(addColBeforeCommand.key);
        else if (action === "addRight") commands.call(addColAfterCommand.key);
        else if (action === "delete") commands.call(deleteSelectedCellsCommand.key);
        else commands.call(setAlignCommand.key, ALIGN[action]);
      }),
    row: (action) =>
      run((ctx, cell) => {
        const commands = ctx.get(commandsCtx);
        if (cell.row === 0 && action !== "addBelow") return;
        select(ctx, "row", cell);
        if (action === "addAbove") commands.call(addRowBeforeCommand.key);
        else if (action === "addBelow") commands.call(addRowAfterCommand.key);
        else commands.call(deleteSelectedCellsCommand.key);
      }),
  };
}

const ALIGN: Record<"alignLeft" | "alignCenter" | "alignRight", Alignment> = {
  alignLeft: "left",
  alignCenter: "center",
  alignRight: "right",
};
