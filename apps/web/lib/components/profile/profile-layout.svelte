<!--
  The member page's frame (the profile-card mockup, Alex 2026-11-17): notices across the top, then the side column and
  the cards. Two columns on wide screens (a 280px side column, as the mockup); below that one column, the side column
  first. The shell gives this page a full-width main (ShellData.wide), so the frame starts under the header's menu
  button, as the mockup's page starts under its logo; it stops growing at 96rem and stays at the left.
-->
<script lang="ts">
import type { Snippet } from "svelte";

let { notices, side, children }: { notices?: Snippet; side: Snippet; children: Snippet } = $props();
</script>

<div class="flex max-w-[96rem] flex-col gap-6">
  {@render notices?.()}
  <div class="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
    <div class="min-w-0">{@render side()}</div>
    <div class="flex min-w-0 flex-col gap-6">{@render children()}</div>
  </div>
</div>
