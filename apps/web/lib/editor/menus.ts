// The in-place editor's side handle, block menu and floating bar (P1.21v slice 3), on Milkdown 7.23.0's own plugins:
// @milkdown/plugin-block places the handle and drags blocks, @milkdown/plugin-slash and @milkdown/plugin-tooltip place
// the block menu and the bar, and preset-commonmark's commands change the text. What each does when, and the menu's
// items, follow Crepe 7.23.0 (src/feature/block-edit/handle/index.ts, block-edit/menu/index.ts and config.ts,
// toolbar/index.ts), Milkdown's own editor, which the playground runs; the markup is ours (text-menus.svelte), so the
// menu is a listbox the editor names as its active option and every control is a named button (ADR 0073 forbids
// Crepe's Vue). This file holds no markup and the Svelte side no Milkdown.
import { commandsCtx, type Editor, editorViewCtx } from "@milkdown/core";
import { BlockProvider, block, blockConfig } from "@milkdown/plugin-block";
import { SlashProvider, slashFactory } from "@milkdown/plugin-slash";
import { TooltipProvider, tooltipFactory } from "@milkdown/plugin-tooltip";
import {
  addBlockTypeCommand,
  blockquoteSchema,
  bulletListSchema,
  clearTextInCurrentBlockCommand,
  codeBlockSchema,
  headingSchema,
  hrSchema,
  orderedListSchema,
  paragraphSchema,
  setBlockTypeCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  wrapInBlockTypeCommand,
} from "@milkdown/preset-commonmark";
import { findParent } from "@milkdown/prose";
import type { NodeType } from "@milkdown/prose/model";
import { type EditorState, TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";

/** The block menu's items, in Crepe's order, less what the page cannot show (tables, tasks, images, math). */
export const BLOCK_ITEMS = [
  "text",
  "heading1",
  "heading2",
  "heading3",
  "quote",
  "divider",
  "bullets",
  "numbers",
  "codeBlock",
] as const;
export type BlockItem = (typeof BLOCK_ITEMS)[number];
export const BAR_ITEMS = ["strong", "emphasis", "code"] as const;
export type BarItem = (typeof BAR_ITEMS)[number];

export type MenusState = {
  /** The block menu's items matching what follows the "/", and the one Enter runs; empty when it is closed. */
  readonly items: readonly BlockItem[];
  readonly index: number;
  readonly bar: boolean;
  /** Which of the bar's marks the selected words carry. */
  readonly on: ReadonlySet<BarItem>;
};

export type MenusOptions = {
  /** The elements the plugins place: the handle (holding the add button and the grip), the block menu and the bar. */
  readonly handle: HTMLElement;
  readonly add: HTMLElement;
  readonly menu: HTMLElement;
  readonly bar: HTMLElement;
  readonly labels: Readonly<Record<BlockItem, string>>;
  /** The id of an item's option, for the editor's aria-activedescendant. */
  readonly optionId: (item: BlockItem) => string;
  readonly onState: (state: MenusState) => void;
  /** Whether a bar item is on for the selection (milkdown.ts isActive). */
  readonly isOn: (item: BarItem, state: EditorState) => boolean;
};

export type Menus = {
  /** Runs the block menu's item: the "/" and what follows it go, and the block becomes the item. */
  readonly choose: (item: BlockItem) => void;
  readonly format: (item: BarItem) => void;
};

/** Milkdown's context, as Editor.config hands it over (@milkdown/ctx, which apps/web does not depend on directly). */
type Ctx = Parameters<Parameters<Editor["config"]>[0]>[0];

const blockMenu = slashFactory("UNSET_BLOCK_MENU");
const formatBar = tooltipFactory("UNSET_FORMAT_BAR");

function blockCommand(ctx: Ctx, item: BlockItem): () => void {
  const commands = ctx.get(commandsCtx);
  const set = (type: NodeType, attrs?: Record<string, unknown>) => () =>
    commands.call(setBlockTypeCommand.key, { nodeType: type, attrs });
  const wrap = (type: NodeType) => () => commands.call(wrapInBlockTypeCommand.key, { nodeType: type });
  switch (item) {
    case "text":
      return set(paragraphSchema.type(ctx));
    case "heading1":
    case "heading2":
    case "heading3":
      return set(headingSchema.type(ctx), { level: Number(item.at(-1)) });
    case "quote":
      return wrap(blockquoteSchema.type(ctx));
    case "divider":
      return () => commands.call(addBlockTypeCommand.key, { nodeType: hrSchema.type(ctx) });
    case "bullets":
      return wrap(bulletListSchema.type(ctx));
    case "numbers":
      return wrap(orderedListSchema.type(ctx));
    case "codeBlock":
      return set(codeBlockSchema.type(ctx));
  }
}

const BAR_COMMANDS = { strong: toggleStrongCommand, emphasis: toggleEmphasisCommand, code: toggleInlineCodeCommand };

function atEndOfBlock(state: EditorState): boolean {
  const { selection } = state;
  return selection instanceof TextSelection && selection.$head.parentOffset === selection.$head.parent.content.size;
}

/** Adds the handle, the block menu and the bar to `editor`, drawn in the elements `options` names. */
export function withMenus(editor: Editor, options: MenusOptions): Menus {
  let ctx: Ctx | undefined;
  let filter = "";
  let items: readonly BlockItem[] = [];
  let index = 0;
  let bar = false;
  let on: ReadonlySet<BarItem> = new Set();
  /** Where the handle's add button opened the menu: it stays open on that empty line until the caret leaves it. */
  let addedAt: number | null = null;
  let slash: SlashProvider | undefined;

  const report = () => options.onState({ items, index, bar, on });
  const matching = () =>
    BLOCK_ITEMS.filter((item) => options.labels[item].toLowerCase().includes(filter.toLowerCase()));
  const refresh = (view: EditorView) => view.dispatch(view.state.tr.setMeta("addToHistory", false));

  function close() {
    addedAt = null;
    slash?.hide();
  }

  const choose = (item: BlockItem) => {
    if (ctx === undefined) return;
    const view = ctx.get(editorViewCtx);
    close();
    ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key);
    blockCommand(ctx, item)();
    view.focus();
  };

  // A key the open menu takes: up and down move through it, Enter runs the item, Escape closes it (Crepe's keys).
  function menuKey(view: EditorView, event: KeyboardEvent): boolean {
    if (items.length === 0) return false;
    if (event.key === "Escape") close();
    else if (event.key === "ArrowDown") index = Math.min(index + 1, items.length - 1);
    else if (event.key === "ArrowUp") index = Math.max(index - 1, 0);
    else if (event.key === "Enter") choose(items[index] as BlockItem);
    else return false;
    report();
    refresh(view);
    return true;
  }

  editor
    .config((configured) => {
      ctx = configured;
      // Not inside a quote, as Crepe: a quote's paragraphs move with it.
      configured.set(blockConfig.key, {
        filterNodes: (pos) => findParent((node) => node.type.name === "blockquote")(pos) === undefined,
      });
      configured.set(block.key, { view: () => handleView(configured, options, (pos) => openAt(pos)) });
      configured.set(blockMenu.key, {
        props: {
          handleKeyDown: menuKey,
          // aria-activedescendant is one of a textbox's own attributes (WAI-ARIA 1.2); aria-expanded is not.
          attributes: (): Record<string, string> => {
            const active = items[index];
            return items.length === 0 || active === undefined
              ? {}
              : { "aria-activedescendant": options.optionId(active) };
          },
        },
        view: (view) => {
          slash = new SlashProvider({
            content: options.menu,
            root: options.menu.parentElement ?? undefined,
            debounce: 20,
            offset: 10,
            shouldShow(this: SlashProvider, shown) {
              const text = this.getContent(shown, (node) => ["paragraph", "heading"].includes(node.type.name));
              if (text === undefined || !atEndOfBlock(shown.state)) return false;
              if (addedAt !== null && shown.state.selection.from !== addedAt) addedAt = null;
              if (addedAt === null && !text.startsWith("/")) return false;
              filter = text.startsWith("/") ? text.slice(1) : text;
              const next = matching();
              if (next.join() !== items.join()) index = 0;
              items = next;
              return items.length > 0;
            },
          });
          // The editor's own attributes say whether the menu is open and which option is active: they are read again
          // on a view update, so one is sent (a transaction that changes nothing and is kept out of the history).
          slash.onShow = () => {
            report();
            refresh(view);
          };
          slash.onHide = () => {
            const was = items.length;
            items = [];
            report();
            if (was > 0) refresh(view);
          };
          slash.update(view);
          return { update: (updated, prev) => slash?.update(updated, prev), destroy: () => slash?.destroy() };
        },
      });
      configured.set(formatBar.key, {
        view: (view) =>
          barView(view, options, (shown, marks) => {
            bar = shown;
            on = marks;
            report();
          }),
      });
    })
    .use(block)
    .use(blockMenu)
    .use(formatBar);

  function openAt(pos: number) {
    addedAt = pos;
    filter = "";
    if (ctx !== undefined) slash?.update(ctx.get(editorViewCtx));
  }

  return {
    choose,
    format: (item) => {
      if (ctx === undefined) return;
      ctx.get(commandsCtx).call(BAR_COMMANDS[item].key);
      ctx.get(editorViewCtx).focus();
    },
  };
}

/** The side handle: placed beside the block under the pointer; its add button puts an empty line below that block. */
function handleView(ctx: Ctx, options: MenusOptions, openAt: (pos: number) => void) {
  const provider = new BlockProvider({
    ctx,
    content: options.handle,
    root: options.handle.parentElement ?? undefined,
    getOffset: () => 8,
    // A heading or a short block gets the handle at its middle, a long one at its first line (Crepe).
    getPlacement: ({ active, blockDom }) => {
      if (active.node.type.name === "heading") return "left";
      return blockDom.getBoundingClientRect().height < active.el.getBoundingClientRect().height ? "left-start" : "left";
    },
  });
  // A press on the add button is not a press on the handle, which would select its block (plugin-block mousedown).
  const hold = (event: PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const add = (event: PointerEvent) => {
    hold(event);
    const active = provider.active;
    if (active === null) return;
    const view = ctx.get(editorViewCtx);
    const pos = active.$pos.pos + active.node.nodeSize;
    const tr = view.state.tr.insert(pos, paragraphSchema.type(ctx).create());
    view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(pos))).scrollIntoView());
    view.focus();
    provider.hide();
    openAt(view.state.selection.from);
  };
  options.add.addEventListener("pointerdown", hold);
  options.add.addEventListener("pointerup", add);
  provider.update();
  return {
    update: () => provider.update(),
    destroy: () => {
      options.add.removeEventListener("pointerdown", hold);
      options.add.removeEventListener("pointerup", add);
      provider.destroy();
    },
  };
}

/** The floating bar: shown over words selected in the focused editor (Crepe toolbar shouldShow). */
function barView(view: EditorView, options: MenusOptions, onBar: (shown: boolean, on: ReadonlySet<BarItem>) => void) {
  const marks = (state: EditorState) => new Set(BAR_ITEMS.filter((item) => options.isOn(item, state)));
  const provider = new TooltipProvider({
    content: options.bar,
    root: options.bar.parentElement ?? undefined,
    debounce: 20,
    offset: 10,
    shouldShow(shown) {
      const { selection, doc } = shown.state;
      const focused = shown.hasFocus() || options.bar.contains(document.activeElement);
      return (
        focused &&
        shown.editable &&
        selection instanceof TextSelection &&
        !selection.empty &&
        doc.textBetween(selection.from, selection.to).length > 0
      );
    },
  });
  provider.onShow = () => onBar(true, marks(view.state));
  provider.onHide = () => onBar(false, new Set());
  provider.update(view);
  return {
    update: (updated: EditorView, prev?: EditorState) => {
      provider.update(updated, prev);
      if (options.bar.dataset.show === "true") onBar(true, marks(updated.state));
    },
    destroy: () => provider.destroy(),
  };
}
