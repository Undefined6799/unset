// The block editor (ADR 0037 point 5): BlockNote 0.56.0's core engine (@blocknote/core, BlockNoteEditor.create and
// mount, src/editor/BlockNoteEditor.ts) with our own menus, and no HTML anywhere (clipboard.ts). Not README-specific
// beyond its schema, so another owner-only editor can reuse it.
import { BlockNoteEditor } from "@blocknote/core";
import { SuggestionMenu } from "@blocknote/core/extensions";
import { useEffect, useRef, useState } from "react";
import { type Copied, copySelection, pasteText } from "./clipboard.ts";
import styles from "./Editor.module.css";
import { BlockHandle, BlockMenu, StyleToolbar } from "./menus.tsx";
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
    pasteHandler: ({ event, editor }) => {
      pasteText(editor, event.clipboardData?.getData("text/plain") ?? "", copied.current);
      return true;
    },
  });
}

export function BlockEditor({ initialContent, onReady, label }: BlockEditorProps) {
  const copied = useRef<Copied | null>(null);
  const ready = useRef(onReady);
  const [editor] = useState(() => createEditor(initialContent, copied));
  const mount = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
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
    ready.current(editor);
    return () => {
      outer.removeEventListener("copy", onCopy, true);
      outer.removeEventListener("cut", onCopy, true);
      editor.unmount();
    };
  }, [editor, label]);
  return (
    <div ref={area} className={styles.editor}>
      <div ref={mount} />
      <StyleToolbar editor={editor} />
      <BlockMenu editor={editor} />
      <BlockHandle editor={editor} />
    </div>
  );
}
