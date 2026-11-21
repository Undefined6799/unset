// The Text card's rich editor (ADR 0073, P1.21u): Milkdown 7.23.0's core and CommonMark preset, the only place
// that imports @milkdown (scripts/lint/.dependency-cruiser.cjs vendor-sdk-one-adapter). Milkdown reads and writes
// markdown through remark (https://milkdown.dev/docs/guide/using-plugins, remark-stringify 11 options), so the
// stored value stays the app's markdown and the server's parser (lib/profile/parse.ts) stays the authority. The
// stringify options below keep its output inside what that parser reads the same way: `-` bullets, `_` italic,
// `**` bold, backtick fences, a `---` rule, and a soft line break where remark would write a backslash break the
// parser shows as text. Loaded only when a member opens the Text editor (text-editor.svelte imports this file
// dynamically). Changes are reported once per animation frame, not after @milkdown/plugin-listener's 200 ms
// debounce, so a save pressed right after typing never posts stale text; the caller also reads `markdown()` as the
// form is sent.
import {
  defaultValueCtx,
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/core";
import { clipboard } from "@milkdown/plugin-clipboard";
import { history } from "@milkdown/plugin-history";
import { commonmark, emphasisSchema, headingSchema, imageSchema, strongSchema } from "@milkdown/preset-commonmark";
import { gfm, remarkGFMPlugin, tableCellSchema, tableHeaderSchema } from "@milkdown/preset-gfm";
import { lift, setBlockType, toggleMark, wrapIn } from "@milkdown/prose/commands";
import { dropCursor } from "@milkdown/prose/dropcursor";
import { gapCursor } from "@milkdown/prose/gapcursor";
import { isHistoryTransaction, redo, redoDepth, undo, undoDepth } from "@milkdown/prose/history";
import type { NodeType, Node as ProseNode, Schema } from "@milkdown/prose/model";
import { liftListItem, wrapInList } from "@milkdown/prose/schema-list";
import { type Command, type EditorState, Plugin, Selection, TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import { $prose, $remark, getMarkdown } from "@milkdown/utils";
import "@milkdown/prose/view/style/prosemirror.css";
import "@milkdown/prose/gapcursor/style/gapcursor.css";
import { enterKeys } from "./enter-keys.ts";
import { type Menus, type MenusOptions, withMenus } from "./menus.ts";

/** The toolbar's actions, by name. */
export const EDITOR_COMMANDS = [
  "strong",
  "emphasis",
  "strike",
  "code",
  "paragraph",
  "heading1",
  "heading2",
  "heading3",
  "bullets",
  "numbers",
  "quote",
  "codeBlock",
  "undo",
  "redo",
] as const;
export type EditorCommand = (typeof EDITOR_COMMANDS)[number];

/** Which actions are on for the selection (a mark it carries, the block it is in) and which may be pressed now. */
export type ToolbarState = {
  readonly active: ReadonlySet<EditorCommand>;
  readonly enabled: ReadonlySet<EditorCommand>;
};

const HEADINGS = { heading1: 1, heading2: 2, heading3: 3 } as const;
const LISTS = { bullets: "bullet_list", numbers: "ordered_list" } as const;

/** The nearest list around the selection, as its depth and node, or null outside every list. */
function listAround(state: EditorState): { depth: number; node: ProseNode } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "bullet_list" || node.type.name === "ordered_list") return { depth, node };
  }
  return null;
}

function inside(state: EditorState, name: string): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) if ($from.node(depth).type.name === name) return true;
  return false;
}

/** A list button: on in its own kind of list it lifts the item out, in the other kind it switches the list. */
function listCommand(schema: Schema, kind: NodeType): Command {
  return (state, dispatch) => {
    const list = listAround(state);
    if (list === null) return wrapInList(kind)(state, dispatch);
    if (list.node.type === kind) return liftListItem(schema.nodes.list_item as NodeType)(state, dispatch);
    dispatch?.(state.tr.setNodeMarkup(state.selection.$from.before(list.depth), kind));
    return true;
  };
}

/**
 * Each action as a ProseMirror command, so the bar can ask whether it applies without running it. A block action
 * pressed where it is already on goes back to a plain paragraph (Alex 2026-11-20: the buttons only "kind of work").
 */
function commandFor(name: EditorCommand, state: EditorState): Command {
  const { schema } = state;
  const node = (type: string) => schema.nodes[type] as NodeType;
  const paragraph = setBlockType(node("paragraph"));
  const active = isActive(name, state);
  switch (name) {
    case "strong":
      return toggleMark(schema.marks.strong as NonNullable<typeof schema.marks.strong>);
    case "emphasis":
      return toggleMark(schema.marks.emphasis as NonNullable<typeof schema.marks.emphasis>);
    case "strike":
      return toggleMark(schema.marks.strike_through as NonNullable<typeof schema.marks.strike_through>);
    case "code":
      return toggleMark(schema.marks.inlineCode as NonNullable<typeof schema.marks.inlineCode>);
    case "paragraph":
      return paragraph;
    case "heading1":
    case "heading2":
    case "heading3":
      return active ? paragraph : setBlockType(node("heading"), { level: HEADINGS[name] });
    case "bullets":
    case "numbers":
      return listCommand(schema, node(LISTS[name]));
    case "quote":
      return active ? lift : wrapIn(node("blockquote"));
    case "codeBlock":
      return active ? paragraph : setBlockType(node("code_block"));
    case "undo":
      return undo;
    case "redo":
      return redo;
  }
}

function isActive(name: EditorCommand, state: EditorState): boolean {
  const { selection } = state;
  const parent = selection.$from.parent;
  const mark = { strong: "strong", emphasis: "emphasis", strike: "strike_through", code: "inlineCode" } as const;
  switch (name) {
    case "strong":
    case "emphasis":
    case "strike":
    case "code": {
      const type = state.schema.marks[mark[name]];
      if (type === undefined) return false;
      if (selection.empty) return type.isInSet(state.storedMarks ?? selection.$from.marks()) !== undefined;
      return state.doc.rangeHasMark(selection.from, selection.to, type);
    }
    case "paragraph":
      return parent.type.name === "paragraph" && !inside(state, "list_item") && !inside(state, "blockquote");
    case "heading1":
    case "heading2":
    case "heading3":
      return parent.type.name === "heading" && parent.attrs.level === HEADINGS[name];
    case "bullets":
    case "numbers":
      return listAround(state)?.node.type.name === LISTS[name];
    case "quote":
      return inside(state, "blockquote");
    case "codeBlock":
      return parent.type.name === "code_block";
    case "undo":
    case "redo":
      return false;
  }
}

/** Whether a press would change the text into a shape the page shows: dry-run, through the same check as pageShapes. */
function applies(name: EditorCommand, state: EditorState, before: number): boolean {
  if (name === "undo") return undoDepth(state) > 0;
  if (name === "redo") return redoDepth(state) > 0;
  let shown = false;
  const ran = commandFor(name, state)(state, (tr) => {
    shown = !tr.docChanged || flattened(tr.doc) <= before;
  });
  return ran && shown;
}

function toolbarState(state: EditorState): ToolbarState {
  const before = flattened(state.doc);
  return {
    active: new Set(EDITOR_COMMANDS.filter((name) => isActive(name, state))),
    enabled: new Set(EDITOR_COMMANDS.filter((name) => applies(name, state, before))),
  };
}

export type MarkdownEditor = {
  readonly run: (command: EditorCommand) => void;
  /** The markdown the editor holds now. */
  readonly markdown: () => string;
  /** Reports a change still waiting for its frame to `onChange` at once, so a save pressed in that frame sends it. */
  readonly flush: () => void;
  readonly focus: () => void;
  /**
   * Puts the caret at the words under the page point (x, y), or at the nearest end when the point is beside them (the
   * card's padding, or below the last line), then focuses the editor.
   */
  readonly focusAt: (x: number, y: number) => void;
  /** Types `text` at the caret, as the member's own keys would. */
  readonly type: (text: string) => void;
  readonly destroy: () => Promise<void>;
  /** The side handle, block menu and floating bar, when the caller drew them (`MountOptions.menus`). */
  readonly menus?: Menus;
};

export type MountOptions = {
  readonly value: string;
  /** The id of the label that names the editor. Its description and state are the caller's to set. */
  readonly labelledBy: string;
  /** Called at once on every change the member makes, before its markdown is ready. */
  readonly onEdit: () => void;
  /** Called with the markdown after every change the member makes, once per frame. */
  readonly onChange: (markdown: string) => void;
  /** Called with the bar's state when the editor opens and at once after the text or the selection changes. */
  readonly onToolbar: (state: ToolbarState) => void;
  /** Where to draw the side handle, block menu and floating bar, if the editor has them (the in-place editor). */
  readonly menus?: Omit<MenusOptions, "isOn">;
};

// The page's parser (apps/web/lib/profile/parse.ts) shows a quote as paragraphs with line breaks, a list item as one
// paragraph with optional lists of its own, and a line break outside a list as a line break (P1.21s); remark writes a
// break in a list item as an indented continuation line the parser moves out of the list. The schema stays Milkdown's
// full one, so any stored text opens as it is; instead no edit (toolbar, shortcut or paste) may add a shape the saved
// card would flatten: a heading, list or code block inside a quote, a second paragraph, quote, heading or code block
// inside a list item, a line break inside a list, or a list nested deeper than the page's three levels (parse.ts
// MAX_LIST_DEPTH), which it shows beside the third; nor, from GFM, a footnote. Text already stored that way stays
// editable.
const ITEM_LISTS = new Set(["bullet_list", "ordered_list"]);
const PAGE_LIST_DEPTH = 3;
/**
 * How many flattened shapes `node` and what it holds carry, given its parent, its index there and how many lists hold
 * it: what the page would show differently from the editor.
 */
function shapesIn(node: ProseNode, parent: ProseNode, index: number, lists: number): number {
  const holder = parent.type.name;
  const name = node.type.name;
  let count = 0;
  if (ITEM_LISTS.has(name) && lists >= PAGE_LIST_DEPTH) count += 1;
  if (holder === "blockquote" && name !== "paragraph") count += 1;
  if (holder === "list_item" && index > 0 && !ITEM_LISTS.has(name)) count += 1;
  if (name === "hardbreak" && lists > 0) count += 1;
  // GFM: the page reads no footnotes (preset-gfm's footnote_reference and footnote_definition), and a table cell
  // holds one line.
  if (name.startsWith("footnote_")) count += 1;
  if (name === "hardbreak" && (holder === "table_cell" || holder === "table_header")) count += 1;
  if (!node.isBlock) return count;
  const inner = lists + (ITEM_LISTS.has(name) ? 1 : 0);
  node.forEach((child, _offset, at) => {
    count += shapesIn(child, node, at, inner);
  });
  return count;
}
/**
 * Each top-level block's count, kept while the block is: ProseMirror nodes never change, and an edit or a dry run
 * builds a new node only for the block it touches and shares every other one with the old document. So the bar's
 * dozen dry runs and the page-shape filter walk the block being edited, not the whole text, on each keystroke.
 */
const blockShapes = new WeakMap<ProseNode, number>();
function flattened(doc: ProseNode): number {
  let count = 0;
  doc.forEach((block, _offset, index) => {
    let shapes = blockShapes.get(block);
    if (shapes === undefined) {
      shapes = shapesIn(block, doc, index, 0);
      blockShapes.set(block, shapes);
    }
    count += shapes;
  });
  return count;
}
// Undo and redo only go back to what the member had, so they pass.
/**
 * Crepe 7.23.0's cursor feature (prosemirror-dropcursor 1.8.4 and prosemirror-gapcursor 1.4.1, as @milkdown/prose
 * ships them): a line shows where a dragged block will land, and the caret can stop between two blocks no text can
 * hold, such as below a last code block, where typing starts a new line.
 */
const dropLine = $prose(() => dropCursor({ width: 2, color: false, class: "rounded-full bg-ring" }));
const gapCaret = $prose(() => gapCursor());

const CELL_ALIGN: Readonly<Record<string, string>> = { left: "text-start", center: "text-center", right: "text-end" };
const cellTag = (node: ProseNode) => (node.type.name === "table_header" ? "th" : "td");
/** A cell's DOM attributes with its alignment as a class; GFM cells span one column and row. */
function cellAttrs(node: ProseNode): Record<string, string> {
  return { class: CELL_ALIGN[String(node.attrs.alignment)] ?? "text-start" };
}

/**
 * A task's box is drawn where its bullet was (the editor's styles, from `data-checked`), and a press on it ticks or
 * clears the task; preset-gfm 7.23.0 draws the item without a box of its own (task-list-item.ts toDOM).
 */
const TASK_BOX = 24;
const taskBox = $prose(
  () =>
    new Plugin({
      props: {
        handleClickOn: (view, _pos, node, nodePos, event, direct) => {
          if (!direct || node.type.name !== "list_item" || node.attrs.checked === null) return false;
          const item = view.nodeDOM(nodePos);
          if (!(item instanceof HTMLElement)) return false;
          if (event.clientX - item.getBoundingClientRect().left > TASK_BOX) return false;
          view.dispatch(view.state.tr.setNodeAttribute(nodePos, "checked", !node.attrs.checked));
          return true;
        },
      },
    }),
);

/** A drawn heading's own level, 1 to 6, from its data-level; anything else is none. */
function headingLevel(value: string | undefined): number | undefined {
  const level = Number(value);
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : undefined;
}

/** The parts of a Markdown tree (mdast) the www rewrite reads. */
type MdNode = { type: string; url?: string; value?: string; children?: MdNode[] };

/**
 * A bare `www.` name opens over https, as the page reads it (parse.ts; Alex 2026-11-21: "bare addresses become
 * https"): remark-gfm 4.0.1 gives one a link to `http://` and its name (mdast-util-gfm-autolink-literal), so that link
 * is pointed at https before the editor draws it.
 */
const wwwOverHttps = $remark("wwwOverHttps", () => () => (tree: MdNode) => {
  const walk = (node: MdNode) => {
    const name = node.children?.length === 1 ? node.children[0]?.value : undefined;
    if (node.type === "link" && name !== undefined && /^www\./i.test(name) && node.url === `http://${name}`) {
      node.url = `https://${name}`;
    }
    node.children?.forEach(walk);
  };
  walk(tree);
});

const pageShapes = $prose(
  () =>
    new Plugin({
      filterTransaction: (tr, state) =>
        !tr.docChanged || isHistoryTransaction(tr) || flattened(tr.doc) <= flattened(state.doc),
    }),
);

/**
 * The markdown as the card stores it. remark-stringify ends the document with a line feed; the plain field never did,
 * so neither does the editor. And an empty line is a blank line: preset-commonmark 7.23.0 writes each empty paragraph
 * as a line of html "<br />" (node/paragraph.ts EMPTY_LINE_PLACEHOLDER), which the page would show as text, so such a
 * line goes (in a quote or a list too, never in a code block) with the blank line it leaves doubled. Removing the preset's
 * remarkPreserveEmptyLinePlugin instead makes its serializer drop the text around the empty paragraph.
 */
const EMPTY_LINE = /^[ >]*<br \/>[ ]*$/;
const FENCE_LINE = /^[ >]*(```|~~~)/;
function stored(markdown: string): string {
  const kept: string[] = [];
  let fenced = false;
  let dropped = false;
  for (const line of markdown.replace(/\n$/, "").split("\n")) {
    if (FENCE_LINE.test(line)) fenced = !fenced;
    const blank = /^[ >]*$/.test(line);
    if (!fenced && EMPTY_LINE.test(line)) {
      dropped = true;
      continue;
    }
    // The blank line after a dropped one repeats the one before it.
    if (dropped && blank && kept.length > 0 && /^[ >]*$/.test(kept[kept.length - 1] ?? "")) continue;
    dropped = false;
    kept.push(line);
  }
  return kept.join("\n");
}

/**
 * Where a press at the page point (x, y) leaves the caret: at the words under it (prosemirror-view 1.42.9
 * EditorView.posAtCoords), else, beside the words, at the start when the point is above them and at the end otherwise.
 */
function caretAt(view: EditorView, x: number, y: number): Selection {
  const { doc } = view.state;
  const box = view.dom.getBoundingClientRect();
  const inside = {
    left: Math.min(Math.max(x, box.left + 1), box.right - 1),
    top: Math.min(Math.max(y, box.top + 1), box.bottom - 1),
  };
  const found = y < box.top || y > box.bottom ? null : view.posAtCoords(inside);
  if (found !== null) return TextSelection.near(doc.resolve(found.pos));
  return y < box.top ? Selection.atStart(doc) : Selection.atEnd(doc);
}

export async function mountMarkdownEditor(root: HTMLElement, options: MountOptions): Promise<MarkdownEditor> {
  let frame = 0;
  let flush: () => void = () => undefined;
  const changes = $prose(
    (ctx) =>
      new Plugin({
        // The bar's state is read in the same step as the change, not a frame later: a press right after the editor
        // opens or right after typing must find its button available.
        view: (mounted) => {
          options.onToolbar(toolbarState(mounted.state));
          const report = () => {
            frame = 0;
            options.onChange(stored(ctx.get(serializerCtx)(mounted.state.doc)));
          };
          // The last change is reported at once when the page goes away before the next frame (a reload right after
          // typing; WebKit may draw none first), so the words reach the page's drafts.
          flush = () => {
            if (frame === 0) return;
            cancelAnimationFrame(frame);
            report();
          };
          addEventListener("pagehide", flush);
          return {
            update: (view, previous) => {
              if (previous !== view.state) options.onToolbar(toolbarState(view.state));
              if (previous.doc.eq(view.state.doc)) return;
              options.onEdit();
              if (frame !== 0) return;
              frame = requestAnimationFrame(report);
            },
            destroy: () => {
              cancelAnimationFrame(frame);
              removeEventListener("pagehide", flush);
            },
          };
        },
      }),
  );
  const made = Editor.make();
  const menus =
    options.menus === undefined
      ? undefined
      : withMenus(made, { ...options.menus, isOn: (item, state) => isActive(item, state) });
  const editor = await made
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, options.value);
      // GitHub Flavored Markdown as the page reads it (parse.ts): struck words need two tildes each side, so a single
      // tilde stays text (remark-gfm 4.0.1 `singleTilde`, true by default).
      // Cells are not padded to line up (`tablePipeAlign`), so a table opened and saved keeps the spacing it had.
      ctx.set(remarkGFMPlugin.options.key, { singleTilde: false, tablePipeAlign: false });
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({
        ...prev,
        bullet: "-" as const,
        rule: "-" as const,
      }));
      // Milkdown keeps the marker each mark was typed or stored with (preset-commonmark 7.23.0 emphasisSchema and
      // strongSchema, attribute `marker`), so "**a *b***" would come back out; the parser reads that run of three
      // wrongly. Writing italic as "_" and bold as "**" always gives "**a _b_**" and "_**word**_", which it reads.
      // The runner returns nothing: a truthy return tells the serializer the mark wrote the text itself
      // (@milkdown/transformer 7.23.0 SerializerState, "every((mark) => !runProseMark(mark, node))").
      // preset-gfm 7.23.0 draws a cell's alignment as a style attribute (table/schema.ts, cellAttributes.alignment),
      // which the app's CSP refuses (style-src-attr); a class aligns it instead, as the page does (readme.svelte).
      for (const cell of [tableCellSchema, tableHeaderSchema]) {
        ctx.update(cell.key, (prev) => (schemaCtx) => {
          const schema = prev(schemaCtx);
          return { ...schema, toDOM: (node) => [cellTag(node), cellAttrs(node), 0] };
        });
      }
      ctx.update(emphasisSchema.key, (prev) => (schemaCtx) => {
        const schema = prev(schemaCtx);
        return {
          ...schema,
          toMarkdown: {
            ...schema.toMarkdown,
            runner: (state, mark) => {
              state.withMark(mark, "emphasis", undefined, { marker: "_" });
            },
          },
        };
      });
      ctx.update(strongSchema.key, (prev) => (schemaCtx) => {
        const schema = prev(schemaCtx);
        return {
          ...schema,
          toMarkdown: {
            ...schema.toMarkdown,
            runner: (state, mark) => {
              state.withMark(mark, "strong", undefined, { marker: "*" });
            },
          },
        };
      });
      // A heading shows one level down, as the page shows it (readme.svelte: # is an h2 under the page's own h1), and
      // carries no id: preset-commonmark 7.23.0 headingSchema.toDOM gives each one an id made from its words, which
      // would repeat across cards and clash with the page's own anchors. parseDOM reads it back one level up, so a
      // paste (plugin-clipboard 7.23.0 draws pasted Markdown with toDOM and parses that) or a copy between cards keeps
      // its level; a pasted h1 is the top level, as an h2 is.
      ctx.update(headingSchema.key, (prev) => (schemaCtx) => ({
        ...prev(schemaCtx),
        // HTML stops at h6, so levels 5 and 6 both draw one; data-level says which, and a copy keeps it.
        parseDOM: [1, 2, 3, 4, 5, 6].map((shown) => ({
          tag: `h${shown}`,
          getAttrs: (dom: HTMLElement) => ({ level: headingLevel(dom.dataset.level) ?? Math.max(shown - 1, 1) }),
        })),
        toDOM: (node) => [
          `h${Math.min(Number(node.attrs.level) + 1, 6)}`,
          { "data-level": String(node.attrs.level) },
          0,
        ],
      }));
      // An image shows its alt text and loads nothing: the page shows it as a link (parse.ts) until the media proxy,
      // and a remote address would be refused by the page's img-src anyway (preset-commonmark 7.23.0 imageSchema.toDOM
      // draws an img with the stored src). Pasted HTML needs nothing more: prosemirror-view 1.42.9 reads it in a
      // detached document (readHTML, detachedDoc), which loads nothing, and only the schema's own toDOM reaches the
      // page, so no pasted image or script is ever drawn. Pasted style attributes are refused by the CSP and reported, not applied. A DOMParser of our own would be refused by the
      // page's Trusted Types rule; prosemirror-view's "ProseMirrorClipboard" policy is the one the CSP allows.
      ctx.update(imageSchema.key, (prev) => (schemaCtx) => ({
        ...prev(schemaCtx),
        toDOM: (node) => ["span", { "data-image": "" }, `[${String(node.attrs.alt) || "image"}]`],
      }));
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        attributes: {
          role: "textbox",
          "aria-multiline": "true",
          "aria-labelledby": options.labelledBy,
          class: "markdown-editor",
          spellcheck: "true",
        },
      }));
    })
    .use(commonmark)
    .use(gfm)
    .use(wwwOverHttps)
    .use(taskBox)
    .use(clipboard)
    .use(pageShapes)
    .use(history)
    .use(changes)
    .use(dropLine)
    .use(gapCaret)
    .use(enterKeys)
    .create();
  return {
    run: (command) =>
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        commandFor(command, view.state)(view.state, view.dispatch, view);
      }),
    markdown: () => stored(editor.action(getMarkdown())),
    flush: () => flush(),
    // The view's own focus puts its selection back (prosemirror-view 1.42.9 EditorView.focus calls selectionToDOM),
    // so a second toolbar press acts on the words the first one did; a plain DOM focus drops it.
    focus: () => editor.action((ctx) => ctx.get(editorViewCtx).focus()),
    focusAt: (x, y) =>
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.setSelection(caretAt(view, x, y)));
        view.focus();
      }),
    type: (text) =>
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        // Through the view's own text input handling, so input rules ("# ", "- ") apply as they would to keys.
        const { from, to } = view.state.selection;
        const insert = () => view.state.tr.insertText(text, from, to);
        const handled = view.someProp("handleTextInput", (handle) => handle(view, from, to, text, insert));
        if (handled !== true) view.dispatch(insert());
      }),
    destroy: async () => {
      await editor.destroy();
    },
    menus,
  };
}
