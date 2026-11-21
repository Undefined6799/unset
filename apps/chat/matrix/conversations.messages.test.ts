// The adapter's mapping of timeline events to messages: text, unreadable and deleted messages, the unconfirmed-device
// mark, reactions, replies and "Seen", on the SDK's own MatrixEvent and Room objects as matrix-js-sdk 43.0.0 builds them
// (no double: the SDK is in-process; only the homeserver is unmanaged, TE-1, and none is reached here). The rooms side
// of the same adapter is in conversations.test.ts.
import { KnownMembership } from "matrix-js-sdk/lib/@types/membership.js";
import { EventShieldColour, EventShieldReason } from "matrix-js-sdk/lib/crypto-api/index.js";
import { createClient, MatrixEvent, Room } from "matrix-js-sdk/lib/matrix.js";
import { describe, expect, test } from "vitest";
import { reactionsOf, replyContent, seenOf, toMessages, unconfirmedDevice } from "./conversations.ts";

const ME = "@uaaaaaaaaaaaaaaaaaaaa:unset.cc";
const THEM = "@ubbbbbbbbbbbbbbbbbbbb:unset.cc";

// No request is made: the client is never started, and the address is a closed loopback port.
const client = createClient({ baseUrl: "http://127.0.0.1:9", userId: ME, deviceId: "DEVICEAAAA", accessToken: "t" });
let n = 0;
const event = (fields: Record<string, unknown>) =>
  new MatrixEvent({ event_id: `$e${++n}`, origin_server_ts: n, sender: ME, ...fields });
const member = (userId: string, membership: string, extra: Record<string, unknown> = {}) =>
  event({ type: "m.room.member", state_key: userId, sender: userId, content: { membership, ...extra } });

function room(id: string, state: MatrixEvent[], mine: string = KnownMembership.Join): Room {
  const r = new Room(id, client, ME);
  for (const e of state) e.event.room_id = id;
  r.currentState.setStateEvents(state);
  r.updateMyMembership(mine);
  return r;
}

describe("toMessages", () => {
  test("chat.messages_text_only: text messages in order, mine marked; state, other kinds and empty bodies left out", () => {
    const events = [
      member(THEM, "join"),
      event({ type: "m.room.message", sender: THEM, content: { msgtype: "m.text", body: "<b>hi</b>" } }),
      event({ type: "m.room.message", content: { msgtype: "m.image", body: "x.png", url: "mxc://x/y" } }),
      event({ type: "m.room.message", content: { msgtype: "m.text", body: 5 } }),
      event({ type: "m.reaction", content: {} }),
      event({ type: "m.room.message", content: { msgtype: "m.text", body: "hello" } }),
    ];
    expect(
      toMessages(events, ME).map((m) => ({ mine: m.mine, kind: m.kind, text: "text" in m ? m.text : null })),
    ).toEqual([
      { mine: false, kind: "text", text: "<b>hi</b>" },
      { mine: true, kind: "text", text: "hello" },
    ]);
  });

  test("chat.messages_unreadable: a message the SDK's own crypto could not decrypt is shown as unreadable", async () => {
    const reader = createClient({
      baseUrl: "http://127.0.0.1:9",
      userId: ME,
      deviceId: "DEVICEBBBB",
      accessToken: "t",
    });
    await reader.initRustCrypto({ useIndexedDB: false });
    const sealed = event({
      type: "m.room.encrypted",
      room_id: "!a:unset.cc",
      sender: THEM,
      content: {
        algorithm: "m.megolm.v1.aes-sha2",
        ciphertext: "AwgA",
        session_id: "s",
        sender_key: "k",
        device_id: "D",
      },
    });
    await reader.decryptEventIfNeeded(sealed);
    expect(sealed.isDecryptionFailure()).toBe(true);
    const pending = event({ type: "m.room.encrypted", sender: THEM, content: { algorithm: "m.megolm.v1.aes-sha2" } });
    expect(toMessages([sealed, pending], ME).map((m) => [m.mine, m.kind])).toEqual([[false, "unreadable"]]);
    reader.stopClient();
  }, 20_000);

  test("chat.unconfirmed_device_marked: a message from a device its owner has not confirmed carries the mark", () => {
    const from = (body: string) =>
      event({ type: "m.room.message", sender: THEM, content: { msgtype: "m.text", body } });
    const [confirmed, unconfirmed] = [from("a"), from("b")];
    const marks = toMessages([confirmed, unconfirmed], ME, {
      unconfirmed: new Set([unconfirmed.getId() as string]),
    }).map((m) => [m.kind, m.unconfirmed]);
    expect(marks).toEqual([
      ["text", false],
      ["text", true],
    ]);
  });
});

// matrix-js-sdk 43.0.0 maps the Rust crypto's lax shield (matrix-sdk-common 0.19.0 deserialized_responses.rs:139-184)
// to a colour (src/rust-crypto/rust-crypto.ts:2521-2575); Element shows its warning for red, a plain padlock for grey
// (element-web v1.12.35 apps/web/src/viewmodels/room/timeline/event-tile/EventTileE2eState.ts:204-209).

describe("unconfirmedDevice", () => {
  test.each([
    [{ shieldColour: EventShieldColour.RED, shieldReason: EventShieldReason.UNSIGNED_DEVICE }, true],
    [{ shieldColour: EventShieldColour.RED, shieldReason: EventShieldReason.UNKNOWN_DEVICE }, true],
    [{ shieldColour: EventShieldColour.RED, shieldReason: EventShieldReason.MISMATCHED_SENDER }, true],
    [{ shieldColour: EventShieldColour.GREY, shieldReason: EventShieldReason.AUTHENTICITY_NOT_GUARANTEED }, false],
    [{ shieldColour: EventShieldColour.NONE, shieldReason: null }, false],
    [null, false],
  ])("chat.unconfirmed_is_red_shield: %o gives %s", (info, marked) => {
    expect(unconfirmedDevice(info)).toBe(marked);
  });
});

// Element shows each person's receipt under the last event they have read (element-web v1.12.35
// apps/web/src/components/views/rooms/ReadReceiptGroup.tsx); here it is "Seen" under this member's last message there.
describe("seenOf", () => {
  const mine = (body: string) => event({ type: "m.room.message", content: { msgtype: "m.text", body } });
  const theirs = event({ type: "m.room.message", sender: THEM, content: { msgtype: "m.text", body: "x" } });
  const [first, second, third] = [mine("1"), mine("2"), mine("3")];
  const reaction = event({ type: "m.reaction", sender: THEM, content: {} });
  const events = [first, theirs, second, reaction, third];
  const messages = toMessages(events, ME);
  const id = (e: MatrixEvent) => e.getId() as string;

  test("chat.seen_under_last_read: Seen goes under this member's last message at or before their receipt", () => {
    expect(seenOf(events, messages, id(second), 7)).toEqual({ id: id(second), at: 7 });
    expect(seenOf(events, messages, id(reaction), 7)).toEqual({ id: id(second), at: 7 });
    expect(seenOf(events, messages, id(theirs), 7)).toEqual({ id: id(first), at: 7 });
    expect(seenOf(events, messages, id(third), 9)).toEqual({ id: id(third), at: 9 });
  });

  test("chat.seen_none: no receipt, one outside the shown timeline, or none past a message of this member's", () => {
    expect(seenOf(events, messages, null, 7)).toBeNull();
    expect(seenOf(events, messages, id(second), undefined)).toBeNull();
    expect(seenOf(events, messages, "$elsewhere", 7)).toBeNull();
    expect(seenOf([theirs, first], toMessages([theirs, first], ME), id(theirs), 7)).toBeNull();
  });
});

// Element reads a message's reactions from the timeline set's relations (element-web v1.12.35 TimelinePanel.tsx:
// 1810-1815) and counts each key's annotations (ReactionsRow.tsx); the SDK aggregates them as events arrive
// (src/models/event-timeline-set.ts:667-668) and drops a redacted one (src/models/relations.ts:235-251).

describe("reactionsOf", () => {
  const annotate = (target: MatrixEvent, key: string, sender: string) =>
    event({
      type: "m.reaction",
      sender,
      room_id: "!r:unset.cc",
      content: { "m.relates_to": { rel_type: "m.annotation", event_id: target.getId(), key } },
    });

  test("chat.reactions_counted: each quick key once with its count, this member's marked, others left out", () => {
    const r = room("!r:unset.cc", [member(ME, "join"), member(THEM, "join")]);
    const target = event({ type: "m.room.message", room_id: "!r:unset.cc", content: { msgtype: "m.text", body: "x" } });
    const reactions = [annotate(target, "👍", THEM), annotate(target, "👍", ME), annotate(target, "🎉", THEM)];
    r.addLiveEvents([target, ...reactions, annotate(target, "not quick", THEM)], { addToState: false });
    const relations = r
      .getUnfilteredTimelineSet()
      .relations.getChildEventsForEvent(target.getId() as string, "m.annotation", "m.reaction");
    expect(reactionsOf(relations?.getSortedAnnotationsByKey() ?? null, ME)).toEqual([
      { key: "👍", count: 2, mine: true },
      { key: "🎉", count: 1, mine: false },
    ]);
    expect(reactionsOf(null, ME)).toEqual([]);
  });
});

// A reply is m.relates_to.m.in_reply_to beside the message, with no fallback body, as Element's makeReplyMixIn writes
// it (element-web v1.12.35 apps/web/src/utils/Reply.ts:52-66; spec v1.18 #rich-replies); the Rust crypto copies
// m.relates_to into the encrypted event's clear part (matrix-sdk-crypto 0.19.0 olm/group_sessions/outbound.rs:594-598).

describe("replies", () => {
  test("chat.reply_content: the text and exactly the reply pointer the server takes", () => {
    expect(replyContent("sure", "$q")).toEqual({
      msgtype: "m.text",
      body: "sure",
      "m.relates_to": { "m.in_reply_to": { event_id: "$q" } },
    });
  });

  test("chat.reply_quoted: a reply carries the message it answers, its text, or why there is none", () => {
    const asked = event({ type: "m.room.message", sender: THEM, content: { msgtype: "m.text", body: "lunch?" } });
    const reply = (to: string) => event({ type: "m.room.message", content: { ...replyContent("yes", to) } });
    const known = new Map([[asked.getId() as string, asked]]);
    const find = (eventId: string) => known.get(eventId);
    const [answer, lost] = [reply(asked.getId() as string), reply("$gone")];
    const shown = toMessages([asked, answer, lost], ME, { find });
    expect(shown.map((m) => m.replyTo)).toEqual([
      null,
      { id: asked.getId(), mine: false, kind: "text", text: "lunch?" },
      { id: "$gone", mine: false, kind: "unavailable" },
    ]);
  });
});

// Element shows a redacted message as "Message deleted" (element-web v1.12.35 apps/web/src/i18n/strings/en_EN.json,
// timeline.self_redaction); the SDK strips a redacted event's content in place (src/models/event.ts:1309).
