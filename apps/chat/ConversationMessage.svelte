<!--
  One message of a conversation and its menu, as Element's message action bar works (element-web v1.12.35
  apps/web/src/components/views/rooms/EventTile/ActionBarAdapter.tsx, components/views/context_menus/
  MessageContextMenu.tsx). On a desktop the actions show
  while the pointer is over the message or focus is in it, and a right-click opens them; on a phone pressing and holding
  opens them. From the keyboard, Tab reaches them: they stay in the tab order while out of sight, and show once focus
  is within the message (Element shows its action bar on keyboard focus in the tile, EventTile.tsx:700-708). The actions float over the message's top edge, as Element's action bar is absolutely placed
  (packages/shared-components/src/room/timeline/event-tile/EventTileView/EventTileView.module.css:150-156), so showing
  or hiding them never moves the timeline, or a confirm below it, under the pointer. React offers Element's eight quick reactions (ADR 0103 decision 1); a reaction under the message is
  pressed to add one's own or take it back. Reply quotes the message above the composer, and a reply shows what it
  answers above its own text (decision 3). Delete and Select hand over to the conversation, which asks to confirm
  (Conversation.svelte); in selection mode a message Delete is offered on has a checkbox and no menu. A deleted message
  shows "Message deleted" (en_EN.json timeline.self_redaction; decision 2). Text is the sender's own: Svelte escapes
  it, and nothing renders markup.
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
import { Checkbox } from "./lib/components/ui/checkbox/index.js";

let {
  message,
  actions,
  seenAt,
  otherName,
  onReact,
  onReply,
  onDelete,
  onSelect,
  selection,
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
  /** Starts selection mode with this message selected. */
  onSelect: () => void;
  /** In selection mode, whether this message is selected and how to change it; null outside it. */
  selection: { readonly selected: boolean; readonly onChange: (selected: boolean) => void } | null;
} = $props();

/**
 * closed: only hover or focus shows the actions; actions: opened by right-click or press and hold; react: the
 * picker.
 */
let menu = $state<"closed" | "actions" | "react">("closed");
/** How long a press is held before it opens the actions, as a long press on a phone. */
const HOLD_MS = 500;
let holding: ReturnType<typeof setTimeout> | undefined;

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const can = (action: MessageAction) => actions.includes(action);
/** No menu while selecting: a press there selects, as the checkbox does. */
const menuActions = $derived(selection === null ? actions : []);
/** A quote's words, with Element's wording where it cannot load the message (ReplyChain.tsx:296). */
const QUOTE_FALLBACK = { deleted: "Message deleted", unavailable: "Can't load the message this replies to." };
const quoted = (quote: Quote) => (quote.kind === "text" ? quote.text : QUOTE_FALLBACK[quote.kind]);

function openFromContextMenu(event: MouseEvent) {
  if (menuActions.length === 0) return;
  event.preventDefault();
  menu = "actions";
}

function startHold(event: PointerEvent) {
  if (event.pointerType !== "touch" || menuActions.length === 0) return;
  holding = setTimeout(() => (menu = "actions"), HOLD_MS);
}

function endHold() {
  clearTimeout(holding);
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === "Escape") menu = "closed";
}

function close(then: () => void) {
  menu = "closed";
  then();
}

function react(key: QuickReaction) {
  menu = "closed";
  onReact(key);
}
</script>

<!-- The right-click and press-and-hold here only open the same toolbar that Tab reaches and keyboard focus inside the
     message shows, so the message itself needs no keyboard handler of its own. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<li
  class={["group relative flex flex-col gap-1", message.mine ? "items-end self-end text-right" : "items-start self-start"]}
  data-mine={message.mine}
  data-message={message.id}
  oncontextmenu={openFromContextMenu}
  onpointerdown={startHold}
  onpointerup={endHold}
  onpointerleave={endHold}
  onpointercancel={endHold}
>
  {#if selection !== null && can("delete")}
    <Checkbox
      aria-label="Select message"
      checked={selection.selected}
      onCheckedChange={(checked) => selection?.onChange(checked)}
    />
  {/if}
  {#if message.replyTo !== null}
    <blockquote class="text-muted-foreground border-l-2 pl-2 text-left text-xs" data-reply-to={message.replyTo.id}>
      <span class="font-medium">{message.replyTo.mine ? "You" : otherName}</span>
      <span class="break-words whitespace-pre-wrap">{quoted(message.replyTo)}</span>
    </blockquote>
  {/if}
  {#if message.kind === "text"}
    <p class={["rounded-md px-3 py-2 text-left text-sm break-words whitespace-pre-wrap", message.mine ? "bg-primary text-primary-foreground" : "bg-muted"]}>{message.text}</p>
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
  {#if menuActions.length > 0}
    <div
      class={[
        // Closed, the actions stay in the tab order but out of sight and untouchable, so Tab reaches them and focus
        // within the message shows them, as Element's tile shows its action bar on keyboard focus (element-web
        // v1.12.35 apps/web/src/components/views/rooms/EventTile.tsx:700-708). display:none would take them out.
        menu === "closed"
          ? "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
          : "",
        "flex",
        message.mine ? "end-0" : "start-0",
        "bg-background absolute bottom-full z-10 gap-1 rounded-md border shadow-xs",
      ]}
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
        <Button variant="ghost" size="sm" onclick={() => close(onDelete)}>
          <Icon name="delete" size={16} />Delete
        </Button>
        <Button variant="ghost" size="sm" onclick={() => close(onSelect)}>
          <Icon name="done" size={16} />Select
        </Button>
      {/if}
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
