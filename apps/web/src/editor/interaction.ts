import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReadmeEditor } from "./schema.ts";

type Rect = { left: number; top: number; width: number; height: number };
type Placement = "above" | "below" | "side" | "dock";
type Keyboard = { width: number; height: number; open: boolean };
export type EditorInput = { touch: boolean; compact: boolean; focused: boolean; keyboardOpen: boolean; viewport: Rect };

// Match BlockNote 0.56's zoom-adjusted keyboard heuristic, resetting on orientation changes.
// https://github.com/TypeCellOS/BlockNote/blob/v0.56.0/packages/react/src/components/FormattingToolbar/useVirtualKeyboard.ts
export function keyboardState(previous: Keyboard | null, width: number, height: number, scale: number): Keyboard {
  const visibleHeight = height * scale;
  const reset = !previous || Math.abs(width - previous.width) > previous.width * 0.2;
  const baseline = reset ? visibleHeight : Math.max(previous.height, visibleHeight);
  return { width, height: baseline, open: baseline - visibleHeight > 150 };
}

function viewportRect(): Rect {
  const view = window.visualViewport;
  return view
    ? { left: view.offsetLeft, top: view.offsetTop, width: view.width, height: view.height }
    : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

/** Modality follows the last pointer; phone layouts keep compact controls even with a mouse. */
export function useEditorInput(editor: ReadmeEditor): EditorInput {
  const [input, setInput] = useState<EditorInput>(() => {
    const touch = typeof window !== "undefined" && !!window.matchMedia?.("(any-pointer: coarse)").matches;
    return {
      touch,
      compact: touch || (typeof window !== "undefined" && window.innerWidth < 768),
      focused: false,
      keyboardOpen: false,
      viewport: typeof window === "undefined" ? { left: 0, top: 0, width: 0, height: 0 } : viewportRect(),
    };
  });
  useEffect(() => {
    const media = window.matchMedia?.("(any-pointer: coarse)");
    const visual = window.visualViewport;
    let touch = media?.matches ?? false;
    let pointerChosen = false;
    let mounted = true;
    let keyboard: Keyboard | null = null;
    const update = () => {
      if (!mounted) return;
      const viewport = viewportRect();
      keyboard = keyboardState(keyboard, window.innerWidth, viewport.height, visual?.scale ?? 1);
      const element = editor.domElement;
      const root = element?.closest("[data-editor-root]") ?? element;
      const focused = !!root?.contains(document.activeElement);
      const next = {
        touch,
        compact: touch || window.innerWidth < 768,
        focused,
        keyboardOpen: touch && focused && keyboard.open,
        viewport,
      };
      setInput((old) =>
        old.touch === next.touch &&
        old.compact === next.compact &&
        old.focused === next.focused &&
        old.keyboardOpen === next.keyboardOpen &&
        old.viewport.left === viewport.left &&
        old.viewport.top === viewport.top &&
        old.viewport.width === viewport.width &&
        old.viewport.height === viewport.height
          ? old
          : next,
      );
    };
    const pointer = (event: PointerEvent) => {
      if (!["mouse", "touch", "pen"].includes(event.pointerType)) return;
      pointerChosen = true;
      touch = event.pointerType !== "mouse";
      update();
    };
    const change = () => {
      if (!pointerChosen) touch = media?.matches ?? false;
      update();
    };
    const blur = (event: FocusEvent) => {
      const element = editor.domElement;
      const root = element?.closest("[data-editor-root]") ?? element;
      // Native tabbing exposes BODY between focusout and focusin. Keep the destination control mounted.
      if (event.relatedTarget instanceof Node && root?.contains(event.relatedTarget)) return;
      queueMicrotask(update);
    };
    const unmount = editor.onMount(update);
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", blur);
    window.addEventListener("resize", update);
    visual?.addEventListener("resize", update);
    visual?.addEventListener("scroll", update);
    media?.addEventListener("change", change);
    update();
    return () => {
      mounted = false;
      unmount();
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", blur);
      window.removeEventListener("resize", update);
      visual?.removeEventListener("resize", update);
      visual?.removeEventListener("scroll", update);
      media?.removeEventListener("change", change);
    };
  }, [editor]);
  return input;
}

const gap = 8;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** Viewport coordinates, before conversion to the menu's positioned ancestor. */
export function menuPosition(
  anchor: Rect,
  size: Pick<Rect, "width" | "height">,
  viewport: Rect,
  editor: Rect,
  placement: Placement,
): { left: number; top: number; maxWidth: number; maxHeight: number } {
  const leftBound = Math.max(viewport.left + gap, editor.left);
  const rightBound = Math.min(viewport.left + viewport.width - gap, editor.left + editor.width);
  const topBound = viewport.top + gap;
  const bottomBound = Math.max(topBound, viewport.top + viewport.height - gap);
  const maxWidth = Math.max(0, rightBound - leftBound);
  const width = Math.min(size.width, maxWidth);
  let left = clamp(anchor.left, leftBound, rightBound - width);
  let top: number;
  let maxHeight = bottomBound - topBound;
  if (placement === "dock") {
    left = leftBound;
    top = bottomBound - Math.min(size.height, maxHeight);
  } else if (placement === "side" && anchor.left - gap - width >= leftBound) {
    left = anchor.left - gap - width;
    top = clamp(anchor.top, topBound, bottomBound - Math.min(size.height, maxHeight));
  } else {
    const above = Math.max(0, anchor.top - gap - topBound);
    const below = Math.max(0, bottomBound - anchor.top - anchor.height - gap);
    const preferAbove = placement !== "below";
    const useAbove = preferAbove ? above >= size.height || above >= below : below < size.height && above > below;
    maxHeight = Math.min(maxHeight, useAbove ? above : below);
    top = useAbove ? anchor.top - gap - Math.min(size.height, maxHeight) : anchor.top + anchor.height + gap;
    top = clamp(top, topBound, bottomBound - Math.min(size.height, maxHeight));
  }
  return { left, top, maxWidth, maxHeight };
}

function clientRect(element: HTMLElement): Rect {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left + element.clientLeft,
    top: rect.top + element.clientTop,
    width: element.clientWidth || rect.width,
    height: element.clientHeight || rect.height,
  };
}

/** The editor lives inside a scroll container; controls cannot escape its clipping without a portal. */
function visibleRect(element: HTMLElement): Rect {
  let view = viewportRect();
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent);
    const clipsX = /auto|scroll|hidden|clip/.test(style.overflowX || style.overflow);
    const clipsY = /auto|scroll|hidden|clip/.test(style.overflowY || style.overflow);
    if (!clipsX && !clipsY) continue;
    const rect = clientRect(parent);
    const left = clipsX ? Math.max(view.left, rect.left) : view.left;
    const top = clipsY ? Math.max(view.top, rect.top) : view.top;
    const right = clipsX ? Math.min(view.left + view.width, rect.left + rect.width) : view.left + view.width;
    const bottom = clipsY ? Math.min(view.top + view.height, rect.top + rect.height) : view.top + view.height;
    view = { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }
  return view;
}

/** CSSOM keeps placement compatible with the application's style-src-attr policy. */
export function useMenuPosition(
  ref: RefObject<HTMLElement | null>,
  anchor: DOMRect | null,
  placement: Placement,
): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const properties = ["position", "left", "top", "max-width", "max-height", "box-sizing"];
    const clear = () => {
      for (const property of properties) element.style.removeProperty(property);
    };
    if (!anchor) {
      clear();
      return;
    }
    const root = element.closest<HTMLElement>("[data-editor-root]") ?? element.parentElement;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    const update = () => {
      const region = root.getBoundingClientRect();
      const view = visibleRect(root);
      const translated = {
        left: anchor.left + region.left - origin.left,
        top: anchor.top + region.top - origin.top,
        width: anchor.width,
        height: anchor.height,
      };
      const width = Math.max(
        0,
        Math.min(view.left + view.width - gap, region.right) - Math.max(view.left + gap, region.left),
      );
      element.style.position = "absolute";
      element.style.boxSizing = "border-box";
      element.style.maxWidth = `${width}px`;
      element.style.maxHeight = `${Math.max(0, view.height - gap * 2)}px`;
      const size = element.getBoundingClientRect();
      const position = menuPosition(translated, size, view, region, placement);
      const parent = element.offsetParent;
      const parentRect = parent?.getBoundingClientRect();
      const left =
        parent && parentRect
          ? position.left - parentRect.left - parent.clientLeft + parent.scrollLeft
          : position.left + window.scrollX;
      const top =
        parent && parentRect
          ? position.top - parentRect.top - parent.clientTop + parent.scrollTop
          : position.top + window.scrollY;
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
      element.style.maxWidth = `${position.maxWidth}px`;
      element.style.maxHeight = `${position.maxHeight}px`;
    };
    const visual = window.visualViewport;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    observer?.observe(root);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    visual?.addEventListener("resize", update);
    visual?.addEventListener("scroll", update);
    update();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      visual?.removeEventListener("resize", update);
      visual?.removeEventListener("scroll", update);
      clear();
    };
  }, [ref, anchor, placement]);
}

function scrollEditor(element: HTMLElement, amount: number): void {
  let remaining = amount;
  for (let parent: HTMLElement | null = element; parent && remaining > 0; parent = parent.parentElement) {
    const overflow = window.getComputedStyle(parent).overflowY;
    if (parent !== document.scrollingElement && !/auto|scroll/.test(overflow)) continue;
    const before = parent.scrollTop;
    const available = Math.max(0, parent.scrollHeight - parent.clientHeight - before);
    parent.scrollTop = before + Math.min(remaining, available);
    remaining -= parent.scrollTop - before;
  }
}

/** Reserve the dock's actual height when typing, without snapping ordinary manual scrolling back to the caret. */
export function useDockedCaret(editor: ReadmeEditor, controls: RefObject<HTMLElement | null>, active: boolean): void {
  const pointer = useRef(false);
  const resume = useRef<(() => void) | null>(null);
  useEffect(() => {
    let frame = 0;
    const down = () => {
      cancelAnimationFrame(frame);
      pointer.current = true;
    };
    const up = () => {
      cancelAnimationFrame(frame);
      // The browser must finish hit-testing the tap/click before scrolling changes its target's position.
      frame = requestAnimationFrame(() => {
        pointer.current = false;
        resume.current?.();
      });
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
    };
  }, []);
  useEffect(() => {
    const dock = controls.current;
    const element = editor.domElement;
    if (!active || !dock || !element) return;
    let mounted = true;
    let queued = false;
    const schedule = () => {
      if (queued || pointer.current) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!mounted || pointer.current || !editor.isFocused()) return;
        const view = editor.prosemirrorView;
        const caret = view.coordsAtPos(view.state.selection.head);
        const rect = dock.getBoundingClientRect();
        const visible = visibleRect(element);
        if (caret.right < rect.left || caret.left > rect.right || rect.height === 0) return;
        const limit = Math.max(visible.top + gap, Math.min(rect.top - gap, visible.top + visible.height - gap));
        scrollEditor(element, Math.max(0, caret.bottom - limit));
      });
    };
    const stopSelection = editor.onSelectionChange(schedule);
    const stopContent = editor.onChange(schedule);
    const visual = window.visualViewport;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(dock);
    observer?.observe(element);
    document.addEventListener("focusin", schedule);
    window.addEventListener("resize", schedule);
    visual?.addEventListener("resize", schedule);
    resume.current = schedule;
    schedule();
    return () => {
      mounted = false;
      resume.current = null;
      stopSelection();
      stopContent();
      observer?.disconnect();
      document.removeEventListener("focusin", schedule);
      window.removeEventListener("resize", schedule);
      visual?.removeEventListener("resize", schedule);
    };
  }, [editor, controls, active]);
}
