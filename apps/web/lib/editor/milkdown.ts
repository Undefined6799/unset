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
import { history } from "@milkdown/plugin-history";
import { commonmark, emphasisSchema, headingSchema, strongSchema } from "@milkdown/preset-commonmark";
import { lift, setBlockType, toggleMark, wrapIn } from "@milkdown/prose/commands";
import { isHistoryTransaction, redo, redoDepth, undo, undoDepth } from "@milkdown/prose/history";
import type { NodeType, Node as ProseNode, Schema } from "@milkdown/prose/model";
import { liftListItem, wrapInList } from "@milkdown/prose/schema-list";
import { type Command, type EditorState, Plugin } from "@milkdown/prose/state";
import { $prose, getMarkdown } from "@milkdown/utils";
import "@milkdown/prose/view/style/prosemirror.css";

/** The toolbar's actions, by name. */
export const EDITOR_COMMANDS = [
  "strong",
  "emphasis",
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
  const mark = { strong: "strong", emphasis: "emphasis", code: "inlineCode" } as const;
  switch (name) {
    case "strong":
    case "emphasis":
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
  readonly destroy: () => Promise<void>;
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
};

// The page's parser (apps/web/lib/profile/parse.ts) shows a quote as one paragraph of text, a list item as one
// paragraph with optional lists of its own, and a line break as a space; remark writes a break in a list item as an
// indented continuation line the parser moves out of the list. The schema stays Milkdown's full one, so any stored
// text opens as it is; instead no edit (toolbar, shortcut or paste) may add a shape the saved card would flatten: a
// second paragraph, heading or list inside a quote, a second paragraph, quote, heading or code block inside a list
// item, a line break anywhere, or a list nested deeper than the page's three levels (parse.ts MAX_LIST_DEPTH), which
// it shows beside the third. Text already stored that way stays editable.
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
  if (holder === "blockquote" && (index > 0 || name !== "paragraph")) count += 1;
  if (holder === "list_item" && index > 0 && !ITEM_LISTS.has(name)) count += 1;
  if (name === "hardbreak") count += 1;
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
const pageShapes = $prose(
  () =>
    new Plugin({
      filterTransaction: (tr, state) =>
        !tr.docChanged || isHistoryTransaction(tr) || flattened(tr.doc) <= flattened(state.doc),
    }),
);

/** remark-stringify ends the document with a line feed; the plain field never did, so neither does the editor. */
const withoutFinalNewline = (markdown: string) => markdown.replace(/\n$/, "");

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
            options.onChange(withoutFinalNewline(ctx.get(serializerCtx)(mounted.state.doc)));
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
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, options.value);
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({
        ...prev,
        bullet: "-" as const,
        rule: "-" as const,
        handlers: { ...prev.handlers, break: () => "\n" },
      }));
      // Milkdown keeps the marker each mark was typed or stored with (preset-commonmark 7.23.0 emphasisSchema and
      // strongSchema, attribute `marker`), so "**a *b***" would come back out; the parser reads that run of three
      // wrongly. Writing italic as "_" and bold as "**" always gives "**a _b_**" and "_**word**_", which it reads.
      // The runner returns nothing: a truthy return tells the serializer the mark wrote the text itself
      // (@milkdown/transformer 7.23.0 SerializerState, "every((mark) => !runProseMark(mark, node))").
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
      // would repeat across cards and clash with the page's own anchors. The markdown and parseDOM are unchanged.
      ctx.update(headingSchema.key, (prev) => (schemaCtx) => ({
        ...prev(schemaCtx),
        toDOM: (node) => [`h${Math.min(Number(node.attrs.level) + 1, 6)}`, 0],
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
    .use(pageShapes)
    .use(history)
    .use(changes)
    .create();
  return {
    run: (command) =>
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        commandFor(command, view.state)(view.state, view.dispatch, view);
      }),
    markdown: () => withoutFinalNewline(editor.action(getMarkdown())),
    flush: () => flush(),
    // The view's own focus puts its selection back (prosemirror-view 1.42.9 EditorView.focus calls selectionToDOM),
    // so a second toolbar press acts on the words the first one did; a plain DOM focus drops it.
    focus: () => editor.action((ctx) => ctx.get(editorViewCtx).focus()),
    destroy: async () => {
      await editor.destroy();
    },
  };
}
