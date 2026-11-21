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
  linkSchema,
  orderedListSchema,
  paragraphSchema,
  setBlockTypeCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  updateLinkCommand,
  wrapInBlockTypeCommand,
} from "@milkdown/preset-commonmark";
import { findParent, posToDOMRect } from "@milkdown/prose";
import type { NodeType } from "@milkdown/prose/model";
import { type EditorState, Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/prose/view";
import { $prose } from "@milkdown/utils";
import { type SafeHref, safeHref } from "@unset/shared-safe-href";

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
export const BAR_ITEMS = ["strong", "emphasis", "code", "link"] as const;
export type BarItem = (typeof BAR_ITEMS)[number];

export type MenusState = {
  /** The block menu's items matching what follows the "/", and the one Enter runs; empty when it is closed. */
  readonly items: readonly BlockItem[];
  readonly index: number;
  readonly bar: boolean;
  /** Which of the bar's marks the selected words carry. */
  readonly on: ReadonlySet<BarItem>;
  /** The link editor (its field's words, and whether the last address was refused) or the link preview, if open. */
  readonly link: LinkState | null;
};

export type LinkState =
  | { readonly mode: "edit"; readonly value: string; readonly refused: boolean }
  /** The stored address, and the same through safeHref when the page shows it as a link (else it is only words). */
  | { readonly mode: "preview"; readonly href: string; readonly safe: SafeHref | null };

export type MenusOptions = {
  /** The elements the plugins place: the handle (holding the add button and the grip), the block menu and the bar. */
  readonly handle: HTMLElement;
  readonly add: HTMLElement;
  readonly menu: HTMLElement;
  readonly bar: HTMLElement;
  /** The link editor, holding its address field, and the preview a pointer over a link shows. */
  readonly linkEdit: HTMLElement;
  readonly linkPreview: HTMLElement;
  /** What an empty line with the caret says. */
  readonly hint: string;
  readonly labels: Readonly<Record<BlockItem, string>>;
  /** The id of an item's option, for the editor's aria-activedescendant. */
  readonly optionId: (item: BlockItem) => string;
  readonly onState: (state: MenusState) => void;
  /** Whether a bar mark is on for the selection (milkdown.ts isActive). */
  readonly isOn: (item: Exclude<BarItem, "link">, state: EditorState) => boolean;
};

export type Menus = {
  /** Runs the block menu's item: the "/" and what follows it go, and the block becomes the item. */
  readonly choose: (item: BlockItem) => void;
  readonly format: (item: BarItem) => void;
  /** The link editor's address: set on the words when the page would show it as a link, else refused. */
  readonly confirmLink: (address: string) => void;
  readonly cancelLink: () => void;
  /** The previewed link: opened in the link editor, or taken off its words. */
  readonly editLink: () => void;
  readonly removeLink: () => void;
};

/** Milkdown's context, as Editor.config hands it over (@milkdown/ctx, which apps/web does not depend on directly). */
type Ctx = Parameters<Parameters<Editor["config"]>[0]>[0];

const blockMenu = slashFactory("UNSET_BLOCK_MENU");
const formatBar = tooltipFactory("UNSET_FORMAT_BAR");
const linkTips = tooltipFactory("UNSET_LINK");
/** What the page shows as a link (lib/profile/parse.ts). */
const WEB = ["http:", "https:"] as const;
/** How long a pointer rests before the link preview follows it (Crepe's link-tooltip DELAY). */
const HOVER_MS = 50;

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

function hasLink(ctx: Ctx, state: EditorState): boolean {
  return state.doc.rangeHasMark(state.selection.from, state.selection.to, linkSchema.type(ctx));
}

/** The linked words under the page point (x, y): the text they are, its address (Crepe link-tooltip utils.ts). */
function linkAt(ctx: Ctx, view: EditorView, x: number, y: number) {
  const found = view.posAtCoords({ left: x, top: y });
  if (found === null) return null;
  const node = view.state.doc.nodeAt(found.pos);
  const mark = node?.marks.find((each) => each.type === linkSchema.type(ctx));
  if (node == null || mark === undefined) return null;
  const from = found.pos - view.state.doc.resolve(found.pos).textOffset;
  return { from, to: from + node.nodeSize, href: String(mark.attrs.href) };
}

/**
 * An empty line with the caret says what to type, drawn by the page and never part of the words (Crepe 7.23.0
 * feature/placeholder, block mode; Milkdown ships no placeholder plugin). Not in a code block or a list, as Crepe.
 */
const placeholder = (hint: string) =>
  $prose(
    () =>
      new Plugin({
        key: new PluginKey("UNSET_PLACEHOLDER"),
        props: {
          decorations: (state) => {
            const { selection } = state;
            const { $anchor } = selection;
            const line = $anchor.parent;
            if (!selection.empty || $anchor.depth === 0 || line.content.size > 0) return null;
            if (line.type.name === "code_block" || findParent((node) => node.type.name === "list_item")($anchor)) {
              return null;
            }
            const before = $anchor.before();
            const shown = Decoration.node(before, before + line.nodeSize, { "data-placeholder": hint });
            return DecorationSet.create(state.doc, [shown]);
          },
        },
      }),
  );

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
  let link: LinkState | null = null;
  /** The linked words the link editor or preview is for, and whether they carried a link already. */
  let linked: { from: number; to: number; existing: boolean } | null = null;
  let linkTip: ReturnType<typeof linkView> | undefined;
  let barTip: ReturnType<typeof barView> | undefined;
  /** Where the handle's add button opened the menu: it stays open on that empty line until the caret leaves it. */
  let addedAt: number | null = null;
  let slash: SlashProvider | undefined;

  const report = () => options.onState({ items, index, bar, on, link });
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
        view: (view) => {
          barTip = barView(
            configured,
            view,
            options,
            () => link?.mode === "edit",
            (shown, marks) => {
              bar = shown;
              on = marks;
              report();
            },
          );
          return barTip;
        },
      });
      let resting = 0;
      configured.set(linkTips.key, {
        props: {
          handleDOMEvents: {
            mousemove: (view, event) => {
              clearTimeout(resting);
              resting = window.setTimeout(() => hover(view, event.clientX, event.clientY), HOVER_MS);
              return false;
            },
            mouseleave: () => {
              clearTimeout(resting);
              resting = window.setTimeout(() => linkTip?.leave(), HOVER_MS);
              return false;
            },
          },
        },
        view: (view) => {
          linkTip = linkView(view, options);
          linkTip.edit.onHide = () => {
            if (link?.mode !== "edit") return;
            stopOutside();
            link = null;
            linked = null;
            report();
          };
          linkTip.preview.onHide = () => {
            if (link?.mode !== "preview") return;
            link = null;
            linked = null;
            report();
          };
          return {
            // The editor closes when the selection leaves its words (Crepe link-edit update).
            update: (updated) => {
              const { from, to } = updated.state.selection;
              if (link?.mode === "edit" && (from !== linked?.from || to !== linked?.to)) linkTip?.edit.hide();
            },
            destroy: () => {
              clearTimeout(resting);
              stopOutside();
              linkTip?.destroy();
            },
          };
        },
      });
    })
    .use(block)
    .use(blockMenu)
    .use(formatBar)
    .use(linkTips)
    .use(placeholder(options.hint));

  // A press outside the link editor closes it, keeping the words as they were (Crepe link-edit).
  function outside(event: PointerEvent) {
    if (event.target instanceof Node && options.linkEdit.contains(event.target)) return;
    linkTip?.edit.hide();
  }
  const stopOutside = () => document.removeEventListener("pointerdown", outside, true);

  function hover(view: EditorView, x: number, y: number) {
    if (ctx === undefined || !view.hasFocus() || link?.mode === "edit") return;
    const found = linkAt(ctx, view, x, y);
    if (found === null) {
      linkTip?.leave();
      return;
    }
    linked = { from: found.from, to: found.to, existing: true };
    link = { mode: "preview", href: found.href, safe: safeHref(found.href, WEB) };
    report();
    linkTip?.preview.show({ getBoundingClientRect: () => posToDOMRect(view, found.from, found.to) }, view);
  }

  /** Opens the link editor over the words from..to, which it selects, with `value` in its field (Crepe link-edit). */
  function openLink(from: number, to: number, value: string, existing: boolean) {
    if (ctx === undefined || linkTip === undefined) return;
    const view = ctx.get(editorViewCtx);
    linkTip.preview.hide();
    // Set first, so the selection below keeps the editor open and the bar stays away while it is.
    linked = { from, to, existing };
    link = { mode: "edit", value, refused: false };
    report();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    barTip?.hide();
    linkTip.edit.show({ getBoundingClientRect: () => posToDOMRect(view, from, to) }, view);
    document.addEventListener("pointerdown", outside, true);
    requestAnimationFrame(() => options.linkEdit.querySelector("input")?.focus());
  }

  // The bar comes back over the words the editor was for: they are still selected, so no change would show it.
  function closeLink() {
    linkTip?.edit.hide();
    if (ctx === undefined) return;
    const view = ctx.get(editorViewCtx);
    view.focus();
    barTip?.update(view);
  }

  function openAt(pos: number) {
    addedAt = pos;
    filter = "";
    if (ctx !== undefined) slash?.update(ctx.get(editorViewCtx));
  }

  return {
    choose,
    format: (item) => {
      if (ctx === undefined) return;
      const view = ctx.get(editorViewCtx);
      if (item !== "link") ctx.get(commandsCtx).call(BAR_COMMANDS[item].key);
      // Link on linked words takes the link off them; on others it opens the link editor (Crepe toggleLinkCommand).
      else if (!hasLink(ctx, view.state)) {
        openLink(view.state.selection.from, view.state.selection.to, "", false);
        return;
      } else ctx.get(commandsCtx).call(toggleLinkCommand.key);
      view.focus();
    },
    confirmLink: (address) => {
      if (ctx === undefined || linked === null) return;
      // Only what the page shows as a link (safeHref, http and https): anything else would be saved as plain words.
      const href = safeHref(address.trim(), WEB);
      if (href === null) {
        link = { mode: "edit", value: address, refused: true };
        report();
        return;
      }
      ctx.get(commandsCtx).call(linked.existing ? updateLinkCommand.key : toggleLinkCommand.key, { href });
      closeLink();
    },
    cancelLink: closeLink,
    editLink: () => {
      if (link?.mode === "preview" && linked !== null) openLink(linked.from, linked.to, link.href, true);
    },
    removeLink: () => {
      if (ctx === undefined || linked === null) return;
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.removeMark(linked.from, linked.to, linkSchema.type(ctx)));
      linkTip?.preview.hide();
      view.focus();
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
function barView(
  ctx: Ctx,
  view: EditorView,
  options: MenusOptions,
  editingLink: () => boolean,
  onBar: (shown: boolean, on: ReadonlySet<BarItem>) => void,
) {
  const marks = (state: EditorState) =>
    new Set(BAR_ITEMS.filter((item) => (item === "link" ? hasLink(ctx, state) : options.isOn(item, state))));
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
        !editingLink() &&
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
    hide: () => provider.hide(),
    destroy: () => provider.destroy(),
  };
}

/**
 * The link editor and the link preview, each placed by plugin-tooltip over the linked words and shown only when asked
 * (Crepe 7.23.0 link-tooltip, @milkdown/components edit-view.ts and preview-view.ts). The preview stays while the
 * pointer is on it.
 */
function linkView(view: EditorView, options: MenusOptions) {
  const placed = (content: HTMLElement) => {
    const provider = new TooltipProvider({
      content,
      root: content.parentElement ?? undefined,
      debounce: 0,
      offset: 10,
      shouldShow: () => false,
    });
    provider.update(view);
    return provider;
  };
  const edit = placed(options.linkEdit);
  const preview = placed(options.linkPreview);
  let over = false;
  const enter = () => {
    over = true;
  };
  const leave = () => {
    over = false;
    preview.hide();
  };
  options.linkPreview.addEventListener("mouseenter", enter);
  options.linkPreview.addEventListener("mouseleave", leave);
  return {
    edit,
    preview,
    /** The pointer left the linked words: the preview goes unless the pointer went onto it. */
    leave: () => {
      if (!over) preview.hide();
    },
    destroy: () => {
      options.linkPreview.removeEventListener("mouseenter", enter);
      options.linkPreview.removeEventListener("mouseleave", leave);
      edit.destroy();
      preview.destroy();
    },
  };
}
