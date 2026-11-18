<!-- A legal page (P2.15; P1.20d): the placeholder banner, the version, then the document as its load parsed it. -->
<script lang="ts">
  import Runs from "./Runs.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.title}</title></svelte:head>

<p>This page is a placeholder. It has not been reviewed by a lawyer, and it is not legal advice.</p>
{#if data.version !== null}<p>Version {data.version}.</p>{/if}
{#each data.sections as section, i (i)}
  {#if section.kind === "h"}
    <svelte:element this={`h${section.level}`}><Runs runs={section.runs} /></svelte:element>
  {:else if section.kind === "p"}
    <p><Runs runs={section.runs} /></p>
  {:else if section.kind === "ul"}
    <ul>{#each section.items as item, j (j)}<li><Runs runs={item} /></li>{/each}</ul>
  {:else}
    <table>
      <thead><tr>{#each section.headers as cell, j (j)}<th><Runs runs={cell} /></th>{/each}</tr></thead>
      <tbody>
        {#each section.rows as row, j (j)}<tr>{#each row as cell, k (k)}<td><Runs runs={cell} /></td>{/each}</tr>{/each}
      </tbody>
    </table>
  {/if}
{/each}
