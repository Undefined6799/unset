<!--
  The in-place editor's table handles (target-look decision 7): one above the column and one beside the row under the
  pointer, each opening its menu, as the playground's table block draws them (@milkdown/components 7.23.0
  table-block). editor/tables.ts places them, shows and hides them (data-show) and runs the actions; this holds only
  the markup. A handle is a named button; its menu takes the focus, and the arrow keys move through it, Enter runs an
  item and Escape closes it with the focus back in the words. The header row offers only Add row below: GFM's table
  has exactly one header row, first.
-->
<script lang="ts">
import type { ColumnAction, RowAction, TableState } from "../../editor/tables.ts";
import { TEXT_MENUS } from "../../profile/messages.ts";
import { Icon, type IconName } from "../icon/index.ts";

let {
  state: shown,
  columnHandle = $bindable(),
  rowHandle = $bindable(),
  ontoggle,
  onclose,
  oncolumn,
  onrow,
}: {
  state: TableState;
  columnHandle?: HTMLElement;
  rowHandle?: HTMLElement;
  ontoggle: (which: "column" | "row") => void;
  onclose: () => void;
  oncolumn: (action: ColumnAction) => void;
  onrow: (action: RowAction) => void;
} = $props();

const COLUMN: readonly { action: ColumnAction; icon: IconName }[] = [
  { action: "addLeft", icon: "back" },
  { action: "addRight", icon: "next" },
  { action: "alignLeft", icon: "align-left" },
  { action: "alignCenter", icon: "align-center" },
  { action: "alignRight", icon: "align-right" },
  { action: "delete", icon: "delete" },
];
const ROW: readonly { action: RowAction; icon: IconName }[] = [
  { action: "addAbove", icon: "up" },
  { action: "addBelow", icon: "down" },
  { action: "delete", icon: "delete" },
];
/** The column's alignment as its menu item, so that item shows as the current one; none when the column has none. */
const ALIGN_ITEM = { left: "alignLeft", center: "alignCenter", right: "alignRight" } as const;
const currentAlign = $derived(shown?.align == null ? undefined : ALIGN_ITEM[shown.align]);
const rows = $derived(shown?.row === 0 ? ROW.filter((item) => item.action === "addBelow") : ROW);

let columnMenu: HTMLElement | undefined = $state();
let rowMenu: HTMLElement | undefined = $state();
// The open menu takes the focus on its first item, so its keys work at once.
$effect(() => {
  const menu = shown?.open === "column" ? columnMenu : shown?.open === "row" ? rowMenu : undefined;
  menu?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
});

function menuKey(event: KeyboardEvent) {
  const items = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[role='menuitem']")];
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (event.key === "Escape") onclose();
  else if (event.key === "ArrowDown") items[Math.min(at + 1, items.length - 1)]?.focus();
  else if (event.key === "ArrowUp") items[Math.max(at - 1, 0)]?.focus();
  else if (event.key === "Home") items[0]?.focus();
  else if (event.key === "End") items.at(-1)?.focus();
  else return;
  event.preventDefault();
  event.stopPropagation();
}

const floating = "absolute z-20 invisible data-[show=true]:visible";
const control =
  "inline-flex items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";
const menuClass = "absolute z-30 flex w-52 flex-col rounded-md border bg-popover p-1 text-popover-foreground shadow-md";
const itemClass =
  "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none";
</script>

<div bind:this={columnHandle} data-table-handle="column" data-show="false" class={floating}>
  <button
    type="button"
    class="{control} h-4 w-7"
    aria-label={TEXT_MENUS.table.column}
    aria-haspopup="menu"
    aria-expanded={shown?.open === "column"}
    onclick={() => ontoggle("column")}><Icon name="grip" size={16} class="rotate-90" /></button
  >
  {#if shown?.open === "column"}
    <div bind:this={columnMenu} role="menu" tabindex="-1" aria-label={TEXT_MENUS.table.column} class="{menuClass} start-0 top-full mt-1" onkeydown={menuKey}>
      {#each COLUMN as item (item.action)}
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          class={itemClass}
          aria-current={item.action === currentAlign ? "true" : undefined}
          onclick={() => oncolumn(item.action)}><Icon name={item.icon} size={16} />{TEXT_MENUS.table.columnActions[item.action]}</button
        >
      {/each}
    </div>
  {/if}
</div>

<div bind:this={rowHandle} data-table-handle="row" data-show="false" class={floating}>
  <button
    type="button"
    class="{control} h-7 w-4"
    aria-label={TEXT_MENUS.table.row}
    aria-haspopup="menu"
    aria-expanded={shown?.open === "row"}
    onclick={() => ontoggle("row")}><Icon name="grip" size={16} /></button
  >
  {#if shown?.open === "row"}
    <div bind:this={rowMenu} role="menu" tabindex="-1" aria-label={TEXT_MENUS.table.row} class="{menuClass} start-full top-0 ms-1" onkeydown={menuKey}>
      {#each rows as item (item.action)}
        <button type="button" role="menuitem" tabindex="-1" class={itemClass} onclick={() => onrow(item.action)}
          ><Icon name={item.icon} size={16} />{TEXT_MENUS.table.rowActions[item.action]}</button
        >
      {/each}
    </div>
  {/if}
</div>
