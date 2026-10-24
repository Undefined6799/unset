// The block editor (ADR 0037 point 5): BlockNote 0.56.0's core engine (@blocknote/core, BlockNoteEditor.create and
// mount, src/editor/BlockNoteEditor.ts) with our own menus, and no HTML anywhere (clipboard.ts). Not README-specific
// beyond its schema, so another owner-only editor can reuse it.
import { BlockNoteEditor } from "@blocknote/core";
import { SuggestionMenu } from "@blocknote/core/extensions";
import { useEffect, useRef, useState } from "react";
import { type Copied, copySelection, endBlockDrag, pasteText } from "./clipboard.ts";
import { columnDrop, dropIntoColumns, normalizeColumns } from "./columns.ts";
import styles from "./Editor.module.css";
import { BlockHandle, BlockMenu, CurrentLine, StyleToolbar } from "./menus.tsx";
import { EDITOR } from "./messages.ts";
import { type ReadmeEditor, type ReadmePartialBlock, readmeSchema } from "./schema.ts";

export type BlockEditorProps = {
  /** The document to start from; empty for a new one. */
  initialContent: readonly ReadmePartialBlock[];
  /** Called once the editor is mounted, so the page can read its document on submit. */
  onReady: (editor: ReadmeEditor) => void;
  /** The accessible name of the editing area. */
  label: string;
};

function createEditor(initialContent: readonly ReadmePartialBlock[], copied: { current: Copied | null }) {
  return BlockNoteEditor.create({
    schema: readmeSchema,
    ...(initialContent.length > 0 ? { initialContent: [...initialContent] } : {}),
    // TipTap would inject its stylesheet through innerHTML (Trusted Types refuses it); Editor.module.css has the rules.
    _tiptapOptions: { injectCSS: false },
    // The placeholder extension appends a <style> element (@blocknote/core 0.56.0 src/extensions/Placeholder/
    // Placeholder.ts), which the CSP's style-src refuses; disableExtensions takes its key (BlockNoteEditor.ts:115).
    disableExtensions: ["placeholder"],
    pasteHandler: ({ event, editor }) => {
      pasteText(editor, event.clipboardData?.getData("text/plain") ?? "", copied.current);
      return true;
    },
  });
}

/** Puts an overlay over `rect` (viewport coordinates), relative to the editor's box. */
function placeOver(
  element: HTMLElement,
  box: DOMRect,
  rect: { left: number; top: number; width: number; height: number },
) {
  element.hidden = false;
  element.style.setProperty("left", `${Math.round(rect.left - box.left)}px`);
  element.style.setProperty("top", `${Math.round(rect.top - box.top)}px`);
  element.style.setProperty("width", `${Math.round(rect.width)}px`);
  element.style.setProperty("height", `${Math.round(rect.height)}px`);
}

/**
 * Takes a handle drag's dragover and drop before ProseMirror when it lands on a block (columns.ts): the block it would
 * pair with is outlined (Alex 2026-10-24 00:04Z) and a bar marks the side the new column goes; any other drop stays
 * ProseMirror's move. Both are overlays, so ProseMirror's own DOM is never touched. Returns the cleanup.
 */
function watchColumnDrops(
  editor: ReadmeEditor,
  outer: HTMLElement,
  marks: readonly (HTMLElement | null)[],
): () => void {
  const [bar, target] = marks;
  const hide = () => {
    for (const mark of marks) if (mark !== null) mark.hidden = true;
  };
  const over = (event: DragEvent) => {
    const drop = columnDrop(editor, event);
    if (drop === null) return hide();
    event.preventDefault();
    event.stopPropagation();
    const box = outer.getBoundingClientRect();
    if (target) placeOver(target, box, drop.rect);
    const x = drop.side === "left" ? drop.rect.left : drop.rect.right;
    if (bar) placeOver(bar, box, { left: x, top: drop.rect.top, width: 2, height: drop.rect.height });
  };
  const drop = (event: DragEvent) => {
    hide();
    const target = columnDrop(editor, event);
    if (target === null) return;
    event.preventDefault();
    event.stopPropagation();
    dropIntoColumns(editor, target);
    endBlockDrag(editor);
  };
  outer.addEventListener("dragover", over, true);
  outer.addEventListener("drop", drop, true);
  outer.addEventListener("dragleave", hide, true);
  outer.addEventListener("dragend", hide, true);
  return () => {
    outer.removeEventListener("dragover", over, true);
    outer.removeEventListener("drop", drop, true);
    outer.removeEventListener("dragleave", hide, true);
    outer.removeEventListener("dragend", hide, true);
  };
}

export function BlockEditor({ initialContent, onReady, label }: BlockEditorProps) {
  const copied = useRef<Copied | null>(null);
  const ready = useRef(onReady);
  const [editor] = useState(() => createEditor(initialContent, copied));
  const mount = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLDivElement>(null);
  const pairing = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = mount.current;
    const outer = area.current;
    if (element === null || outer === null) return;
    editor.mount(element);
    editor.getExtension(SuggestionMenu)?.addSuggestionMenu({ triggerCharacter: "/" });
    element.setAttribute("aria-label", label);
    // Captured on the wrapper, so BlockNote's own copy handler on the editor element never runs.
    const onCopy = (event: ClipboardEvent) => {
      copied.current = copySelection(editor, event);
    };
    outer.addEventListener("copy", onCopy, true);
    outer.addEventListener("cut", onCopy, true);
    outer.style.setProperty("--editor-placeholder", JSON.stringify(EDITOR.placeholder));
    const stopColumns = watchColumnDrops(editor, outer, [indicator.current, pairing.current]);
    const stopNormalize = editor.onChange(() => normalizeColumns(editor));
    ready.current(editor);
    return () => {
      stopColumns();
      stopNormalize();
      outer.removeEventListener("copy", onCopy, true);
      outer.removeEventListener("cut", onCopy, true);
      editor.unmount();
    };
  }, [editor, label]);
  return (
    <div ref={area} className={styles.editor}>
      <CurrentLine editor={editor} />
      <div ref={pairing} className={styles.columnTarget} aria-hidden="true" hidden />
      <div ref={indicator} className={styles.columnDrop} aria-hidden="true" hidden />
      <div ref={mount} />
      <StyleToolbar editor={editor} />
      <BlockMenu editor={editor} />
      <BlockHandle editor={editor} />
    </div>
  );
}
