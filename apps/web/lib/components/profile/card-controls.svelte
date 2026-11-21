<!--
  The owner's controls on each card (ADR 0051; from apps/web/src/screens/profile/CardControls.tsx, P1.20i): the
  editor, move up and down, and delete behind a confirm. They sit at the card's top right, always shown (Alex
  2026-11-18: phones have no hover), as the profile-card mockup's pencil and three-dot menu. With script the menu is
  the stock DropdownMenu holding Move up, Move down and Delete; with none the same three are plain icon buttons and
  links, so moving and deleting still work. Each move posts the whole new order to the page's `reorder` action. On a
  large screen with a mouse the card is also dragged by its top bar and dropped on another card to take its place
  (Alex 2026-11-18: dragging on big screens only; phones and the keyboard use the menu). Edit and delete are links that
  open the stock Dialog with script, and with none go to the page with that editor or confirm in place (card-panel.svelte;
  staging walkthrough 2026-11-18, finding 8). A card moved from its menu keeps focus on its menu button; with no script
  the page reloads. A
  deleted card's place goes to the card that takes it (its first control), or the one before when it was last, or Add
  card when none is left; the page stays where it was (the page's enhance refreshes in place). On the owner's page with
  the editor in place (ADR 0074 item 4), a Text card's menu also holds its Width and Style as radio groups: a choice is
  handed to `onchoose` and waits, with the card's words, for the page's one Save; and Show Markdown, which `markdown`
  turns on and off (the page swaps the editor for the plain field).
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
import { BUTTONS_EDIT, CARD_EDIT, COLLECTION_EDIT, cardName, LINKS_EDIT } from "../../profile/messages.ts";
import { tick } from "svelte";
import type { CardContent, CardEditLimits, CardSurface, CardView, CardWidth, Enhance, SubmitHandler } from "../../profile/types.ts";
import type { CardChange } from "../../profile/unsaved.ts";
import { opensHere, PANEL_ANCHOR } from "../../profile/panel.ts";
import { Icon } from "../icon/index.ts";
import { Button, buttonVariants } from "../ui/button/index.ts";
import * as Alert from "../ui/alert/index.ts";
import * as Dialog from "../ui/dialog/index.ts";
import * as DropdownMenu from "../ui/dropdown-menu/index.ts";
import CardEditor from "./card-editor.svelte";

let {
  cards,
  index,
  limits,
  enhance = () => undefined,
  chosen,
  onchoose,
  markdown,
}: {
  cards: readonly CardView[];
  index: number;
  limits: CardEditLimits;
  enhance?: Enhance;
  /** The Text card's Width and Style as the member last chose them, saved or not. */
  chosen?: { readonly width: CardWidth; readonly surface: CardSurface };
  onchoose?: (change: CardChange) => void;
  /** Whether the Text card shows its plain Markdown field instead of the editor, and how to turn that over. */
  markdown?: { readonly shown: boolean; readonly toggle: () => void };
} = $props();


const card = $derived(cards[index]);
const keys = $derived(cards.map((c) => c.key));

const WIDTHS: readonly CardWidth[] = ["full", "half"];
const SURFACES: readonly CardSurface[] = ["filled", "outlined", "plain"];
const choosesHere = $derived(onchoose !== undefined && card?.content.kind === "readme");

/** Whether the page runs script: false while the server renders and until the first effect runs in the browser. */
let hydrated = $state(false);
$effect(() => {
  hydrated = true;
});

/** The whole new order, with the card `key` taken out and put where the card at `at` was. */
function placed(key: string, at: number): string[] {
  const order = keys.filter((k) => k !== key);
  order.splice(at, 0, key);
  return order;
}

/** The whole new order, with the cards at `from` and `to` swapped. */
function swapped(from: number, to: number): string[] {
  const order = [...keys];
  [order[from], order[to]] = [order[to] as string, order[from] as string];
  return order;
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
let menuButton: HTMLButtonElement | null = $state(null);
/** On closing the delete dialog, focus goes back to what opened it: the menu button, or the Delete link. */
function backToRemove(event: Event) {
  const target = [menuButton, removeLink].find((el) => el?.isConnected);
  if (target == null) return;
  event.preventDefault();
  target.focus();
}
/** The move forms the menu submits, by direction. */
const moveForms: Record<"up" | "down", HTMLFormElement | undefined> = $state({ up: undefined, down: undefined });
function moveFromMenu(to: "up" | "down") {
  moveForms[to]?.requestSubmit();
}
function removeFromMenu() {
  removeRefused = undefined;
  removing = true;
}

/** Large screens with a mouse drag cards; phones and the keyboard use the menu. */
const DRAGS = "(min-width: 64rem) and (pointer: fine)";
const DRAG_TYPE = "application/x-unset-card";
let dropOrder: string[] = $state([]);
let dropForm: HTMLFormElement | undefined = $state();
async function dropped(key: string) {
  dropOrder = placed(key, index);
  await tick();
  dropForm?.requestSubmit();
}
// The card's top bar (the element the controls sit in) is the handle, the whole card the drop target; a dragged card
// carries only its key, and a drop posts the new order as a move does.
$effect(() => {
  const head = group?.parentElement;
  const shown = group?.closest<HTMLElement>('[data-slot="card"]');
  const key = card?.key;
  if (!hydrated || head == null || shown == null || key === undefined) return;
  const wide = matchMedia(DRAGS);
  const sync = () => {
    head.draggable = wide.matches;
    head.style.cursor = wide.matches ? "grab" : "";
  };
  const start = (event: DragEvent) => {
    if (event.dataTransfer === null) return;
    event.dataTransfer.setData(DRAG_TYPE, key);
    event.dataTransfer.effectAllowed = "move";
    const box = shown.getBoundingClientRect();
    event.dataTransfer.setDragImage(shown, event.clientX - box.left, event.clientY - box.top);
  };
  const over = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    shown.dataset.drop = "";
  };
  const leave = (event: DragEvent) => {
    if (!(event.relatedTarget instanceof Node && shown.contains(event.relatedTarget))) delete shown.dataset.drop;
  };
  const drop = (event: DragEvent) => {
    delete shown.dataset.drop;
    const from = event.dataTransfer?.getData(DRAG_TYPE);
    if (from === undefined || from === "") return;
    event.preventDefault();
    if (from !== key) void dropped(from);
  };
  sync();
  wide.addEventListener("change", sync);
  head.addEventListener("dragstart", start);
  shown.addEventListener("dragover", over);
  shown.addEventListener("dragleave", leave);
  shown.addEventListener("drop", drop);
  return () => {
    wide.removeEventListener("change", sync);
    head.removeEventListener("dragstart", start);
    shown.removeEventListener("dragover", over);
    shown.removeEventListener("dragleave", leave);
    shown.removeEventListener("drop", drop);
    head.draggable = false;
    head.style.cursor = "";
  };
});

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
  const target =
    group.querySelector<HTMLElement>("[data-card-menu]") ??
    group.querySelector<HTMLElement>(`[data-move="${pending.to}"]`) ??
    group.querySelector<HTMLElement>("[data-move]");
  target?.focus();
});
</script>

{#snippet move(to: number, label: string)}
  {@const direction = to < index ? "up" : "down"}
  <form
    bind:this={moveForms[direction]}
    method="POST"
    action="?/reorder"
    hidden={hydrated}
    use:enhance
    onsubmit={() => (pendingMove = { key: card?.key ?? "", to: direction })}
  >
    {#each swapped(index, to) as key (key)}<input type="hidden" name="order" value={key} />{/each}
    {#if !hydrated}
      <Button type="submit" variant="ghost" size="icon-sm" data-move={direction} class={tap}
        ><Icon name={direction} size={20} label={label} /></Button
      >
    {/if}
  </form>
{/snippet}

{#if card !== undefined}
  <fieldset
    bind:this={group}
    data-card-controls
    class="-me-2 -mt-1 flex shrink-0 gap-0.5"
  >
    <legend class="sr-only">{CARD_EDIT.group(cardName(card.content))}</legend>
    <CardEditor
      kind={card.content.kind}
      content={card.content}
      width={card.width}
      surface={card.surface}
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
    {#if hydrated}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          bind:ref={menuButton}
          data-card-menu
          class="{buttonVariants({ variant: 'ghost', size: 'icon-sm' })} {tap}"
          ><Icon name="more" size={20} label={CARD_EDIT.more(cardName(card.content))} /></DropdownMenu.Trigger
        >
        <!-- No scroll lock: the menu's lock and the delete dialog's overlap and the page jumps to the top (bits-ui 2.20.6 popper-layer-inner.svelte locks by default). -->
        <DropdownMenu.Content align="end" preventScroll={false}>
          {#if index > 0}
            <DropdownMenu.Item onSelect={() => moveFromMenu("up")}><Icon name="up" size={16} />{CARD_EDIT.up}</DropdownMenu.Item>
          {/if}
          {#if index < cards.length - 1}
            <DropdownMenu.Item onSelect={() => moveFromMenu("down")}
              ><Icon name="down" size={16} />{CARD_EDIT.down}</DropdownMenu.Item
            >
          {/if}
          {#if choosesHere && onchoose !== undefined}
            {#if index > 0 || index < cards.length - 1}<DropdownMenu.Separator />{/if}
            <DropdownMenu.Label>{CARD_EDIT.width}</DropdownMenu.Label>
            <DropdownMenu.RadioGroup
              bind:value={() => chosen?.width ?? card.width, (width) => onchoose({ width: width as CardWidth })}
            >
              {#each WIDTHS as width (width)}
                <DropdownMenu.RadioItem value={width} closeOnSelect={false}>{CARD_EDIT[width]}</DropdownMenu.RadioItem>
              {/each}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Label>{CARD_EDIT.style}</DropdownMenu.Label>
            <DropdownMenu.RadioGroup
              bind:value={() => chosen?.surface ?? card.surface, (surface) => onchoose({ surface: surface as CardSurface })}
            >
              {#each SURFACES as surface (surface)}
                <DropdownMenu.RadioItem value={surface} closeOnSelect={false}>{CARD_EDIT[surface]}</DropdownMenu.RadioItem>
              {/each}
            </DropdownMenu.RadioGroup>
            {#if markdown !== undefined}
              <DropdownMenu.Separator />
              <DropdownMenu.CheckboxItem bind:checked={() => markdown.shown, () => markdown.toggle()}
                >{CARD_EDIT.showMarkdown}</DropdownMenu.CheckboxItem
              >
            {/if}
          {/if}
          {#if cards.length > 1 || choosesHere}<DropdownMenu.Separator />{/if}
          <DropdownMenu.Item variant="destructive" onSelect={removeFromMenu}
            ><Icon name="delete" size={16} />{CARD_EDIT.remove}</DropdownMenu.Item
          >
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <form bind:this={dropForm} method="POST" action="?/reorder" hidden use:enhance>
        {#each dropOrder as key (key)}<input type="hidden" name="order" value={key} />{/each}
      </form>
    {/if}
    <Dialog.Root bind:open={removing}>
      {#if !hydrated}
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
      {/if}
      <Dialog.Content onCloseAutoFocus={backToRemove}>
        <Dialog.Header>
          <Dialog.Title>{CARD_EDIT.removeTitle(cardName(card.content))}</Dialog.Title>
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
