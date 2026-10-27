import { useEffect, useRef } from "react";
import { moveBlockNextTo } from "./block-actions.ts";
import type { ReadmeEditor } from "./schema.ts";

type Point = { x: number; y: number };
type BlockTarget = { id: string; element: HTMLElement };
type Drop = BlockTarget & { placement: "before" | "after" };
type Gesture = BlockTarget & { pointerId: number; start: Point; armed: boolean; moved: boolean; drop: Drop | null };
type Tap = Point & { id: string; time: number };
const BLOCK = '[data-node-type="blockContainer"][data-id]';
const INTERACTIVE = 'a,button,input,textarea,select,summary,[role="button"],[role="link"],[contenteditable="false"]';
const point = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (rect: DOMRect, at: Point, x = 0, y = x) =>
  at.x >= rect.left - x && at.x <= rect.right + x && at.y >= rect.top - y && at.y <= rect.bottom + y;
const repeatedTap = (previous: Tap | null, next: Tap) =>
  previous && previous.id === next.id && next.time - previous.time <= 350 && distance(previous, next) <= 24;

/** Range rects cover the rendered text fragments, unlike the full-width paragraph box. */
function overText(element: HTMLElement, at: Point): boolean {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = element.ownerDocument.createRange();
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    range.selectNodeContents(text);
    for (const rect of range.getClientRects()) {
      if (inside(rect, at, 2)) return true;
    }
  }
  return false;
}

function backgroundBlock(editor: ReadmeEditor, event: PointerEvent): BlockTarget | null {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !editor.domElement?.contains(target) || target.closest(INTERACTIVE)) return null;
  const element = target.closest<HTMLElement>(BLOCK);
  const id = element?.dataset.id;
  if (!element || !id) return null;
  const block = editor.getBlock(id);
  if (!block || block.type === "column" || block.type === "columnList" || overText(element, point(event))) return null;
  return { id, element };
}

/** Only the source's siblings participate; a nested block cannot be dragged out of its parent. */
function dropAt(editor: ReadmeEditor, source: Gesture, at: Point): Drop | null {
  const siblings = editor.getParentBlock(source.id)?.children ?? editor.document;
  let nearest: Drop | null = null;
  let closest = Number.POSITIVE_INFINITY;
  for (const sibling of siblings) {
    const element = editor.domElement?.querySelector<HTMLElement>(`${BLOCK}[data-id="${CSS.escape(sibling.id)}"]`);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (!inside(rect, at, 0, 16)) continue;
    if (sibling.id === source.id && inside(rect, at)) return null;
    if (sibling.id === source.id) continue;
    const away = Math.max(rect.top - at.y, at.y - rect.bottom, 0);
    if (away >= closest) continue;
    closest = away;
    nearest = { id: sibling.id, element, placement: at.y < rect.top + rect.height / 2 ? "before" : "after" };
  }
  return nearest;
}

function listen(editor: ReadmeEditor, openBlock: (id: string) => void): () => void {
  const root = editor.domElement?.closest<HTMLElement>("[data-editor-root]");
  if (!root) return () => undefined;
  const page = root.ownerDocument;
  const pointers = new Set<number>();
  let gesture: Gesture | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let tap: Tap | null = null;
  let suppress: (Point & { until: number; element: HTMLElement }) | null = null;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
    const previous = gesture;
    gesture = null;
    previous?.element.removeAttribute("data-touch-dragging");
    previous?.drop?.element.removeAttribute("data-touch-drop");
    if (previous && root.hasPointerCapture?.(previous.pointerId)) root.releasePointerCapture(previous.pointerId);
  };
  const cancel = () => {
    clear();
    tap = null;
  };
  const down = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return;
    pointers.add(event.pointerId);
    if (pointers.size !== 1) return cancel();
    const block = backgroundBlock(editor, event);
    if (!block) return cancel();
    gesture = { ...block, pointerId: event.pointerId, start: point(event), armed: false, moved: false, drop: null };
    timer = setTimeout(() => {
      if (!gesture) return;
      gesture.armed = true;
      tap = null;
      gesture.element.dataset.touchDragging = "";
      // Pointer Events capture keeps updates coming after the finger leaves the original block.
      // https://w3c.github.io/pointerevents/#dom-element-setpointercapture
      root.setPointerCapture?.(gesture.pointerId);
    }, 450);
  };
  const move = (event: PointerEvent) => {
    const current = gesture;
    if (!current || current.pointerId !== event.pointerId) return;
    const at = point(event);
    if (!current.armed) {
      if (distance(current.start, at) > 8) cancel();
      return;
    }
    if (!current.moved && distance(current.start, at) <= 8) return;
    current.moved = true;
    current.drop?.element.removeAttribute("data-touch-drop");
    current.drop = dropAt(editor, current, at);
    if (current.drop) current.drop.element.dataset.touchDrop = current.drop.placement;
    if (event.cancelable) event.preventDefault();
  };
  const up = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    const current = gesture;
    if (!current || current.pointerId !== event.pointerId) return;
    clear();
    if (current.armed && current.moved) {
      suppress = { ...point(event), until: Date.now() + 500, element: current.element };
      if (current.drop) moveBlockNextTo(editor, current.id, current.drop.id, current.drop.placement);
      return;
    }
    if (current.armed) return;
    if (distance(current.start, point(event)) > 8) {
      tap = null;
      return;
    }
    const next = { ...point(event), id: current.id, time: Date.now() };
    if (repeatedTap(tap, next)) {
      tap = null;
      suppress = { ...point(event), until: Date.now() + 500, element: current.element };
      openBlock(current.id);
      return;
    }
    tap = next;
  };
  const aborted = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (gesture?.pointerId === event.pointerId) cancel();
  };
  const lostCapture = (event: PointerEvent) => {
    // Transferring the touch's implicit capture to root emits a bubbling loss on the original block first.
    // https://w3c.github.io/pointerevents/#process-pending-pointer-capture
    if (event.target === root) aborted(event);
  };
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape") cancel();
  };
  const touchmove = (event: TouchEvent) => {
    // A normal swipe never prevents scrolling. Only a stationary, eligible hold takes over the gesture.
    // https://w3c.github.io/touch-events/#the-touchmove-event
    if (gesture?.armed && event.cancelable) event.preventDefault();
  };
  const context = (event: MouseEvent) => {
    if (gesture?.armed && event.target instanceof Node && gesture.element.contains(event.target))
      event.preventDefault();
  };
  const compatibility = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      suppress &&
      Date.now() < suppress.until &&
      event.detail > 0 &&
      target &&
      !target.closest(INTERACTIVE) &&
      (target === root || suppress.element.contains(target)) &&
      distance(suppress, { x: event.clientX, y: event.clientY }) <= 24
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  page.addEventListener("pointerdown", down, true);
  page.addEventListener("pointermove", move, true);
  page.addEventListener("pointerup", up, true);
  page.addEventListener("pointercancel", aborted, true);
  root.addEventListener("lostpointercapture", lostCapture);
  page.addEventListener("keydown", key);
  page.addEventListener("touchmove", touchmove, { passive: false, capture: true });
  root.addEventListener("contextmenu", context, true);
  root.addEventListener("click", compatibility, true);
  root.addEventListener("dblclick", compatibility, true);
  return () => {
    cancel();
    page.removeEventListener("pointerdown", down, true);
    page.removeEventListener("pointermove", move, true);
    page.removeEventListener("pointerup", up, true);
    page.removeEventListener("pointercancel", aborted, true);
    root.removeEventListener("lostpointercapture", lostCapture);
    page.removeEventListener("keydown", key);
    page.removeEventListener("touchmove", touchmove, true);
    root.removeEventListener("contextmenu", context, true);
    root.removeEventListener("click", compatibility, true);
    root.removeEventListener("dblclick", compatibility, true);
  };
}

/** Custom gestures start on block backgrounds; native text selection, links and ordinary scroll keep their events. */
export function useTouchBlockGestures(editor: ReadmeEditor, active: boolean, openBlock: (id: string) => void): void {
  const callback = useRef(openBlock);
  callback.current = openBlock;
  useEffect(() => {
    if (!active) return;
    let cleanup: () => void = () => undefined;
    const attach = () => {
      cleanup();
      cleanup = listen(editor, (id) => callback.current(id));
    };
    const unmount = editor.onUnmount(() => cleanup());
    const mount = editor.onMount(attach);
    attach();
    return () => {
      mount();
      unmount();
      cleanup();
    };
  }, [editor, active]);
}
