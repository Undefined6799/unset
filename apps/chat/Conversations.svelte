<!--
  The conversation list, part of the chat page's shell (ADR 0088; ADR 0055 point 2: the shell may lay out with Tailwind,
  everything else is a stock component). Requests (someone asked to talk; the invite is the request) come first with
  Accept; each conversation shows the other person's name, its unread count, and a lock when it is encrypted or a
  "Not encrypted" mark when it is not (ADR 0085). The start route `/?with=<chat ID>` (core/conversations.ts
  startTarget), where a profile's Message link lands, opens the conversation with that person if there is one, and
  otherwise a composer for a new one that makes nothing: no room and no request until the member's first Send (Alex,
  2026-11-21), so following a link from any site tells nobody anything. A conversation that is not one-to-one and
  private (core/conversations.ts availableOf) is listed as unavailable, with no name, no Accept and nothing to open.
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
  type Conversation as Item,
  startTarget,
} from "./core/conversations.ts";
import { Icon } from "./lib/components/icon/index.js";
import * as Alert from "./lib/components/ui/alert/index.js";
import { Button } from "./lib/components/ui/button/index.js";
import { Input } from "./lib/components/ui/input/index.js";

let { conversations, me }: { conversations: Conversations; me: string } = $props();

let list: readonly Item[] = $state([]);
let open: ConversationId | null = $state(null);
/** The person a new conversation would be with, while its composer is open and nothing is made yet. */
let draft: ChatId | null = $state(null);
let first = $state("");
let starting = $state(false);
let unsent: string | null = $state(null);
let problem: string | null = $state(null);
const requests = $derived(list.filter((c) => c.available && c.request));
const talks = $derived(list.filter((c) => c.available && !c.request));
const unavailable = $derived(list.filter((c) => !c.available));

$effect(() => conversations.watchList((next) => (list = next)));

async function accept(id: ConversationId) {
  problem = (await conversations.accept(id)) ? null : "The request could not be accepted. Try again in a moment.";
}

onMount(() => {
  const asked = new URLSearchParams(window.location.search).has("with");
  if (!asked) return;
  const target = startTarget(window.location.search, me);
  window.history.replaceState(null, "", "/");
  if (target === null) {
    problem = "That chat ID is not one we know.";
    return;
  }
  open = conversations.find(target);
  if (open === null) draft = target;
});

async function startDraft(event: SubmitEvent) {
  event.preventDefault();
  if (draft === null || starting || first.trim() === "") return;
  starting = true;
  const started = await conversations.start(draft, first);
  starting = false;
  if (started === null) {
    problem = "The conversation could not be started. Try again in a moment.";
    return;
  }
  problem = null;
  unsent = started.sent ? null : first;
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

{#if open !== null}
  <Conversation {conversations} id={open} {unsent} onBack={() => ((open = null), (unsent = null))} />
{:else if draft !== null}
  <section class="flex flex-col gap-4" data-screen="new-conversation">
    <div class="flex items-center gap-2">
      <Button variant="ghost" size="icon" onclick={leaveDraft}><Icon name="back" label="Back to conversations" /></Button>
      <h2 class="min-w-0 flex-1 truncate font-medium">New conversation</h2>
      <span class="flex items-center gap-1 text-xs" data-mark="encrypted"><Icon name="private" size={16} />Encrypted</span>
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
  <div class="flex flex-col gap-4" data-screen="conversations">
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
                {@render mark(request)}
                <span class="truncate">{request.with.name} wants to talk</span>
              </span>
              <Button size="sm" onclick={() => accept(request.id)}>Accept</Button>
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
              class="w-full justify-between"
              data-conversation={talk.with.id}
              onclick={() => (open = talk.id)}
            >
              <span class="flex min-w-0 items-center gap-2">
                {@render mark(talk)}
                <span class="truncate">{talk.with.name}</span>
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

{#snippet mark(item: Item)}
  {#if item.kind === "encrypted"}
    <span data-mark="encrypted"><Icon name="private" size={16} label="Encrypted" /></span>
  {:else}
    <span class="flex items-center gap-1 text-xs" data-mark="not_encrypted">
      <Icon name="warning" size={16} />Not encrypted
    </span>
  {/if}
{/snippet}
