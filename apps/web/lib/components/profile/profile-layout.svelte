<!--
  The member page's frame (ADR 0072, P1.21o; the only layout since ADR 0077): the profile header (profile-header.svelte),
  then the notices, then the cards in one centred area up to 64rem, wide enough for two half cards and short enough to
  read. Nothing sets a height, so the page is as long as its cards. On the owner's page `bar` (unsaved-bar.svelte) comes
  first, above the name and avatar, and sticks under the site header (ADR 0074 item 4).
-->
<script lang="ts">
import type { Snippet } from "svelte";

let { bar, notices, header, children }: { bar?: Snippet; notices?: Snippet; header: Snippet; children: Snippet } =
  $props();
</script>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-6">
  {@render bar?.()}
  {@render header()}
  {@render notices?.()}
  <div class="flex min-w-0 flex-col gap-6">{@render children()}</div>
</div>
