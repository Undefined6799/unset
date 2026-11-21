// Conversations through matrix-js-sdk 43.0.0 as it ships (build step 9): this file turns the SDK's rooms and events into
// our Conversation and Message (core/conversations.ts), and nothing SDK-shaped leaves it.
// - Which rooms are direct: the account's m.direct map (https://spec.matrix.org/v1.18/client-server-api/#mdirect), read
//   as Element filters it (element-web v1.12.35 apps/web/src/utils/dm/filterValidMDirect.ts:23-60), and for a room not
//   in it the `is_direct` flag on this member's invite (src/models/room-member.ts:342-366; Element's
//   DMRoomMap.getUserIdForRoomId, apps/web/src/utils/DMRoomMap.ts:172-192).
// - An existing conversation with someone: as Element's findDMForUser (apps/web/src/utils/dm/findDMForUser.ts:30-95),
//   a room from m.direct where this member has joined and exactly two people are joined or invited, one of them the
//   other person, and that is available (below); the most recently active wins.
// - One-to-one and private (core/conversations.ts availableOf): the m.room.join_rules event itself, not
//   Room.getJoinRule, which assumes `invite` when the event is missing (src/models/room-state.ts:1045-1049); and
//   getInvitedAndJoinedMemberCount, which takes sync's room summary when there is one, so members lazy loading has
//   not sent still count (room-state.ts:243-268; spec v1.18 #_matrixclientv3sync `summary`).
// - Room kind (ADR 0085): encrypted when the room's m.room.encryption names Megolm (src/models/room.ts:4022-4026 reads
//   the event; the algorithm check is ours, as src/rust-crypto/rust-crypto.ts:1811-1817 ignores any other).
// - Messages: decrypted in place by the SDK, so an m.room.encrypted event either becomes its clear m.room.message or
//   fails (MatrixEvent.isDecryptionFailure, src/models/event.ts:855); one still decrypting is left out until
//   MatrixEventEvent.Decrypted, as Element's TimelinePanel waits for it (apps/web/src/components/structures/
//   TimelinePanel.tsx:312, 891-905). Text only (spec #mtext).
// - Unconfirmed device (ADR 0093): the SDK's red shield for an event (CryptoApi.getEncryptionInfoForEvent; the Rust
//   crypto's lax shield, matrix-sdk-common 0.19.0 deserialized_responses.rs:139-184: a device its owner never signed,
//   one not known, or a sender that is not the device's owner), where Element shows its warning padlock (element-web
//   v1.12.35 apps/web/src/viewmodels/room/timeline/event-tile/EventTileE2eState.ts:204-209). Grey, a key restored
//   from backup, gets Element's plain padlock and no mark here.
import type { RoomMessageEventContent } from "matrix-js-sdk/lib/@types/events.js";
import { KnownMembership } from "matrix-js-sdk/lib/@types/membership.js";
import { type EventEncryptionInfo, EventShieldColour } from "matrix-js-sdk/lib/crypto-api/index.js";
import { EventType, type MatrixEvent, MsgType, NotificationCountType, type Room } from "matrix-js-sdk/lib/matrix.js";
import {
  availableOf,
  type Conversation,
  type ConversationId,
  type ConversationKind,
  isQuickReaction,
  type Message,
  nameOf,
  type Quote,
  type Reaction,
} from "../core/conversations.ts";

const MEGOLM = "m.megolm.v1.aes-sha2";

/** m.direct content as room id to the other person, keeping only well-formed entries (filterValidMDirect). */
export function directRooms(content: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (content === null || typeof content !== "object" || Array.isArray(content)) return map;
  for (const [userId, roomIds] of Object.entries(content)) {
    if (!Array.isArray(roomIds)) continue;
    for (const roomId of roomIds) if (typeof roomId === "string") map.set(roomId, userId);
  }
  return map;
}

/**
 * m.direct with `roomId` recorded for `userId` alone, as Element's setDMRoom writes it (apps/web/src/Rooms.ts:52-73):
 * dropped from every other person's list first, since a room is direct with one person.
 */
export function withDirect(content: unknown, roomId: string, userId: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, other] of directRooms(content)) {
    if (id !== roomId) out[other] = [...(out[other] ?? []), id];
  }
  out[userId] = [...(out[userId] ?? []), roomId];
  return out;
}

/** The other person of a direct room, or undefined when the room is not direct. */
export const otherPerson = (room: Room, direct: ReadonlyMap<string, string>): string | undefined =>
  direct.get(room.roomId) ?? room.getDMInviter();

export function kindOf(room: Room): ConversationKind {
  const encryption = room.currentState.getStateEvents(EventType.RoomEncryption, "");
  return encryption?.getContent().algorithm === MEGOLM ? "encrypted" : "not_encrypted";
}

/** Whether `room` is one-to-one and private, read from its join rule event and its member counts. */
export function isAvailable(room: Room): boolean {
  const joinRule: unknown = room.currentState.getStateEvents(EventType.RoomJoinRules, "")?.getContent().join_rule;
  return availableOf({
    joinRule: typeof joinRule === "string" ? joinRule : undefined,
    people: room.getInvitedAndJoinedMemberCount(),
  });
}

/** A direct room this member is in or invited to, as our Conversation; null for any other room. */
export function toConversation(room: Room, direct: ReadonlyMap<string, string>): Conversation | null {
  const mine = room.getMyMembership();
  if (mine !== KnownMembership.Join && mine !== KnownMembership.Invite) return null;
  const other = otherPerson(room, direct);
  if (other === undefined) return null;
  return {
    id: room.roomId as ConversationId,
    with: { id: other, name: nameOf(room.getMember(other)?.rawDisplayName, other) },
    kind: kindOf(room),
    available: isAvailable(room),
    request: mine === KnownMembership.Invite,
    unread: room.getUnreadNotificationCount(NotificationCountType.Total),
    lastActiveAt: room.getLastActiveTimestamp(),
  };
}

/** Where the other person stands in the room: joined, invited, or out (left, refused, banned, or never there). */
export function otherMembership(room: Room, other: string): "join" | "invite" | "out" {
  const membership = room.getMember(other)?.membership;
  if (membership === KnownMembership.Join) return "join";
  return membership === KnownMembership.Invite ? "invite" : "out";
}

const present = (membership: string | undefined) =>
  membership === KnownMembership.Join || membership === KnownMembership.Invite;

/** The conversation already had with `other`, as Element's findDMForUser finds it; undefined when there is none. */
export function findDirect(
  getRoom: (id: string) => Room | null,
  direct: ReadonlyMap<string, string>,
  other: string,
): Room | undefined {
  const suitable = [...direct]
    .filter(([, userId]) => userId === other)
    .map(([roomId]) => getRoom(roomId))
    .filter((room): room is Room => room !== null && room.getMyMembership() === KnownMembership.Join)
    .filter(isAvailable)
    .filter((room) => {
      const people = room.currentState.getMembers().filter((m) => present(m.membership));
      return people.length === 2 && people.some((m) => m.userId === other);
    });
  return suitable.sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp())[0];
}

/** Whether an event's encryption info is Element's warning: a red shield. None, for an event not decrypted here. */
export function unconfirmedDevice(info: EventEncryptionInfo | null): boolean {
  return info !== null && info.shieldColour === EventShieldColour.RED;
}

/** What toMessages is told about the events beside the events themselves. */
export type About = {
  /** Ids of events sent from a device its owner has not confirmed (unconfirmedDevice). */
  readonly unconfirmed?: ReadonlySet<string>;
  /** An event's annotations by key, as Relations.getSortedAnnotationsByKey gives them (src/models/relations.ts:263). */
  readonly annotations?: (eventId: string) => readonly (readonly [string, ReadonlySet<MatrixEvent>])[] | null;
  /** An event of the room by id, as Room.findEventById finds it, for the message a reply answers. */
  readonly find?: (eventId: string) => MatrixEvent | undefined;
};

/** The timeline's text messages and unreadable ones, in order, with their reactions; anything else is left out. */
export function toMessages(events: readonly MatrixEvent[], me: string, about: About = {}): Message[] {
  const { unconfirmed = new Set(), annotations = () => null, find = () => undefined } = about;
  const messages: Message[] = [];
  for (const event of events) {
    const id = event.getId();
    if (id === undefined || event.isState()) continue;
    const reactions = reactionsOf(annotations(id), me);
    const replyTo = event.replyEventId === undefined ? null : quoteOf(event.replyEventId, find(event.replyEventId), me);
    const mine = event.getSender() === me;
    const base = { id, mine, at: event.getTs(), unconfirmed: unconfirmed.has(id), reactions, replyTo };
    if (event.isDecryptionFailure()) {
      messages.push({ ...base, kind: "unreadable" });
      continue;
    }
    const content = event.getContent();
    if (event.getType() !== EventType.RoomMessage || content.msgtype !== "m.text") continue;
    if (typeof content.body !== "string" || content.body === "") continue;
    messages.push({ ...base, kind: "text", text: content.body });
  }
  return messages;
}

/**
 * What a reply shows of the message `id` it answers (MatrixEvent.replyEventId, src/models/event.ts:697): its text; that
 * it was deleted; or, for one not loaded, unreadable or not a text message, that it cannot be shown, where Element
 * says it cannot load it (element-web v1.12.35 apps/web/src/components/views/elements/ReplyChain.tsx:296).
 */
export function quoteOf(id: string, target: MatrixEvent | undefined, me: string): Quote {
  const base = { id, mine: target?.getSender() === me };
  if (target?.isRedacted()) return { ...base, kind: "deleted" };
  const content = target?.isDecryptionFailure() ? undefined : target?.getContent();
  if (content?.msgtype !== "m.text" || typeof content.body !== "string") return { ...base, kind: "unavailable" };
  return { ...base, kind: "text", text: content.body };
}

/** A reply's content: the text and exactly `m.relates_to.m.in_reply_to`, as Element's makeReplyMixIn writes it. */
export function replyContent(text: string, replyTo: string): RoomMessageEventContent {
  return { msgtype: MsgType.Text, body: text, "m.relates_to": { "m.in_reply_to": { event_id: replyTo } } };
}

/**
 * A message's quick reactions, most first as Relations.getSortedAnnotationsByKey orders them (src/models/
 * relations.ts:263): each key's annotations not redacted, and whether this member is among their senders, as
 * Element's ReactionPicker reads its own (element-web v1.12.35 apps/web/src/components/views/emojipicker/
 * ReactionPicker.tsx:68-79). A key outside the quick set, which the server refuses, is left out.
 */
export function reactionsOf(
  byKey: readonly (readonly [string, ReadonlySet<MatrixEvent>])[] | null,
  me: string,
): Reaction[] {
  const reactions: Reaction[] = [];
  for (const [key, events] of byKey ?? []) {
    const live = [...events].filter((e) => !e.isRedacted());
    if (!isQuickReaction(key) || live.length === 0) continue;
    reactions.push({ key, count: live.length, mine: live.some((e) => e.getSender() === me) });
  }
  return reactions;
}

/**
 * Where "Seen" goes: under this member's last message at or before the other person's read receipt (`readUpTo`, the
 * event Room.getEventReadUpTo gives, src/models/read-receipt.ts:127), with the receipt's time. Null with no receipt,
 * one outside the loaded timeline, or no message of this member's at or before it. Element shows a receipt under the
 * last event its reader has read (element-web v1.12.35 apps/web/src/components/views/rooms/ReadReceiptGroup.tsx).
 */
export function seenOf(
  events: readonly MatrixEvent[],
  messages: readonly Message[],
  readUpTo: string | null,
  at: number | undefined,
): { readonly id: string; readonly at: number } | null {
  if (readUpTo === null || at === undefined) return null;
  const upTo = events.findIndex((e) => e.getId() === readUpTo);
  const mine = new Set(messages.filter((m) => m.mine).map((m) => m.id));
  for (let i = upTo; i >= 0; i--) {
    const id = events[i]?.getId();
    if (id !== undefined && mine.has(id)) return { id, at };
  }
  return null;
}
