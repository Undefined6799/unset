// The editor's own menus (ADR 0037 point 5): the text-style toolbar, the "/" block menu and the block handle. BlockNote
// 0.56.0 keeps their state in its core extensions (@blocknote/core src/extensions: FormattingToolbar, SuggestionMenu,
// SideMenu, each a store with `state` and `subscribe`); its React menus are not used, because they write raw HTML
// (GenericPopover's closing snapshot) which our Trusted Types policy refuses. Menus are placed through the CSSOM
// (element.style), which the CSP allows; an inline style attribute would be blocked.
import {
  FormattingToolbarExtension,
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
  SideMenuExtension,
  SuggestionMenu,
} from "@blocknote/core/extensions";
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { endBlockDrag, startBlockDrag } from "./clipboard.ts";
import styles from "./Editor.module.css";
import { EDITOR } from "./messages.ts";
import { type ReadmeEditor, type ReadmePartialBlock, TEXT_STYLES } from "./schema.ts";

type Store<T> = { readonly state: T; subscribe: (listener: () => void) => () => void };

function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.state,
  );
}

/** Puts `ref`'s element at a viewport position (`at`, from a DOMRect); null while the menu is hidden. The element is
 * absolutely placed in the editor, so the position is taken relative to the editor's box. */
function usePlace(ref: RefObject<HTMLElement | null>, at: { left: number; top: number } | null): void {
  useLayoutEffect(() => {
    const element = ref.current;
    const box = element?.offsetParent?.getBoundingClientRect();
    if (element === null || box === undefined || at === null) return;
    element.style.setProperty("left", `${Math.round(at.left - box.left)}px`);
    element.style.setProperty("top", `${Math.round(at.top - box.top)}px`);
  });
}

export function StyleToolbar({ editor }: { editor: ReadmeEditor }) {
  const shown = useStore(editor.getExtension(FormattingToolbarExtension)?.store as Store<boolean>);
  const [, render] = useState(0);
  useEffect(() => editor.onSelectionChange(() => render((n) => n + 1)), [editor]);
  const ref = useRef<HTMLDivElement>(null);
  const selection = shown ? window.getSelection() : null;
  const rect = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null;
  usePlace(ref, rect === null ? null : { left: rect.left, top: rect.top - 44 });
  if (!shown) return null;
  const active = editor.getActiveStyles();
  return (
    <div ref={ref} className={styles.toolbar} role="toolbar" aria-label={EDITOR.toolbar}>
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
    </div>
  );
}

type BlockItem = { title: string; block: ReadmePartialBlock };

const BLOCK_ITEMS: readonly BlockItem[] = [
  { title: EDITOR.blocks.paragraph, block: { type: "paragraph" } },
  { title: EDITOR.blocks.heading1, block: { type: "heading", props: { level: 1 } } },
  { title: EDITOR.blocks.heading2, block: { type: "heading", props: { level: 2 } } },
  { title: EDITOR.blocks.heading3, block: { type: "heading", props: { level: 3 } } },
  { title: EDITOR.blocks.bulletListItem, block: { type: "bulletListItem" } },
  { title: EDITOR.blocks.numberedListItem, block: { type: "numberedListItem" } },
  { title: EDITOR.blocks.checkListItem, block: { type: "checkListItem" } },
  { title: EDITOR.blocks.quote, block: { type: "quote" } },
  { title: EDITOR.blocks.codeBlock, block: { type: "codeBlock" } },
];

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
  const items = useMemo(() => filterSuggestionItems([...BLOCK_ITEMS], query ?? ""), [query]);
  const pick = (index: number) => {
    const item = items[index];
    if (item === undefined) return;
    menu?.closeMenu();
    menu?.clearQuery();
    insertOrUpdateBlockForSlashMenu(editor, item.block);
  };
  const selected = useMenuKeys(editor, query, items.length, pick);
  const ref = useRef<HTMLDivElement>(null);
  usePlace(ref, open ? { left: state.referencePos.left, top: state.referencePos.bottom + 4 } : null);
  if (!open) return null;
  // Focus stays in the editor while the menu is open (the keys above); options are reached by keys or the pointer.
  return (
    <div ref={ref} className={styles.menu} role="listbox" aria-label={EDITOR.slashMenu}>
      {items.map((item, index) => (
        <div
          key={item.title}
          role="option"
          tabIndex={-1}
          aria-selected={index === selected}
          className={styles.option}
          onMouseDown={(event) => {
            event.preventDefault();
            pick(index);
          }}
        >
          {item.title}
        </div>
      ))}
      {items.length === 0 ? <div className={styles.empty}>{EDITOR.noMatch}</div> : null}
    </div>
  );
}

export function BlockHandle({ editor }: { editor: ReadmeEditor }) {
  const side = editor.getExtension(SideMenuExtension);
  const state = useStore(
    side?.store as Store<{ show: boolean; referencePos: DOMRect; block: { id: string } } | undefined>,
  );
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => side?.setMenuElement(ref.current ?? undefined));
  const open = state?.show === true;
  usePlace(ref, open ? { left: state.referencePos.left - 72, top: state.referencePos.top } : null);
  if (!open) return null;
  const addBelow = () => {
    const [block] = editor.insertBlocks([{ type: "paragraph" }], state.block.id, "after");
    if (block === undefined) return;
    editor.setTextCursorPosition(block);
    editor.getExtension(SuggestionMenu)?.openSuggestionMenu("/");
  };
  return (
    <div ref={ref} className={styles.handle}>
      <button type="button" className={styles.tool} aria-label={EDITOR.addBlock} onClick={addBelow}>
        +
      </button>
      <button
        type="button"
        className={styles.tool}
        aria-label={EDITOR.dragBlock}
        draggable
        onDragStart={(event) => {
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
    </div>
  );
}
