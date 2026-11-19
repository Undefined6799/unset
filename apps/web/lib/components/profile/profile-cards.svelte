<!--
  The profile's cards (ADR 0051; P1.20i; laid out as the profile-card mockup, Alex 2026-11-17): a two-column grid on
  wide screens where a half card takes one column, each card on the stock Card. The README reads like a GitHub README
  under a "handle / README.md" bar; links are rows split by rules (a long list scrolls inside its card); collections
  are tiles; the buttons card is the raised Contact panel with a ruled edge. Carousels scroll with CSS snap: one to
  four tiles by the card's own width (a container query), and when more are left a part of the next one shows and
  the count says to scroll; the scrolling area and its buttons are carousel.svelte. Everything shown was built by
  apps/web/lib/profile/view.ts. On the owner's page `controls` puts each card's own at the top right of the card, and
  `add` closes the grid, full width (the Add card button). No cards and no `add` renders nothing.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import { CARD_TEXT } from "../../profile/messages.ts";
import type { CardLayout, CardView } from "../../profile/types.ts";
import { Button } from "../ui/button/index.ts";
import * as Card from "../ui/card/index.ts";
import Carousel from "./carousel.svelte";
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
  carousel: "grid grid-flow-col gap-[round(0.75rem,1px)]",
};
/**
 * A carousel's tile width by its number of tiles (1, 2, 3, 4, more): whole tiles while they all fit at the card's
 * width, else a quarter of the next one shows. TAIL says at which widths some are left over, for the count line.
 * Tile widths and the carousel's gap are rounded to whole pixels (https://developer.mozilla.org/en-US/docs/Web/CSS/round)
 * so every snap point is a whole pixel. Otherwise Firefox rests a fraction of a pixel short of a tile's snap point, an
 * arrow key snaps it back to that tile, and the keyboard cannot get past the second tile (profile-carousel.spec.ts).
 */
/** Three or more grid entries share the whole row (no empty column); one or two keep the tile width. */
const GRID_FILLS_ROW_FROM = 3;
const GRID_FILLED = "grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3";
const TILES = [
  "auto-cols-[100%]",
  "auto-cols-[round(down,85%,1px)] @sm:auto-cols-[round(down,(100%-0.75rem)/2,1px)]",
  "auto-cols-[round(down,85%,1px)] @sm:auto-cols-[round(down,(100%-1.5rem)/2.25,1px)] @2xl:auto-cols-[round(down,(100%-1.5rem)/3,1px)]",
  "auto-cols-[round(down,85%,1px)] @sm:auto-cols-[round(down,(100%-1.5rem)/2.25,1px)] @2xl:auto-cols-[round(down,(100%-2.25rem)/3.25,1px)] @4xl:auto-cols-[round(down,(100%-2.25rem)/4,1px)]",
  "auto-cols-[round(down,85%,1px)] @sm:auto-cols-[round(down,(100%-1.5rem)/2.25,1px)] @2xl:auto-cols-[round(down,(100%-2.25rem)/3.25,1px)] @4xl:auto-cols-[round(down,(100%-3rem)/4.25,1px)]",
] as const;
const TAIL = ["hidden", "@sm:hidden", "@2xl:hidden", "@4xl:hidden", ""] as const;
const tierOf = (count: number) => Math.min(Math.max(count, 1), 5) - 1;
const tile = "flex min-w-0 snap-start flex-col gap-1 rounded-sm border bg-secondary p-3.5";
const row = "flex min-w-0 justify-between gap-3 border-t py-2.5 first:border-t-0 first:pt-0";
const label = "shrink-0 font-mono text-xs leading-6 tracking-wider text-muted-foreground uppercase";
/** A link's host hides on a phone, where the row has no room for it; an entry's tag is its own text and stays. */
const site = `${label} max-sm:hidden`;
/** A card the owner drags another onto is ringed (card-controls.svelte sets data-drop). */
const card =
  "min-w-0 gap-0 rounded-sm border-0 py-0 shadow-md [overflow-wrap:anywhere] data-drop:ring-2 data-drop:ring-ring";
const head = "flex items-start justify-between gap-3";
const count = "font-mono text-xs text-muted-foreground";
</script>

{#snippet listHead(title: string, counted: string, scrolls: boolean, index: number, sideways = -1)}
  <div class={head}>
    <div class="min-w-0">
      {#if title !== ""}<h2 class="text-xl font-semibold">{title}</h2>{/if}
      <p class={count}>
        {counted}{#if scrolls}{" · "}{CARD_TEXT.scrollForMore}{/if}{#if sideways >= 0}<span class={TAIL[sideways]}
            >{" · "}{CARD_TEXT.scrollSideways}</span
          >{/if}
      </p>
    </div>
    {@render controls?.(index)}
  </div>
{/snippet}

{#snippet scroller(layout: CardLayout, title: string, count: number, scrolls: boolean, list: Snippet<[string]>)}
  {#if layout === "carousel"}
    {#snippet tiles()}{@render list(`${LAYOUT.carousel} ${TILES[tierOf(count)]}`)}{/snippet}
    <Carousel {title} list={tiles} />
  {:else}
    <div class={scrolls ? "-me-2 max-h-60 overflow-y-auto pe-2" : ""}>{@render list(layout === "grid" && count >= GRID_FILLS_ROW_FROM ? GRID_FILLED : LAYOUT[layout])}</div>
  {/if}
{/snippet}

{#if cards.length > 0 || add !== undefined}
  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
    {#each cards as shown, index (shown.key)}
      {@const span = shown.width === "half" ? "" : "md:col-span-2"}
      {#if shown.shown.kind === "readme"}
        <Card.Root class="group/card {card} {span}">
          <div class="{head} min-h-12 items-center border-b px-5 py-2">
            <p class="flex min-w-0 items-center gap-2 font-mono text-sm text-muted-foreground">
              <!-- The handle gives way on a narrow card, never the file name (staging walkthrough 2026-11-19). -->
              {#if handle !== null}<span class="truncate">{handle}</span><span aria-hidden="true">/</span>{/if}
              <span class="shrink-0 font-medium whitespace-nowrap text-foreground">README.md</span>
            </p>
            {@render controls?.(index)}
          </div>
          <div class="px-6 pt-5 pb-6"><Readme blocks={shown.shown.blocks} /></div>
        </Card.Root>
      {:else if shown.shown.kind === "links"}
        {@const links = shown.shown}
        {@const scrolls = links.layout === "list" && links.items.length > SCROLL_AFTER}
        {@const sideways = links.layout === "carousel" ? tierOf(links.items.length) : -1}
        {#snippet linkList(layout: string)}
          <ul class={layout}>
            {#each links.items as link, i (i)}
              <li class={links.layout === "list" ? row : tile}>
                <div class="min-w-0">
                  <a class="font-medium" href={link.href} rel="me nofollow ugc noopener noreferrer">{link.text}</a>
                  {#if link.description !== ""}<p class="text-sm text-muted-foreground">{link.description}</p>{/if}
                </div>
                {#if link.site !== ""}<span class={site}>{link.site}</span>{/if}
              </li>
            {/each}
          </ul>
        {/snippet}
        <Card.Root class="group/card {card} {span} @container flex flex-col gap-3 p-5">
          {@render listHead(links.title, CARD_TEXT.links(links.items.length), scrolls, index, sideways)}
          {@render scroller(links.layout, links.title, links.items.length, scrolls, linkList)}
        </Card.Root>
      {:else if shown.shown.kind === "collection"}
        {@const entries = shown.shown}
        {@const scrolls = entries.layout === "list" && entries.items.length > SCROLL_AFTER}
        {@const sideways = entries.layout === "carousel" ? tierOf(entries.items.length) : -1}
        {#snippet entryList(layout: string)}
          <ul class={layout}>
            {#each entries.items as entry, i (i)}
              <li class={entries.layout === "list" ? `${row} flex-col gap-1` : tile}>
                {#if entry.tag !== ""}<span class={label}>{entry.tag}</span>{/if}
                <h3 class="font-semibold">
                  {#if entry.href === null}{entry.title}{:else}<a href={entry.href} rel="nofollow ugc noopener noreferrer"
                      >{entry.title}</a
                    >{/if}
                </h3>
                {#if entry.description !== ""}<p class="text-sm text-muted-foreground">{entry.description}</p>{/if}
              </li>
            {/each}
          </ul>
        {/snippet}
        <Card.Root class="group/card {card} {span} @container flex flex-col gap-3 p-5">
          {@render listHead(entries.title, CARD_TEXT.entries(entries.items.length), scrolls, index, sideways)}
          {@render scroller(entries.layout, entries.title, entries.items.length, scrolls, entryList)}
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
              <Button href={button.href} rel="nofollow ugc noopener noreferrer" variant={i === 0 ? "default" : "outline"}>{button.label}</Button>
            {/each}
          </div>
          {#if addresses.length > 0}<p class="mt-3 font-mono text-xs text-muted-foreground">{addresses.join(" · ")}</p>{/if}
        </Card.Root>
      {/if}
    {/each}
    {#if add !== undefined}
      <div class="md:col-span-2">{@render add()}</div>
    {/if}
  </div>
{/if}
