<!--
  Adding a card (ADR 0051; the profile-card mockup's single Add picker, Alex 2026-11-18): one "Add card" button after
  the last card opens the stock Dialog listing the kinds of card; choosing one closes it and opens that kind's editor,
  which posts to the page's `create` action as before. When the editor closes, focus goes back to "Add card". With no
  script "Add card" is a link to the page with the picker in place (`?add`), whose kinds link on to their editors
  (card-panel.svelte; staging walkthrough 2026-11-18, finding 8).
-->
<script module lang="ts">
import { ADD_CARD, BUTTONS_EDIT, CARD_EDIT, COLLECTION_EDIT, LINKS_EDIT } from "../../profile/messages.ts";
import type { CardContent, CardEditLimits } from "../../profile/types.ts";

type Kind = CardContent["kind"];
export type CardKindOption = { kind: Kind; name: string; blurb: string; title: string; width: "full" | "half" };

/** The kinds of card the picker offers, in order, with the editor each opens. */
export function cardKinds(limits: CardEditLimits): readonly CardKindOption[] {
  return [
    { kind: "readme", name: ADD_CARD.readme, blurb: ADD_CARD.readmeBlurb, title: CARD_EDIT.addReadme, width: "full" },
    { kind: "links", name: ADD_CARD.links, blurb: ADD_CARD.linksBlurb, title: LINKS_EDIT.add, width: "full" },
    {
      kind: "collection",
      name: ADD_CARD.collection,
      blurb: ADD_CARD.collectionBlurb,
      title: COLLECTION_EDIT.add,
      width: "full",
    },
    {
      kind: "buttons",
      name: ADD_CARD.buttons,
      blurb: ADD_CARD.buttonsBlurb(limits.buttons),
      title: BUTTONS_EDIT.add,
      width: "half",
    },
  ];
}
/** Rows a kind's editor writes (domains/profile CARD_EDIT_LIMITS); a README has none. */
export const maxRows = (limits: CardEditLimits, kind: Kind) => (kind === "readme" ? 0 : limits[kind]);
/** The look of a kind in the picker, as a button (dialog) or a link (in place). */
export const OPTION_LOOK =
  "flex w-full flex-col items-start gap-0.5 rounded-sm border bg-card px-3.5 py-3 text-left text-foreground no-underline transition-colors hover:border-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none";
</script>

<script lang="ts">
import { tick } from "svelte";
import type { Enhance } from "../../profile/types.ts";
import { opensHere, PANEL_ANCHOR } from "../../profile/panel.ts";
import { Icon } from "../icon/index.ts";
import * as Dialog from "../ui/dialog/index.ts";
import CardEditor from "./card-editor.svelte";

let { limits, enhance }: { limits: CardEditLimits; enhance?: Enhance } = $props();

const KINDS = $derived(cardKinds(limits));

let picking = $state(false);
let editing: Record<Kind, boolean> = $state({ readme: false, links: false, collection: false, buttons: false });
const triggerId = $props.id();

async function choose(kind: Kind) {
  picking = false;
  await tick();
  editing[kind] = true;
}
const backToAdd = () => document.getElementById(triggerId);
</script>

<Dialog.Root bind:open={picking}>
  <a
    id={triggerId}
    href="?add#{PANEL_ANCHOR}"
    aria-haspopup="dialog"
    data-add-card
    onclick={(event) => {
          if (opensHere(event)) picking = true;
        }}
    class="flex min-h-18 w-full items-center justify-center gap-2 rounded-sm border border-dashed border-input font-mono text-xs tracking-wider text-muted-foreground uppercase transition-colors hover:border-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none md:col-span-2"
  >
    <Icon name="add" size={16} />{ADD_CARD.trigger}
  </a>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{ADD_CARD.title}</Dialog.Title>
      <Dialog.Description>{ADD_CARD.description}</Dialog.Description>
    </Dialog.Header>
    <ul class="grid gap-2">
      {#each KINDS as option (option.kind)}
        <li>
          <button
            type="button"
            class={OPTION_LOOK}
            onclick={() => choose(option.kind)}
          >
            <span class="font-semibold">{option.name}</span>
            <span class="text-sm text-muted-foreground">{option.blurb}</span>
          </button>
        </li>
      {/each}
    </ul>
  </Dialog.Content>
</Dialog.Root>

{#each KINDS as option (option.kind)}
  <CardEditor
    kind={option.kind}
    width={option.width}
    trigger={null}
    bind:open={editing[option.kind]}
    returnFocus={backToAdd}
    title={option.title}
    submit={CARD_EDIT.add}
    max={maxRows(limits, option.kind)}
    textMax={limits.text}
    {enhance}
  />
{/each}
