<!--
  One conversation, part of the chat page's shell (ADR 0088; ADR 0055 point 2). The live timeline as the adapter maps
  it (matrix/conversations.ts toMessages): text, and a plain line for a message this browser cannot decrypt. Older
  messages load on request; the newest is marked read as it is shown. The composer is text only and stays off until
  the other person has joined and encryption is on for the conversation in this browser (core/conversations.ts
  composerOf); a conversation that is not encrypted is never sent in from this page (ADR 0085 decision 4).
  Message text is the sender's own: Svelte escapes it, and nothing here renders markup.
-->
<script lang="ts">
import type { Composer, ConversationId, Conversations, ConversationView } from "./core/conversations.ts";
import { Icon } from "./lib/components/icon/index.js";
import * as Alert from "./lib/components/ui/alert/index.js";
import { Button } from "./lib/components/ui/button/index.js";
import { Input } from "./lib/components/ui/input/index.js";

let { conversations, id, onBack }: { conversations: Conversations; id: ConversationId; onBack: () => void } = $props();

let view: ConversationView | null = $state(null);
let loaded = $state(false);
let text = $state("");
let sending = $state(false);
let failed = $state(false);

$effect(() =>
  conversations.watch(id, (next) => {
    view = next;
    loaded = true;
  }),
);

const WAITING: Record<Exclude<Composer, "on">, (name: string) => string> = {
  request: (name) => `${name} wants to talk. Accept to reply.`,
  gone: () => "You left this conversation.",
  not_encrypted: () => "This conversation is not encrypted, so you cannot send messages in it here.",
  waiting_for_them: (name) => `You can write once ${name} accepts your request.`,
  waiting_for_encryption: () => "Securing this conversation…",
};

async function send(event: SubmitEvent) {
  event.preventDefault();
  if (sending || text.trim() === "") return;
  sending = true;
  const sent = await conversations.send(id, text);
  sending = false;
  failed = !sent;
  if (sent) text = "";
}

async function accept() {
  failed = !(await conversations.accept(id));
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
</script>

<section class="flex flex-col gap-4" data-screen="conversation" data-composer={view?.composer}>
  <div class="flex items-center gap-2">
    <Button variant="ghost" size="icon" onclick={onBack}><Icon name="back" label="Back to conversations" /></Button>
    {#if view !== null}
      <h2 class="min-w-0 flex-1 truncate font-medium">{view.conversation.with.name}</h2>
      {#if view.conversation.kind === "encrypted"}
        <span class="flex items-center gap-1 text-xs" data-mark="encrypted"><Icon name="private" size={16} />Encrypted</span>
      {:else}
        <span class="flex items-center gap-1 text-xs" data-mark="not_encrypted">
          <Icon name="warning" size={16} />Not encrypted
        </span>
      {/if}
    {/if}
  </div>
  {#if view === null}
    <p class="text-muted-foreground text-sm">{loaded ? "This conversation is not available." : "One moment."}</p>
  {:else}
    {#if view.hasOlder}
      <Button variant="outline" size="sm" onclick={() => conversations.older(id)}>Show older messages</Button>
    {/if}
    <ol class="flex flex-col gap-2" aria-label="Messages">
      {#each view.messages as message (message.id)}
        <li class={message.mine ? "self-end text-right" : "self-start"} data-mine={message.mine}>
          {#if message.kind === "text"}
            <p class="bg-muted rounded-md px-3 py-2 text-sm break-words whitespace-pre-wrap">{message.text}</p>
          {:else}
            <p class="text-muted-foreground text-sm italic" data-unreadable>This message can't be read on this browser</p>
          {/if}
          <time class="text-muted-foreground text-xs" datetime={new Date(message.at).toISOString()}>{time(message.at)}</time>
        </li>
      {/each}
    </ol>
    {#if view.composer === "request"}
      <Button onclick={accept}>Accept</Button>
    {/if}
    {#if failed}
      <Alert.Root>
        <Alert.Description>That did not go through. Try again in a moment.</Alert.Description>
      </Alert.Root>
    {/if}
    <form class="flex gap-2" onsubmit={send}>
      <label class="sr-only" for="message">Message</label>
      <Input
        id="message"
        autocomplete="off"
        disabled={view.composer !== "on"}
        aria-describedby={view.composer === "on" ? undefined : "composer-off"}
        bind:value={text}
      />
      <Button type="submit" disabled={view.composer !== "on" || sending}>Send</Button>
    </form>
    {#if view.composer !== "on"}
      <p id="composer-off" class="text-muted-foreground text-sm">{WAITING[view.composer](view.conversation.with.name)}</p>
    {/if}
  {/if}
</section>
