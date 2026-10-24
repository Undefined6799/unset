// Blocks on a touch screen (Alex 2026-10-24 03:41Z: "a hold on it would select it and allow to delete and drag"). A
// finger held still on a block for HOLD_MS selects the whole block, as the handle's drag does with a mouse; lifted
// there, the block's menu opens (Delete); moved, the block follows the finger. Dropped on another block's middle it
// goes beside it as a column (columns.ts, the same rule as a mouse drop); dropped on the top or bottom of a block it
// moves before or after it. A finger that moves before the hold is a scroll, left to the browser.
//
// Touch events, not pointer events: once the hold has started, the finger's touchmove is cancelled so the page does
// not scroll under the drag, which needs a non-passive touchmove listener (a pointer event cannot stop a pan the
// browser has already claimed: it sends pointercancel). MDN was not reachable from the session that wrote this, so
// the no-scroll behaviour on iOS Safari and Android Chrome is unverified until a phone test proves it; Chromium's
// emulated touch passes (tests: the editor probe's hold, drag and drop).
import { selectBlock } from "./clipboard.ts";
import { type ColumnDrop, columnDropAt, dropIntoColumns, moveBlock, textBlockAt } from "./columns.ts";
import type { ReadmeEditor } from "./schema.ts";

/** How long a finger rests on a block before it is held (about a long press; Android's default is 400ms). */
const HOLD_MS = 450;
/** How far a finger may drift, in CSS pixels, and still be holding rather than scrolling. */
const SLOP = 10;

/** Where a held block would land: beside a block as a column, or before or after one. */
export type TouchDrop =
  | { readonly kind: "columns"; readonly drop: ColumnDrop }
  | { readonly kind: "move"; readonly target: string; readonly placement: "before" | "after"; readonly rect: DOMRect };

/** Where dropping `dragged` at (x, y) would put it, or null where it would not move. */
export function touchDropAt(editor: ReadmeEditor, dragged: string, x: number, y: number): TouchDrop | null {
  const element = document.elementFromPoint(x, y);
  const drop = columnDropAt(editor, dragged, element, x, y);
  if (drop !== null) return { kind: "columns", drop };
  const block = textBlockAt(element);
  if (block === null || block.id === dragged) return null;
  // Never into itself: a held list item carries its nested items.
  if (block.content.closest(`[data-node-type="blockContainer"][data-id="${CSS.escape(dragged)}"]`) !== null)
    return null;
  const rect = block.content.getBoundingClientRect();
  return { kind: "move", target: block.id, placement: y < rect.top + rect.height / 2 ? "before" : "after", rect };
}

export type HoldHandlers = {
  /** A block was held and let go without moving: open its menu. */
  readonly menu: (id: string) => void;
  /** The finger moved while holding: show where the block would land (null: nowhere). */
  readonly show: (drop: TouchDrop | null) => void;
};

/** Watches `outer` for holds on its blocks; returns the cleanup. */
export function watchBlockHolds(editor: ReadmeEditor, outer: HTMLElement, on: HoldHandlers): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start = { x: 0, y: 0 };
  let held: { id: string; drop: TouchDrop | null; moved: boolean } | null = null;
  const reset = () => {
    clearTimeout(timer);
    timer = undefined;
    held = null;
    on.show(null);
  };
  const touchStart = (event: TouchEvent) => {
    reset();
    const touch = event.touches[0];
    const block =
      event.touches.length === 1 ? textBlockAt(event.target instanceof Element ? event.target : null) : null;
    if (touch === undefined || block === null) return;
    start = { x: touch.clientX, y: touch.clientY };
    timer = setTimeout(() => {
      timer = undefined;
      if (selectBlock(editor, block.id)) held = { id: block.id, drop: null, moved: false };
    }, HOLD_MS);
  };
  const touchMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (touch === undefined) return;
    if (held === null) {
      if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > SLOP) clearTimeout(timer);
      return;
    }
    event.preventDefault();
    held.moved = true;
    held.drop = touchDropAt(editor, held.id, touch.clientX, touch.clientY);
    on.show(held.drop);
  };
  const touchEnd = (event: TouchEvent) => {
    const done = held;
    reset();
    if (done === null) return;
    // The lift ends the hold: no click, no caret placed where the finger was.
    event.preventDefault();
    if (!done.moved) return on.menu(done.id);
    if (done.drop?.kind === "columns") dropIntoColumns(editor, done.drop.drop);
    else if (done.drop?.kind === "move") moveBlock(editor, done.id, done.drop.target, done.drop.placement);
  };
  // A long press on Android also opens the context menu; while a block is held it is ours.
  const contextMenu = (event: Event) => {
    if (held !== null) event.preventDefault();
  };
  outer.addEventListener("touchstart", touchStart, { passive: true });
  outer.addEventListener("touchmove", touchMove, { passive: false });
  outer.addEventListener("touchend", touchEnd, { passive: false });
  outer.addEventListener("touchcancel", reset);
  outer.addEventListener("contextmenu", contextMenu);
  return () => {
    reset();
    outer.removeEventListener("touchstart", touchStart);
    outer.removeEventListener("touchmove", touchMove);
    outer.removeEventListener("touchend", touchEnd);
    outer.removeEventListener("touchcancel", reset);
    outer.removeEventListener("contextmenu", contextMenu);
  };
}
