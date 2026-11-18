<!--
  The profile's cards (ADR 0051; P1.20i; laid out as the profile-card mockup, Alex 2026-11-17): a two-column grid on
  wide screens where a half card takes one column, each card on the stock Card. The README reads like a GitHub README
  under a "handle / README.md" bar; links are rows split by rules (a long list scrolls inside its card); collections
  are tiles; the buttons card is the raised Contact panel with a ruled edge. Carousels scroll with CSS snap and show
  only whole tiles, one to four by the card's own width (a container query), no script. Everything shown was built by
  apps/web/lib/profile/view.ts. On the owner's page `controls` puts each card's own at the top right of the card, and
  `add` closes the grid with the add buttons. No cards and no `add` renders nothing.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import { CARD_TEXT } from "../../profile/messages.ts";
import type { CardLayout, CardView } from "../../profile/types.ts";
import { Button } from "../ui/button/index.ts";
import * as Card from "../ui/card/index.ts";
import Readme from "./readme.svelte";

let {
  cards,
  handle = null,
  controls,
  add,
}: {
  cards: readonly CardView[];
  /** The verified handle the README bar names; null shows README.md alone. */
  handle?: string | null;
  controls?: Snippet<[number]>;
  add?: Snippet;
} = $props();

/** A list longer than this scrolls inside its card. */
const SCROLL_AFTER = 4;
const LAYOUT: Record<CardLayout, string> = {
  list: "grid",
  grid: "grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3",
  carousel:
    "grid grid-flow-col auto-cols-[100%] gap-3 overflow-x-auto snap-x snap-mandatory pb-2.5 @sm:auto-cols-[calc((100%-0.75rem)/2)] @2xl:auto-cols-[calc((100%-1.5rem)/3)] @4xl:auto-cols-[calc((100%-2.25rem)/4)]",
};
const tile = "flex min-w-0 snap-start flex-col gap-1 rounded-sm border bg-secondary p-3.5";
const row = "flex min-w-0 justify-between gap-3 border-t py-2.5 first:border-t-0 first:pt-0";
const site = "shrink-0 max-sm:hidden font-mono text-xs leading-6 tracking-wider text-muted-foreground uppercase";
const card = "min-w-0 gap-0 rounded-sm border-0 py-0 shadow-md [overflow-wrap:anywhere]";
const head = "flex items-start justify-between gap-3";
const count = "font-mono text-xs text-muted-foreground";
</script>

{#snippet listHead(title: string, counted: string, scrolls: boolean, index: number)}
  <div class={head}>
    <div class="min-w-0">
      {#if title !== ""}<h2 class="text-xl font-semibold">{title}</h2>{/if}
      <p class={count}>{counted}{#if scrolls}{" · "}{CARD_TEXT.scrollForMore}{/if}</p>
    </div>
    {@render controls?.(index)}
  </div>
{/snippet}

{#if cards.length > 0 || add !== undefined}
  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
    {#each cards as shown, index (shown.key)}
      {@const span = shown.width === "half" ? "" : "md:col-span-2"}
      {#if shown.shown.kind === "readme"}
        <Card.Root class="group/card {card} {span}">
          <div class="{head} min-h-12 items-center border-b px-5 py-2">
            <p class="flex min-w-0 items-center gap-2 font-mono text-sm text-muted-foreground">
              {#if handle !== null}<span class="truncate">{handle}</span><span aria-hidden="true">/</span>{/if}
              <span class="font-medium text-foreground">README.md</span>
            </p>
            {@render controls?.(index)}
          </div>
          <div class="px-6 pt-5 pb-6"><Readme blocks={shown.shown.blocks} /></div>
        </Card.Root>
      {:else if shown.shown.kind === "links"}
        {@const links = shown.shown}
        {@const scrolls = links.layout === "list" && links.items.length > SCROLL_AFTER}
        <Card.Root class="group/card {card} {span} flex flex-col gap-3 p-5">
          {@render listHead(links.title, CARD_TEXT.links(links.items.length), scrolls, index)}
          <div class={scrolls ? "-me-2 max-h-60 overflow-y-auto pe-2" : "@container"}>
            <ul class={LAYOUT[links.layout]}>
              {#each links.items as link, i (i)}
                <li class={links.layout === "list" ? row : tile}>
                  <div class="min-w-0">
                    <a class="font-medium" href={link.href} rel="me noopener noreferrer">{link.text}</a>
                    {#if link.description !== ""}<p class="text-sm text-muted-foreground">{link.description}</p>{/if}
                  </div>
                  {#if link.site !== ""}<span class={site}>{link.site}</span>{/if}
                </li>
              {/each}
            </ul>
          </div>
        </Card.Root>
      {:else if shown.shown.kind === "collection"}
        {@const entries = shown.shown}
        {@const scrolls = entries.layout === "list" && entries.items.length > SCROLL_AFTER}
        <Card.Root class="group/card {card} {span} flex flex-col gap-3 p-5">
          {@render listHead(entries.title, CARD_TEXT.entries(entries.items.length), scrolls, index)}
          <div class={scrolls ? "-me-2 max-h-60 overflow-y-auto pe-2" : "@container"}>
            <ul class={LAYOUT[entries.layout]}>
              {#each entries.items as entry, i (i)}
                <li class={entries.layout === "list" ? `${row} flex-col gap-1` : tile}>
                  {#if entry.tag !== ""}<span class={site}>{entry.tag}</span>{/if}
                  <h3 class="font-semibold">
                    {#if entry.href === null}{entry.title}{:else}<a href={entry.href} rel="noopener noreferrer"
                        >{entry.title}</a
                      >{/if}
                  </h3>
                  {#if entry.description !== ""}<p class="text-sm text-muted-foreground">{entry.description}</p>{/if}
                </li>
              {/each}
            </ul>
          </div>
        </Card.Root>
      {:else}
        {@const contact = shown.shown}
        {@const addresses = contact.buttons.flatMap((b) => (b.address === undefined ? [] : [b.address]))}
        <Card.Root
          class="group/card {card} {span} relative border border-input bg-secondary p-6 shadow-none before:absolute before:inset-y-0 before:start-0 before:w-0.75 before:bg-info"
        >
          <div class={head}>
            <p class="font-mono text-xs leading-8 tracking-wider text-muted-foreground uppercase">{CARD_TEXT.contact}</p>
            {@render controls?.(index)}
          </div>
          <h2 class="mt-1 text-2xl leading-7 font-bold tracking-tight">{contact.heading}</h2>
          {#if contact.text !== ""}<p class="mt-2 text-muted-foreground">{contact.text}</p>{/if}
          <div class="mt-4 flex flex-wrap items-center gap-2.5">
            {#each contact.buttons as button, i (i)}
              <Button href={button.href} variant={i === 0 ? "default" : "outline"}>{button.label}</Button>
            {/each}
          </div>
          {#if addresses.length > 0}<p class="mt-3 font-mono text-xs text-muted-foreground">{addresses.join(" · ")}</p>{/if}
        </Card.Root>
      {/if}
    {/each}
    {#if add !== undefined}
      <section
        aria-labelledby="add-card"
        class="flex flex-col items-center gap-3 rounded-sm border border-dashed border-input p-5 md:col-span-2"
      >
        <h2 id="add-card" class="font-mono text-xs tracking-wider text-muted-foreground uppercase">{CARD_TEXT.addCard}</h2>
        <div class="flex flex-wrap justify-center gap-2.5">{@render add()}</div>
      </section>
    {/if}
  </div>
{/if}
