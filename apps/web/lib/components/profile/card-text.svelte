<!--
  A Text card's words on the owner's page, edited where they stand (ADR 0074 item 4): no Edit press and no Write and
  Preview tabs. The server renders the card's blocks as every visitor sees them (readme.svelte), and with no script
  they stay so; the card's own form (card-editor.svelte) still edits it. With script, once the browser is idle, the
  Milkdown editor (P1.21u, editor/milkdown.ts) is drawn in their place and opened on `value` (the unsaved words, else
  the stored ones), and every change is handed to `onedit` as markdown, once a frame; `flushes` holds this card's way
  to hand over a change still waiting for its frame, which the page runs before it builds a Save. If the editor
  cannot load the blocks stay. The parent remounts this component to throw the member's changes away (Discard).
-->
<script lang="ts">
import { onDestroy, onMount } from "svelte";
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
}: {
  blocks: readonly Block[];
  name: string;
  value: string;
  onedit: (markdown: string) => void;
  flushes: Set<() => void>;
} = $props();

const id = $props.id();
const labelId = `${id}-label`;
let host: HTMLDivElement | undefined = $state();
let editor: MarkdownEditor | undefined = $state();
let closed = false;

/** Once the browser has nothing else to do: the page's own work and first paint come before the editor's script. */
function whenIdle(run: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(run, { timeout: 2000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(run, 200);
  return () => clearTimeout(id);
}

async function open() {
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
  } catch {
    // The editor could not load: the blocks stay, and the card's own form still edits it.
  }
}

let cancel: (() => void) | undefined;
onMount(() => {
  cancel = whenIdle(() => void open());
});
onDestroy(() => {
  closed = true;
  cancel?.();
  if (editor !== undefined) flushes.delete(editor.flush);
  void editor?.destroy();
});
</script>

<span id={labelId} class="sr-only">{TEXT_IN_PLACE.label(name)}</span>
{#if editor === undefined}<Readme {blocks} />{/if}
<div
  bind:this={host}
  data-text-in-place
  class="{editor === undefined ? 'hidden' : ''} [&_.markdown-editor]:outline-none [&_.markdown-editor]:flex [&_.markdown-editor]:flex-col [&_.markdown-editor]:gap-3 [&_h2]:text-2xl [&_h2]:leading-8 [&_h2]:font-bold [&_h2]:tracking-tight [&_h3]:mt-2 [&_h3]:text-xl [&_h3]:font-semibold [&_h4]:mt-1 [&_h4]:font-semibold [&_ul]:list-disc [&_ul]:ps-6 [&_ol]:list-decimal [&_ol]:ps-6 [&_blockquote]:border-s-3 [&_blockquote]:border-input [&_blockquote]:ps-3.5 [&_blockquote]:text-muted-foreground [&_pre]:rounded-sm [&_pre]:bg-muted [&_pre]:px-4 [&_pre]:py-3.5 [&_pre]:font-mono [&_code]:font-mono [&_a]:underline"
></div>
