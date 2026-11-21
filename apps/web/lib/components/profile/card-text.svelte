<!--
  A Text card's words on the owner's page, edited where they stand (ADR 0074 item 4): no Edit press and no Write and
  Preview tabs. The server renders the card's blocks as every visitor sees them (readme.svelte), and with no script
  they stay so; the card's own form (card-editor.svelte) still edits it. With script, once the browser is idle, the
  Milkdown editor (P1.21u, editor/milkdown.ts) is drawn in their place and opened on `value` (the unsaved words, else
  the stored ones), and every change is handed to `onedit` as markdown, once a frame; `flushes` holds this card's way
  to hand over a change still waiting for its frame, which the page runs before it builds a Save, and `onfocus` hands
  the page the way back into this card once the member types in it, so the page can return there after a Save.
  The editor's script loads as soon as the page is up; a press on the card before the editor is drawn opens it at
  once, and the caret goes where the press was, with the keys typed meanwhile (P1.21r). A press on the card around
  the words (its padding, below the last line) puts the caret at the nearest words. If the editor cannot load the
  blocks stay, with a line that says so. The parent remounts this component to throw the member's changes away
  (Discard).
-->
<script lang="ts">
import { onDestroy, onMount, tick } from "svelte";
import type { MarkdownEditor } from "../../editor/milkdown.ts";
import { TEXT_IN_PLACE } from "../../profile/messages.ts";
import type { Block } from "../../profile/types.ts";
import Readme from "./readme.svelte";

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
/** The page's script runs here: from now on a press on the card opens the editor (a press before that is the page's). */
let listening = $state(false);
let closed = false;
let opening: Promise<void> | undefined;
/** A press on the card before the editor was drawn, and the keys typed since: carried into the editor once it is. */
let early: { x: number; y: number; typed: string } | undefined;

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
    if (closed || host === undefined) return;
    const mounted = await mountMarkdownEditor(host, {
      value,
      labelledBy: labelId,
      // Each change reaches the page once a frame, as markdown; the card has no bar of its own yet (slice 3 adds one).
      onEdit: () => undefined,
      onChange: onedit,
      onToolbar: () => undefined,
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
    early = undefined;
  }
}

const open = () => {
  opening ??= mount();
  return opening;
};

function carryEarly(mounted: MarkdownEditor) {
  if (early === undefined) return;
  const { x, y, typed } = early;
  early = undefined;
  mounted.focusAt(x, y);
  if (typed !== "") mounted.type(typed);
}

/** A press the card's own controls, links and fields keep: never taken for a press on the words. */
const CONTROLS = "a, button, input, textarea, select, label, [role='menu'], [role='menuitem'], [role='dialog']";

function pressed(event: PointerEvent) {
  if (event.button !== 0 || failed || !(event.target instanceof Element)) return;
  if (event.target.closest(CONTROLS) !== null && !host?.contains(event.target)) return;
  if (editor === undefined) {
    if (event.target.closest("a") !== null) return;
    event.preventDefault();
    early = { x: event.clientX, y: event.clientY, typed: "" };
    void open();
    return;
  }
  if (event.target.closest(".ProseMirror") !== null) return;
  event.preventDefault();
  editor.focusAt(event.clientX, event.clientY);
}

/** Keys typed between an early press and the editor being drawn: letters and spaces, kept for the editor. */
function typedEarly(event: KeyboardEvent) {
  if (early === undefined || event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
  event.preventDefault();
  early.typed += event.key;
}

let cancel: (() => void) | undefined;
onMount(() => {
  // The script is fetched now; the editor is drawn when the browser is idle, or at once when the member presses.
  void import("../../editor/milkdown.ts").catch(() => undefined);
  cancel = whenIdle(() => void open());
  const card = host?.closest<HTMLElement>("[data-slot='card']") ?? host?.parentElement ?? undefined;
  card?.addEventListener("pointerdown", pressed);
  addEventListener("keydown", typedEarly);
  listening = true;
  return () => {
    card?.removeEventListener("pointerdown", pressed);
    removeEventListener("keydown", typedEarly);
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
<div
  bind:this={host}
  data-text-in-place
  data-listening={listening ? "" : undefined}
  onfocusin={() => editor !== undefined && onfocus?.(editor.focus)}
  class="{editor === undefined ? 'hidden' : ''} [&_.markdown-editor]:outline-none [&_.markdown-editor]:rounded-sm [&_.markdown-editor:focus-visible]:ring-[3px] [&_.markdown-editor:focus-visible]:ring-ring/50 [&_.markdown-editor]:flex [&_.markdown-editor]:flex-col [&_.markdown-editor]:gap-3 [&_h2]:text-2xl [&_h2]:leading-8 [&_h2]:font-bold [&_h2]:tracking-tight [&_h3]:mt-2 [&_h3]:text-xl [&_h3]:font-semibold [&_h4]:mt-1 [&_h4]:font-semibold [&_ul]:list-disc [&_ul]:ps-6 [&_ol]:list-decimal [&_ol]:ps-6 [&_blockquote]:border-s-3 [&_blockquote]:border-input [&_blockquote]:ps-3.5 [&_blockquote]:text-muted-foreground [&_pre]:rounded-sm [&_pre]:bg-muted [&_pre]:px-4 [&_pre]:py-3.5 [&_pre]:font-mono [&_code]:font-mono [&_a]:underline"
></div>
