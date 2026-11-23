<!--
  A Text card's words on the owner's page, edited where they stand (ADR 0074 item 4): no Edit press and no Write and
  Preview tabs. The server renders the card's blocks as every visitor sees them (readme.svelte), and with no script
  they stay so; the card's own form (card-editor.svelte) still edits it. With script, once the browser is idle, the
  Milkdown editor (P1.21u, editor/milkdown.ts) is drawn in their place and opened on `value` (the unsaved words, else
  the stored ones), and every change is handed to `onedit` as markdown, once a frame; `flushes` holds this card's way
  to hand over a change still waiting for its frame, which the page runs before it builds a Save, and `onfocus` hands
  the page the way back into this card once the member types in it, so the page can return there after a Save.
  The editor's script loads as soon as the page is up; a press on the card before the editor is drawn opens it at
  once, and the caret goes where the press was, with the keys typed meanwhile (P1.21r): only the card pressed last
  keeps them, a press or focus anywhere else lets go, and the first key it cannot replay ends them. A press on the card around
  the words (its padding, below the last line) puts the caret at the nearest words. If the editor cannot load the
  blocks stay, with a line that says so. The parent remounts this component to throw the member's changes away
  (Discard).
-->
<script lang="ts" module>
/** The one card holding an early press, and how to make it let go: a press on another card takes the press over. */
let holder: (() => void) | undefined;
</script>

<script lang="ts">
import { flushSync, onDestroy, onMount, tick } from "svelte";
import type { BlockItem, MenusState } from "../../editor/menus.ts";
import type { MarkdownEditor } from "../../editor/milkdown.ts";
import { TEXT_IN_PLACE, TEXT_MENUS } from "../../profile/messages.ts";
import type { Block } from "../../profile/types.ts";
import Readme from "./readme.svelte";
import TextMenus from "./text-menus.svelte";

let {
  blocks,
  name,
  value,
  onedit,
  flushes,
  onfocus,
}: {
  blocks: readonly Block[];
  name: string;
  value: string;
  onedit: (markdown: string) => void;
  flushes: Set<() => void>;
  onfocus?: (focus: () => void) => void;
} = $props();

const id = $props.id();
const labelId = `${id}-label`;
let host: HTMLDivElement | undefined = $state();
let editor: MarkdownEditor | undefined = $state();
let failed = $state(false);
let menus: MenusState = $state({ items: [], index: 0, bar: false, on: new Set(), link: null });
let handle: HTMLElement | undefined = $state();
let add: HTMLElement | undefined = $state();
let menu: HTMLElement | undefined = $state();
let bar: HTMLElement | undefined = $state();
let linkEdit: HTMLElement | undefined = $state();
let linkPreview: HTMLElement | undefined = $state();
const optionId = (item: BlockItem) => `${id}-block-${item}`;
/** The page's script runs here: from now on a press on the card opens the editor (a press before that is the page's). */
let listening = $state(false);
let closed = false;
let opening: Promise<void> | undefined;
/**
 * A press on the card before the editor was drawn, and the keys typed since: carried into the editor once it is.
 * `ended` is set by the first key it cannot replay; keys after that are not kept, so what reaches the editor is only
 * ever what the member typed, in order.
 */
let early: { x: number; y: number; typed: string; ended: boolean } | undefined;

/** Lets go of the early press: the member pressed or moved somewhere else, so nothing typed belongs to this card. */
function letGo() {
  early = undefined;
  if (holder === letGo) holder = undefined;
}

/** Takes the early press for this card, so that only the card pressed last keeps keys. */
function hold(x: number, y: number) {
  if (holder !== letGo) holder?.();
  holder = letGo;
  early = { x, y, typed: "", ended: false };
}

/** A press or a move of focus outside this card ends its early press. */
function elsewhere(event: Event) {
  if (early === undefined || !(event.target instanceof Node)) return;
  if (!(cardOf()?.contains(event.target) ?? false)) letGo();
}

const cardOf = () => host?.closest<HTMLElement>("[data-slot='card']") ?? host?.parentElement ?? undefined;

/** Once the browser has nothing else to do: the page's own work and first paint come before the editor is drawn. */
function whenIdle(run: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(run, { timeout: 2000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(run, 200);
  return () => clearTimeout(id);
}

async function mount() {
  try {
    const { mountMarkdownEditor } = await import("../../editor/milkdown.ts");
    if (closed || host === undefined || handle === undefined || add === undefined || menu === undefined) return;
    if (bar === undefined || linkEdit === undefined || linkPreview === undefined) return;
    const mounted = await mountMarkdownEditor(host, {
      value,
      labelledBy: labelId,
      // Each change reaches the page once a frame, as markdown; the card's formatting is in its menus, not a bar.
      onEdit: () => undefined,
      onChange: onedit,
      onToolbar: () => undefined,
      menus: {
        handle,
        add,
        menu,
        bar,
        linkEdit,
        linkPreview,
        hint: TEXT_MENUS.hint,
        labels: TEXT_MENUS.items,
        optionId,
        // Drawn at once: plugin-slash and plugin-tooltip measure their element right after it is shown (floating-ui
        // computePosition reads its size after a microtask), so a menu still holding its last items would be placed by
        // the wrong height and not flip above a line near the bottom of the screen.
        onState: (state) => {
          menus = state;
          flushSync();
        },
      },
    });
    if (closed) {
      await mounted.destroy();
      return;
    }
    editor = mounted;
    flushes.add(mounted.flush);
    // The editor is hidden until it is drawn in the blocks' place; the caret can only go in once it shows.
    await tick();
    carryEarly(mounted);
  } catch {
    // The blocks stay, and the card's own form still edits it; the line says why the words cannot be typed in.
    failed = true;
    letGo();
  }
}

const open = () => {
  opening ??= mount();
  return opening;
};

function carryEarly(mounted: MarkdownEditor) {
  if (early === undefined) return;
  const { x, y, typed } = early;
  letGo();
  mounted.focusAt(x, y);
  if (typed !== "") mounted.type(typed);
}

/** A press the card's own controls, links and fields keep: never taken for a press on the words. */
const CONTROLS =
  "a, button, input, textarea, select, label, [role='menu'], [role='menuitem'], [role='dialog'], [role='listbox'], [data-block-handle], [data-text-popover]";

function pressed(event: PointerEvent) {
  if (event.button !== 0 || failed || !(event.target instanceof Element)) return;
  if (event.target.closest(CONTROLS) !== null && !host?.contains(event.target)) return;
  if (editor === undefined) {
    if (event.target.closest("a") !== null) return;
    event.preventDefault();
    hold(event.clientX, event.clientY);
    void open();
    return;
  }
  if (event.target.closest(".ProseMirror") !== null) return;
  event.preventDefault();
  editor.focusAt(event.clientX, event.clientY);
}

/** Keys a person types with no modifier that the editor gets back as typed: a character, a space. */
const replayable = (event: KeyboardEvent) =>
  event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing;

/** Keys that change nothing on their own (a Shift held for a capital) and so neither end nor join the kept keys. */
const MODIFIERS = new Set(["Shift", "CapsLock"]);

/**
 * Keys typed between an early press and the editor being drawn. A character is kept; the first key that is not one
 * (Backspace, Enter, an arrow, a shortcut) ends the kept keys, since replaying the characters around it would give
 * words the member never typed.
 */
function typedEarly(event: KeyboardEvent) {
  if (early === undefined || early.ended || MODIFIERS.has(event.key)) return;
  if (!replayable(event)) {
    early.ended = true;
    return;
  }
  event.preventDefault();
  early.typed += event.key;
}

/**
 * A click on the words before the page's script ran reached no listener, but the browser kept it as a caret in them
 * (a collapsed selection, which a click on any text leaves): taken as the early press, where that caret is.
 */
function pressedBeforeScript() {
  const caret = getSelection();
  if (caret === null || caret.rangeCount === 0 || !caret.isCollapsed) return;
  const at = caret.anchorNode;
  const card = cardOf();
  if (at === null || card === undefined || !card.contains(at)) return;
  const element = at instanceof Element ? at : at.parentElement;
  if (element === null || element.closest(CONTROLS) !== null) return;
  const rects = caret.getRangeAt(0).getClientRects();
  const box = rects[0] ?? element.getBoundingClientRect();
  hold(box.left, box.top + box.height / 2);
  void open();
}

let cancel: (() => void) | undefined;
onMount(() => {
  // The script is fetched now; the editor is drawn when the browser is idle, or at once when the member presses.
  void import("../../editor/milkdown.ts").catch(() => undefined);
  cancel = whenIdle(() => void open());
  const card = cardOf();
  card?.addEventListener("pointerdown", pressed);
  addEventListener("keydown", typedEarly);
  addEventListener("pointerdown", elsewhere, true);
  addEventListener("focusin", elsewhere);
  listening = true;
  pressedBeforeScript();
  return () => {
    card?.removeEventListener("pointerdown", pressed);
    removeEventListener("keydown", typedEarly);
    removeEventListener("pointerdown", elsewhere, true);
    removeEventListener("focusin", elsewhere);
    letGo();
  };
});
// Also on the server, where only `closed` matters: nothing else was set up there.
onDestroy(() => {
  closed = true;
  cancel?.();
  if (editor !== undefined) flushes.delete(editor.flush);
  void editor?.destroy();
});
</script>

<span id={labelId} class="sr-only">{TEXT_IN_PLACE.label(name)}</span>
{#if editor === undefined}<Readme {blocks} />{/if}
{#if failed}<p role="alert" class="text-sm text-muted-foreground">{TEXT_IN_PLACE.failed}</p>{/if}
<div class="relative">
<TextMenus
  state={menus}
  {optionId}
  bind:handle
  bind:add
  bind:menu
  bind:bar
  bind:linkEdit
  bind:linkPreview
  onchoose={(item) => editor?.menus?.choose(item)}
  onformat={(item) => editor?.menus?.format(item)}
  onlink={{
    confirm: (address) => editor?.menus?.confirmLink(address),
    cancel: () => editor?.menus?.cancelLink(),
    edit: () => editor?.menus?.editLink(),
    remove: () => editor?.menus?.removeLink(),
  }}
/>
<div
  bind:this={host}
  data-text-in-place
  data-listening={listening ? "" : undefined}
  onfocusin={() => editor !== undefined && onfocus?.(editor.focus)}
  class="{editor === undefined ? 'hidden' : ''} [&_.markdown-editor]:outline-none [&_.markdown-editor]:rounded-sm [&_.markdown-editor:focus-visible]:outline-solid [&_.markdown-editor:focus-visible]:outline-2 [&_.markdown-editor:focus-visible]:outline-offset-8 [&_.markdown-editor:focus-visible]:outline-ring/40 [&_.markdown-editor]:flex [&_.markdown-editor]:flex-col [&_.markdown-editor]:gap-3 [&_.markdown-editor>p]:my-3 [&_.markdown-editor_:is(ul,ol,dl)]:my-0 [&_.markdown-editor>:first-child]:mt-0 [&_.markdown-editor>:last-child]:mb-0 [&_li>p]:my-0 [&_li+li]:mt-0.5 [&_blockquote]:flex [&_blockquote]:flex-col [&_blockquote]:gap-3 [&_blockquote>p]:my-0 [&_h2]:text-2xl [&_h2]:leading-8 [&_h2]:font-bold [&_h2]:tracking-tight [&_h3]:mt-2 [&_h3]:text-xl [&_h3]:font-semibold [&_h4]:mt-1 [&_h4]:font-semibold [&_ul]:list-disc [&_ul]:ps-6 [&_ol]:list-decimal [&_ol]:ps-6 [&_blockquote]:border-s-3 [&_blockquote]:border-input [&_blockquote]:ps-3.5 [&_blockquote]:text-muted-foreground [&_pre]:rounded-sm [&_pre]:bg-muted [&_pre]:px-4 [&_pre]:py-3.5 [&_pre]:font-mono [&_code]:font-mono [&_a]:underline [&_[data-image]]:text-muted-foreground [&_[data-placeholder]]:before:pointer-events-none [&_[data-placeholder]]:before:absolute [&_[data-placeholder]]:before:h-0 [&_[data-placeholder]]:before:text-muted-foreground [&_[data-placeholder]]:before:content-[attr(data-placeholder)]"
></div>
</div>
