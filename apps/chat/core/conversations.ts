// The chat page's own words for conversations (build step 9). Screens see only these; matrix/conversations.ts turns the
// SDK's rooms and events into them (architecture instructions §4-5), so no SDK type reaches a screen.
// Room kinds (ADR 0085): a room is encrypted or plain, fixed when it is made; this page makes encrypted ones only and
// sends only in them, and marks any other room "not encrypted" so the screens are ready when plain chats are offered.
// Chat is one-to-one and private (Alex, 2026-11-21; group chat later): a room with a third person, or one that
// anyone but an invited person may join, is listed as unavailable and never opened, accepted or sent in. The server's
// RoomPolicy refuses to make one; this page does not trust that alone, since it encrypts to everyone in a room.

/** A member's chat ID, `@u<20 base32 letters>:<our server>` (ADR 0010: opaque), checked by parseChatId. */
export type ChatId = string & { readonly __brand: "ChatId" };
/** One conversation, by the id the adapter gave it. */
export type ConversationId = string & { readonly __brand: "ConversationId" };

export type ConversationKind = "encrypted" | "not_encrypted";

export type Conversation = {
  readonly id: ConversationId;
  /** The other person: their chat ID, which is never shown, and the name they are shown by (nameOf). */
  readonly with: { readonly id: string; readonly name: string };
  readonly kind: ConversationKind;
  /** One-to-one and private (availableOf); false: shown as unavailable, never as a chat. */
  readonly available: boolean;
  /** Someone asked to talk and this member has not accepted yet (the invite is the request). */
  readonly request: boolean;
  readonly unread: number;
  readonly lastActiveAt: number;
};

/**
 * Element's quick reactions (element-web v1.12.35 packages/shared-components/src/core/EmojiPicker/QuickReactions.tsx:
 * 22), the only keys the server takes (ADR 0092 decision 1). They are what people put on a message, not icons.
 */
export const QUICK_REACTIONS = ["👍", "👎", "😄", "🎉", "😕", "❤️", "🚀", "👀"] as const;
export type QuickReaction = (typeof QUICK_REACTIONS)[number];
export const isQuickReaction = (key: unknown): key is QuickReaction => QUICK_REACTIONS.some((q) => q === key);

/** One reaction on a message: how many put it there, and whether this member is one of them. */
export type Reaction = { readonly key: QuickReaction; readonly count: number; readonly mine: boolean };

/** What a reply shows of the message it answers: its text, that it was deleted, or that it cannot be shown here. */
export type Quote = { readonly id: string; readonly mine: boolean } & (
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "deleted" }
  | { readonly kind: "unavailable" }
);

/**
 * A line of the conversation: text, a message this browser cannot read, or one its sender deleted (ADR 0092 decision
 * 2). User text is never markup.
 */
export type Message = {
  readonly id: string;
  readonly mine: boolean;
  readonly at: number;
  /** Sent from a device its owner has not confirmed: shown with a warning (ADR 0093). */
  readonly unconfirmed: boolean;
  /** Its quick reactions, most first. */
  readonly reactions: readonly Reaction[];
  /** The message this one answers (ADR 0092 decision 3), or null. */
  readonly replyTo: Quote | null;
} & ({ readonly kind: "text"; readonly text: string } | { readonly kind: "unreadable" } | { readonly kind: "deleted" });

/** What a member can do with a message from its menu. */
export type MessageAction = "react" | "reply" | "delete";

/**
 * React and reply while the composer sends; delete one's own message while still a member of an encrypted
 * conversation, the only redaction of a message the server takes (ADR 0092 decision 2). Nothing on a deleted message.
 */
export function actionsOf(message: Message, composer: Composer): readonly MessageAction[] {
  if (message.kind === "deleted") return [];
  const actions: MessageAction[] = canSend(composer) ? ["react", "reply"] : [];
  const member = composer !== "request" && composer !== "gone" && composer !== "not_encrypted";
  if (message.mine && member) actions.push("delete");
  return actions;
}

/**
 * - on: the composer may send;
 * - pending: it may send, and the other person, still invited, reads the messages once they accept (Alex, 2026-11-21:
 *   the asker writes along with the request);
 * - request: accept the request first;
 * - gone: this member has left;
 * - not_encrypted: the room is not encrypted, and this page never sends in one;
 * - they_left: the other person is not in the conversation any more (left, or turned the request down);
 * - waiting_for_encryption: this browser's encryption has not switched on for the room yet.
 */
export type Composer = "on" | "pending" | "request" | "gone" | "not_encrypted" | "they_left" | "waiting_for_encryption";

export type ComposerFacts = {
  readonly mine: "join" | "invite" | "leave";
  /** Where the other person stands: joined, invited, or out of the room. */
  readonly other: "join" | "invite" | "out";
  readonly kind: ConversationKind;
  /** The SDK's crypto has encryption on for the room (CryptoApi.isEncryptionEnabledInRoom). */
  readonly encryptionOn: boolean;
};

/** Off until this member has joined an encrypted room whose encryption is on here and the other person is in it. */
export function composerOf(facts: ComposerFacts): Composer {
  if (facts.mine === "invite") return "request";
  if (facts.mine === "leave") return "gone";
  if (facts.kind !== "encrypted") return "not_encrypted";
  if (facts.other === "out") return "they_left";
  if (!facts.encryptionOn) return "waiting_for_encryption";
  return facts.other === "invite" ? "pending" : "on";
}

/** Whether the composer sends: on, or pending while the other person is invited. */
export const canSend = (composer: Composer): boolean => composer === "on" || composer === "pending";

/** How many people a conversation may hold, joined or invited: this member and one other. */
const ROOM_SIZE = 2;

/**
 * A room is a conversation here only when an invite is the one way in (m.room.join_rules `invite`, which both private
 * createRoom presets set, spec v1.18 #post_matrixclientv3createroom) and at most two people are joined or invited.
 * No join rule seen is not private: the page never assumes the spec's default.
 */
export function availableOf(facts: { readonly joinRule: string | undefined; readonly people: number }): boolean {
  return facts.joinRule === "invite" && facts.people <= ROOM_SIZE;
}

export type ConversationView = {
  readonly conversation: Conversation;
  readonly messages: readonly Message[];
  readonly composer: Composer;
  /** Older messages may still be loaded. */
  readonly hasOlder: boolean;
  /** The last message of this member's the other person has read, and when they read it (ADR 0092 decision 4). */
  readonly seen: { readonly id: string; readonly at: number } | null;
};

/** What the screens can do with conversations; every call reports its outcome, nothing is thrown. */
/**
 * What the composer holds once a send finishes: nothing when it still holds exactly what was sent; otherwise what the
 * member typed meanwhile, or the text that did not go.
 */
export function draftAfterSend(sent: string, now: string, delivered: boolean): string {
  return delivered && now === sent ? "" : now;
}

/** The messages selection mode gives a checkbox: those Delete is offered on (actionsOf). */
export function selectable(messages: readonly Message[], composer: Composer): string[] {
  return messages.filter((m) => actionsOf(m, composer).includes("delete")).map((m) => m.id);
}

export type Conversations = {
  /** Calls `onList` now and on every change, until the returned stop is called. */
  readonly watchList: (onList: (list: readonly Conversation[]) => void) => () => void;
  /** Calls `onView` now and on every change of the conversation, marking it read as it is shown. */
  readonly watch: (id: ConversationId, onView: (view: ConversationView | null) => void) => () => void;
  /** The available conversation already had with this person, or null; it makes nothing. */
  readonly find: (with_: ChatId) => ConversationId | null;
  /**
   * Asks this person to talk with a first message: a new encrypted conversation with them invited, then `text` sent in
   * it. Null when no conversation could be made; `sent` false when it was made but the message did not go.
   */
  readonly start: (with_: ChatId, text: string) => Promise<{ id: ConversationId; sent: boolean } | null>;
  readonly accept: (id: ConversationId) => Promise<boolean>;
  readonly older: (id: ConversationId) => Promise<void>;
  /** Sends only while the composer sends, as a reply to the message `replyTo` when given; false when not sent. */
  readonly send: (id: ConversationId, text: string, replyTo?: string) => Promise<boolean>;
  /**
   * Deletes each of this member's own messages for both people, one after another, and gives back the ids of those
   * not deleted; one that fails does not stop the rest.
   */
  readonly remove: (id: ConversationId, messageIds: readonly string[]) => Promise<readonly string[]>;
  /** Whether Delete asks to confirm first; false once this member chose "Don't ask me again" in this browser. */
  readonly confirmsDelete: () => boolean;
  /** Remembers "Don't ask me again" in this browser only. */
  readonly stopConfirmingDelete: () => void;
  /** Puts `key` on the message, or takes this member's own `key` back off it; false when nothing changed. */
  readonly react: (id: ConversationId, messageId: string, key: QuickReaction) => Promise<boolean>;
};

/** Who a person is shown as when they have no name of their own: erased, or never named. */
const FORMER_MEMBER = "Former member";

/**
 * The name `chatId` is shown by: their display name, or Former member, never the chat ID itself (ADR 0010: opaque).
 * No name is what an erased member leaves (Synapse 1.165.0 handlers/deactivate_account.py:180-195 deletes the profile
 * and :316-326 expires their membership events before the leave), which matrix-js-sdk 43.0.0 reports as the user ID
 * (src/models/room-member.ts:152-153, 215-217); a homeserver's default name is the local part (handlers/register.py:
 * 320-321).
 */
export function nameOf(displayName: string | undefined, chatId: string): string {
  const name = displayName?.trim() ?? "";
  const localPart = chatId.slice(1, chatId.indexOf(":"));
  return name === "" || name === chatId || name === localPart ? FORMER_MEMBER : name;
}

const LOCAL_PART = /^@u[a-z2-7]{20}$/;

/** `raw` as a chat ID on the same server as `me`, never `me` itself; null for anything else. */
export function parseChatId(raw: string, me: string): ChatId | null {
  const colon = raw.indexOf(":");
  if (colon < 0 || !LOCAL_PART.test(raw.slice(0, colon))) return null;
  const server = me.slice(me.indexOf(":") + 1);
  if (raw.slice(colon + 1) !== server || raw === me) return null;
  return raw as ChatId;
}

/** The start route: `/?with=<chat ID>`, given once (the Message button on unset.sh, build step 10, links here). */
export function startTarget(search: string, me: string): ChatId | null {
  const values = new URLSearchParams(search).getAll("with");
  return values.length === 1 && values[0] !== undefined ? parseChatId(values[0], me) : null;
}
