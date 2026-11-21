<!--
  One message of a conversation and its menu, as Element's message action bar works (element-web v1.12.35
  apps/web/src/components/views/rooms/EventTile/ActionBarAdapter.tsx, components/views/context_menus/
  MessageContextMenu.tsx). On a desktop the actions show
  while the pointer is over the message or focus is in it, and a right-click opens them; on a phone pressing and holding
  opens them. React offers Element's eight quick reactions (ADR 0092 decision 1); a reaction under the message is
  pressed to add one's own or take it back. Reply quotes the message above the composer, and a reply shows what it
  answers above its own text (decision 3). Delete asks to confirm first, as Element's ConfirmRedactDialog does
  (apps/web/src/components/views/dialogs/ConfirmRedactDialog.tsx:63-72), and a deleted message shows "Message deleted"
  (en_EN.json timeline.self_redaction; decision 2). Text is the sender's own: Svelte escapes it, and nothing renders
  markup.
-->
<script lang="ts">
import {
  type Message,
  type MessageAction,
  QUICK_REACTIONS,
  type QuickReaction,
  type Quote,
} from "./core/conversations.ts";
import { Icon } from "./lib/components/icon/index.js";
import { Button } from "./lib/components/ui/button/index.js";

let {
  message,
  actions,
  seenAt,
  otherName,
  onReact,
  onReply,
  onDelete,
}: {
  message: Message;
  actions: readonly MessageAction[];
  /** When the other person read up to this message, if this is where "Seen" goes. */
  seenAt: number | null;
  /** The other person's name, for a quote of their message. */
  otherName: string;
  onReact: (key: QuickReaction) => void;
  onReply: () => void;
  onDelete: () => void;
} = $props();

/**
 * closed: only hover or focus shows the actions; actions: opened by right-click or press and hold; react: the picker;
 * delete: the confirm before deleting.
 */
let menu = $state<"closed" | "actions" | "react" | "delete">("closed");
/** How long a press is held before it opens the actions, as a long press on a phone. */
const HOLD_MS = 500;
let holding: ReturnType<typeof setTimeout> | undefined;

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const can = (action: MessageAction) => actions.includes(action);
/** A quote's words, with Element's wording where it cannot load the message (ReplyChain.tsx:296). */
const QUOTE_FALLBACK = { deleted: "Message deleted", unavailable: "Can't load the message this replies to." };
const quoted = (quote: Quote) => (quote.kind === "text" ? quote.text : QUOTE_FALLBACK[quote.kind]);

function openFromContextMenu(event: MouseEvent) {
  if (actions.length === 0) return;
  event.preventDefault();
  menu = "actions";
}

function startHold(event: PointerEvent) {
  if (event.pointerType !== "touch" || actions.length === 0) return;
  holding = setTimeout(() => (menu = "actions"), HOLD_MS);
}

function endHold() {
  clearTimeout(holding);
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === "Escape") menu = "closed";
}

function confirmDelete() {
  menu = "closed";
  onDelete();
}

function react(key: QuickReaction) {
  menu = "closed";
  onReact(key);
}
</script>

<!-- The right-click and press-and-hold here only open the same toolbar that keyboard focus inside the message shows,
     so the message itself needs no keyboard handler of its own. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<li
  class={["group flex flex-col gap-1", message.mine ? "items-end self-end text-right" : "items-start self-start"]}
  data-mine={message.mine}
  data-message={message.id}
  oncontextmenu={openFromContextMenu}
  onpointerdown={startHold}
  onpointerup={endHold}
  onpointerleave={endHold}
  onpointercancel={endHold}
>
  {#if message.replyTo !== null}
    <blockquote class="text-muted-foreground border-l-2 pl-2 text-left text-xs" data-reply-to={message.replyTo.id}>
      <span class="font-medium">{message.replyTo.mine ? "You" : otherName}</span>
      <span class="break-words whitespace-pre-wrap">{quoted(message.replyTo)}</span>
    </blockquote>
  {/if}
  {#if message.kind === "text"}
    <p class="bg-muted rounded-md px-3 py-2 text-sm break-words whitespace-pre-wrap">{message.text}</p>
  {:else if message.kind === "deleted"}
    <p class="text-muted-foreground text-sm italic" data-deleted>Message deleted</p>
  {:else}
    <p class="text-muted-foreground text-sm italic" data-unreadable>This message can't be read on this browser</p>
  {/if}
  {#if message.unconfirmed}
    <p class="text-muted-foreground flex items-center gap-1 text-xs" data-mark="unconfirmed">
      <Icon name="warning" size={16} />Sent from a device that hasn't been confirmed
    </p>
  {/if}
  {#if message.reactions.length > 0}
    <ul class="flex flex-wrap gap-1" aria-label="Reactions">
      {#each message.reactions as reaction (reaction.key)}
        <li>
          <Button
            variant={reaction.mine ? "secondary" : "outline"}
            size="sm"
            aria-pressed={reaction.mine}
            disabled={!can("react")}
            data-reaction={reaction.key}
            onclick={() => onReact(reaction.key)}>{reaction.key} {reaction.count}</Button
          >
        </li>
      {/each}
    </ul>
  {/if}
  {#if actions.length > 0}
    <div
      class={[menu === "closed" ? "hidden group-hover:flex group-focus-within:flex" : "flex", "gap-1"]}
      role="toolbar"
      aria-label="Message actions"
      tabindex="-1"
      onkeydown={closeOnEscape}
      data-actions
    >
      {#if can("react")}
        <Button variant="ghost" size="sm" aria-expanded={menu === "react"} onclick={() => (menu = menu === "react" ? "actions" : "react")}>
          <Icon name="like" size={16} />React
        </Button>
      {/if}
      {#if can("reply")}
        <Button
          variant="ghost"
          size="sm"
          onclick={() => {
            menu = "closed";
            onReply();
          }}><Icon name="reply" size={16} />Reply</Button
        >
      {/if}
      {#if can("delete")}
        <Button variant="ghost" size="sm" aria-expanded={menu === "delete"} onclick={() => (menu = "delete")}>
          <Icon name="delete" size={16} />Delete
        </Button>
      {/if}
    </div>
  {/if}
  {#if menu === "delete"}
    <div
      class="flex flex-wrap items-center gap-1"
      role="group"
      aria-label="Delete message"
      tabindex="-1"
      onkeydown={closeOnEscape}
      data-confirm-delete
    >
      <p class="text-sm">Delete this message? It is deleted for both of you.</p>
      <Button variant="destructive" size="sm" onclick={confirmDelete}>Delete</Button>
      <Button variant="ghost" size="sm" onclick={() => (menu = "closed")}>Cancel</Button>
    </div>
  {/if}
  {#if menu === "react"}
    <div class="flex flex-wrap gap-1" role="toolbar" aria-label="Quick reactions" tabindex="-1" onkeydown={closeOnEscape} data-picker>
      {#each QUICK_REACTIONS as key (key)}
        <Button variant="outline" size="sm" aria-label={`React with ${key}`} onclick={() => react(key)}>{key}</Button>
      {/each}
    </div>
  {/if}
  <time class="text-muted-foreground text-xs" datetime={new Date(message.at).toISOString()}>{time(message.at)}</time>
  {#if seenAt !== null}
    <p class="text-muted-foreground text-xs" data-seen>Seen {time(seenAt)}</p>
  {/if}
</li>
