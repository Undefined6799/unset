// The conversations the screens use (core/conversations.ts Conversations), run on matrix-js-sdk 43.0.0 as it ships.
// What each call does, and where Element v1.12.35 does the same:
// - find: an existing conversation (findDirect), making nothing; the start route opens it, or a composer for a new one.
// - start: only on the first Send of that composer, as Element starts a DM on its first message (startDmOnFirstMessage
//   and createRoomFromLocalRoom, apps/web/src/utils/direct-messages.ts:24-91). createRoom({ preset:
//   trusted_private_chat, is_direct, invite: [them] }), the options Element's createRoom picks for a DM
//   (apps/web/src/createRoom.ts:141-172), then the room is recorded in m.direct (Rooms.ts:52-73, called at
//   createRoom.ts:371) and awaited from sync (createRoom.ts:353-369). Element also sends initial_state; ours sends
//   none, since the server's RoomPolicy takes exactly {preset, is_direct, invite} and adds Megolm itself (ADR 0085
//   decision 1). The first message waits until the room is ready to send in, polled as Element's isRoomReady is
//   (utils/local-room.ts:76-113, utils/localRoom/isRoomReady.ts:16-38): here, until the composer sends.
// - Sending while the other person is only invited: the preset's history_visibility is `shared` (Synapse 1.165.0
//   handlers/room.py:157-163), and matrix-js-sdk 43.0.0 then shares the Megolm key with invited members' devices too
//   (Room.shouldEncryptForInvitedMembers, src/models/room.ts:1963-1979; rust-crypto/RoomEncryptor.ts:105, 204), so
//   they read it once they accept. One with no device yet gets no key and sees the message as unreadable.
// - accept: joinRoom, then m.direct records the inviter, as RoomView.updateDMState does after a join
//   (apps/web/src/components/structures/RoomView.tsx:1707-1716).
// - watch: re-read on the client's re-emitted room and event changes, as TimelinePanel listens on the client
//   (TimelinePanel.tsx:299-314), and mark the newest message from the other person read with sendReadReceipt,
//   allowing a retry after a failure (TimelinePanel.tsx:1060-1140). The receipt is sendReadReceipt's default, the
//   public m.read (src/client.ts:3911-3924), as Element sends with its "send read receipts" setting on, its default
//   (TimelinePanel.tsx:963-983): the other person sees "Seen" (ADR 0092 decision 4; spec v1.18 #receipts). The view's
//   seen is the other person's own m.read (Room.getEventReadUpTo, getReadReceiptForUserId, read-receipt.ts:91-127).
// - react: Element's ReactionPicker.onChoose (element-web v1.12.35 apps/web/src/components/views/emojipicker/
//   ReactionPicker.tsx:86-115): this member's own annotation with that key is taken back with redactEvent, otherwise
//   sendEvent sends an m.reaction annotation, which matrix-js-sdk 43.0.0 never encrypts (src/client.ts:3056). A
//   message's reactions are the timeline set's relations, as Element reads them (TimelinePanel.tsx:1810-1815).
// - remove: redactEvent with no reason, as Element's Remove does after its confirm when no reason is typed
//   (apps/web/src/components/views/dialogs/ConfirmRedactDialog.tsx:63-72), only of this member's own message while
//   they are still in an encrypted conversation (core/conversations.ts actionsOf; ADR 0092 decision 2). Several go
//   one redactEvent each, as Element's bulk redact sends them (BulkRedactDialog.tsx:87-96). Element sends them all at
//   once and only logs a failure; here they go one after another, so the message rate limit Synapse 1.165.0 applies
//   to a redaction too (synapse/handlers/message.py:1078-1084) does not refuse the tail of a long selection, and the
//   ones refused come back so the page can say so. The SDK applies a redaction
//   only once the server has it (chronological ordering; src/models/room.ts:2828-2843), so a refused one stays shown.
// - confirmsDelete, stopConfirmingDelete: "Don't ask me again" lives in this browser's localStorage on the chat
//   origin, under the account's own `unset-chat:` key, never on the server; Log out removes it (forgetLocalChoices,
//   matrix/client.ts), as Element's clearStorage clears localStorage at log out (Lifecycle.ts:1208-1222).
// - older: client.scrollback (src/client.ts:4574-4650); no older messages once oldState.paginationToken is null.
// - send: sendTextMessage (client.ts:3272-3294), or for a reply sendMessage with replyContent (matrix/conversations.ts;
//   Element's makeReplyMixIn), only while the composer sends, checked again just before sending:
//   the SDK encrypts only where its crypto has the room's encryption (client.ts:3022-3060).
// A conversation that is not available (core/conversations.ts availableOf) has no view, cannot be accepted and is never
// sent in, so the page never joins or encrypts to a room with a third person or one anyone may join.
// Spec v1.18: https://spec.matrix.org/v1.18/client-server-api/#client-behaviour-21 (direct messages),
// #receiving-notifications, #receipts, #get_matrixclientv3roomsroomidmessages.
import { type CryptoApi, CryptoEvent } from "matrix-js-sdk/lib/crypto-api/index.js";
import {
  ClientEvent,
  EventType,
  type MatrixClient,
  type MatrixEvent,
  MatrixEventEvent,
  Preset,
  RelationType,
  type Room,
  RoomEvent,
  RoomMemberEvent,
  RoomStateEvent,
} from "matrix-js-sdk/lib/matrix.js";
import {
  actionsOf,
  type Composer,
  type Conversation,
  type ConversationId,
  type Conversations,
  type ConversationView,
  canSend,
  composerOf,
  type QuickReaction,
} from "../core/conversations.ts";
import {
  directRooms,
  findDirect,
  isAvailable,
  kindOf,
  otherMembership,
  otherPerson,
  replyContent,
  seenOf,
  toConversation,
  toMessages,
  unconfirmedDevice,
  withDirect,
} from "./conversations.ts";

/** How long a new conversation may take to arrive from sync, and then to be ready to send in, before start gives up. */
const ARRIVAL_MS = 30_000;
/** How often start looks again whether a new conversation is ready (Element's isRoomReady interval). */
const READY_POLL_MS = 500;
const OLDER_PAGE = 30;

/** Client events after which a list or a view is read again (each client re-emits it, src/sync.ts:1964-1983). */
const CHANGES = [
  ClientEvent.Room,
  ClientEvent.DeleteRoom,
  ClientEvent.AccountData,
  ClientEvent.Sync,
  RoomEvent.Timeline,
  RoomEvent.MyMembership,
  RoomEvent.LocalEchoUpdated,
  RoomEvent.Receipt,
  RoomEvent.Redaction,
  RoomStateEvent.Events,
  RoomStateEvent.Members,
  RoomMemberEvent.Membership,
  RoomMemberEvent.Name,
  MatrixEventEvent.Decrypted,
  // A device list or a person's trust changed: a message's shield may have too. Element re-checks on the trust change
  // (EventTileE2eViewModel.ts:131-134); the Rust crypto says to look again when the sender's devices change
  // (matrix-sdk-common 0.19.0 deserialized_responses.rs:165-167), as a new browser may get the message first.
  CryptoEvent.DevicesUpdated,
  CryptoEvent.UserTrustStatusChanged,
] as const;

/** The Storage calls the service makes; the page passes window.localStorage. */
export type LocalChoices = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** This account's "Don't ask me again" for Delete, in this browser only. */
const skipDeleteConfirmKey = (me: string) => `unset-chat:${me}:skip-delete-confirm`;

/** Log out's part for this browser's own choices: every one this account made here goes. */
export function forgetLocalChoices(storage: LocalChoices, me: string): void {
  storage.removeItem(skipDeleteConfirmKey(me));
}

export function createConversations(
  client: MatrixClient,
  crypto: CryptoApi,
  me: string,
  storage: LocalChoices = globalThis.localStorage,
): Conversations {
  const direct = () => directRooms(client.getAccountData(EventType.Direct)?.getContent());
  const changes = changeFeed(client);
  const readSent = new Map<string, string>();

  const list = (): Conversation[] =>
    client
      .getVisibleRooms()
      .map((room) => toConversation(room, direct()))
      .filter((c): c is Conversation => c !== null)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);

  const composerFor = async (room: Room, other: string): Promise<Composer> => {
    const membership = room.getMyMembership();
    return composerOf({
      mine: membership === "join" || membership === "invite" ? membership : "leave",
      other: otherMembership(room, other),
      kind: kindOf(room),
      encryptionOn: await crypto.isEncryptionEnabledInRoom(room.roomId),
    });
  };

  /**
   * The ids of decrypted events whose shield is Element's warning (Element asks per event, EventTileE2eViewModel.ts
   * doVerifyEvent). One whose shield cannot be read is marked too: what cannot be checked is not shown as confirmed.
   */
  const unconfirmedOf = async (events: readonly MatrixEvent[]): Promise<Set<string>> => {
    const decrypted = events.filter((e) => e.isEncrypted() && !e.isDecryptionFailure() && e.getId() !== undefined);
    const marked = await Promise.all(
      decrypted.map((e) => crypto.getEncryptionInfoForEvent(e).then(unconfirmedDevice, () => true)),
    );
    return new Set(decrypted.filter((_, i) => marked[i]).map((e) => e.getId() as string));
  };

  const annotationsOf = (room: Room, eventId: string) =>
    room
      .getUnfilteredTimelineSet()
      .relations.getChildEventsForEvent(eventId, RelationType.Annotation, EventType.Reaction);

  const viewOf = async (id: ConversationId): Promise<ConversationView | null> => {
    const room = client.getRoom(id);
    const conversation = room === null ? null : toConversation(room, direct());
    if (room === null || conversation === null || !conversation.available) return null;
    const events = room.getLiveTimeline().getEvents();
    const messages = toMessages(events, me, {
      unconfirmed: await unconfirmedOf(events),
      annotations: (eventId) => annotationsOf(room, eventId)?.getSortedAnnotationsByKey() ?? null,
      find: (eventId) => room.findEventById(eventId),
    });
    const other = conversation.with.id;
    const receipt = room.getReadReceiptForUserId(other);
    return {
      conversation,
      messages,
      composer: await composerFor(room, other),
      hasOlder: room.oldState.paginationToken !== null,
      seen: seenOf(events, messages, room.getEventReadUpTo(other), receipt?.data.ts),
    };
  };

  /** The newest event from the other person, once, unless already read (Element ignores our own, ignoreOwn). */
  const markRead = (room: Room) => {
    if (room.getMyMembership() !== "join") return;
    const last = room
      .getLiveTimeline()
      .getEvents()
      .findLast((e) => e.getSender() !== me && e.getId()?.startsWith("$"));
    const id = last?.getId();
    if (last === undefined || id === undefined || readSent.get(room.roomId) === id) return;
    if (room.hasUserReadEvent(me, id)) return;
    readSent.set(room.roomId, id);
    client.sendReadReceipt(last).catch(() => readSent.delete(room.roomId));
  };

  /** Whether the composer sends in `roomId` now, looking again until `deadline` (Element's isRoomReady polling). */
  const whenSendable = async (roomId: string, other: string, deadline: number): Promise<boolean> => {
    for (;;) {
      const room = client.getRoom(roomId);
      if (room !== null && canSend(await composerFor(room, other))) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    }
  };

  const sendIn = async (room: Room, other: string, text: string, replyTo?: string): Promise<boolean> => {
    if (text.trim() === "" || !isAvailable(room) || !canSend(await composerFor(room, other))) return false;
    try {
      if (replyTo === undefined) await client.sendTextMessage(room.roomId, text);
      else await client.sendMessage(room.roomId, replyContent(text, replyTo));
      return true;
    } catch {
      return false;
    }
  };

  /** Toggles this member's `key` on the message, as Element's ReactionPicker does; only while the composer sends. */
  const toggleReaction = async (room: Room, other: string, messageId: string, key: QuickReaction) => {
    if (!isAvailable(room) || !canSend(await composerFor(room, other))) return false;
    const mine = annotationsOf(room, messageId)?.getAnnotationsBySender()?.[me] ?? new Set();
    const own = [...mine].find((e) => !e.isRedacted() && e.getRelation()?.key === key)?.getId();
    try {
      if (own !== undefined) await client.redactEvent(room.roomId, own);
      else {
        const relation = { rel_type: RelationType.Annotation as const, event_id: messageId, key };
        await client.sendEvent(room.roomId, EventType.Reaction, { "m.relates_to": relation });
      }
      return true;
    } catch {
      return false;
    }
  };

  /** Deletes this member's own message, only where actionsOf offers it. */
  const deleteOwn = async (room: Room, other: string, messageId: string) => {
    const target = room.findEventById(messageId);
    if (!isAvailable(room) || target === undefined) return false;
    const [shown] = toMessages([target], me);
    if (shown === undefined || !actionsOf(shown, await composerFor(room, other)).includes("delete")) return false;
    try {
      await client.redactEvent(room.roomId, messageId);
      return true;
    } catch {
      return false;
    }
  };

  const recordDirect = (roomId: string, other: string) =>
    client.setAccountData(
      EventType.Direct,
      withDirect(client.getAccountData(EventType.Direct)?.getContent(), roomId, other),
    );

  return {
    watchList(onList) {
      return changes.watch(() => onList(list()));
    },
    watch(id, onView) {
      let latest = 0;
      return changes.watch(async () => {
        const mine = ++latest;
        const view = await viewOf(id);
        if (mine !== latest) return; // a later read is under way; it paints instead
        onView(view);
        const room = client.getRoom(id);
        if (view !== null && room !== null) markRead(room);
      });
    },
    find(other) {
      const found = findDirect((roomId) => client.getRoom(roomId), direct(), other);
      return found === undefined ? null : (found.roomId as ConversationId);
    },
    async start(other, text) {
      if (text.trim() === "") return null;
      const deadline = Date.now() + ARRIVAL_MS;
      let roomId: string;
      try {
        ({ room_id: roomId } = await client.createRoom({
          preset: Preset.TrustedPrivateChat,
          is_direct: true,
          invite: [other],
        }));
        await recordDirect(roomId, other);
      } catch {
        return null;
      }
      if (!(await arrived(client, roomId, ARRIVAL_MS))) return null;
      const id = roomId as ConversationId;
      const ready = await whenSendable(roomId, other, deadline);
      const room = client.getRoom(roomId);
      return { id, sent: ready && room !== null && (await sendIn(room, other, text)) };
    },
    async accept(id) {
      const room = client.getRoom(id);
      const inviter = room?.getDMInviter();
      if (room === null || inviter === undefined || !isAvailable(room)) return false;
      try {
        await client.joinRoom(id);
        await recordDirect(id, inviter);
        return true;
      } catch {
        return false;
      }
    },
    async older(id) {
      const room = client.getRoom(id);
      if (room !== null) await client.scrollback(room, OLDER_PAGE).catch(() => undefined);
    },
    async send(id, text, replyTo) {
      const room = client.getRoom(id);
      const other = room === null ? undefined : otherPerson(room, direct());
      return room !== null && other !== undefined && (await sendIn(room, other, text, replyTo));
    },
    async remove(id, messageIds) {
      const room = client.getRoom(id);
      const other = room === null ? undefined : otherPerson(room, direct());
      const failed: string[] = [];
      for (const messageId of messageIds)
        if (room === null || other === undefined || !(await deleteOwn(room, other, messageId))) failed.push(messageId);
      return failed;
    },
    confirmsDelete: () => storage.getItem(skipDeleteConfirmKey(me)) !== "true",
    stopConfirmingDelete: () => storage.setItem(skipDeleteConfirmKey(me), "true"),
    async react(id, messageId, key) {
      const room = client.getRoom(id);
      const other = room === null ? undefined : otherPerson(room, direct());
      return room !== null && other !== undefined && (await toggleReaction(room, other, messageId, key));
    },
  };
}

/** One set of client listeners for every watcher, attached while any watches; a burst of changes is read once. */
function changeFeed(client: MatrixClient) {
  // Every name in CHANGES is one of the client's own events; the SDK types each listener by its name.
  const emitter = client as unknown as {
    on(name: string, f: () => void): void;
    off(name: string, f: () => void): void;
  };
  const watchers = new Set<() => void>();
  let queued = false;
  const changed = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const watcher of watchers) watcher();
    });
  };
  return {
    watch(watcher: () => void): () => void {
      if (watchers.size === 0) for (const name of CHANGES) emitter.on(name, changed);
      watchers.add(watcher);
      watcher();
      return () => {
        watchers.delete(watcher);
        if (watchers.size === 0) for (const name of CHANGES) emitter.off(name, changed);
      };
    },
  };
}

/** Resolves true once sync has brought the room (Element's createRoom.ts:353-369), false at the deadline. */
function arrived(client: MatrixClient, roomId: string, deadlineMs: number): Promise<boolean> {
  if (client.getRoom(roomId) !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onRoom = (room: Room) => room.roomId === roomId && done(true);
    const timer = setTimeout(() => done(false), deadlineMs);
    const done = (ok: boolean) => {
      clearTimeout(timer);
      client.off(ClientEvent.Room, onRoom);
      resolve(ok);
    };
    client.on(ClientEvent.Room, onRoom);
  });
}
