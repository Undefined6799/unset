import { useCallback, useEffect, useId, useRef, useState } from "react";
import { moveBlock } from "./block-actions.ts";
import styles from "./Editor.module.css";
import { EDITOR } from "./messages.ts";
import type { ReadmeEditor, ReadmePartialBlock } from "./schema.ts";
import { useTouchBlockGestures } from "./touch-gestures.ts";

const insertions: { label: string; block: ReadmePartialBlock }[] = [
  { label: EDITOR.blocks.paragraph, block: { type: "paragraph" } },
  { label: EDITOR.blocks.heading1, block: { type: "heading", props: { level: 1 } } },
  { label: EDITOR.blocks.heading2, block: { type: "heading", props: { level: 2 } } },
  { label: EDITOR.blocks.heading3, block: { type: "heading", props: { level: 3 } } },
  { label: EDITOR.blocks.bulletListItem, block: { type: "bulletListItem" } },
  { label: EDITOR.blocks.numberedListItem, block: { type: "numberedListItem" } },
  { label: EDITOR.blocks.checkListItem, block: { type: "checkListItem" } },
  { label: EDITOR.blocks.quote, block: { type: "quote" } },
  { label: EDITOR.blocks.codeBlock, block: { type: "codeBlock" } },
];

/** Phone layouts and touch input use an action sheet, without desktop hover/drag handles. */
export function TouchBlocks({ editor, active }: { editor: ReadmeEditor; active: boolean }) {
  const [blockId, setBlockId] = useState<string | null>(null);
  const [inserting, setInserting] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const open = useCallback((id: string) => {
    setInserting(false);
    setBlockId(id);
  }, []);
  useTouchBlockGestures(editor, active, open);
  useEffect(() => {
    const element = dialog.current;
    if (blockId) element?.showModal();
    else element?.close();
  }, [blockId]);
  const close = () => {
    dialog.current?.close();
    setBlockId(null);
    editor.focus();
  };
  const perform = (action: (id: string) => void) => {
    if (!blockId) return;
    const id = blockId;
    close();
    action(id);
    editor.focus();
  };
  if (!active && !blockId) return null;
  return (
    <>
      <button
        className={`${styles.tool} ${styles.touchBlocksButton}`}
        type="button"
        aria-haspopup="dialog"
        onClick={() => open(editor.getTextCursorPosition().block.id)}
      >
        {EDITOR.blockActions}
      </button>
      <dialog
        ref={dialog}
        className={styles.blockSheet}
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <div className={styles.sheetHeader}>
          <h2 id={titleId}>{inserting ? EDITOR.addBlock : EDITOR.blockActions}</h2>
          <button type="button" className={styles.tool} onClick={close}>
            {EDITOR.done}
          </button>
        </div>
        {inserting ? (
          <div className={styles.sheetActions}>
            {insertions.map((item) => (
              <button
                key={item.label}
                type="button"
                className={styles.typeItem}
                onClick={() =>
                  perform((id) => {
                    const [added] = editor.insertBlocks([item.block], id, "after");
                    if (added) editor.setTextCursorPosition(added);
                  })
                }
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.sheetActions}>
            <button type="button" className={styles.typeItem} onClick={() => setInserting(true)}>
              {EDITOR.addBlock}
            </button>
            <button
              type="button"
              className={styles.typeItem}
              disabled={!blockId || !editor.getPrevBlock(blockId)}
              onClick={() => perform((id) => moveBlock(editor, id, "up"))}
            >
              {EDITOR.moveUp}
            </button>
            <button
              type="button"
              className={styles.typeItem}
              disabled={!blockId || !editor.getNextBlock(blockId)}
              onClick={() => perform((id) => moveBlock(editor, id, "down"))}
            >
              {EDITOR.moveDown}
            </button>
            <button
              type="button"
              className={`${styles.typeItem} ${styles.deleteAction}`}
              onClick={() => perform((id) => editor.removeBlocks([id]))}
            >
              {EDITOR.deleteBlock}
            </button>
          </div>
        )}
        <p className={styles.gestureHint}>{EDITOR.gestureHint}</p>
      </dialog>
    </>
  );
}
