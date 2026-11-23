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
  selectColCommand,
  selectRowCommand,
  setAlignCommand,
} from "@milkdown/preset-gfm";
import type { Node as ProseNode, ResolvedPos } from "@milkdown/prose/model";
import { Plugin, PluginKey } from "@milkdown/prose/state";
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

function alignOf(table: ProseNode, column: number): Alignment | null {
  const value = table.firstChild?.maybeChild(column)?.attrs.alignment;
  return value === "left" || value === "center" || value === "right" ? value : null;
}

export function withTables(editor: Editor, options: TableOptions): TableTools {
  /** The cell under the pointer while it is over the card (decision 10: nothing stays once it leaves). */
  let hovered: Cell | null = null;
  let open: "column" | "row" | null = null;
  let shown: Cell | null = null;

  const update = (view: EditorView) => {
    // On a screen with no pointer that hovers, the caret's cell: a touch puts the caret there.
    const touch = window.matchMedia("(hover: none)").matches;
    const caret = touch ? cellAt(view.state.selection.$from) : null;
    const cell = open !== null ? shown : (hovered ?? caret);
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

  const area = options.columnHandle.parentElement;
  editor.use(
    $prose(
      () =>
        new Plugin({
          key: new PluginKey("UNSET_TABLE_TOOLS"),
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
              open = null;
              update(view);
            };
            area?.addEventListener("pointermove", moved);
            area?.addEventListener("pointerleave", left);
            return {
              update: () => update(view),
              destroy: () => {
                area?.removeEventListener("pointermove", moved);
                area?.removeEventListener("pointerleave", left);
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
        if (shown === null) return;
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
