<!--
  The owner's controls under each card (ADR 0051; from apps/web/src/screens/profile/CardControls.tsx, P1.20i): the
  editor, move up and down, and delete behind a confirm. Up and down are labelled buttons the keyboard reaches; each
  posts the whole new order to the page's `reorder` action and works with no script. Edit and delete open the stock
  Dialog, which needs script, as today's Modal did.
-->
<script lang="ts">
import type { Action } from "svelte/action";
import { Button, buttonVariants } from "../ui/button/index.ts";
import * as Dialog from "../ui/dialog/index.ts";
import CardEditor from "./card-editor.svelte";
import { BUTTONS_EDIT, CARD_EDIT, COLLECTION_EDIT, LINKS_EDIT } from "../../profile/messages.ts";
import type { CardContent, CardEditLimits, CardView } from "../../profile/types.ts";

let {
  cards,
  index,
  limits,
  enhance = () => undefined,
}: { cards: readonly CardView[]; index: number; limits: CardEditLimits; enhance?: Action<HTMLFormElement> } = $props();

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
const maxOf = (kind: CardContent["kind"]) => (kind === "readme" ? 0 : limits[kind]);
</script>

{#snippet move(to: number, label: string)}
  <form method="POST" action="?/reorder" use:enhance>
    {#each swapped(index, to) as key (key)}<input type="hidden" name="order" value={key} />{/each}
    <Button type="submit" variant="outline">{label}</Button>
  </form>
{/snippet}

{#if card !== undefined}
  <fieldset class="mt-2 flex min-w-0 flex-wrap gap-3 border-t pt-4">
    <legend class="sr-only">{CARD_EDIT.group(cardName(card.content))}</legend>
    <CardEditor
      kind={card.content.kind}
      content={card.content}
      width={card.width}
      cardKey={card.key}
      trigger={CARD_EDIT.edit}
      title={EDIT_TITLE[card.content.kind]}
      submit={CARD_EDIT.save}
      max={maxOf(card.content.kind)}
      {enhance}
    />
    {#if index > 0}{@render move(index - 1, CARD_EDIT.up)}{/if}
    {#if index < cards.length - 1}{@render move(index + 1, CARD_EDIT.down)}{/if}
    <Dialog.Root>
      <Dialog.Trigger class={buttonVariants({ variant: "outline" })}>{CARD_EDIT.remove}</Dialog.Trigger>
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
