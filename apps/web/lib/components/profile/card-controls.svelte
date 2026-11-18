<!--
  The owner's controls on each card (ADR 0051; from apps/web/src/screens/profile/CardControls.tsx, P1.20i): the
  editor, move up and down, and delete behind a confirm. They sit at the card's top right as small icon buttons, each
  named for assistive tech; with a mouse they show while the card is hovered or holds focus, on touch always (the
  profile-card mockup, Alex 2026-11-17, which puts a pencil and a menu there; these stay plain buttons, so moving works
  with no script). Up and down are labelled buttons the keyboard reaches; each
  posts the whole new order to the page's `reorder` action and works with no script. Edit and delete open the stock
  Dialog, which needs script, as today's Modal did. With script the moved card keeps focus: its same button, or its
  other move button once it reaches an end, since the button pressed is redrawn and focus would fall to the body.
-->
<script module lang="ts">
/** The card a move button was pressed on, and which, until the new order arrives. */
let pendingMove: { key: string; to: "up" | "down" } | null = null;
</script>

<script lang="ts">
import { BUTTONS_EDIT, CARD_EDIT, COLLECTION_EDIT, LINKS_EDIT } from "../../profile/messages.ts";
import type { CardContent, CardEditLimits, CardView, Enhance } from "../../profile/types.ts";
import { Icon } from "../icon/index.ts";
import { Button, buttonVariants } from "../ui/button/index.ts";
import * as Dialog from "../ui/dialog/index.ts";
import CardEditor from "./card-editor.svelte";

let {
  cards,
  index,
  limits,
  enhance = () => undefined,
}: { cards: readonly CardView[]; index: number; limits: CardEditLimits; enhance?: Enhance } = $props();

const card = $derived(cards[index]);
const keys = $derived(cards.map((c) => c.key));

/** The whole new order, with the cards at `from` and `to` swapped. */
function swapped(from: number, to: number): string[] {
  const order = [...keys];
  [order[from], order[to]] = [order[to] as string, order[from] as string];
  return order;
}

/** The name a card's controls are grouped under, for assistive tech. */
function cardName(content: CardContent): string {
  switch (content.kind) {
    case "readme":
      return CARD_EDIT.readme;
    case "links":
      return content.title || "Links";
    case "collection":
      return content.title || "Collection";
    case "buttons":
      return content.heading;
  }
}

const EDIT_TITLE = {
  readme: CARD_EDIT.editReadme,
  links: LINKS_EDIT.editTitle,
  collection: COLLECTION_EDIT.editTitle,
  buttons: BUTTONS_EDIT.editTitle,
};
/** 32px with a mouse, a 44px target on touch, as the shell's header icons. */
const tap = "text-muted-foreground hover:text-foreground pointer-coarse:size-11";
const maxOf = (kind: CardContent["kind"]) => (kind === "readme" ? 0 : limits[kind]);

let group: HTMLFieldSetElement | undefined = $state();
// Runs when the new order arrives (cards changes); pendingMove itself is not reactive, so a press alone does nothing.
$effect(() => {
  const moved = cards[index];
  const pending = pendingMove;
  if (pending === null || moved?.key !== pending.key || group === undefined) return;
  pendingMove = null;
  const target = group.querySelector<HTMLElement>(`[data-move="${pending.to}"]`) ?? group.querySelector<HTMLElement>("[data-move]");
  target?.focus();
});
</script>

{#snippet move(to: number, label: string)}
  {@const direction = to < index ? "up" : "down"}
  <form method="POST" action="?/reorder" use:enhance onsubmit={() => (pendingMove = { key: card?.key ?? "", to: direction })}>
    {#each swapped(index, to) as key (key)}<input type="hidden" name="order" value={key} />{/each}
    <Button type="submit" variant="ghost" size="icon-sm" data-move={direction} class={tap}
      ><Icon name={direction} size={20} label={label} /></Button
    >
  </form>
{/snippet}

{#if card !== undefined}
  <fieldset
    bind:this={group}
    class="-me-2 -mt-1 flex shrink-0 gap-0.5 transition-opacity motion-reduce:transition-none pointer-fine:opacity-0 pointer-fine:group-focus-within/card:opacity-100 pointer-fine:group-hover/card:opacity-100"
  >
    <legend class="sr-only">{CARD_EDIT.group(cardName(card.content))}</legend>
    <CardEditor
      kind={card.content.kind}
      content={card.content}
      width={card.width}
      cardKey={card.key}
      trigger={CARD_EDIT.edit}
      icon="edit"
      triggerClass={tap}
      title={EDIT_TITLE[card.content.kind]}
      submit={CARD_EDIT.save}
      max={maxOf(card.content.kind)}
      {enhance}
    />
    {#if index > 0}{@render move(index - 1, CARD_EDIT.up)}{/if}
    {#if index < cards.length - 1}{@render move(index + 1, CARD_EDIT.down)}{/if}
    <Dialog.Root>
      <Dialog.Trigger class="{buttonVariants({ variant: 'ghost', size: 'icon-sm' })} {tap}"
        ><Icon name="delete" size={20} label={CARD_EDIT.remove} /></Dialog.Trigger
      >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>{CARD_EDIT.removeTitle}</Dialog.Title>
          <Dialog.Description>{CARD_EDIT.removeBody}</Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
          <Dialog.Close class={buttonVariants({ variant: "outline" })}>{CARD_EDIT.cancel}</Dialog.Close>
          <form method="POST" action="?/remove" use:enhance>
            <input type="hidden" name="key" value={card.key} />
            <Button type="submit" variant="destructive">{CARD_EDIT.remove}</Button>
          </form>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  </fieldset>
{/if}
