<!--
  The README card's blocks (ADR 0051; from apps/web/src/screens/profile/readme.tsx, P1.20i): parsed on the server by
  apps/web/lib/profile/parse.ts, rendered here as plain elements. Every member string is a text node (escaped by
  Svelte); raw HTML never reaches the page, and each link's href is already a safeHref result. The card's own title is
  an h2, so README headings start at h3.
-->
<script lang="ts">
import type { Block, Inline } from "../../profile/types.ts";

let { blocks }: { blocks: readonly Block[] } = $props();
const HEADINGS = ["h3", "h4", "h5"] as const;
</script>

{#snippet inline(nodes: readonly Inline[])}
  {#each nodes as node, i (i)}
    {#if node.kind === "text"}{node.text}{:else if node.kind === "code"}<code class="font-mono">{node.text}</code
      >{:else if node.kind === "strong"}<strong>{@render inline(node.children)}</strong
      >{:else if node.kind === "em"}<em>{@render inline(node.children)}</em
      >{:else}<a class="underline" href={node.href} rel="nofollow ugc noopener noreferrer"
        >{@render inline(node.children)}</a
      >{/if}
  {/each}
{/snippet}

<div class="flex flex-col gap-3">
  {#each blocks as block, i (i)}
    {#if block.kind === "heading"}
      <svelte:element this={HEADINGS[block.level - 1] ?? "h5"} class="font-semibold">
        {@render inline(block.children)}
      </svelte:element>
    {:else if block.kind === "paragraph"}
      <p>{@render inline(block.children)}</p>
    {:else if block.kind === "quote"}
      <blockquote class="text-muted-foreground border-s-2 ps-4"><p>{@render inline(block.children)}</p></blockquote>
    {:else if block.kind === "list"}
      {#if block.ordered}
        <ol class="list-decimal ps-6" start={block.start}>
          {#each block.items as item, j (j)}<li>{@render inline(item)}</li>{/each}
        </ol>
      {:else}
        <ul class="list-disc ps-6">
          {#each block.items as item, j (j)}<li>{@render inline(item)}</li>{/each}
        </ul>
      {/if}
    {:else if block.kind === "code"}
      <pre class="bg-muted overflow-x-auto rounded-md p-3 font-mono"><code>{block.text}</code></pre>
    {:else}
      <hr />
    {/if}
  {/each}
</div>
