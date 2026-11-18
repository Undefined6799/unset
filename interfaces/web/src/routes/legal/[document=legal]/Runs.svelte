<!-- A legal document's inline text (P1.20d): text, bold and links, nested; text is always escaped by Svelte. -->
<script lang="ts">
  import Runs from "./Runs.svelte";
  import type { Run } from "./+page.server.ts";

  let { runs }: { runs: Run[] } = $props();
</script>

{#each runs as run, i (i)}{#if run.kind === "text"}{run.text}{:else if run.kind === "strong"}<strong
      ><Runs runs={run.children} /></strong
    >{:else}<a href={run.href}><Runs runs={run.children} /></a>{/if}{/each}
