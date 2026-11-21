// The chat page's own words for conversations (build step 9). Screens see only these; matrix/conversations.ts turns the
// SDK's rooms and events into them (architecture instructions §4-5), so no SDK type reaches a screen.
// Room kinds (ADR 0085): a room is encrypted or plain, fixed when it is made; this page makes encrypted ones only and
// sends only in them, and marks any other room "not encrypted" so the screens are ready when plain chats are offered.

/** A member's chat ID, `@u<20 base32 letters>:<our server>` (ADR 0010: opaque), checked by parseChatId. */
export type ChatId = string & { readonly __brand: "ChatId" };
/** One conversation, by the id the adapter gave it. */
export type ConversationId = string & { readonly __brand: "ConversationId" };

export type ConversationKind = "encrypted" | "not_encrypted";

export type Conversation = {
  readonly id: ConversationId;
  /** The other person: their chat ID and the name they show. */
  readonly with: { readonly id: string; readonly name: string };
  readonly kind: ConversationKind;
  /** Someone asked to talk and this member has not accepted yet (the invite is the request). */
  readonly request: boolean;
  readonly unread: number;
  readonly lastActiveAt: number;
};

/** A line of the conversation: text, or a message this browser cannot read. User text is never markup. */
export type Message = {
  readonly id: string;
  readonly mine: boolean;
  readonly at: number;
} & ({ readonly kind: "text"; readonly text: string } | { readonly kind: "unreadable" });

/**
 * - on: the composer may send;
 * - request: accept the request first;
 * - gone: this member has left;
 * - not_encrypted: the room is not encrypted, and this page never sends in one;
 * - waiting_for_them: the other person has not joined yet;
 * - waiting_for_encryption: joined, but this browser's encryption has not switched on for the room yet.
 */
export type Composer = "on" | "request" | "gone" | "not_encrypted" | "waiting_for_them" | "waiting_for_encryption";

export type ComposerFacts = {
  readonly mine: "join" | "invite" | "leave";
  readonly otherJoined: boolean;
  readonly kind: ConversationKind;
  /** The SDK's crypto has encryption on for the room (CryptoApi.isEncryptionEnabledInRoom). */
  readonly encryptionOn: boolean;
};

/** Off until this member and the other person have joined an encrypted room whose encryption is on here. */
export function composerOf(facts: ComposerFacts): Composer {
  if (facts.mine === "invite") return "request";
  if (facts.mine === "leave") return "gone";
  if (facts.kind !== "encrypted") return "not_encrypted";
  if (!facts.otherJoined) return "waiting_for_them";
  return facts.encryptionOn ? "on" : "waiting_for_encryption";
}

export type ConversationView = {
  readonly conversation: Conversation;
  readonly messages: readonly Message[];
  readonly composer: Composer;
  /** Older messages may still be loaded. */
  readonly hasOlder: boolean;
};

/** What the screens can do with conversations; every call reports its outcome, nothing is thrown. */
export type Conversations = {
  /** Calls `onList` now and on every change, until the returned stop is called. */
  readonly watchList: (onList: (list: readonly Conversation[]) => void) => () => void;
  /** Calls `onView` now and on every change of the conversation, marking it read as it is shown. */
  readonly watch: (id: ConversationId, onView: (view: ConversationView | null) => void) => () => void;
  /** The existing conversation with this person, or a new encrypted one with them asked to join. */
  readonly start: (with_: ChatId) => Promise<ConversationId | null>;
  readonly accept: (id: ConversationId) => Promise<boolean>;
  readonly older: (id: ConversationId) => Promise<void>;
  /** Sends only while the composer is on; false when it was not sent. */
  readonly send: (id: ConversationId, text: string) => Promise<boolean>;
};

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
