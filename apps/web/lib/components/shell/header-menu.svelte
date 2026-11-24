<!--
  A header menu with script (book P1.22m, ADR 0116 points 8 and 9): the stock shadcn-svelte Dropdown Menu over bits-ui
  2.20.6, for its arrow keys, typeahead, focus return and menu roles (node_modules/bits-ui
  dist/bits/menu/menu.svelte.js). The three-line menu and the Create menu are both this: rows whose feature does not
  exist yet, each a disabled menu item that says so, then the rows that run today, each a link. The shell draws the
  menu with no script itself, as a native popover, and loads this file once the client has started.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import { Icon, type IconName } from "../icon/index.ts";
import * as DropdownMenu from "../ui/dropdown-menu/index.ts";

let {
  open = $bindable(false),
  button = $bindable(null),
  id,
  label,
  align,
  triggerClass,
  trigger,
  soon,
  links,
  comingSoon,
}: {
  open?: boolean;
  /** The menu's button, for the shell to give focus to when it swaps this menu in. */
  button?: HTMLElement | null;
  /** The id the native menu had, when the stock one replaces it in the document. */
  id?: string | undefined;
  /** The menu's name: the title the native menu shows. */
  label: string;
  /** The edge of the button the menu lines up with. */
  align: "start" | "end";
  triggerClass: string;
  /** What the button shows. */
  trigger: Snippet;
  /** The rows whose feature is coming: drawn disabled, and skipped by the keys. */
  soon: readonly { label: string; icon: IconName }[];
  /** The rows that run today. */
  links: readonly { label: string; icon: IconName; href: string }[];
  comingSoon: string;
} = $props();

// A row is a 44px target on touch, as the header's own controls are. The row the pointer or the keys are on is muted:
// the library marks it with the accent colour, which in our theme is the menu's own surface (shared/ui/theme.css).
const row = "pointer-coarse:min-h-11";
const link = `${row} data-highlighted:bg-muted focus:bg-muted`;
</script>

<DropdownMenu.Root bind:open>
  <DropdownMenu.Trigger bind:ref={button} class={triggerClass}>{@render trigger()}</DropdownMenu.Trigger>
  <DropdownMenu.Content {id} {align} aria-label={label} class="w-64 max-w-[calc(100vw-1rem)]">
    {#each soon as item (item.label)}
      <DropdownMenu.Item disabled class={row}>
        <!-- One string for assistive technology, since a gap between two flex items reads as a space. -->
        <Icon name={item.icon} size={16} /><span aria-hidden="true">{item.label}</span>
        <DropdownMenu.Shortcut aria-hidden="true" class="tracking-normal">{comingSoon}</DropdownMenu.Shortcut>
        <span class="sr-only">{item.label}, {comingSoon}</span>
      </DropdownMenu.Item>
    {/each}
    {#if soon.length > 0 && links.length > 0}<DropdownMenu.Separator />{/if}
    {#each links as item (item.href)}
      <DropdownMenu.Item class={link}>
        {#snippet child({ props })}
          <a {...props} href={item.href}><Icon name={item.icon} size={16} />{item.label}</a>
        {/snippet}
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
