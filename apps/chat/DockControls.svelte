<!--
  The chat box's controls at the end of its top bar (ADR 0115; Alex 2026-11-23): a three-dot menu with "Open full
  chat" (the chat page in a new tab), and, on a conversation, Minimise (to its avatar at the bottom of unset.sh) and
  Close. Part of the chat page's shell (ADR 0055 point 2): stock components laid out with Tailwind.
-->
<script lang="ts">
import { Icon } from "./lib/components/icon/index.js";
import { Button, buttonVariants } from "./lib/components/ui/button/index.js";
import * as DropdownMenu from "./lib/components/ui/dropdown-menu/index.js";

let { onMinimise, onClose }: { onMinimise?: () => void; onClose: () => void } = $props();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger class={buttonVariants({ variant: "ghost", size: "icon" })} data-dock-menu>
    <Icon name="more" label="More" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end">
    <DropdownMenu.Item>
      {#snippet child({ props })}
        <a {...props} href="/" target="_blank" rel="noopener"><Icon name="external" size={16} />Open full chat</a>
      {/snippet}
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
{#if onMinimise !== undefined}
  <Button variant="ghost" size="icon" onclick={onMinimise} data-dock-minimise>
    <Icon name="remove" label="Minimise" />
  </Button>
{/if}
<Button variant="ghost" size="icon" onclick={onClose} data-dock-close><Icon name="close" label="Close" /></Button>
