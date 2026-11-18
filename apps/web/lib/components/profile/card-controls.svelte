<!--
  The owner's controls on each card (ADR 0051; from apps/web/src/screens/profile/CardControls.tsx, P1.20i): the
  editor, move up and down, and delete behind a confirm. They sit at the card's top right as small icon buttons, each
  named for assistive tech; with a mouse they show while the card is hovered or holds focus, on touch always (the
  profile-card mockup, Alex 2026-11-17, which puts a pencil and a menu there; these stay plain buttons, so moving works
  with no script). Up and down are labelled buttons the keyboard reaches; each
  posts the whole new order to the page's `reorder` action and works with no script. Edit and delete are links that
  open the stock Dialog with script, and with none go to the page with that editor or confirm in place (card-panel.svelte;
  staging walkthrough 2026-11-18, finding 8). With script the moved card keeps focus: its same button, or its
  other move button once it reaches an end, since the button pressed is redrawn and focus would fall to the body. A
  deleted card's place goes to the card that takes it (its first control), or the one before when it was last, or Add
  card when none is left; the page stays where it was (the page's enhance refreshes in place).
-->
<script module lang="ts">
/** The card a move button was pressed on, and which, until the new order arrives. */
let pendingMove: { key: string; to: "up" | "down" } | null = null;

/** After a delete: the first control of the card now at `at`, or of the last card, or Add card when none is left. */
function focusAfterRemove(at: number) {
  const groups = document.querySelectorAll<HTMLElement>("[data-card-controls]");
  const group = groups[Math.min(at, groups.length - 1)];
  const target =
    group?.querySelector<HTMLElement>("button, a") ?? document.querySelector<HTMLElement>("[data-add-card]");
  target?.focus();
}
</script>

<script lang="ts">
import { BUTTONS_EDIT, CARD_EDIT, COLLECTION_EDIT, LINKS_EDIT } from "../../profile/messages.ts";
import { tick } from "svelte";
import type { CardContent, CardEditLimits, CardView, Enhance, SubmitHandler } from "../../profile/types.ts";
import { opensHere, PANEL_ANCHOR } from "../../profile/panel.ts";
import { Icon } from "../icon/index.ts";
import { Button, buttonVariants } from "../ui/button/index.ts";
import * as Alert from "../ui/alert/index.ts";
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
let removing = $state(false);
let removeLink: HTMLAnchorElement | undefined = $state();
function backToRemove(event: Event) {
  if (removeLink === undefined || !removeLink.isConnected) return;
  event.preventDefault();
  removeLink.focus();
}

// A refused delete keeps the dialog open with the reason inside it, where the member is looking, as the card editor
// does (Codex review of f14b5ab); the page's own alert would sit behind the modal. The message is the action's
// catalog text (`fail(status, { code, message })`), or ours when the answer carried none or never came.
let removeRefused: string | undefined = $state();
const removeCard: SubmitHandler = () => {
  const at = index;
  removeRefused = undefined;
  return async ({ result, update }) => {
    if (result.type === "failure") {
      const message = result.data?.message;
      removeRefused = typeof message === "string" ? message : CARD_EDIT.removeRefused;
      return;
    }
    if (result.type === "error") {
      removeRefused = CARD_EDIT.removeRefused;
      return;
    }
    await update();
    await tick();
    focusAfterRemove(at);
  };
};
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
    data-card-controls
    class="-me-2 -mt-1 flex shrink-0 gap-0.5 transition-opacity motion-reduce:transition-none pointer-fine:opacity-0 pointer-fine:group-focus-within/card:opacity-100 pointer-fine:group-hover/card:opacity-100"
  >
    <legend class="sr-only">{CARD_EDIT.group(cardName(card.content))}</legend>
    <CardEditor
      kind={card.content.kind}
      content={card.content}
      width={card.width}
      cardKey={card.key}
      trigger={{ label: CARD_EDIT.edit, href: `?edit=${card.key}#${PANEL_ANCHOR}` }}
      icon="edit"
      triggerClass={tap}
      title={EDIT_TITLE[card.content.kind]}
      submit={CARD_EDIT.save}
      max={maxOf(card.content.kind)}
      textMax={limits.text}
      {enhance}
    />
    {#if index > 0}{@render move(index - 1, CARD_EDIT.up)}{/if}
    {#if index < cards.length - 1}{@render move(index + 1, CARD_EDIT.down)}{/if}
    <Dialog.Root bind:open={removing}>
      <a
        bind:this={removeLink}
        href="?remove={card.key}#{PANEL_ANCHOR}"
        aria-haspopup="dialog"
        class="{buttonVariants({ variant: 'ghost', size: 'icon-sm' })} {tap}"
        onclick={(event) => {
          if (opensHere(event)) {
            removeRefused = undefined;
            removing = true;
          }
        }}><Icon name="delete" size={20} label={CARD_EDIT.remove} /></a
      >
      <Dialog.Content onCloseAutoFocus={backToRemove}>
        <Dialog.Header>
          <Dialog.Title>{CARD_EDIT.removeTitle}</Dialog.Title>
          <Dialog.Description>{CARD_EDIT.removeBody}</Dialog.Description>
        </Dialog.Header>
        {#if removeRefused !== undefined}
          <Alert.Root variant="destructive" role="alert"><Alert.Description>{removeRefused}</Alert.Description></Alert.Root>
        {/if}
        <Dialog.Footer>
          <Dialog.Close class={buttonVariants({ variant: "outline" })}>{CARD_EDIT.cancel}</Dialog.Close>
          <form method="POST" action="?/remove" use:enhance={removeCard}>
            <input type="hidden" name="key" value={card.key} />
            <Button type="submit" variant="destructive">{CARD_EDIT.remove}</Button>
          </form>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  </fieldset>
{/if}
