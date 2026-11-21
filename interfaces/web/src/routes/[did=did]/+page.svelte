<!--
  The member's own page (P2.13, ADR 0051; from apps/web/src/screens/Me.tsx, P1.20g, P1.20i): the profile header with
  the account at a glance (ADR 0077), then the cards with their controls and an editor for each new kind. Everything shown was built by +page.server.ts; card forms post to this page's actions. Sign out and
  the link to the sign-in server live in the account menu and Settings › Account, not here (Alex 2026-11-18). With no script an editor opens in place at the top of the cards
  (CardPanel, from the page's query). With script each Text card is edited where it stands (card-text.svelte, ADR 0074
  item 4): what the member changes waits in `edits`, and in the device's drafts, until the one Save above the name
  posts every changed card to ?/saveAll at once. Drafts left from an earlier visit are offered back, never merged on
  their own.
-->
<script lang="ts">
import AddCard from "@unset/apps-web/lib/components/profile/add-card.svelte";
import CardControls from "@unset/apps-web/lib/components/profile/card-controls.svelte";
import CardPanel from "@unset/apps-web/lib/components/profile/card-panel.svelte";
import CardText from "@unset/apps-web/lib/components/profile/card-text.svelte";
import DraftsOffer from "@unset/apps-web/lib/components/profile/drafts-offer.svelte";
import ProfileCards from "@unset/apps-web/lib/components/profile/profile-cards.svelte";
import ProfileHeader from "@unset/apps-web/lib/components/profile/profile-header.svelte";
import ProfileLayout from "@unset/apps-web/lib/components/profile/profile-layout.svelte";
import UnsavedBar from "@unset/apps-web/lib/components/profile/unsaved-bar.svelte";
import * as Alert from "@unset/apps-web/lib/components/ui/alert";
import { Button } from "@unset/apps-web/lib/components/ui/button";
import * as Card from "@unset/apps-web/lib/components/ui/card";
import { Textarea } from "@unset/apps-web/lib/components/ui/textarea";
import { clearDraft, type Draft, readDraft, writeDraft } from "@unset/apps-web/lib/profile/drafts.ts";
import { cardName, OWN_PAGE, TEXT_IN_PLACE, UNSAVED_BAR } from "@unset/apps-web/lib/profile/messages.ts";
import {
  type CardEdit,
  cardSaveForm,
  readSaveAnswer,
  type WrittenVersions,
} from "@unset/apps-web/lib/profile/save-all.ts";
import type { CardView } from "@unset/apps-web/lib/profile/types.ts";
import {
  afterSave,
  type CardChange,
  edit,
  editsToSave,
  NO_EDITS,
  offeredAfterSave,
  onPage,
  type UnsavedCards,
} from "@unset/apps-web/lib/profile/unsaved.ts";
import { onMount, tick, untrack } from "svelte";
import { deserialize } from "$app/forms";
import { goto, refreshAll } from "$app/navigation";
import { enhanceInPlace as enhance } from "../../lib/enhance-in-place.ts";

let { data, form } = $props();
// The page's notes on what could not be read, under the profile header.
const hasNotes = $derived(
  data.account.handleUnavailable || data.profileUnavailable || data.cardsIncomplete || data.cardsOverflow,
);
const setUp = $derived(data.profile === null && !data.profileUnavailable);
// The tab names the member: their display name, else their verified handle. An unverified handle reads as
// `handle.invalid` (the protocol's INVALID_HANDLE, @atproto/syntax 0.7.7
// dist/handle.js), which is no name (walkthrough 2026-11-18, finding 6).
const title = $derived(data.account.verified || data.name !== data.account.handle ? data.name : OWN_PAGE.title);

// ADR 0074 item 4: the cards changed on the page and not yet saved.
let edits: UnsavedCards = $state(NO_EDITS);
/** Bumped to remount every in-place editor on the words it should now hold (Discard, drafts brought back). */
let generation = $state(0);
/**
 * The words each in-place editor holds, as it last reported them; and a count per card that remounts its editor when
 * the stored words change under it (a save from the card's own form), so it shows them. A Save from the bar leaves an
 * editor as it is: it already holds what was written, or newer words.
 */
const held = new Map<string, string>();
let remounts: ReadonlyMap<string, number> = $state(new Map());
$effect(() => {
  for (const card of data.cards) {
    if (card.content.kind !== "readme") continue;
    const want = textOf(card);
    const has = held.get(card.key);
    held.set(card.key, want);
    if (has === undefined || has === want) continue;
    untrack(() => {
      remounts = new Map(remounts).set(card.key, (remounts.get(card.key) ?? 0) + 1);
    });
  }
});
// A card deleted from its menu leaves no unsaved edit or draft behind it. Only a whole read says a card is gone: a
// failed or partial one (the PDS unreachable on a refresh) keeps every edit and draft.
$effect(() => {
  const kept = onPage(
    untrack(() => edits),
    data,
  );
  if (kept === untrack(() => edits)) return;
  forget([...untrack(() => edits).keys()].filter((key) => !kept.has(key)));
  edits = kept;
});
/** The Text cards showing their plain Markdown field instead of the editor. */
let plain: ReadonlySet<string> = $state(new Set());
let saving = $state(false);
let said: { text: string; refused: boolean } | undefined = $state();
/** Drafts this device kept from an earlier visit, offered back until the member answers. */
let offered: ReadonlyMap<string, Draft> = $state(new Map());

/** This device's storage, or null where there is none or the browser refuses it (reading it can throw SecurityError). */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
const textOf = (card: CardView) => {
  const fields = edits.get(card.key)?.fields;
  return fields?.text ?? (card.content.kind === "readme" ? card.content.text : "");
};

function change(key: string, made: CardChange) {
  if (made.fields?.text !== undefined) held.set(key, made.fields.text);
  // Typing into a card supersedes the draft an earlier visit kept for it: its own draft now holds these words. A Width
  // or Style change does not, so that draft stays offered.
  if (made.fields?.text !== undefined && offered.has(key))
    offered = new Map([...offered].filter(([other]) => other !== key));
  edits = edit(edits, data.cards, key, made);
  said = undefined;
  const text = made.fields?.text;
  const store = storage();
  const unsaved = edits.get(key);
  if (store === null || text === undefined) return;
  if (unsaved === undefined) void clearDraft(store, data.account.did, key);
  else void writeDraft(store, data.account.did, key, { version: unsaved.version, text });
}

function forget(keys: Iterable<string>) {
  const store = storage();
  if (store !== null) for (const key of keys) void clearDraft(store, data.account.did, key);
}

// While an earlier visit's draft is offered the stored draft is that one (typing retires the offer), so Discard leaves
// it and Throw them away removes it, whatever Width or Style is unsaved.
function discard() {
  forget([...edits.keys()].filter((key) => !offered.has(key)));
  edits = NO_EDITS;
  said = undefined;
  generation += 1;
}

// Each mounted Text editor's way to hand over words still waiting for their frame (card-text.svelte).
const flushes = new Set<() => void>();

const NO_VERSIONS: WrittenVersions = new Map();

async function save() {
  // A press in the same frame as the last keystroke: those words reach `edits` first.
  for (const flush of flushes) flush();
  // The keys typed straight after the press go on in the words, not to the Save button (staging, 2026-11-21).
  backToWordsFromBar();
  const toSend = editsToSave(edits, data.cards);
  const previous = data.cards;
  const sent = toSend.map((card) => card.key);
  const form = cardSaveForm(toSend, data.cardEditLimits.formBytes);
  if (form.kind === "too_large") {
    said = { text: UNSAVED_BAR.tooLarge, refused: true };
    return;
  }
  saving = true;
  const here = `/${data.account.did}`;
  let answer = readSaveAnswer({ type: "error" }, here);
  try {
    // As use:enhance posts (kit 3.2.0 src/runtime/app/forms.js): the action header asks for the JSON answer.
    const response = await fetch("?/saveAll", {
      method: "POST",
      body: form.body,
      headers: { accept: "application/json", "x-sveltekit-action": "true" },
    });
    answer = readSaveAnswer(deserialize(await response.text()), here);
  } catch {
    // Not sent, or no answer: nothing is known to be written, so everything stays unsaved.
  }
  // The cards as now stored, with the versions just written, before reading what is left: the editors stay open while
  // a Save is on its way, and words typed meanwhile stay unsaved on the new version (afterSave).
  if (answer.kind === "elsewhere") {
    // Nothing was written (an ended sign-in): every change stays in this device's drafts, offered back on return.
    saving = false;
    await goto(answer.location);
    return;
  }
  if (answer.kind !== "failed") await refreshAll();
  const keys = answer.kind === "saved" ? sent : answer.kind === "refused" ? (answer.saved ?? []) : [];
  const written = toSend.filter((card) => keys.includes(card.key));
  const before = edits;
  // Settled on the versions this Save wrote, as its answer names them: never on ones the refresh read, which another
  // tab may have written since, so a later Save is a conflict rather than a write over its words.
  const versions =
    answer.kind === "saved" || answer.kind === "refused" ? (answer.versions ?? NO_VERSIONS) : NO_VERSIONS;
  edits = afterSave(edits, written, versions, data.cards, previous);
  keepDrafts(keys, before);
  moveOffered(written, versions);
  if (answer.kind === "saved") said = { text: UNSAVED_BAR.saved, refused: false };
  else if (answer.kind === "refused") said = { text: answer.message, refused: true };
  else said = { text: UNSAVED_BAR.failed, refused: true };
  saving = false;
  await returnToWords();
}

/** The way back into the Text card the member last typed in: its editor (card-text.svelte `onfocus`) or its Markdown field. */
let lastWords: (() => void) | undefined;
/**
 * After a Save the caret goes back where the member was typing, unless they have moved on: a press on Save leaves
 * focus on the bar, or on nothing once the bar goes, and the next keys would otherwise go nowhere.
 */
/** A card's Markdown field as the page draws it now: a Save redraws the cards, so a field found before may be gone. */
const markdownField = (key: string) =>
  document.querySelector<HTMLTextAreaElement>(`textarea[data-card-markdown="${CSS.escape(key)}"]`);

function backToWordsFromBar() {
  const active = document.activeElement;
  const onBar = active === null || active === document.body || active.closest("[data-unsaved-bar]") !== null;
  if (onBar) lastWords?.();
}

async function returnToWords() {
  await tick();
  backToWordsFromBar();
}

/** Each written card's draft goes, or moves to the new version when the card holds newer words. */
function keepDrafts(written: readonly string[], before: UnsavedCards) {
  const store = storage();
  if (store === null) return;
  for (const key of written) {
    // A draft still offered from an earlier visit holds words no Save sent (only its Width or Style changed since): it
    // stays as it is until the member brings it back or throws it away.
    if (offered.has(key)) continue;
    const left = edits.get(key);
    const text = left?.fields.text;
    if (left === undefined || text === undefined) {
      if (before.has(key)) void clearDraft(store, data.account.did, key);
    } else void writeDraft(store, data.account.did, key, { version: left.version, text });
  }
}

/** An offered draft whose card's Width or Style was just written moves to the new version, here and on the device. */
function moveOffered(written: readonly CardEdit[], versions: WrittenVersions) {
  const moved = offeredAfterSave(offered, written, versions);
  if (moved === offered) return;
  const store = storage();
  for (const [key, draft] of moved)
    if (store !== null && offered.get(key) !== draft) void writeDraft(store, data.account.did, key, draft);
  offered = moved;
}

function toggleMarkdown(key: string) {
  const next = new Set(plain);
  if (!next.delete(key)) next.add(key);
  plain = next;
}

onMount(async () => {
  const store = storage();
  if (store === null) return;
  const found = new Map<string, Draft>();
  for (const card of data.cards) {
    if (card.content.kind !== "readme" || card.version === undefined) continue;
    const draft = await readDraft(store, data.account.did, card.key);
    if (draft === null) continue;
    if (draft.text === card.content.text) void clearDraft(store, data.account.did, card.key);
    else found.set(card.key, draft);
  }
  offered = found;
});

/** The drafts come back as unsaved edits, each with the version it started from, so Save names any card changed since. */
function restore() {
  let next = edits;
  for (const [key, draft] of offered) {
    next = edit(next, data.cards, key, { fields: { text: draft.text } });
    const unsaved = next.get(key);
    if (unsaved !== undefined) next = new Map(next).set(key, { ...unsaved, version: draft.version });
  }
  edits = next;
  offered = new Map();
  generation += 1;
}

function dropDrafts() {
  forget(offered.keys());
  offered = new Map();
}
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

{#snippet readNotes()}
  {#if data.account.handleUnavailable}<p>{OWN_PAGE.handleUnavailable}</p>{/if}
  {#if data.profileUnavailable}<p>{OWN_PAGE.profileUnavailable}</p>{/if}
  {#if data.cardsIncomplete}<p>{OWN_PAGE.cardsIncomplete}</p>{/if}
  {#if data.cardsOverflow}<p>{OWN_PAGE.cardsOverflow}</p>{/if}
{/snippet}

<ProfileLayout>
  {#snippet bar()}
    {#if data.profile !== null}
      <UnsavedBar
        count={edits.size}
        {saving}
        message={said?.text}
        refused={said?.refused ?? false}
        onsave={() => void save()}
        ondiscard={discard}
      />
    {/if}
  {/snippet}

  {#snippet notices()}
    <DraftsOffer count={offered.size} onrestore={restore} ondrop={dropDrafts} />
    {#if form?.message && data.cardPanel === null}
      <Alert.Root variant="destructive" role="alert">
        <Alert.Description>{form.message}</Alert.Description>
      </Alert.Root>
    {/if}
  {/snippet}

  {#snippet header()}
    <ProfileHeader
      name={data.name}
      letter={data.letter}
      handle={data.profile === null ? null : data.account.handle}
      did={data.account.did}
      headline={data.profile?.headline}
      location={data.profile?.location}
      website={data.profile?.website}
      contact={data.contact}
      shape={data.avatarShape}
      edit={data.profile === null ? undefined : { href: "/settings/profile", publicHref: `/@${data.account.did}`, enhance }}
      notes={hasNotes ? readNotes : undefined}
    />
  {/snippet}

  {#if data.cardPanel !== null}
    <CardPanel
      request={data.cardPanel}
      cards={data.cards}
      limits={data.cardEditLimits}
      shape={data.avatarShape}
      here={`/${data.account.did}`}
      refusal={form?.code === undefined ? null : form}
      newKey={data.newCardKey}
      {enhance}
    />
  {/if}
  {#if data.profile === null}
    <ProfileCards cards={data.cards} />
  {:else}
    <ProfileCards cards={data.cards}>
      {#snippet controls(index: number)}
        {@const card = data.cards[index]}
        <CardControls
          cards={data.cards}
          {index}
          limits={data.cardEditLimits}
          {enhance}
          chosen={card === undefined ? undefined : (edits.get(card.key) ?? card)}
          onchoose={(made) => card !== undefined && change(card.key, made)}
          markdown={card === undefined
            ? undefined
            : { shown: plain.has(card.key), toggle: () => toggleMarkdown(card.key) }}
        />
      {/snippet}
      {#snippet text(index: number)}
        {@const card = data.cards[index]}
        {#if card !== undefined && card.shown.kind === "readme"}
          {#if plain.has(card.key)}
            <Textarea
              aria-label={TEXT_IN_PLACE.label(cardName(card.content))}
              value={textOf(card)}
              rows={12}
              maxlength={data.cardEditLimits.text}
              oninput={(event) => change(card.key, { fields: { text: event.currentTarget.value } })}
              data-card-markdown={card.key}
              onfocus={() => (lastWords = () => markdownField(card.key)?.focus())}
            />
          {:else}
            <!-- Remounted on Discard, drafts brought back, or new stored words under it (remounts). -->
            {#key `${generation}:${card.key}:${remounts.get(card.key) ?? 0}`}
              <CardText
                blocks={card.shown.blocks}
                name={cardName(card.content)}
                value={textOf(card)}
                onedit={(markdown) => change(card.key, { fields: { text: markdown } })}
                {flushes}
                onfocus={(focus) => (lastWords = focus)}
              />
            {/key}
          {/if}
        {/if}
      {/snippet}
      {#snippet add()}
        <AddCard limits={data.cardEditLimits} newKey={data.newCardKey} {enhance} />
      {/snippet}
    </ProfileCards>
  {/if}

  {#if setUp}
    <Card.Root>
      <Card.Header>
        <Card.Description>{OWN_PAGE.setUpEyebrow}</Card.Description>
        <Card.Title>{OWN_PAGE.setUpTitle}</Card.Title>
      </Card.Header>
      <Card.Content><p>{OWN_PAGE.setUpBody}</p></Card.Content>
      <Card.Footer><Button href="/settings/profile">{OWN_PAGE.editProfile}</Button></Card.Footer>
    </Card.Root>
  {/if}
</ProfileLayout>
