<!--
  The profile's cards (ADR 0051; from apps/web/src/screens/profile/ProfileCards.tsx, P1.20i): a two-column grid on wide
  screens where a half card takes one column, each card on the stock Card. Links, collections and buttons show what
  apps/web/lib/profile/view.ts built; carousels scroll with CSS snap, no script. On the owner's page `controls` adds
  each card's own. An empty list renders nothing.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import type { CardLayout, CardView } from "../../profile/types.ts";
import { Icon } from "../icon/index.ts";
import { Button } from "../ui/button/index.ts";
import * as Card from "../ui/card/index.ts";
import Readme from "./readme.svelte";

let { cards, controls }: { cards: readonly CardView[]; controls?: Snippet<[number]> } = $props();

const LAYOUT: Record<CardLayout, string> = {
  list: "grid gap-3",
  grid: "grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4",
  carousel: "grid auto-cols-[minmax(220px,70%)] grid-flow-col gap-4 overflow-x-auto snap-x snap-mandatory",
};
</script>

{#if cards.length > 0}
  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
    {#each cards as card, index (card.key)}
      <Card.Root class={card.width === "half" ? "min-w-0 [overflow-wrap:anywhere]" : "min-w-0 md:col-span-2 [overflow-wrap:anywhere]"}>
        <Card.Content class="flex flex-col gap-4">
          {#if card.shown.kind === "readme"}
            <div class="text-muted-foreground font-mono text-xs">README.md</div>
            <Readme blocks={card.shown.blocks} />
          {:else if card.shown.kind === "links"}
            {#if card.shown.title !== ""}<h2 class="text-lg font-semibold">{card.shown.title}</h2>{/if}
            <ul class={LAYOUT[card.shown.layout]}>
              {#each card.shown.items as link, i (i)}
                <li class="min-w-0 snap-start">
                  <a class="inline-flex items-center gap-2" href={link.href} rel="me noopener noreferrer">
                    <span class="underline">{link.text}</span><Icon name="external" size={16} />
                  </a>
                  {#if link.description !== ""}<p class="text-muted-foreground mt-1">{link.description}</p>{/if}
                </li>
              {/each}
            </ul>
          {:else if card.shown.kind === "collection"}
            {#if card.shown.title !== ""}<h2 class="text-lg font-semibold">{card.shown.title}</h2>{/if}
            <ul class={LAYOUT[card.shown.layout]}>
              {#each card.shown.items as entry, i (i)}
                <li class="min-w-0 snap-start">
                  {#if entry.tag !== ""}<span class="text-muted-foreground font-mono text-xs">{entry.tag}</span>{/if}
                  <h3 class="mt-1 font-semibold">
                    {#if entry.href === null}{entry.title}{:else}<a class="underline" href={entry.href} rel="noopener noreferrer"
                        >{entry.title}</a
                      >{/if}
                  </h3>
                  {#if entry.description !== ""}<p class="text-muted-foreground mt-1">{entry.description}</p>{/if}
                </li>
              {/each}
            </ul>
          {:else}
            <h2 class="text-lg font-semibold">{card.shown.heading}</h2>
            {#if card.shown.text !== ""}<p class="text-muted-foreground">{card.shown.text}</p>{/if}
            <div class="flex flex-wrap items-center gap-4">
              {#each card.shown.buttons as button, i (i)}
                <Button href={button.href} variant={i === 0 ? "default" : "outline"}>{button.label}</Button>
              {/each}
            </div>
          {/if}
          {@render controls?.(index)}
        </Card.Content>
      </Card.Root>
    {/each}
  </div>
{/if}
