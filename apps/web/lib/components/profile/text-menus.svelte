<!--
  The in-place editor's side handle, block menu and floating bar (P1.21v slice 3), drawn as Crepe 7.23.0 draws them,
  with our components and icons. editor/menus.ts places them, shows and hides them (data-show) and says what they
  hold; this holds only the markup. Every control is a named button; the block menu is a listbox whose active option
  the editor names (aria-activedescendant), so it is read as the member moves through it with the arrow keys. A
  press on any of them keeps the editor's focus and selection. The handle shows only for a pointer that can hover.
-->
<script lang="ts">
import { BLOCK_GROUPS, type BlockGroup, groupOf } from "../../editor/block-items.ts";
import type { BarItem, BlockItem, MenusState } from "../../editor/menus.ts";
import { TEXT_MENUS } from "../../profile/messages.ts";
import { Icon, type IconName } from "../icon/index.ts";

let {
  state: shown,
  optionId,
  handle = $bindable(),
  add = $bindable(),
  grip = $bindable(),
  menu = $bindable(),
  bar = $bindable(),
  linkEdit = $bindable(),
  linkPreview = $bindable(),
  onchoose,
  onpoint,
  onformat,
  onlink,
}: {
  state: MenusState;
  optionId: (item: BlockItem) => string;
  handle?: HTMLElement;
  add?: HTMLElement;
  grip?: HTMLElement;
  menu?: HTMLElement;
  bar?: HTMLElement;
  linkEdit?: HTMLElement;
  linkPreview?: HTMLElement;
  onchoose: (item: BlockItem) => void;
  /** A tab was pressed: its group's first shown item becomes the active one. */
  onpoint: (item: BlockItem) => void;
  onformat: (item: BarItem) => void;
  /** The link editor's and preview's actions (editor/menus.ts Menus). */
  onlink: {
    confirm: (address: string) => void;
    cancel: () => void;
    edit: () => void;
    remove: () => void;
  };
} = $props();

/** Each item's icon, as Crepe draws one for each: Iconoir, and Lucide's numbered headings (ADR 0109). */
const BLOCK_ICONS: Record<BlockItem, IconName> = {
  text: "text",
  heading1: "h1",
  heading2: "h2",
  heading3: "h3",
  heading4: "h4",
  heading5: "h5",
  heading6: "h6",
  quote: "quote",
  divider: "remove",
  bullets: "list",
  numbers: "numbered-list",
  tasks: "task-list",
  codeBlock: "code-block",
  table: "table",
};
/** The tabs: each group with an item shown, and its first shown item, which a press on the tab makes active. */
const tabs = $derived(
  (Object.keys(BLOCK_GROUPS) as BlockGroup[]).flatMap((group) => {
    const first = shown.items.find((item) => groupOf(item) === group);
    return first === undefined ? [] : [{ group, first }];
  }),
);
const activeGroup = $derived.by(() => {
  const active = shown.items[shown.index];
  return active === undefined ? undefined : groupOf(active);
});
const BAR_ICONS: Record<BarItem, IconName> = {
  strong: "bold",
  emphasis: "italic",
  strike: "strikethrough",
  code: "inline-code",
  link: "link",
};
const refusedId = $props.id();

let list: HTMLUListElement | undefined = $state();
// The active item is scrolled to the top of the list, under its group's name when it is the group's first, as Crepe's
// scrollToIndex does on every key and tab press.
$effect(() => {
  const active = shown.items[shown.index];
  const row = active === undefined ? null : document.getElementById(optionId(active));
  if (list === undefined || row === null) return;
  const heading =
    row.previousElementSibling?.getAttribute("role") === "presentation" ? row.previousElementSibling : row;
  list.scrollTop = (heading as HTMLElement).offsetTop - list.offsetTop;
});

let address = $state("");
// The field holds what the editor opened it with, each time it opens (an empty field, or the link being edited).
$effect.pre(() => {
  if (shown.link?.mode === "edit" && !shown.link.refused) address = shown.link.value;
});

// Enter sets the link and Escape closes the editor; neither reaches the page's own keys (Crepe link-edit).
function addressKey(event: KeyboardEvent) {
  if (event.key !== "Enter" && event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Enter") onlink.confirm(address);
  else onlink.cancel();
}

function copy() {
  if (shown.link?.mode !== "preview") return;
  void navigator.clipboard?.writeText(shown.link.href).catch(() => undefined);
}

const keep = (event: Event) => event.preventDefault();
// Hidden by visibility, not display (Crepe's CSS does the same with opacity): floating-ui measures the element before
// it is shown, which it cannot do with no box.
const floating = "absolute z-20 flex invisible data-[show=true]:visible";
// The link editor and preview are shown only by an explicit show(), which marks them shown before placing them, so
// they take no room while hidden: an invisible one beside a narrow card would scroll a phone's page sideways.
const placedOnShow = "absolute z-20 hidden data-[show=true]:flex max-w-[calc(100vw-2rem)]";
const control =
  "inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
</script>

<div bind:this={handle} data-block-handle data-show="false" class="{floating} gap-0.5 pointer-coarse:data-[show=true]:invisible">
  <button bind:this={add} type="button" class={control} aria-label={TEXT_MENUS.add}><Icon name="add" /></button>
  <!-- Not a <button>: a browser starts no drag from a form control. Dragged, it moves its block; pressed, it opens
       the block menu to change that block (Alex 2026-11-21 18:48Z). Keys need neither: blocks move by Mod-Shift-Arrow
       and change by "/" (menus.ts). The six dots are Crepe's handle, Lucide's grip (ADR 0087). -->
  <span bind:this={grip} role="button" tabindex="-1" class="{control} cursor-grab" aria-label={TEXT_MENUS.drag} title={TEXT_MENUS.drag}><Icon name="grip" /></span>
</div>

<div bind:this={menu} data-show="false" class="{floating} w-56 flex-col rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
  <!-- Crepe's tab-group: the groups' names; the one holding the active item is current. A press keeps the editor's
       focus, so the arrow keys still move through the menu. -->
  <div role="group" aria-label={TEXT_MENUS.tabs} class="flex gap-1 border-b px-1 pb-1" onpointerdown={keep}>
    {#each tabs as tab (tab.group)}
      <button
        type="button"
        tabindex="-1"
        class="rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-[current=true]:bg-muted aria-[current=true]:text-foreground"
        aria-current={tab.group === activeGroup}
        onclick={() => onpoint(tab.first)}>{TEXT_MENUS.groups[tab.group]}</button
      >
    {/each}
  </div>
  <ul bind:this={list} role="listbox" aria-label={TEXT_MENUS.blocks} class="max-h-72 overflow-y-auto" onpointerdown={keep}>
    {#each shown.items as item, at (item)}
      {#if at === 0 || groupOf(shown.items[at - 1] as BlockItem) !== groupOf(item)}
        <li role="presentation" class="px-2 pt-2 pb-1 text-xs text-muted-foreground">{TEXT_MENUS.groups[groupOf(item)]}</li>
      {/if}
      <li
        id={optionId(item)}
        role="option"
        aria-selected={at === shown.index}
        class="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm aria-selected:bg-muted"
        onclick={() => onchoose(item)}
        onkeydown={() => undefined}
      >
        <Icon name={BLOCK_ICONS[item]} size={16} />
        {TEXT_MENUS.items[item]}
      </li>
    {/each}
  </ul>
</div>

<div bind:this={bar} data-show="false" role="toolbar" tabindex="-1" aria-label={TEXT_MENUS.bar} class="{floating} gap-0.5 rounded-md border bg-popover p-0.5 shadow-md" onpointerdown={keep}>
  {#each ["strong", "emphasis", "strike", "code", "link"] as const as item (item)}
    <button
      type="button"
      class="{control} aria-pressed:bg-accent aria-pressed:text-accent-foreground"
      aria-label={TEXT_MENUS.format[item]}
      aria-pressed={shown.on.has(item)}
      onclick={() => onformat(item)}><Icon name={BAR_ICONS[item]} /></button
    >
  {/each}
</div>

<div bind:this={linkEdit} data-show="false" data-text-popover role="dialog" aria-label={TEXT_MENUS.link.editor} class="{placedOnShow} w-72 flex-col gap-1 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
  <div class="flex items-center gap-1">
    <input
      bind:value={address}
      type="url"
      class="h-8 min-w-0 flex-1 rounded-sm bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
      aria-label={TEXT_MENUS.link.address}
      aria-invalid={shown.link?.mode === "edit" && shown.link.refused}
      aria-describedby={shown.link?.mode === "edit" && shown.link.refused ? refusedId : undefined}
      placeholder={TEXT_MENUS.link.placeholder}
      onkeydown={addressKey}
    />
    {#if address !== ""}
      <button type="button" class={control} aria-label={TEXT_MENUS.link.apply} onclick={() => onlink.confirm(address)}><Icon name="done" /></button>
    {/if}
  </div>
  {#if shown.link?.mode === "edit" && shown.link.refused}
    <p id={refusedId} role="alert" class="px-2 pb-1 text-xs text-destructive">{TEXT_MENUS.link.refused}</p>
  {/if}
</div>

<div bind:this={linkPreview} data-show="false" data-text-popover role="group" aria-label={TEXT_MENUS.link.preview} class="{placedOnShow} items-center gap-0.5 rounded-md border bg-popover p-0.5 text-sm text-popover-foreground shadow-md" onpointerdown={keep}>
  {#if shown.link?.mode === "preview"}
    <button type="button" class={control} aria-label={TEXT_MENUS.link.copy} onclick={copy}><Icon name="copy" /></button>
    {#if shown.link.safe !== null}
      <a href={shown.link.safe} target="_blank" rel="noopener noreferrer" class="min-w-0 truncate px-1 underline">{shown.link.href}</a>
    {:else}
      <span class="min-w-0 truncate px-1 text-muted-foreground">{shown.link.href}</span>
    {/if}
    <button type="button" class={control} aria-label={TEXT_MENUS.link.edit} onclick={onlink.edit}><Icon name="edit" /></button>
    <button type="button" class={control} aria-label={TEXT_MENUS.link.remove} onclick={onlink.remove}><Icon name="delete" /></button>
  {/if}
</div>
