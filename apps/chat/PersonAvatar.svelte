<!--
  A chat partner's avatar, part of the chat page's shell (ADR 0099; ADR 0055 point 2): for now the first letter of
  their handle (core/dock.ts initialOf) on the stock Avatar's fallback, as the dock mock-up draws it
  (chat-mockup/dock-v1.html; Alex 2026-11-23: "an avatar of the person, let's say for now"). The handle is the
  member's own text, which Svelte escapes.
-->
<script lang="ts">
import { initialOf } from "./core/dock.ts";
import * as Avatar from "./lib/components/ui/avatar/index.js";

let { handle, class: className }: { handle: string; class?: string } = $props();
</script>

<Avatar.Root class={className} aria-hidden="true">
  <Avatar.Fallback class="bg-primary text-primary-foreground font-medium">{initialOf(handle)}</Avatar.Fallback>
</Avatar.Root>
