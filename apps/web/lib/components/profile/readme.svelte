<!--
  The Text card's blocks (the #readme kind, ADR 0051; from apps/web/src/screens/profile/readme.tsx, P1.20i): parsed on
  the server by apps/web/lib/profile/parse.ts, rendered here as plain elements. Every member string is a text node
  (escaped by Svelte); raw HTML never reaches the page, and each link's href is already a safeHref result. The card has
  no title of its own (P1.21p), so its headings sit beside the other cards' titles: # is an h2, under the page's h1.
-->
<script lang="ts">
import type { Block, Inline, ListBlock } from "../../profile/types.ts";

let { blocks }: { blocks: readonly Block[] } = $props();
const HEADINGS = ["h2", "h3", "h4"] as const;
// The page's own type scale, not a document's (approved notebook direction, 2026-11-19): a first-level heading a step
// above a card title, the next at a card title's size, the last as bold body text. No rules underneath.
const HEADING_LOOK = [
  "text-2xl leading-8 font-bold tracking-tight",
  "mt-2 text-xl font-semibold",
  "mt-1 font-semibold",
] as const;
</script>

{#snippet inline(nodes: readonly Inline[])}
  {#each nodes as node, i (i)}
    {#if node.kind === "text"}{node.text}{:else if node.kind === "break"}<br />{:else if node.kind === "code"}<code class="rounded-sm bg-muted px-1 font-mono text-sm">{node.text}</code
      >{:else if node.kind === "strong"}<strong>{@render inline(node.children)}</strong
      >{:else if node.kind === "em"}<em>{@render inline(node.children)}</em
      >{:else}<a class="underline" href={node.href} rel="nofollow ugc noopener noreferrer"
        >{@render inline(node.children)}</a
      >{/if}
  {/each}
{/snippet}

{#snippet list(block: ListBlock)}
  {#if block.ordered}
    <ol class="list-decimal space-y-0.5 ps-6" start={block.start}>
      {#each block.items as item, j (j)}<li>{@render inline(item.text)}{#each item.lists as sub, k (k)}{@render list(sub)}{/each}</li>{/each}
    </ol>
  {:else}
    <ul class="list-disc space-y-0.5 ps-6 [&_ul]:list-[circle]">
      {#each block.items as item, j (j)}<li>{@render inline(item.text)}{#each item.lists as sub, k (k)}{@render list(sub)}{/each}</li>{/each}
    </ul>
  {/if}
{/snippet}

<!-- The base styles give a bare paragraph a margin (app.css); the card's inset is the edge, so the first and last lose it. -->
<div class="flex flex-col gap-3 *:first:mt-0 *:last:mb-0">
  {#each blocks as block, i (i)}
    {#if block.kind === "heading"}
      <svelte:element this={HEADINGS[block.level - 1] ?? "h4"} class={HEADING_LOOK[block.level - 1] ?? "font-semibold"}>
        {@render inline(block.children)}
      </svelte:element>
    {:else if block.kind === "paragraph"}
      <p>{@render inline(block.children)}</p>
    {:else if block.kind === "quote"}
      <blockquote class="flex flex-col gap-3 border-s-3 border-input ps-3.5 text-muted-foreground">
        {#each block.paragraphs as paragraph, j (j)}<p class="my-0">{@render inline(paragraph)}</p>{/each}
      </blockquote>
    {:else if block.kind === "list"}
      {@render list(block)}
    {:else if block.kind === "code"}
      <pre class="overflow-x-auto rounded-sm bg-muted px-4 py-3.5 font-mono text-[13px] leading-5"><code>{block.text}</code></pre>
    {:else}
      <hr />
    {/if}
  {/each}
</div>
