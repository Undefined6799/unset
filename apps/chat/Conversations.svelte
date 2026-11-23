<!--
  The conversation list, part of the chat page's shell (ADR 0099; ADR 0055 point 2: the shell may lay out with Tailwind,
  everything else is a stock component). Requests (someone asked to talk; the invite is the request) come first with
  Accept; each conversation shows the other person (PersonName.svelte: their public name over their handle), its
  unread count, and a lock when it is encrypted or a "Not encrypted" mark when it is not (ADR 0097). The start route
  `/?with=<chat ID>` (core/conversations.ts startTarget), where a profile's Message link lands, opens the conversation with that person if there is one, and
  otherwise a composer for a new one that makes nothing: no room and no request until the member's first Send (Alex,
  2026-11-21), so following a link from any site tells nobody anything. A conversation that is not one-to-one and
  private (core/conversations.ts availableOf) is listed as unavailable, with no name, no Accept and nothing to open.
  In the chat box on unset.sh (ADR 0115; Alex 2026-11-23, after the dock mock-up chat-mockup/dock-v1.html) `dock`
  says what shows: the list (under unset.sh's chat icon), one conversation (at the bottom corner, its own bar with
  the box's controls), or that conversation minimised to its avatar, with its count of new messages.
  Names are the other person's own text:
  Svelte escapes it, and nothing here renders markup.
-->
<script lang="ts">
import { onMount } from "svelte";
import Conversation from "./Conversation.svelte";
import {
  type ChatId,
  type ConversationId,
  type Conversations,
  composerAfterStart,
  type Conversation as Item,
  startTarget,
} from "./core/conversations.ts";
import type { DockMode } from "./core/dock.ts";
import DockControls from "./DockControls.svelte";
import { Icon } from "./lib/components/icon/index.js";
import * as Alert from "./lib/components/ui/alert/index.js";
import { Button } from "./lib/components/ui/button/index.js";
import { Input } from "./lib/components/ui/input/index.js";
import PersonAvatar from "./PersonAvatar.svelte";
import PersonName from "./PersonName.svelte";

/** The chat box's part: what shows, and the box's ways to change it. */
export type Dock = { readonly mode: DockMode; readonly show: (mode: DockMode) => void; readonly close: () => void };

let {
  conversations,
  names,
  me,
  dock,
}: {
  conversations: Conversations;
  names: (chatId: string) => Promise<string | null>;
  me: string;
  dock?: Dock;
} = $props();

let list: readonly Item[] = $state([]);
let open: ConversationId | null = $state(null);
/** The person a new conversation would be with, while its composer is open and nothing is made yet. */
let draft: ChatId | null = $state(null);
let first = $state("");
let starting = $state(false);
/** What the opened conversation's composer starts with, once a new conversation's first message was started. */
let carried: { text: string; failed: boolean } | null = $state(null);
let problem: string | null = $state(null);
const requests = $derived(list.filter((c) => c.available && c.request));
const talks = $derived(list.filter((c) => c.available && !c.request));
const unavailable = $derived(list.filter((c) => !c.available));

$effect(() => conversations.watchList((next) => (list = next)));

async function accept(id: ConversationId) {
  problem = (await conversations.accept(id)) ? null : "The request could not be accepted. Try again in a moment.";
}

onMount(async () => {
  const asked = new URLSearchParams(window.location.search).has("with");
  if (!asked) return;
  const target = startTarget(window.location.search, me);
  window.history.replaceState(null, "", "/");
  if (target === null) {
    problem = "That chat ID is not one we know.";
    return;
  }
  open = await conversations.find(target);
  if (open === null) draft = target;
  dock?.show("conversation");
});

function openTalk(id: ConversationId) {
  open = id;
  dock?.show("conversation");
}
const openItem = $derived(list.find((c) => c.id === open));

async function startDraft(event: SubmitEvent) {
  event.preventDefault();
  if (draft === null || starting || first.trim() === "") return;
  starting = true;
  // The field stays open while the start goes, as the composer's does: what the member types meanwhile is kept.
  const sent = first;
  const started = await conversations.start(draft, sent);
  starting = false;
  if (started === null) {
    problem = "The conversation could not be started. Try again in a moment.";
    return;
  }
  problem = null;
  carried = composerAfterStart(sent, first, started.sent);
  first = "";
  draft = null;
  open = started.id;
}

function leaveDraft() {
  draft = null;
  first = "";
  problem = null;
}
</script>

{#if dock?.mode === "bubble" && open !== null}
  <button
    class="bg-primary text-primary-foreground relative flex size-full items-center justify-center rounded-full"
    onclick={() => dock?.show("conversation")}
    data-dock-bubble
  >
    <PersonAvatar handle={openItem?.with.name ?? ""} class="size-full text-xl" />
    <span class="sr-only">Open the chat with {openItem?.with.name ?? "them"}</span>
    {#if (openItem?.unread ?? 0) > 0}
      <span class="bg-background text-foreground absolute bottom-1 rounded-full px-1.5 text-xs" data-unread={openItem?.unread}>
        {openItem?.unread}<span class="sr-only"> new</span>
      </span>
    {/if}
  </button>
{:else if open !== null && dock?.mode !== "list"}
  <Conversation
    {conversations}
    {names}
    id={open}
    typed={carried?.text ?? ""}
    unsent={carried?.failed === true}
    onBack={dock === undefined ? () => ((open = null), (carried = null)) : undefined}
    controls={dock === undefined ? undefined : conversationControls}
  />
{:else if draft !== null && dock?.mode !== "list"}
  <section class="flex flex-col gap-4" data-screen="new-conversation">
    <div class="flex items-center gap-2">
      <Button variant="ghost" size="icon" onclick={leaveDraft}><Icon name="back" label="Back to conversations" /></Button>
      <h2 class="min-w-0 flex-1 truncate font-medium">New conversation</h2>
      <span class="flex items-center gap-1 text-xs" data-mark="encrypted"><Icon name="private" size={16} />Encrypted</span>
      {#if dock !== undefined}<DockControls onClose={dock.close} />{/if}
    </div>
    {#if problem !== null}
      <Alert.Root>
        <Alert.Description>{problem}</Alert.Description>
      </Alert.Root>
    {/if}
    <form class="flex gap-2" onsubmit={startDraft}>
      <label class="sr-only" for="message">Message</label>
      <Input id="message" autocomplete="off" aria-describedby="new-conversation-note" bind:value={first} />
      <Button type="submit" disabled={starting}>Send</Button>
    </form>
    <p id="new-conversation-note" class="text-muted-foreground text-sm">
      {starting ? "Sending…" : "Your first message asks them to talk. They can read it once they accept."}
    </p>
  </section>
{:else}
  <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto" data-screen="conversations">
    {#if problem !== null}
      <Alert.Root>
        <Alert.Description>{problem}</Alert.Description>
      </Alert.Root>
    {/if}
    {#if requests.length > 0}
      <section class="flex flex-col gap-2" aria-labelledby="requests-heading">
        <h2 id="requests-heading" class="text-sm font-medium">Requests</h2>
        <ul class="flex flex-col gap-2">
          {#each requests as request (request.id)}
            <li class="flex items-center justify-between gap-2" data-request={request.with.id}>
              <span class="flex min-w-0 items-center gap-2">
                <PersonAvatar handle={request.with.name} />
                {@render mark(request)}
                <span class="truncate">{request.with.name} wants to talk</span>
              </span>
              {#if dock === undefined}
                <Button size="sm" onclick={() => accept(request.id)}>Accept</Button>
              {:else}
                <!-- The box opens it, with Accept in the conversation, as the mock-up's menu does. -->
                <Button size="sm" onclick={() => openTalk(request.id)}>Open</Button>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    {#if talks.length === 0 && requests.length === 0 && unavailable.length === 0}
      <p class="text-muted-foreground text-sm">No conversations yet.</p>
    {:else if talks.length > 0}
      <ul class="flex flex-col gap-1" aria-label="Conversations">
        {#each talks as talk (talk.id)}
          <li>
            <Button
              variant="ghost"
              class="h-auto w-full justify-between py-2"
              data-conversation={talk.with.id}
              onclick={() => openTalk(talk.id)}
            >
              <span class="flex min-w-0 items-center gap-2">
                <PersonAvatar handle={talk.with.name} />
                {@render mark(talk)}
                <PersonName chatId={talk.with.id} handle={talk.with.name} {names} />
              </span>
              {#if talk.unread > 0}
                <span class="bg-primary text-primary-foreground rounded-full px-2 text-xs" data-unread={talk.unread}>
                  {talk.unread}<span class="sr-only"> unread</span>
                </span>
              {/if}
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if unavailable.length > 0}
      <ul class="flex flex-col gap-1" aria-label="Unavailable conversations">
        {#each unavailable as item (item.id)}
          <li class="text-muted-foreground flex items-center gap-2 px-4 py-2 text-sm" data-unavailable>
            <Icon name="warning" size={16} />This conversation is not available.
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

{#snippet conversationControls()}
  {#if dock !== undefined}
    <DockControls onMinimise={() => dock.show("bubble")} onClose={dock.close} />
  {/if}
{/snippet}

{#snippet mark(item: Item)}
  {#if item.kind === "encrypted"}
    <span data-mark="encrypted"><Icon name="private" size={16} label="Encrypted" /></span>
  {:else}
    <span class="flex items-center gap-1 text-xs" data-mark="not_encrypted">
      <Icon name="warning" size={16} />Not encrypted
    </span>
  {/if}
{/snippet}
