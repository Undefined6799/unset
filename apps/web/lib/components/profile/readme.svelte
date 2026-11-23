<!--
  The Text card's blocks (the #readme kind, ADR 0051; from apps/web/src/screens/profile/readme.tsx, P1.20i): parsed on
  the server by apps/web/lib/profile/parse.ts, rendered here as plain elements. Every member string is a text node
  (escaped by Svelte); raw HTML never reaches the page, and each link's href is already a safeHref result. The card has
  no title of its own (P1.21p), so its headings sit beside the other cards' titles: # is an h2, under the page's h1.
-->
<script lang="ts">
import type { Block, Inline, ListBlock } from "../../profile/types.ts";

let { blocks }: { blocks: readonly Block[] } = $props();
/** A task's words as plain text, its checkbox's accessible name (WCAG 2.2 SC 4.1.2). */
const plainText = (nodes: readonly Inline[]): string =>
  nodes
    .map((node) => {
      if (node.kind === "text" || node.kind === "code") return node.text;
      if (node.kind === "break") return " ";
      return plainText(node.children);
    })
    .join("");
// Six levels under the page's h1: # is an h2, and HTML stops at h6, so ##### and ###### share it.
const HEADINGS = ["h2", "h3", "h4", "h5", "h6", "h6"] as const;
// The playground's six steps (Crepe 7.23.0 theme/common/reset.css: 2.625em down to 1.125em), on the theme's type
// scale; # is the display heading (Alex 2026-11-21 18:48:10Z, "a bit bigger"). No rules underneath.
/** A column's alignment as a class: the CSP allows no style attribute. */
const ALIGN = { left: "text-start", center: "text-center", right: "text-end" } as const;
const aligned = (align: "left" | "center" | "right" | null | undefined) => (align ? ALIGN[align] : "text-start");
const HEADING_LOOK = [
  "mt-2 text-4xl leading-tight font-bold tracking-tight",
  "mt-2 text-3xl leading-tight font-bold tracking-tight",
  "mt-1 text-2xl leading-snug font-semibold",
  "mt-1 text-xl font-semibold",
  "text-lg font-semibold",
  "font-bold",
] as const;
</script>

{#snippet inline(nodes: readonly Inline[])}
  {#each nodes as node, i (i)}
    {#if node.kind === "text"}{node.text}{:else if node.kind === "break"}<br />{:else if node.kind === "code"}<code class="rounded-sm bg-muted px-1 font-mono text-sm">{node.text}</code
      >{:else if node.kind === "strong"}<strong>{@render inline(node.children)}</strong
      >{:else if node.kind === "em"}<em>{@render inline(node.children)}</em
      >{:else if node.kind === "del"}<del>{@render inline(node.children)}</del
      >{:else}<a class="underline" href={node.href} rel="nofollow ugc noopener noreferrer"
        >{@render inline(node.children)}</a
      >{/if}
  {/each}
{/snippet}

<!-- A task's box shows where the bullet was; it cannot be ticked here (GFM 0.29 leaves that to the reader). -->
{#snippet item(entry: ListBlock["items"][number])}
  <li class={entry.task === undefined ? "" : "-ms-5 list-none"}
    >{#if entry.task !== undefined}<input
        type="checkbox"
        class="me-1.5 size-3.5 align-middle accent-primary"
        checked={entry.task === "done"}
        aria-label={plainText(entry.text).trim()}
        disabled
      />{/if}{@render inline(entry.text)}{#each entry.lists as sub, k (k)}{@render list(sub)}{/each}</li
  >
{/snippet}

{#snippet list(block: ListBlock)}
  {#if block.ordered}
    <ol class="list-decimal space-y-0.5 ps-6" start={block.start}>
      {#each block.items as entry, j (j)}{@render item(entry)}{/each}
    </ol>
  {:else}
    <ul class="list-disc space-y-0.5 ps-6 [&_ul]:list-[circle]">
      {#each block.items as entry, j (j)}{@render item(entry)}{/each}
    </ul>
  {/if}
{/snippet}

<!-- The base styles give a bare paragraph a margin (app.css); the card's inset is the edge, so the first and last lose it. -->
<div class="flex flex-col gap-3 *:first:mt-0 *:last:mb-0">
  {#each blocks as block, i (i)}
    {#if block.kind === "heading"}
      <svelte:element this={HEADINGS[block.level - 1] ?? "h6"} class={HEADING_LOOK[block.level - 1] ?? "font-bold"}>
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
    {:else if block.kind === "table"}
      <!-- A wide table scrolls inside the card rather than widening it. -->
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr>
              {#each block.head as cell, c (c)}<th class="border-b border-input px-3 py-1.5 font-semibold {aligned(block.align[c])}"
                  >{@render inline(cell)}</th
                >{/each}
            </tr>
          </thead>
          {#if block.rows.length > 0}
            <tbody>
              {#each block.rows as row, r (r)}<tr>
                  {#each row as cell, c (c)}<td class="border-b border-input px-3 py-1.5 {aligned(block.align[c])}"
                      >{@render inline(cell)}</td
                    >{/each}
                </tr>{/each}
            </tbody>
          {/if}
        </table>
      </div>
    {:else if block.kind === "rule"}
      <hr />
    {/if}
  {/each}
</div>
