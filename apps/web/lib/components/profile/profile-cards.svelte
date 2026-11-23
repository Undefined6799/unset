<!--
  The profile's cards (ADR 0051; P1.20i; laid out as the profile-card mockup, Alex 2026-11-17): a two-column grid on
  wide screens where a half card takes one column, each card on the stock Card. The Text card (the #readme kind) is the
  member's Markdown alone, with no bar or title of its own; links are rows split by rules (a long list scrolls inside its card); collections
  are tiles; the buttons card is the raised Contact panel with a ruled edge. Carousels scroll with CSS snap: one to
  four tiles by the card's own width (a container query), and when more are left a part of the next one shows and
  the count says to scroll; the scrolling area and its buttons are carousel.svelte. Everything shown was built by
  apps/web/lib/profile/view.ts. On the owner's page `controls` puts each card's own at the top right of the card, and
  `add` closes the grid, full width (the Add card button), and `text`, when given, draws a Text card's words in place
  of its rendered blocks (card-text.svelte, the editor in place, ADR 0074). No cards and no `add` renders nothing.
-->
<script lang="ts">
import type { Snippet } from "svelte";
import { CARD_TEXT } from "../../profile/messages.ts";
import type { CardLayout, CardSurface, ShownCard } from "../../profile/types.ts";
import { Icon } from "../icon/index.ts";
import { Button } from "../ui/button/index.ts";
import * as Card from "../ui/card/index.ts";
import Carousel from "./carousel.svelte";
import Readme from "./readme.svelte";

let {
  cards,
  controls,
  add,
  text,
}: {
  cards: readonly ShownCard[];
  controls?: Snippet<[number]>;
  add?: Snippet;
  text?: Snippet<[number]>;
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
/**
 * A linked row or tile is one link (P1.21p): the whole row is the target, so it holds no other control. The base rule
 * underlines every link in text (app.css); a row is not text, so it drops that and shows its resting cue instead: the
 * title in the link colour with the external mark. Hover underlines the title alone, so nothing moves or resizes, and
 * a key's focus rings the whole row (app.css draws the ring on every link).
 */
const rowItem = "min-w-0 border-t first:border-t-0";
const rowLink = "group/link flex min-w-0 gap-3 py-2.5 text-foreground no-underline [li:first-child>&]:pt-0";
const tileLink = "group/link w-full text-foreground no-underline hover:border-ring/60";
const linkTitle = "font-medium text-info underline-offset-4 group-hover/link:underline";
const label = "shrink-0 font-mono text-xs leading-6 tracking-wider text-muted-foreground uppercase";
/** A link's host hides on a phone, where the row has no room for it; an entry's tag is its own text and stays. */
const site = `${label} max-sm:hidden`;
/** A card the owner drags another onto is ringed (card-controls.svelte sets data-drop). */
const card =
  "min-w-0 gap-0 rounded-sm py-0 [overflow-wrap:anywhere] data-drop:ring-2 data-drop:ring-ring data-moving:opacity-60 data-moving:transition-opacity";
/** Surface changes only the outer card; nested tiles and dividers keep their own structure. */
const SURFACE: Record<CardSurface, string> = {
  filled: "border-0 bg-card shadow-md",
  outlined: "border border-border bg-transparent shadow-none",
  plain: "border-0 bg-transparent shadow-none",
};
const CONTACT_FILLED =
  "border border-input bg-secondary shadow-none before:absolute before:inset-y-0 before:start-0 before:w-0.75 before:bg-info";
/** Plain has no edge to ring, so the owner's card shows one while a key moves focus inside it. */
const PLAIN_FOCUS =
  "outline-offset-2 has-focus-visible:outline has-focus-visible:outline-1 has-focus-visible:outline-ring";
/** The outer card's surface classes; Contact's Filled keeps its own tint and edge. */
function outer(shown: ShownCard): string {
  const surface =
    shown.surface === "filled" && shown.shown.kind === "buttons" ? CONTACT_FILLED : SURFACE[shown.surface];
  return shown.surface === "plain" && controls !== undefined ? `${surface} ${PLAIN_FOCUS}` : surface;
}
const head = "flex items-start justify-between gap-3";
/**
 * The Text card's inset by surface: Filled and Outlined keep room inside their edge, wider from tablet up; Plain has no
 * edge, so its text lines up with the grid and the other cards' edges.
 */
const TEXT_INSET: Record<CardSurface, string> = { filled: "p-5 md:p-7", outlined: "p-5 md:p-7", plain: "p-0" };
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
        <!-- No bar and no automatic heading (P1.21p): the member's own text leads, its headings are the card's. -->
        <Card.Root class="group/card {card} {span} {outer(shown)} {TEXT_INSET[shown.surface]}" data-surface={shown.surface}>
          <!-- On a phone the owner's controls sit in a row above the text, so the text keeps the card's whole width
               (staging test 2026-11-21, u5); from sm up they stand beside it. -->
          <div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
            {#if controls !== undefined}<div class="flex justify-end sm:order-last">{@render controls(index)}</div>{/if}
            <div class="min-w-0 flex-1">
              {#if text === undefined}<Readme blocks={shown.shown.blocks} />{:else}{@render text(index)}{/if}
            </div>
          </div>
        </Card.Root>
      {:else if shown.shown.kind === "links"}
        {@const links = shown.shown}
        {@const scrolls = links.layout === "list" && links.items.length > SCROLL_AFTER}
        {@const sideways = links.layout === "carousel" ? tierOf(links.items.length) : -1}
        {#snippet linkList(layout: string)}
          <ul class={layout}>
            {#each links.items as link, i (i)}
              <li class={links.layout === "list" ? rowItem : "flex min-w-0 snap-start"}>
                <a
                  class="{links.layout === 'list' ? rowLink : `${tile} ${tileLink}`} justify-between"
                  href={link.href}
                  rel="me nofollow ugc noopener noreferrer"
                >
                  <span class="min-w-0">
                    <span class={linkTitle}>{link.text}<Icon name="external" size={16} class="ms-1 inline align-[-3px]" /></span>
                    {#if link.description !== ""}<span class="block text-sm text-muted-foreground">{link.description}</span>{/if}
                  </span>
                  {#if link.site !== ""}<span class={site}>{link.site}</span>{/if}
                </a>
              </li>
            {/each}
          </ul>
        {/snippet}
        <Card.Root class="group/card {card} {span} {outer(shown)} @container flex flex-col gap-3 p-5" data-surface={shown.surface}>
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
              {#snippet entryBody(linked: boolean)}
                {#if entry.tag !== ""}<span class={label}>{entry.tag}</span>{/if}
                <h3 class="font-semibold">
                  {#if linked}<span class={linkTitle}>{entry.title}<Icon name="external" size={16} class="ms-1 inline align-[-3px]" /></span
                    >{:else}{entry.title}{/if}
                </h3>
                {#if entry.description !== ""}<p class="text-sm text-muted-foreground">{entry.description}</p>{/if}
              {/snippet}
              {#if entry.href === null}
                <li class={entries.layout === "list" ? `${row} flex-col gap-1` : tile}>{@render entryBody(false)}</li>
              {:else}
                <li class={entries.layout === "list" ? rowItem : "flex min-w-0 snap-start"}>
                  <a
                    class="{entries.layout === 'list' ? rowLink : `${tile} ${tileLink}`} flex-col gap-1"
                    href={entry.href}
                    rel="nofollow ugc noopener noreferrer">{@render entryBody(true)}</a
                  >
                </li>
              {/if}
            {/each}
          </ul>
        {/snippet}
        <Card.Root class="group/card {card} {span} {outer(shown)} @container flex flex-col gap-3 p-5" data-surface={shown.surface}>
          {@render listHead(entries.title, CARD_TEXT.entries(entries.items.length), scrolls, index, sideways)}
          {@render scroller(entries.layout, entries.title, entries.items.length, scrolls, entryList)}
        </Card.Root>
      {:else}
        {@const contact = shown.shown}
        {@const addresses = contact.buttons.flatMap((b) => (b.address === undefined ? [] : [b.address]))}
        <Card.Root
          class="group/card {card} {span} {outer(shown)} relative p-6"
          data-surface={shown.surface}
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
