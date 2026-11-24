<!--
  A header panel with script (book P1.22m, ADR 0116 points 8 and 9): the stock shadcn-svelte Popover over bits-ui
  2.20.6, for its place under the button, the focus it holds while open and gives back, Escape and the press outside
  (node_modules/bits-ui dist/bits/popover/components/popover-content.svelte). Messages, the bell's panel and Search on
  a phone are this: a title row with a Close button, as the native panel has, then what the shell passes. The library
  gives the panel no role, so it is named here: a dialog, labelled by its title. A panel taller than the room under
  its button scrolls, as the native one does and as the stock menu's content does: its height is capped at what the
  library measured (--bits-popover-content-available-height, bits-ui dist/internal/floating-svelte/
  floating-utils.svelte.js), which leaves the 8px it keeps from the window's edges; the stock Popover file sets no
  cap. The shell draws Messages and Search with no script itself, as native popovers, and the bell as a link to its
  page, and loads this file once the client has started.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import { Icon } from "../icon/index.ts";
import { buttonVariants } from "../ui/button/index.ts";
import * as Popover from "../ui/popover/index.ts";

let {
  open = $bindable(false),
  button = $bindable(null),
  title,
  closeLabel,
  triggerClass,
  trigger,
  class: className = "",
  onOpened,
  children,
}: {
  open?: boolean;
  /** The panel's button, for the shell to give focus to when it swaps this panel in. */
  button?: HTMLElement | null;
  title: string;
  /** The Close button's name, which says what it closes. */
  closeLabel: string;
  triggerClass: string;
  /** What the button shows. */
  trigger: Snippet;
  /** The panel's width, where it is not the header panels' own. */
  class?: string;
  /** Called each time the panel opens. */
  onOpened?: (() => void) | undefined;
  children: Snippet;
} = $props();

const id = $props.id();
</script>

<Popover.Root bind:open onOpenChange={(now) => now && onOpened?.()}>
  <Popover.Trigger bind:ref={button} class={triggerClass}>{@render trigger()}</Popover.Trigger>
  <Popover.Content
    role="dialog"
    aria-labelledby="{id}-title"
    align="end"
    collisionPadding={8}
    class="flex max-h-(--bits-popover-content-available-height) w-80 max-w-[calc(100vw-1rem)] flex-col gap-1 overflow-x-hidden overflow-y-auto rounded-lg p-2 {className}"
  >
    <div class="flex items-center justify-between gap-2 py-1 pr-1 pl-3">
      <h2 id="{id}-title" class="font-semibold">{title}</h2>
      <Popover.Close class="{buttonVariants({ variant: 'ghost', size: 'icon-sm' })} pointer-coarse:size-11">
        <Icon name="close" size={20} label={closeLabel} />
      </Popover.Close>
    </div>
    {@render children()}
  </Popover.Content>
</Popover.Root>
