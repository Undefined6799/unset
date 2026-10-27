// @vitest-environment jsdom
import { BlockNoteEditor } from "@blocknote/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { type ReadmeEditor, readmeSchema } from "./schema.ts";
import { useTouchBlockGestures } from "./touch-gestures.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let react: Root | undefined;
let editor: ReadmeEditor | undefined;
const originalRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
afterEach(async () => {
  await act(async () => react?.unmount());
  editor?.unmount();
  react = undefined;
  editor = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalRects) Object.defineProperty(Range.prototype, "getClientRects", originalRects);
  else Reflect.deleteProperty(Range.prototype, "getClientRects");
  document.body.replaceChildren();
});

async function setup(late = false) {
  vi.useFakeTimers();
  editor = BlockNoteEditor.create({
    schema: readmeSchema,
    _tiptapOptions: { injectCSS: false },
    disableExtensions: ["placeholder"],
    initialContent: [
      { id: "a", type: "paragraph", content: "First" },
      {
        id: "b",
        type: "paragraph",
        content: "Second",
        children: [{ id: "child", type: "paragraph", content: "Nested" }],
      },
      { id: "c", type: "paragraph", content: "Third" },
    ],
  });
  const current = editor;
  const wrapper = document.createElement("div");
  wrapper.dataset.editorRoot = "";
  const mount = document.createElement("div");
  const host = document.createElement("div");
  wrapper.append(mount, host);
  document.body.append(wrapper);
  const opened: string[] = [];
  function Probe({ active = true }: { active?: boolean }) {
    useTouchBlockGestures(current, active, (id) => opened.push(id));
    return null;
  }
  if (!late) current.mount(mount);
  react = createRoot(host);
  await act(async () => react?.render(createElement(Probe)));
  if (late) await act(async () => current.mount(mount));
  const block = (id: string) =>
    wrapper.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${id}"]`) as HTMLElement;
  for (const [id, y, height] of [
    ["a", 0, 40],
    ["b", 50, 90],
    ["child", 95, 35],
    ["c", 150, 40],
  ] as const) {
    vi.spyOn(block(id), "getBoundingClientRect").mockReturnValue(new DOMRect(id === "child" ? 60 : 20, y, 300, height));
  }
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value(this: Range) {
      const container = this.startContainer.parentElement?.closest<HTMLElement>("[data-node-type=blockContainer]");
      const rect = container?.getBoundingClientRect();
      return rect ? [new DOMRect(rect.left + 10, rect.top + 5, 70, 24)] : [];
    },
  });
  const pointer = (type: string, id: string, x: number, y: number, pointerId = 1) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId, pointerType: "touch", clientX: x, clientY: y, button: 0 });
    block(id).dispatchEvent(event);
    return event;
  };
  const tap = (id: string, x: number, y: number) => {
    pointer("pointerdown", id, x, y);
    pointer("pointerup", id, x, y);
  };
  return { current, wrapper, opened, block, pointer, tap, Probe };
}

test("double_tap_on_background_opens_only_that_block_and_consumes_compatibility_double_click", async () => {
  const { opened, tap, block } = await setup(true);
  tap("b", 280, 65);
  await act(async () => vi.advanceTimersByTime(150));
  tap("b", 282, 67);
  expect(opened).toEqual(["b"]);
  const click = new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 282, clientY: 67, detail: 2 });
  block("b").dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);
});

test("opening_actions_does_not_suppress_the_sheet_buttons_or_keyboard_clicks", async () => {
  const { tap, wrapper, block } = await setup();
  tap("b", 280, 65);
  tap("b", 280, 65);
  const action = document.createElement("button");
  wrapper.append(action);
  const click = new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 280, clientY: 65, detail: 1 });
  action.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(false);
  const keyboard = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 });
  block("b").dispatchEvent(keyboard);
  expect(keyboard.defaultPrevented).toBe(false);
});

test("text_double_tap_and_long_press_remain_native", async () => {
  const { opened, tap, pointer, block } = await setup();
  tap("b", 45, 65);
  tap("b", 45, 65);
  pointer("pointerdown", "b", 45, 65);
  await act(async () => vi.advanceTimersByTime(500));
  expect(block("b").hasAttribute("data-touch-dragging")).toBe(false);
  const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  block("b").dispatchEvent(menu);
  expect(menu.defaultPrevented).toBe(false);
  expect(opened).toEqual([]);
});

test("ordinary_swiping_cancels_the_hold_without_preventing_scroll", async () => {
  const { current, pointer, block, wrapper } = await setup();
  pointer("pointerdown", "b", 280, 65);
  expect(pointer("pointermove", "b", 280, 77).defaultPrevented).toBe(false);
  await act(async () => vi.advanceTimersByTime(500));
  const move = new Event("touchmove", { bubbles: true, cancelable: true });
  wrapper.dispatchEvent(move);
  expect(move.defaultPrevented).toBe(false);
  expect(block("b").hasAttribute("data-touch-dragging")).toBe(false);
  pointer("pointerup", "b", 280, 175);
  expect(current.document.map((item) => item.id)).toEqual(["a", "b", "c"]);
});

test("hold_then_move_marks_the_target_and_moves_nested_content_as_one_undo_step", async () => {
  const { current, pointer, block, wrapper } = await setup();
  const before = current.document;
  pointer("pointerdown", "b", 280, 65);
  await act(async () => vi.advanceTimersByTime(450));
  expect(block("b").hasAttribute("data-touch-dragging")).toBe(true);
  pointer("pointermove", "b", 280, 180);
  expect(block("c").dataset.touchDrop).toBe("after");
  const scroll = new Event("touchmove", { bubbles: true, cancelable: true });
  wrapper.dispatchEvent(scroll);
  expect(scroll.defaultPrevented).toBe(true);
  pointer("pointerup", "b", 280, 180);
  expect(current.document.map((item) => item.id)).toEqual(["a", "c", "b"]);
  expect(current.getBlock("b")?.children[0]?.id).toBe("child");
  expect(wrapper.querySelector("[data-touch-dragging], [data-touch-drop]")).toBeNull();
  current.undo();
  expect(current.document).toEqual(before);
});

test("holding_without_moving_does_not_reorder_or_open_actions", async () => {
  const { current, opened, pointer, block } = await setup();
  pointer("pointerdown", "b", 280, 65);
  await act(async () => vi.advanceTimersByTime(500));
  const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  block("b").dispatchEvent(menu);
  expect(menu.defaultPrevented).toBe(true);
  pointer("pointerup", "b", 280, 65);
  expect(current.document.map((item) => item.id)).toEqual(["a", "b", "c"]);
  expect(opened).toEqual([]);
});

test("dragging_a_nested_block_cannot_leave_its_sibling_group", async () => {
  const { current, pointer, block } = await setup();
  const before = current.document;
  pointer("pointerdown", "child", 280, 110);
  await act(async () => vi.advanceTimersByTime(450));
  pointer("pointermove", "child", 280, 180);
  expect(block("c").hasAttribute("data-touch-drop")).toBe(false);
  pointer("pointerup", "child", 280, 180);
  expect(current.document).toEqual(before);
});

test("transferring_implicit_capture_from_the_block_to_the_root_does_not_cancel_dragging", async () => {
  const { pointer, block } = await setup();
  pointer("pointerdown", "b", 280, 65);
  await act(async () => vi.advanceTimersByTime(450));
  pointer("lostpointercapture", "b", 280, 65);
  expect(block("b").hasAttribute("data-touch-dragging")).toBe(true);
});

test.each(["pointercancel", "lostpointercapture", "Escape", "second-pointer", "inactive"])(
  "%s_clears_a_pending_drag_without_moving_content",
  async (reason) => {
    const { current, pointer, wrapper, Probe } = await setup();
    const before = current.document;
    pointer("pointerdown", "b", 280, 65);
    await act(async () => vi.advanceTimersByTime(450));
    pointer("pointermove", "b", 280, 180);
    expect(wrapper.querySelector("[data-touch-drop]")).not.toBeNull();
    if (reason === "Escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    else if (reason === "second-pointer") pointer("pointerdown", "a", 280, 15, 2);
    else if (reason === "inactive") await act(async () => react?.render(createElement(Probe, { active: false })));
    else if (reason === "lostpointercapture") {
      const lost = new Event("lostpointercapture", { bubbles: true });
      Object.assign(lost, { pointerId: 1 });
      wrapper.dispatchEvent(lost);
    } else pointer(reason, "b", 280, 180);
    expect(wrapper.querySelector("[data-touch-dragging], [data-touch-drop]")).toBeNull();
    pointer("pointerup", "b", 280, 180);
    expect(current.document).toEqual(before);
  },
);

test("links_and_buttons_do_not_open_the_block_sheet", async () => {
  const { opened, block } = await setup();
  for (const tag of ["a", "button", "input"]) {
    const control = document.createElement(tag);
    block("b").append(control);
    for (let tap = 0; tap < 2; tap++)
      for (const type of ["pointerdown", "pointerup"]) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.assign(event, { pointerId: 1, pointerType: "touch", clientX: 280, clientY: 65 });
        control.dispatchEvent(event);
      }
  }
  expect(opened).toEqual([]);
});
