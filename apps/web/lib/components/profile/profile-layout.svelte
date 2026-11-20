<!--
  The member page's frame (the profile-card mockup, Alex 2026-11-17): notices across the top, then the side column and
  the cards. Two columns on wide screens (a 280px side column, as the mockup); below that one column, the side column
  first. The shell gives this page a full-width main (ShellData.wide), so the frame starts under the header's menu
  button, as the mockup's page starts under its logo; it stops growing at 96rem and stays at the left.

  The compact layout (ADR 0072, P1.21o) has no side column: the header (profile-header.svelte), then the notices, then
  the cards in one centred area up to 64rem, wide enough for two half cards and short enough to read. Nothing sets a
  height, so the page is as long as its cards. The limited page (ADR 0078) has no cards, so it passes none.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import type { ProfileLayout } from "../../profile/types.ts";

let {
  layout = "sidebar",
  notices,
  side,
  children,
}: { layout?: ProfileLayout; notices?: Snippet; side: Snippet; children?: Snippet } = $props();
</script>

{#if layout === "compact"}
  <div class="mx-auto flex w-full max-w-5xl flex-col gap-6">
    {@render side()}
    {@render notices?.()}
    <div class="flex min-w-0 flex-col gap-6">{@render children?.()}</div>
  </div>
{:else}
  <div class="flex max-w-[96rem] flex-col gap-6">
    {@render notices?.()}
    <div class="grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div class="min-w-0">{@render side()}</div>
      <div class="flex min-w-0 flex-col gap-6">{@render children?.()}</div>
    </div>
  </div>
{/if}
