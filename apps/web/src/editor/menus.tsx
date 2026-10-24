// The editor's own menus (ADR 0037 point 5): the text-style toolbar, the "/" block menu and the block handle. BlockNote
// 0.56.0 keeps their state in its core extensions (@blocknote/core src/extensions: FormattingToolbar, SuggestionMenu,
// SideMenu, each a store with `state` and `subscribe`); its React menus are not used, because they write raw HTML
// (GenericPopover's closing snapshot) which our Trusted Types policy refuses. Menus are placed through the CSSOM
// (element.style), which the CSP allows; an inline style attribute would be blocked.

import { getDefaultBlockTypeItems } from "@blocknote/core";
import {
  FormattingToolbarExtension,
  filterSuggestionItems,
  getDefaultSlashMenuItems,
  SideMenuExtension,
  SuggestionMenu,
} from "@blocknote/core/extensions";
import {
  Fragment,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { endBlockDrag, startBlockDrag } from "./clipboard.ts";
import styles from "./Editor.module.css";
import { EDITOR } from "./messages.ts";
import { ALIGNMENTS, type Alignment, type ReadmeEditor, type ReadmePartialBlock, TEXT_STYLES } from "./schema.ts";

type Store<T> = { readonly state: T; subscribe: (listener: () => void) => () => void };

function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.state,
  );
}

/** Puts `ref`'s element at a viewport position (`at`, from a DOMRect); null while the menu is hidden. The element is
 * absolutely placed in the editor, so the position is taken relative to the editor's box, and kept inside its width
 * (right-aligned text would otherwise push the toolbar past the page's edge). */
function usePlace(ref: RefObject<HTMLElement | null>, at: { left: number; top: number } | null): void {
  useLayoutEffect(() => {
    const element = ref.current;
    const box = element?.offsetParent?.getBoundingClientRect();
    if (element === null || box === undefined || at === null) return;
    const left = Math.max(0, Math.min(at.left - box.left, box.width - element.offsetWidth));
    element.style.setProperty("left", `${Math.round(left)}px`);
    element.style.setProperty("top", `${Math.round(at.top - box.top)}px`);
  });
}

/** Closes an open menu on a press outside `ref` or on Escape, as the sheet's Select closes. */
function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", onKey);
    };
  });
}

/** The block types the toolbar's type menu offers (BlockNote's block type select), plus the code block. */
function blockTypes(editor: ReadmeEditor) {
  const items: { key: string; type: string; props?: Record<string, boolean | number | string> }[] =
    getDefaultBlockTypeItems(editor);
  return [...items, { key: "code_block", type: "codeBlock" }];
}

function currentType(editor: ReadmeEditor) {
  const block = editor.getTextCursorPosition().block;
  return blockTypes(editor).find(
    (item) =>
      item.type === block.type &&
      (item.props?.level === undefined || item.props.level === (block.props as Record<string, unknown>).level),
  );
}

/** A link the README keeps: a plain http(s) address (domains/profile parseReadme drops any other). */
const isWebLink = (text: string) => /^https?:\/\/[^\s]+$/i.test(text.trim());

/**
 * The selection toolbar, laid out like BlockNote's (@blocknote/react 0.56.0 FormattingToolbar): the block type, the
 * text styles, and a link. The type menu and the link field stay open on our own state while they have focus, since
 * BlockNote's store hides the toolbar once focus leaves the text.
 */
/** The blocks the selection covers. A triple click selects a block up to the start of the next one, so a block the
 * selection only touches at its start is not one of them. */
function selectedBlocks(editor: ReadmeEditor) {
  const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
  const { $to, empty } = editor.prosemirrorView.state.selection;
  return !empty && $to.parentOffset === 0 && blocks.length > 1 ? blocks.slice(0, -1) : blocks;
}

export function StyleToolbar({ editor }: { editor: ReadmeEditor }) {
  const shown = useStore(editor.getExtension(FormattingToolbarExtension)?.store as Store<boolean>);
  const [, render] = useState(0);
  const [types, setTypes] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => editor.onSelectionChange(() => render((n) => n + 1)), [editor]);
  const ref = useRef<HTMLDivElement>(null);
  const at = useRef<{ left: number; top: number } | null>(null);
  const selection = shown ? window.getSelection() : null;
  const rect = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null;
  if (rect !== null) at.current = { left: rect.left, top: rect.top - 44 };
  const open = shown || types || link !== null;
  useDismiss(types || link !== null, ref, () => {
    setTypes(false);
    setLink(null);
  });
  usePlace(ref, open ? at.current : null);
  if (!open) return null;
  const active = editor.getActiveStyles();
  const current = currentType(editor);
  const back = () => {
    setTypes(false);
    setLink(null);
    editor.focus();
  };
  const selected = selectedBlocks(editor);
  // As BlockNote's TextAlignButton: only blocks with a textAlignment prop take one (a quote or a code block does not).
  const alignable = selected.filter((block) => "textAlignment" in block.props);
  const alignment = (alignable[0]?.props as { textAlignment?: string } | undefined)?.textAlignment ?? "left";
  const setAlignment = (value: Alignment) => {
    for (const block of alignable) editor.updateBlock(block, { props: { textAlignment: value } } as never);
    render((n) => n + 1);
    editor.focus();
  };
  const setType = (item: ReturnType<typeof blockTypes>[number]) => {
    const blocks = selected;
    for (const block of blocks) editor.updateBlock(block, { type: item.type, props: item.props ?? {} } as never);
    back();
  };
  const applyLink = () => {
    const url = link?.trim() ?? "";
    back();
    if (isWebLink(url)) editor.createLink(url);
  };
  const title = (key: string) => editor.dictionary.slash_menu[key as keyof typeof editor.dictionary.slash_menu].title;
  if (link !== null) {
    return (
      <div ref={ref} className={styles.toolbar} role="toolbar" aria-label={EDITOR.toolbar}>
        <input
          className={styles.linkField}
          type="url"
          aria-label={EDITOR.linkUrl}
          placeholder="https://"
          value={link}
          // biome-ignore lint/a11y/noAutofocus: the field opens on the Link button's press, which asked for it.
          autoFocus
          onChange={(event) => setLink(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") applyLink();
            else if (event.key === "Escape") back();
            else return;
            event.preventDefault();
          }}
        />
        <button type="button" className={styles.tool} onClick={applyLink} disabled={!isWebLink(link)}>
          {EDITOR.linkApply}
        </button>
      </div>
    );
  }
  return (
    <div ref={ref} className={styles.toolbar} role="toolbar" aria-label={EDITOR.toolbar}>
      <div className={styles.typePicker}>
        <button
          type="button"
          className={styles.tool}
          aria-label={EDITOR.blockType}
          aria-expanded={types}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setTypes((on) => !on)}
        >
          {current === undefined ? EDITOR.blockType : title(current.key)} ▾
        </button>
        {types ? (
          <div className={styles.typeMenu} role="menu" aria-label={EDITOR.blockType}>
            {blockTypes(editor).map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitemradio"
                aria-checked={item.key === current?.key}
                className={styles.typeItem}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setType(item)}
              >
                <span className={styles.chosen} aria-hidden="true">
                  {item.key === current?.key ? "→" : ""}
                </span>
                <span className={styles.glyph} aria-hidden="true">
                  {GLYPHS[item.key]}
                </span>
                {title(item.key)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <span className={styles.divider} aria-hidden="true" />
      {TEXT_STYLES.map((style) => (
        <button
          key={style}
          type="button"
          className={styles.tool}
          aria-label={EDITOR.styles[style]}
          aria-pressed={active[style] === true}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor.toggleStyles({ [style]: true })}
        >
          {EDITOR.marks[style]}
        </button>
      ))}
      {alignable.length > 0 ? (
        <>
          <span className={styles.divider} aria-hidden="true" />
          {ALIGNMENTS.map((value) => (
            <button
              key={value}
              type="button"
              className={styles.tool}
              aria-label={EDITOR.align[value]}
              aria-pressed={alignment === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setAlignment(value)}
            >
              <span className={styles.alignMark} data-align={value} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </button>
          ))}
        </>
      ) : null}
      <span className={styles.divider} aria-hidden="true" />
      <button
        type="button"
        className={styles.tool}
        aria-label={EDITOR.link}
        aria-pressed={editor.getSelectedLinkUrl() !== undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setLink(editor.getSelectedLinkUrl() ?? "")}
      >
        {EDITOR.linkMark}
      </button>
    </div>
  );
}

/** The "/" menu's items: BlockNote's own (title, subtext, aliases, group, shortcut badge), for the blocks the README
 * holds, each with a short glyph in its tile in place of BlockNote's React icons. */
const GLYPHS: Readonly<Record<string, string>> = {
  heading: "H1",
  heading_2: "H2",
  heading_3: "H3",
  quote: "\u201c",
  numbered_list: "1.",
  bullet_list: "\u2022",
  check_list: "[\u00d7]",
  paragraph: "T",
  code_block: "{ }",
};

/** BlockNote's shortcut ("Ctrl-Alt-1", "⌘-Alt-1") as the sheet's Kbd keys: one key each, symbols for modifiers on a
 * Mac, `ctrl` elsewhere (sheet components/Kbd and Search). */
function shortcutKeys(badge: string): string[] {
  const mac = badge.includes("⌘");
  const names: Readonly<Record<string, string>> = { Ctrl: "ctrl", Alt: mac ? "⌥" : "alt", Shift: "⇧" };
  return badge.split("-").map((key) => names[key] ?? key);
}

function slashItems(editor: ReadmeEditor, query: string) {
  const ours = getDefaultSlashMenuItems(editor).filter((item) => Object.hasOwn(GLYPHS, item.key));
  return filterSuggestionItems(ours, query);
}

/** The keys the open block menu takes from the editor: arrows move, Enter picks, Escape closes. The highlight goes
 * back to the first item whenever the query changes. */
function useMenuKeys(editor: ReadmeEditor, query: string | null, count: number, pick: (index: number) => void) {
  const [at, setAt] = useState({ query, index: 0 });
  const index = at.query === query ? Math.min(at.index, Math.max(count - 1, 0)) : 0;
  useEffect(() => {
    if (query === null) return;
    const onKey = (event: KeyboardEvent) => {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (step !== undefined && count > 0) setAt({ query, index: (index + step + count) % count });
      else if (event.key === "Enter" && count > 0) pick(index);
      else if (event.key === "Escape") editor.getExtension(SuggestionMenu)?.closeMenu();
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    const dom = editor.domElement;
    dom?.addEventListener("keydown", onKey, true);
    return () => dom?.removeEventListener("keydown", onKey, true);
  });
  return index;
}

export function BlockMenu({ editor }: { editor: ReadmeEditor }) {
  const menu = editor.getExtension(SuggestionMenu);
  const state = useStore(menu?.store as Store<{ show: boolean; query: string; referencePos: DOMRect } | undefined>);
  const open = state?.show === true;
  const query = open ? state.query : null;
  const items = useMemo(() => (query === null ? [] : slashItems(editor, query)), [editor, query]);
  const pick = (index: number) => {
    const item = items[index];
    if (item === undefined) return;
    menu?.closeMenu();
    menu?.clearQuery();
    item.onItemClick();
  };
  const selected = useMenuKeys(editor, query, items.length, pick);
  const ref = useRef<HTMLDivElement>(null);
  usePlace(ref, open ? { left: state.referencePos.left, top: state.referencePos.bottom + 4 } : null);
  useLayoutEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  });
  if (!open) return null;
  // Focus stays in the editor while the menu is open (the keys above); options are reached by keys or the pointer.
  return (
    <div ref={ref} className={styles.menu} role="listbox" aria-label={EDITOR.slashMenu}>
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {item.group !== undefined && item.group !== items[index - 1]?.group ? (
            <div className={styles.group} role="presentation">
              {item.group}
            </div>
          ) : null}
          <div
            role="option"
            tabIndex={-1}
            aria-selected={index === selected}
            className={styles.option}
            onMouseDown={(event) => {
              event.preventDefault();
              pick(index);
            }}
          >
            <span className={styles.glyph} aria-hidden="true">
              {GLYPHS[item.key]}
            </span>
            <span className={styles.label}>
              <span className={styles.title}>{item.title}</span>
              {item.subtext === undefined ? null : <span className={styles.subtext}>{item.subtext}</span>}
            </span>
            {item.badge === undefined ? null : (
              <span className={styles.keys}>
                {shortcutKeys(item.badge).map((key) => (
                  <kbd key={key} className={styles.key}>
                    {key}
                  </kbd>
                ))}
              </span>
            )}
          </div>
        </Fragment>
      ))}
      {items.length === 0 ? <div className={styles.empty}>{EDITOR.noMatch}</div> : null}
    </div>
  );
}

/**
 * The block handle, as BlockNote's side menu (@blocknote/react 0.56.0 SideMenu): + adds a block below and opens the
 * "/" menu; :: drags the block, and a click on it opens the block's menu (Alex 2026-10-23 23:30Z: delete from ::).
 * The side menu stays frozen on its block while that menu is open.
 */
export function BlockHandle({ editor }: { editor: ReadmeEditor }) {
  const side = editor.getExtension(SideMenuExtension);
  const state = useStore(
    side?.store as Store<{ show: boolean; referencePos: DOMRect; block: { id: string } } | undefined>,
  );
  const ref = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  useEffect(() => side?.setMenuElement(ref.current ?? undefined));
  const close = () => {
    setMenu(false);
    side?.unfreezeMenu();
  };
  useDismiss(menu, ref, close);
  const open = state?.show === true || menu;
  usePlace(ref, state?.show === true ? { left: state.referencePos.left - 72, top: state.referencePos.top } : null);
  if (!open || state === undefined) return null;
  const addBelow = () => {
    const [block] = editor.insertBlocks([{ type: "paragraph" }], state.block.id, "after");
    if (block === undefined) return;
    editor.setTextCursorPosition(block);
    editor.getExtension(SuggestionMenu)?.openSuggestionMenu("/");
  };
  const remove = () => {
    const id = state.block.id;
    close();
    editor.removeBlocks([id]);
    editor.focus();
  };
  return (
    <div ref={ref} className={styles.handle}>
      <button type="button" className={styles.tool} aria-label={EDITOR.addBlock} onClick={addBelow}>
        +
      </button>
      <button
        type="button"
        className={styles.tool}
        aria-label={EDITOR.blockMenu}
        aria-haspopup="menu"
        aria-expanded={menu}
        draggable
        onClick={() => {
          if (menu) return close();
          side?.freezeMenu();
          setMenu(true);
        }}
        onDragStart={(event) => {
          setMenu(false);
          side?.freezeMenu();
          startBlockDrag(editor, event.nativeEvent, state.block.id);
        }}
        onDragEnd={() => {
          endBlockDrag(editor);
          side?.unfreezeMenu();
        }}
      >
        ::
      </button>
      {menu ? (
        <div className={styles.blockMenu} role="menu" aria-label={EDITOR.blockMenu}>
          <button type="button" role="menuitem" className={styles.typeItem} onClick={remove}>
            {EDITOR.deleteBlock}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The line the caret is on (Alex 2026-10-23 23:22Z: "hard to find where the line is"): a bar beside that block,
 * drawn outside ProseMirror's own markup, so the editor's DOM stays its own. Hidden while the editor does not have
 * focus.
 */
export function CurrentLine({ editor }: { editor: ReadmeEditor }) {
  const ref = useRef<HTMLDivElement>(null);
  const [, render] = useState(0);
  useEffect(() => editor.onSelectionChange(() => render((n) => n + 1)), [editor]);
  useEffect(() => editor.onChange(() => render((n) => n + 1)), [editor]);
  useLayoutEffect(() => {
    const element = ref.current;
    const box = element?.offsetParent?.getBoundingClientRect();
    if (element === null || box === undefined) return;
    const id = editor.isFocused() ? editor.getTextCursorPosition().block.id : null;
    const block =
      id === null
        ? null
        : editor.domElement?.querySelector(
            `[data-node-type="blockContainer"][data-id="${CSS.escape(id)}"] > [data-content-type]`,
          );
    element.hidden = !(block instanceof HTMLElement);
    if (!(block instanceof HTMLElement)) return;
    const rect = block.getBoundingClientRect();
    element.style.setProperty("top", `${Math.round(rect.top - box.top)}px`);
    element.style.setProperty("height", `${Math.round(rect.height)}px`);
  });
  return <div ref={ref} className={styles.currentLine} aria-hidden="true" hidden />;
}
