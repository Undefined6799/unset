<!-- A legal page (P2.15; P1.20d): the placeholder banner, the version, then the document as its load filled it. Text
     is always escaped by Svelte; links are the ones the parser accepted. -->
<script lang="ts">
import type { Run } from "../../../lib/legal.ts";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();
</script>

{#snippet runs(list: Run[])}{#each list as run, i (i)}{#if run.kind === "text"}{run.text}{:else if run.kind === "strong"}<strong
        >{@render runs(run.children)}</strong
      >{:else}<a href={run.href}>{@render runs(run.children)}</a>{/if}{/each}{/snippet}

<svelte:head><title>{data.title}</title></svelte:head>

<p>This page is a placeholder. It has not been reviewed by a lawyer, and it is not legal advice.</p>
{#if data.version !== null}<p>Version {data.version}.</p>{/if}
{#each data.sections as section, i (i)}
  {#if section.kind === "h"}
    <svelte:element this={`h${section.level}`}>{@render runs(section.runs)}</svelte:element>
  {:else if section.kind === "p"}
    <p>{@render runs(section.runs)}</p>
  {:else if section.kind === "ul"}
    <ul>{#each section.items as item, j (j)}<li>{@render runs(item)}</li>{/each}</ul>
  {:else}
    <table>
      <thead><tr>{#each section.headers as cell, j (j)}<th>{@render runs(cell)}</th>{/each}</tr></thead>
      <tbody>
        {#each section.rows as row, j (j)}<tr>{#each row as cell, k (k)}<td>{@render runs(cell)}</td>{/each}</tr>{/each}
      </tbody>
    </table>
  {/if}
{/each}
