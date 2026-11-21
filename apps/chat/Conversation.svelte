<!--
  One conversation, part of the chat page's shell (ADR 0099; ADR 0055 point 2). The live timeline as the adapter maps
  it (matrix/conversations.ts toMessages), each message with its menu (ConversationMessage.svelte): text, and a plain
  line for a message this browser cannot decrypt; a message from a device its owner has not confirmed carries a
  warning, where Element shows its red padlock (ADR 0104). Older
  messages load on request; the newest is marked read as it is shown, and "Seen" with the time goes under the last
  message the other person has read (ADR 0103 decision 4). The composer is text only and stays off until
  encryption is on for the conversation in this browser (core/conversations.ts composerOf); while the other person has
  not accepted it is pending and still sends, for them to read once they do. A conversation that is not encrypted is
  never sent in from this page (ADR 0097 decision 4). `typed` is what the field opens with: for a new conversation,
  what the member typed while its first message went; `unsent` marks that the first message did not go, so the field
  keeps it with the failure shown.
  Deleting (ADR 0103 decision 2; Alex, 2026-11-21 20:42Z): Delete on one message, or Select and then "Delete N" on
  several of one's own, asks once to confirm, with "Don't ask me again", which this browser keeps
  (conversation-service.ts); once it is set Delete acts at once. Any not deleted are reported; the rest still go.
  Message text is the sender's own: Svelte escapes it, and nothing here renders markup.
-->
<script lang="ts">
import ConversationMessage from "./ConversationMessage.svelte";
import {
  actionsOf,
  type Composer,
  type ConversationId,
  type Conversations,
  type ConversationView,
  canSend,
  draftAfterSend,
  type Message,
  selectable,
} from "./core/conversations.ts";
import { Icon } from "./lib/components/icon/index.js";
import * as Alert from "./lib/components/ui/alert/index.js";
import { Button } from "./lib/components/ui/button/index.js";
import { Checkbox } from "./lib/components/ui/checkbox/index.js";
import { Input } from "./lib/components/ui/input/index.js";
import { Label } from "./lib/components/ui/label/index.js";
import PersonName from "./PersonName.svelte";

let {
  conversations,
  id,
  onBack,
  names,
  typed = "",
  unsent = false,
}: {
  conversations: Conversations;
  id: ConversationId;
  onBack: () => void;
  names: (chatId: string) => Promise<string | null>;
  typed?: string;
  unsent?: boolean;
} = $props();

let view = $state<ConversationView | null>(null);
let loaded = $state(false);
// What the field opens with, once, when the conversation opens; the field is the member's from then on.
// svelte-ignore state_referenced_locally
let text = $state(typed);
let sending = $state(false);
// svelte-ignore state_referenced_locally
let failed = $state(unsent);
const sends = $derived(view !== null && canSend(view.composer));

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
  pending: (name) => `${name} has not accepted yet. They can read your messages once they do.`,
  they_left: (name) => `${name} is not in this conversation.`,
  waiting_for_encryption: () => "Securing this conversation…",
};

/** The message the next Send answers, shown above the composer until sent or cancelled (ADR 0103 decision 3). */
let replyingTo = $state<Message | null>(null);

function startReply(message: Message) {
  replyingTo = message;
  document.getElementById("message")?.focus();
}

async function send(event: SubmitEvent) {
  event.preventDefault();
  if (sending || text.trim() === "") return;
  sending = true;
  // The field stays open while the send goes: only what was sent is cleared, so text typed meanwhile is kept, and a
  // reply started meanwhile stays too.
  const [draft, answering] = [text, replyingTo];
  const sent = await conversations.send(id, draft, answering?.id);
  sending = false;
  failed = !sent;
  text = draftAfterSend(draft, text, sent);
  if (sent && replyingTo === answering) replyingTo = null;
}

/** In selection mode, the ids selected; null outside it. Only messages Delete is offered on can be in it. */
let selected = $state<readonly string[] | null>(null);
const canSelect = $derived(view === null ? [] : selectable(view.messages, view.composer));
/** The messages waiting on the confirm, or null when none is shown. */
let confirming = $state<readonly string[] | null>(null);
let dontAsk = $state(false);
/** How many of the last deletion were not deleted. */
let notDeleted = $state(0);

$effect(() => {
  // A message that can no longer be deleted (deleted meanwhile, or the conversation ended) leaves the selection.
  if (selected !== null && selected.some((m) => !canSelect.includes(m)))
    selected = selected.filter((m) => canSelect.includes(m));
});

function choose(messageId: string, on: boolean) {
  if (selected === null) return;
  selected = on ? [...new Set([...selected, messageId])] : selected.filter((m) => m !== messageId);
}

function askToDelete(messageIds: readonly string[]) {
  if (messageIds.length === 0) return;
  if (conversations.confirmsDelete()) {
    dontAsk = false;
    confirming = messageIds;
  } else void remove(messageIds);
}

async function remove(messageIds: readonly string[]) {
  if (dontAsk) conversations.stopConfirmingDelete();
  confirming = null;
  selected = null;
  if (replyingTo !== null && messageIds.includes(replyingTo.id)) replyingTo = null;
  notDeleted = (await conversations.remove(id, messageIds)).length;
}

async function accept() {
  failed = !(await conversations.accept(id));
}
</script>

<section class="flex flex-col gap-4" data-screen="conversation" data-composer={view?.composer}>
  <div class="flex items-center gap-2">
    <Button variant="ghost" size="icon" onclick={onBack}><Icon name="back" label="Back to conversations" /></Button>
    {#if view !== null}
      <h2 class="min-w-0 flex-1 font-medium">
        <PersonName chatId={view.conversation.with.id} handle={view.conversation.with.name} {names} />
      </h2>
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
        <ConversationMessage
          {message}
          actions={actionsOf(message, view.composer)}
          seenAt={view.seen?.id === message.id ? view.seen.at : null}
          otherName={view.conversation.with.name}
          onReact={(key) => conversations.react(id, message.id, key)}
          onReply={() => startReply(message)}
          onDelete={() => askToDelete([message.id])}
          onSelect={() => (selected = [message.id])}
          selection={selected === null
            ? null
            : { selected: selected.includes(message.id), onChange: (on) => choose(message.id, on) }}
        />
      {/each}
    </ol>
    {#if view.composer === "request"}
      <Button onclick={accept}>Accept</Button>
    {/if}
    {#if selected !== null && confirming === null}
      <div class="flex items-center gap-2" role="group" aria-label="Selected messages" data-selecting>
        <Button
          variant="destructive"
          size="sm"
          disabled={selected.length === 0}
          onclick={() => askToDelete(selected ?? [])}
        >
          <Icon name="delete" size={16} />Delete {selected.length}
        </Button>
        <Button variant="ghost" size="sm" onclick={() => (selected = null)}>Cancel</Button>
      </div>
    {/if}
    {#if confirming !== null}
      <div class="flex flex-col gap-2" role="group" aria-label="Delete messages" data-confirm-delete>
        <p class="text-sm">
          {confirming.length === 1
            ? "Delete this message? It is deleted for both of you."
            : `Delete ${confirming.length} messages? They are deleted for both of you.`}
        </p>
        <div class="flex items-center gap-2">
          <Checkbox id="dont-ask" bind:checked={dontAsk} />
          <Label for="dont-ask">Don't ask me again</Label>
        </div>
        <div class="flex gap-2">
          <Button variant="destructive" size="sm" onclick={() => remove(confirming ?? [])}>Delete</Button>
          <Button variant="ghost" size="sm" onclick={() => (confirming = null)}>Cancel</Button>
        </div>
      </div>
    {/if}
    {#if notDeleted > 0}
      <Alert.Root>
        <Alert.Description>
          {notDeleted === 1 ? "1 message was not deleted." : `${notDeleted} messages were not deleted.`} Try again in a
          moment.
        </Alert.Description>
      </Alert.Root>
    {/if}
    {#if failed}
      <Alert.Root>
        <Alert.Description>That did not go through. Try again in a moment.</Alert.Description>
      </Alert.Root>
    {/if}
    {#if replyingTo !== null && sends}
      <div class="flex items-start gap-2 border-l-2 pl-2 text-sm" data-replying={replyingTo.id}>
        <p class="min-w-0 flex-1">
          <span class="font-medium">Replying to {replyingTo.mine ? "your message" : view.conversation.with.name}</span>
          <span class="text-muted-foreground block truncate">
            {replyingTo.kind === "text" ? replyingTo.text : "This message can't be read on this browser"}
          </span>
        </p>
        <Button variant="ghost" size="icon" onclick={() => (replyingTo = null)}>
          <Icon name="close" label="Cancel reply" />
        </Button>
      </div>
    {/if}
    <form class="flex gap-2" onsubmit={send}>
      <label class="sr-only" for="message">Message</label>
      <Input
        id="message"
        autocomplete="off"
        disabled={!sends}
        aria-describedby={view.composer === "on" ? undefined : "composer-off"}
        bind:value={text}
      />
      <Button type="submit" disabled={!sends || sending}>Send</Button>
    </form>
    {#if view.composer !== "on"}
      <p id="composer-off" class="text-muted-foreground text-sm">{WAITING[view.composer](view.conversation.with.name)}</p>
    {/if}
  {/if}
</section>
