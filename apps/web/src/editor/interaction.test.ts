// @vitest-environment jsdom
import { BlockNoteEditor } from "@blocknote/core";
import { TextSelection } from "prosemirror-state";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { keyboardState, menuPosition, useDockedCaret, useEditorInput, useMenuPosition } from "./interaction.ts";
import { type ReadmeEditor, readmeSchema } from "./schema.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const viewport = { left: 0, top: 0, width: 1440, height: 900 };
const region = { left: 400, top: 100, width: 800, height: 1200 };
const anchor = { left: 460, top: 300, width: 80, height: 24 };

test("menu_flips_below_when_selection_is_near_the_top", () => {
  expect(menuPosition({ ...anchor, top: 12 }, { width: 300, height: 40 }, viewport, region, "above")).toMatchObject({
    left: 460,
    top: 44,
    maxWidth: 800,
  });
});

test("menu_flips_above_and_limits_height_to_the_available_space", () => {
  expect(
    menuPosition({ ...anchor, top: 500 }, { width: 320, height: 600 }, { ...viewport, height: 600 }, region, "below"),
  ).toMatchObject({ top: 8, maxHeight: 484 });
});

// A software keyboard can leave less than three rows on either side of the docked toolbar.
test("menu_covers_its_anchor_rather_than_shrinking_below_three_rows", () => {
  expect(
    menuPosition(
      { ...anchor, top: 200, height: 100 },
      { width: 200, height: 400 },
      { ...viewport, top: 150, height: 240 },
      region,
      "above",
    ),
  ).toMatchObject({ top: 158, maxHeight: 224 });
});

test("menu_width_uses_the_editor_region_on_a_medium_screen", () => {
  expect(
    menuPosition(
      anchor,
      { width: 600, height: 40 },
      { ...viewport, width: 768 },
      { ...region, left: 392, width: 328 },
      "above",
    ),
  ).toMatchObject({ left: 392, maxWidth: 328 });
});

test("docked_toolbar_fits_a_panned_and_keyboard_reduced_visual_viewport", () => {
  expect(
    menuPosition(
      anchor,
      { width: 600, height: 48 },
      { left: 20, top: 100, width: 390, height: 350 },
      { ...region, left: 16, width: 700 },
      "dock",
    ),
  ).toMatchObject({ left: 28, top: 394, maxWidth: 374 });
});

test("side_controls_go_above_instead_of_covering_the_block_when_the_gutter_is_narrow", () => {
  expect(menuPosition({ ...anchor, left: 410 }, { width: 72, height: 40 }, viewport, region, "side")).toMatchObject({
    left: 410,
    top: 252,
  });
  expect(menuPosition({ ...anchor, left: 500 }, { width: 72, height: 40 }, viewport, region, "side")).toMatchObject({
    left: 420,
    top: 300,
  });
});

test("keyboard_detection_distinguishes_keyboard_zoom_and_orientation", () => {
  const closed = keyboardState(null, 1024, 800, 1);
  expect(keyboardState(closed, 1024, 500, 1).open).toBe(true);
  expect(keyboardState(closed, 1024, 400, 2).open).toBe(false);
  expect(keyboardState(closed, 1400, 500, 1).open).toBe(false);
  expect(keyboardState(closed, 1024, 700, 1).open).toBe(false);
});

let root: Root | null = null;
let editor: ReadmeEditor | null = null;
const originalClientRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
afterEach(async () => {
  await act(async () => root?.unmount());
  editor?.unmount();
  root = null;
  editor = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalClientRects) Object.defineProperty(Range.prototype, "getClientRects", originalClientRects);
  else Reflect.deleteProperty(Range.prototype, "getClientRects");
  document.body.replaceChildren();
});

async function observeInput(coarse: boolean, width: number) {
  const media = Object.assign(new EventTarget(), { matches: coarse });
  vi.stubGlobal("matchMedia", () => media);
  vi.stubGlobal("innerWidth", width);
  const visual = Object.assign(new EventTarget(), { offsetLeft: 0, offsetTop: 0, width, height: 900, scale: 1 });
  vi.stubGlobal("visualViewport", visual);
  editor = BlockNoteEditor.create({
    schema: readmeSchema,
    _tiptapOptions: { injectCSS: false },
    disableExtensions: ["placeholder"],
  });
  const currentEditor = editor;
  const wrapper = document.createElement("div");
  wrapper.dataset.editorRoot = "";
  const mount = document.createElement("div");
  const controls = document.createElement("button");
  const host = document.createElement("div");
  const outside = document.createElement("button");
  wrapper.append(mount, controls, host);
  document.body.append(wrapper, outside);
  currentEditor.mount(mount);
  const observed: { current: ReturnType<typeof useEditorInput> | null } = { current: null };
  function Probe() {
    observed.current = useEditorInput(currentEditor);
    return null;
  }
  root = createRoot(host);
  await act(async () => root?.render(createElement(Probe)));
  return { observed, visual, controls, outside };
}

test("wide_touch_keeps_compact_controls_until_switching_to_mouse", async () => {
  const { observed } = await observeInput(true, 1440);
  expect(observed.current).toMatchObject({ touch: true, compact: true });
  const pointer = new Event("pointerdown", { bubbles: true });
  Object.defineProperty(pointer, "pointerType", { value: "mouse" });
  await act(async () => document.dispatchEvent(pointer));
  expect(observed.current).toMatchObject({ touch: false, compact: false });
});

test("phone_width_keeps_compact_controls_with_a_mouse_and_updates_on_resize", async () => {
  const { observed } = await observeInput(false, 390);
  expect(observed.current).toMatchObject({ touch: false, compact: true });
  const pointer = new Event("pointerdown", { bubbles: true });
  Object.defineProperty(pointer, "pointerType", { value: "mouse" });
  await act(async () => document.dispatchEvent(pointer));
  expect(observed.current).toMatchObject({ touch: false, compact: true });
  await act(async () => {
    vi.stubGlobal("innerWidth", 768);
    window.dispatchEvent(new Event("resize"));
  });
  expect(observed.current).toMatchObject({ touch: false, compact: false });
  await act(async () => {
    vi.stubGlobal("innerWidth", 767);
    window.dispatchEvent(new Event("resize"));
  });
  expect(observed.current).toMatchObject({ touch: false, compact: true });
});

test("narrow_mouse_switches_to_touch_on_hybrid_pointer_input", async () => {
  const { observed } = await observeInput(false, 390);
  expect(observed.current?.touch).toBe(false);
  const pointer = new Event("pointerdown", { bubbles: true });
  Object.defineProperty(pointer, "pointerType", { value: "touch" });
  await act(async () => document.dispatchEvent(pointer));
  expect(observed.current?.touch).toBe(true);
});

test("toolbar_focus_remains_editor_focus_and_viewport_events_follow_the_keyboard", async () => {
  const { observed, visual, controls, outside } = await observeInput(true, 1024);
  await act(async () => controls.focus());
  expect(observed.current?.focused).toBe(true);
  await act(async () => {
    visual.height = 500;
    visual.offsetTop = 24;
    visual.dispatchEvent(new Event("resize"));
  });
  expect(observed.current).toMatchObject({ keyboardOpen: true, viewport: { top: 24, height: 500 } });
  await act(async () => outside.focus());
  expect(observed.current?.focused).toBe(false);
});

test("focusout_keeps_controls_mounted_during_the_native_gap_before_focusin", async () => {
  const { observed, controls } = await observeInput(false, 1440);
  await act(async () => controls.focus());
  expect(observed.current?.focused).toBe(true);
  const active = vi.spyOn(document, "activeElement", "get").mockReturnValue(document.body);
  await act(async () =>
    controls.dispatchEvent(
      new FocusEvent("focusout", {
        bubbles: true,
        relatedTarget: editor?.domElement ?? null,
      }),
    ),
  );
  expect(observed.current?.focused).toBe(true);
  active.mockRestore();
});

test("position_hook_tracks_scrolling_and_clears_styles_when_the_anchor_disappears", async () => {
  const host = document.createElement("div");
  const wrapper = document.createElement("div");
  wrapper.dataset.editorRoot = "";
  const menu = document.createElement("div");
  wrapper.append(menu, host);
  document.body.append(wrapper);
  let top = 100;
  vi.spyOn(wrapper, "getBoundingClientRect").mockImplementation(() => new DOMRect(400, top, 800, 1000));
  vi.spyOn(menu, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 40));
  Object.defineProperty(menu, "offsetParent", { value: wrapper });
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("innerHeight", 900);
  const ref = { current: menu };
  function Probe({ at }: { at: DOMRect | null }) {
    useMenuPosition(ref, at, "above");
    return null;
  }
  root = createRoot(host);
  const at = new DOMRect(460, 300, 80, 24);
  await act(async () => root?.render(createElement(Probe, { at })));
  expect(menu.style.top).toBe("152px");
  await act(async () => {
    top = -100;
    window.dispatchEvent(new Event("scroll"));
  });
  expect(menu.style.top).toBe("152px");
  await act(async () => root?.render(createElement(Probe, { at })));
  expect(menu.style.top).toBe("152px");
  await act(async () => root?.render(createElement(Probe, { at: null })));
  expect(menu.style.left).toBe("");
  expect(menu.style.top).toBe("");
  expect(menu.style.maxWidth).toBe("");
  expect(menu.style.maxHeight).toBe("");
  await act(async () => window.dispatchEvent(new Event("resize")));
  expect(menu.style.top).toBe("");
});

// The block-type trigger sits in docked controls that move on their own (useDockedCaret); a rect captured when the
// menu opened left the menu over the toolbar (Alex 2026-10-27).
test("menu_follows_its_trigger_when_the_trigger_moves_after_opening", async () => {
  const host = document.createElement("div");
  const wrapper = document.createElement("div");
  wrapper.dataset.editorRoot = "";
  const trigger = document.createElement("button");
  const menu = document.createElement("div");
  wrapper.append(trigger, menu, host);
  document.body.append(wrapper);
  let triggerTop = 700;
  vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 900));
  vi.spyOn(trigger, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, triggerTop, 100, 44));
  vi.spyOn(menu, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 300));
  Object.defineProperty(menu, "offsetParent", { value: wrapper });
  vi.stubGlobal("innerWidth", 400);
  vi.stubGlobal("innerHeight", 900);
  const ref = { current: menu };
  function Probe() {
    useMenuPosition(ref, trigger, "above");
    return null;
  }
  root = createRoot(host);
  await act(async () => root?.render(createElement(Probe)));
  expect(menu.style.top).toBe("392px");
  await act(async () => {
    triggerTop = 400;
    window.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(menu.style.top).toBe("92px");
});

// The sticky Save and Cancel bar and the fixed phone navigation precede the editor and paint over it.
test("menu_stays_clear_of_sticky_and_fixed_bars_that_precede_the_editor", async () => {
  const form = document.createElement("form");
  const bar = document.createElement("div");
  bar.style.position = "sticky";
  const wrapper = document.createElement("div");
  wrapper.dataset.editorRoot = "";
  const host = document.createElement("div");
  const menu = document.createElement("div");
  wrapper.append(menu, host);
  form.append(bar, wrapper);
  document.body.append(form);
  const nav = document.createElement("nav");
  nav.style.position = "fixed";
  document.body.prepend(nav);
  vi.spyOn(bar, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 80));
  vi.spyOn(nav, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 520, 400, 80));
  vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(new DOMRect(0, -200, 400, 1200));
  vi.spyOn(menu, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 400));
  Object.defineProperty(menu, "offsetParent", { value: wrapper });
  vi.stubGlobal("innerWidth", 400);
  vi.stubGlobal("innerHeight", 600);
  const ref = { current: menu };
  function Probe({ at }: { at: number }) {
    useMenuPosition(ref, new DOMRect(0, at, 100, 44), "above");
    return null;
  }
  root = createRoot(host);
  await act(async () => root?.render(createElement(Probe, { at: 400 })));
  // Room above the trigger is 88..392, under the bar: the menu is cut to that height and scrolls.
  expect(menu.style.maxHeight).toBe("304px");
  expect(menu.style.top).toBe("288px");
  // Below a trigger near the top, the room ends 8px above the fixed navigation (520).
  await act(async () => root?.render(createElement(Probe, { at: 100 })));
  expect(menu.style.maxHeight).toBe("360px");
  nav.remove();
});

test("docked_controls_remain_inside_the_clipping_scroll_container", async () => {
  const scroller = document.createElement("div");
  scroller.style.overflowX = "auto";
  scroller.style.overflowY = "auto";
  const wrapper = document.createElement("div");
  wrapper.dataset.editorRoot = "";
  const host = document.createElement("div");
  const menu = document.createElement("div");
  wrapper.append(menu, host);
  scroller.append(wrapper);
  document.body.append(scroller);
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 80, 1000, 600));
  vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(new DOMRect(400, -100, 400, 1000));
  vi.spyOn(menu, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 400, 100));
  Object.defineProperty(menu, "offsetParent", { value: wrapper });
  Object.defineProperty(wrapper, "clientTop", { value: 2 });
  Object.defineProperty(wrapper, "scrollTop", { value: 30 });
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("innerHeight", 900);
  const ref = { current: menu };
  function Probe() {
    useMenuPosition(ref, new DOMRect(400, -100, 400, 1000), "dock");
    return null;
  }
  root = createRoot(host);
  await act(async () => root?.render(createElement(Probe)));
  expect(menu.style.left).toBe("0px");
  expect(menu.style.top).toBe("700px");
  expect(menu.style.maxWidth).toBe("400px");
});

test("docked_caret_scrolls_above_controls_on_resize_but_leaves_manual_scroll_and_toolbar_focus_alone", async () => {
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  Object.defineProperty(scroller, "clientHeight", { value: 600 });
  Object.defineProperty(scroller, "scrollHeight", { value: 1200 });
  vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 800, 600));
  const wrapper = document.createElement("div");
  wrapper.dataset.editorRoot = "";
  const mount = document.createElement("div");
  const controls = document.createElement("button");
  const host = document.createElement("div");
  wrapper.append(mount, controls, host);
  scroller.append(wrapper);
  document.body.append(scroller);
  let dockTop = 500;
  vi.spyOn(controls, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, dockTop, 800, 100));
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [new DOMRect(20, 600 - scroller.scrollTop, 1, 20)],
  });
  vi.stubGlobal("innerWidth", 800);
  vi.stubGlobal("innerHeight", 600);
  editor = BlockNoteEditor.create({
    schema: readmeSchema,
    initialContent: [{ type: "paragraph", content: "Text" }],
    // jsdom has no native page layout; this test exercises the dock's own scroll behavior.
    _tiptapOptions: { injectCSS: false, editorProps: { handleScrollToSelection: () => true } },
    disableExtensions: ["placeholder"],
  });
  const current = editor;
  current.mount(mount);
  const view = current.prosemirrorView;
  let textPosition = 0;
  view.state.doc.descendants((node, pos) => {
    if (node.isText) textPosition = pos + 1;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, textPosition)));
  view.focus();
  scroller.scrollTop = 0;
  expect(view.coordsAtPos(view.state.selection.head).bottom).toBe(620);
  const ref = { current: controls };
  function Probe({ active }: { active: boolean }) {
    useDockedCaret(current, ref, active);
    return null;
  }
  root = createRoot(host);
  const frame: { current: FrameRequestCallback | null } = { current: null };
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame.current = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frame.current = null;
  });
  await act(async () => root?.render(createElement(Probe, { active: false })));
  await act(async () => view.dom.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  await act(async () => root?.render(createElement(Probe, { active: true })));
  expect(scroller.scrollTop).toBe(0);
  await act(async () => view.dom.dispatchEvent(new Event("pointerup", { bubbles: true })));
  expect(scroller.scrollTop).toBe(0);
  await act(async () => frame.current?.(0));
  expect(scroller.scrollTop).toBe(128);
  await act(async () => {
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  expect(scroller.scrollTop).toBe(0);
  await act(async () => root?.render(createElement(Probe, { active: true })));
  expect(scroller.scrollTop).toBe(0);
  await act(async () => {
    dockTop = 350;
    window.dispatchEvent(new Event("resize"));
  });
  expect(scroller.scrollTop).toBe(278);
  await act(async () => {
    scroller.scrollTop = 0;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, textPosition + 1)));
  });
  expect(scroller.scrollTop).toBe(278);
  await act(async () => {
    scroller.scrollTop = 0;
    view.dispatch(view.state.tr.insertText("x"));
  });
  expect(scroller.scrollTop).toBe(278);
  await act(async () => {
    controls.focus();
    scroller.scrollTop = 0;
    window.dispatchEvent(new Event("resize"));
  });
  expect(scroller.scrollTop).toBe(0);
  await act(async () => root?.render(createElement(Probe, { active: false })));
  await act(async () => {
    current.prosemirrorView.dom.focus();
    window.dispatchEvent(new Event("resize"));
  });
  expect(scroller.scrollTop).toBe(0);
});
