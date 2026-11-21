<!--
  The owner's editor in place, for a page opened with one (no script; staging walkthrough 2026-11-18, finding 8): the
  card's editor, the delete confirm, the Add card picker and then the chosen kind's editor, or the avatar's shape,
  each as a panel at the top of the cards with a Cancel link back to the page. Their forms post to the page's
  actions as the dialogs do, keeping the query, so a refusal shows the panel again with the reason and what was typed.
-->
<script lang="ts">
import { ADD_CARD, BUTTONS_EDIT, CARD_EDIT, COLLECTION_EDIT, cardName, LINKS_EDIT } from "../../profile/messages.ts";
import { PANEL_ANCHOR } from "../../profile/panel.ts";
import type {
  AvatarShape,
  CardEditLimits,
  CardPanelRequest,
  CardPanelState,
  CardView,
  Enhance,
  Refusal,
} from "../../profile/types.ts";
import * as Alert from "../ui/alert/index.ts";
import { Button } from "../ui/button/index.ts";
import * as Card from "../ui/card/index.ts";
import { cardKinds, maxRows, OPTION_LOOK } from "./add-card.svelte";
import AvatarEditor from "./avatar-editor.svelte";
import CardEditor from "./card-editor.svelte";

let {
  request,
  cards,
  limits,
  shape,
  here,
  refusal,
  newKey,
  enhance = () => undefined,
}: {
  request: CardPanelRequest;
  cards: readonly CardView[];
  limits: CardEditLimits;
  shape: AvatarShape;
  /** The page's own path, where Cancel goes. */
  here: string;
  /** The page's action answer after a refused write, with what was typed when it was a card form. */
  refusal?: (Refusal & { readonly values?: Readonly<Record<string, string>> }) | null;
  /** The page's newCardKey, for the card the add form adds. */
  newKey?: string;
  enhance?: Enhance;
} = $props();

const EDIT_TITLE = {
  readme: CARD_EDIT.editReadme,
  links: LINKS_EDIT.editTitle,
  collection: COLLECTION_EDIT.editTitle,
  buttons: BUTTONS_EDIT.editTitle,
};
const card = $derived(
  request.kind === "edit" || request.kind === "remove" ? cards.find((c) => c.key === request.key) : undefined,
);
const adding = $derived(
  request.kind === "add" && request.card !== null ? cardKinds(limits).find((k) => k.kind === request.card) : undefined,
);
/** The panel's place, link back and kept query, with the refusal the page was shown again with. */
const panelState = (stay: string): CardPanelState => ({
  anchor: PANEL_ANCHOR,
  cancel: here,
  stay,
  ...(refusal == null ? {} : { refusal, ...(refusal.values === undefined ? {} : { values: refusal.values }) }),
});
</script>

{#if request.kind === "edit" && card !== undefined}
  <CardEditor
    kind={card.content.kind}
    content={card.content}
    width={card.width}
    surface={card.surface}
    cardKey={card.key}
    trigger={null}
    panel={panelState(`edit=${card.key}`)}
    title={EDIT_TITLE[card.content.kind]}
    submit={CARD_EDIT.save}
    max={maxRows(limits, card.content.kind)}
    textMax={limits.text}
    {enhance}
  />
{:else if request.kind === "remove" && card !== undefined}
  <Card.Root id={PANEL_ANCHOR} class="gap-4 rounded-sm">
    <Card.Header>
      <Card.Title><h2 class="text-xl font-semibold">{CARD_EDIT.removeTitle(cardName(card.content))}</h2></Card.Title>
      <Card.Description>{CARD_EDIT.removeBody}</Card.Description>
    </Card.Header>
    {#if refusal != null}
      <Card.Content>
        <Alert.Root variant="destructive"><Alert.Description>{refusal.message}</Alert.Description></Alert.Root>
      </Card.Content>
    {/if}
    <Card.Footer class="flex justify-end gap-2">
      <Button href={here} variant="outline">{CARD_EDIT.cancel}</Button>
      <form method="POST" action="?/remove&remove={card.key}#{PANEL_ANCHOR}" use:enhance>
        <input type="hidden" name="key" value={card.key} />
        <Button type="submit" variant="destructive">{CARD_EDIT.remove}</Button>
      </form>
    </Card.Footer>
  </Card.Root>
{:else if adding !== undefined}
  <CardEditor
    kind={adding.kind}
    width={adding.width}
    trigger={null}
    panel={panelState(`add=${adding.kind}`)}
    title={adding.title}
    submit={CARD_EDIT.add}
    max={maxRows(limits, adding.kind)}
    textMax={limits.text}
    {newKey}
    {enhance}
  />
{:else if request.kind === "add"}
  <Card.Root id={PANEL_ANCHOR} class="gap-4 rounded-sm">
    <Card.Header>
      <Card.Title><h2 class="text-xl font-semibold">{ADD_CARD.title}</h2></Card.Title>
      <Card.Description>{ADD_CARD.description}</Card.Description>
    </Card.Header>
    <Card.Content>
      <ul class="grid gap-2">
        {#each cardKinds(limits) as option (option.kind)}
          <li>
            <a class={OPTION_LOOK} href="?add={option.kind}#{PANEL_ANCHOR}">
              <span class="font-semibold">{option.name}</span>
              <span class="text-sm text-muted-foreground">{option.blurb}</span>
            </a>
          </li>
        {/each}
      </ul>
    </Card.Content>
    <Card.Footer class="flex justify-end"><Button href={here} variant="outline">{CARD_EDIT.cancel}</Button></Card.Footer>
  </Card.Root>
{:else if request.kind === "avatar"}
  <AvatarEditor {shape} {enhance} panel={panelState("avatar")} />
{/if}
