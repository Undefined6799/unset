<!--
  A header menu with script (book P1.22m, ADR 0116 points 8 and 9): the stock shadcn-svelte Dropdown Menu over bits-ui
  2.20.6, for its arrow keys, typeahead, focus return and menu roles (node_modules/bits-ui
  dist/bits/menu/menu.svelte.js). The three-line menu and the Create menu are both this: rows whose feature does not
  exist yet, each a disabled menu item that says so, then the rows that run today, each a link. More actions, the
  header's menu under 640px, is this too: Create's rows as a group with a heading, then the rows that open a panel of
  the shell's. The shell draws the menu with no script itself, as a native popover, and loads this file once the
  client has started.
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
  heading,
  actions = [],
  onClosed,
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
  /** A name for the rows above, drawn over them, when they are a group among other rows. */
  heading?: string | undefined;
  /**
   * Rows after those: each is a link, or tells the shell it was chosen. A count is drawn at the row's end, and the
   * row is then named by the count's own words.
   */
  actions?: readonly {
    label: string;
    icon: IconName;
    href?: string | undefined;
    onSelect?: (() => void) | undefined;
    count?: { badge: string; name: string } | undefined;
  }[];
  /** Called once the menu has closed and gone from the page. */
  onClosed?: (() => void) | undefined;
} = $props();

// A row is a 44px target on touch, as the header's own controls are. The row the pointer or the keys are on is muted:
// the library marks it with the accent colour, which in our theme is the menu's own surface (shared/ui/theme.css).
const row = "pointer-coarse:min-h-11";
const link = `${row} data-highlighted:bg-muted focus:bg-muted`;
</script>

{#snippet rows()}
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
{/snippet}
{#snippet actionRow(item: (typeof actions)[number])}
  <Icon name={item.icon} size={16} />
  {#if item.count === undefined}
    {item.label}
  {:else}
    <span aria-hidden="true">{item.label}</span>
    <DropdownMenu.Shortcut aria-hidden="true" class="tracking-normal">{item.count.badge}</DropdownMenu.Shortcut>
    <span class="sr-only">{item.count.name}</span>
  {/if}
{/snippet}

<DropdownMenu.Root bind:open onOpenChangeComplete={(now) => !now && onClosed?.()}>
  <DropdownMenu.Trigger bind:ref={button} class={triggerClass}>{@render trigger()}</DropdownMenu.Trigger>
  <DropdownMenu.Content {id} {align} aria-label={label} class="w-64 max-w-[calc(100vw-1rem)]">
    {#if heading === undefined}
      {@render rows()}
    {:else}
      <DropdownMenu.Group>
        <DropdownMenu.GroupHeading>{heading}</DropdownMenu.GroupHeading>
        {@render rows()}
      </DropdownMenu.Group>
    {/if}
    {#if actions.length > 0}
      <DropdownMenu.Separator />
      {#each actions as item (item.label)}
        {#if item.href === undefined}
          <DropdownMenu.Item class={link} onSelect={() => item.onSelect?.()}>{@render actionRow(item)}</DropdownMenu.Item>
        {:else}
          <DropdownMenu.Item class={link}>
            {#snippet child({ props })}
              <a {...props} href={item.href}>{@render actionRow(item)}</a>
            {/snippet}
          </DropdownMenu.Item>
        {/if}
      {/each}
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
