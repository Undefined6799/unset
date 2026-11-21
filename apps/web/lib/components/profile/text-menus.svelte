<!--
  The in-place editor's side handle, block menu and floating bar (P1.21v slice 3), drawn as Crepe 7.23.0 draws them,
  with our components and icons. editor/menus.ts places them, shows and hides them (data-show) and says what they
  hold; this holds only the markup. Every control is a named button; the block menu is a listbox whose active option
  the editor names (aria-activedescendant), so it is read as the member moves through it with the arrow keys. A
  press on any of them keeps the editor's focus and selection. The handle shows only for a pointer that can hover.
-->
<script lang="ts">
import type { BarItem, BlockItem, MenusState } from "../../editor/menus.ts";
import { TEXT_MENUS } from "../../profile/messages.ts";
import { Icon, type IconName } from "../icon/index.ts";

let {
  state,
  optionId,
  handle = $bindable(),
  add = $bindable(),
  menu = $bindable(),
  bar = $bindable(),
  onchoose,
  onformat,
}: {
  state: MenusState;
  optionId: (item: BlockItem) => string;
  handle?: HTMLElement;
  add?: HTMLElement;
  menu?: HTMLElement;
  bar?: HTMLElement;
  onchoose: (item: BlockItem) => void;
  onformat: (item: BarItem) => void;
} = $props();

const BLOCK_ICONS: Partial<Record<BlockItem, IconName>> = {
  heading1: "heading",
  heading2: "heading",
  heading3: "heading",
  quote: "quote",
  bullets: "list",
  numbers: "numbered-list",
  codeBlock: "code-block",
};
/** Crepe's three groups, each headed by its name. */
const GROUPS: Record<BlockItem, keyof typeof TEXT_MENUS.groups> = {
  text: "text",
  heading1: "text",
  heading2: "text",
  heading3: "text",
  quote: "text",
  divider: "text",
  bullets: "list",
  numbers: "list",
  codeBlock: "advanced",
};
const BAR_ICONS: Record<BarItem, IconName> = { strong: "bold", emphasis: "italic", code: "inline-code" };

const keep = (event: Event) => event.preventDefault();
// Hidden by visibility, not display (Crepe's CSS does the same with opacity): floating-ui measures the element before
// it is shown, which it cannot do with no box.
const floating = "absolute z-20 flex invisible data-[show=true]:visible";
const control =
  "inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
</script>

<div bind:this={handle} data-block-handle data-show="false" class="{floating} gap-0.5 pointer-coarse:data-[show=true]:invisible">
  <button bind:this={add} type="button" class={control} aria-label={TEXT_MENUS.add}><Icon name="add" /></button>
  <!-- Not a button: a browser starts no drag from a form control, and the grip has no key to press. It is named, and
       moving a block by keys is its own follow-up (plugin-block has no key for it). -->
  <span role="img" class="{control} cursor-grab" aria-label={TEXT_MENUS.drag} title={TEXT_MENUS.drag}><Icon name="menu" /></span>
</div>

<div bind:this={menu} data-show="false" class="{floating} w-56 flex-col rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
  <ul role="listbox" aria-label={TEXT_MENUS.blocks} class="max-h-72 overflow-y-auto" onpointerdown={keep}>
    {#each state.items as item, at (item)}
      {#if at === 0 || GROUPS[state.items[at - 1] as BlockItem] !== GROUPS[item]}
        <li role="presentation" class="px-2 pt-2 pb-1 text-xs text-muted-foreground">{TEXT_MENUS.groups[GROUPS[item]]}</li>
      {/if}
      <li
        id={optionId(item)}
        role="option"
        aria-selected={at === state.index}
        class="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
        onclick={() => onchoose(item)}
        onkeydown={() => undefined}
      >
        {#if BLOCK_ICONS[item] !== undefined}<Icon name={BLOCK_ICONS[item]} size={16} />{:else}<span class="size-4"></span>{/if}
        {TEXT_MENUS.items[item]}
      </li>
    {/each}
  </ul>
</div>

<div bind:this={bar} data-show="false" role="toolbar" tabindex="-1" aria-label={TEXT_MENUS.bar} class="{floating} gap-0.5 rounded-md border bg-popover p-0.5 shadow-md" onpointerdown={keep}>
  {#each ["strong", "emphasis", "code"] as const as item (item)}
    <button
      type="button"
      class="{control} aria-pressed:bg-accent aria-pressed:text-accent-foreground"
      aria-label={TEXT_MENUS.format[item]}
      aria-pressed={state.on.has(item)}
      onclick={() => onformat(item)}><Icon name={BAR_ICONS[item]} /></button
    >
  {/each}
</div>
