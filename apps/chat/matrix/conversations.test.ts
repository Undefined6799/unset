// The adapter's mapping (build step 9), on the SDK's own Room and MatrixEvent objects as matrix-js-sdk 43.0.0 builds
// them from sync (no double: the SDK is in-process; only the homeserver is unmanaged, TE-1, and none is reached here).
// The calls that need a homeserver run in tests/e2e/chat-page.chromium.spec.ts and in the step's live run.
import { KnownMembership } from "matrix-js-sdk/lib/@types/membership.js";
import { EventShieldColour, EventShieldReason } from "matrix-js-sdk/lib/crypto-api/index.js";
import { createClient, MatrixEvent, NotificationCountType, Room } from "matrix-js-sdk/lib/matrix.js";
import { describe, expect, test } from "vitest";
import {
  directRooms,
  findDirect,
  otherMembership,
  toConversation,
  toMessages,
  unconfirmedDevice,
  withDirect,
} from "./conversations.ts";

const ME = "@uaaaaaaaaaaaaaaaaaaaa:unset.cc";
const THEM = "@ubbbbbbbbbbbbbbbbbbbb:unset.cc";
const OTHER = "@ucccccccccccccccccccc:unset.cc";
const MEGOLM = { algorithm: "m.megolm.v1.aes-sha2" };

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
/** m.room.join_rules (spec v1.18 #mroomjoin_rules); both private presets set `invite`. */
const joinRule = (rule: string) => event({ type: "m.room.join_rules", state_key: "", content: { join_rule: rule } });
const dm = (id: string, them: string, theirs = "join") =>
  room(id, [
    event({ type: "m.room.encryption", state_key: "", content: MEGOLM }),
    joinRule("invite"),
    member(ME, "join", { displayname: "Me" }),
    member(them, theirs, { displayname: "Bea" }),
  ]);

describe("directRooms", () => {
  test("chat.direct_map: m.direct read as Element reads it, invalid parts dropped", () => {
    const map = directRooms({ [THEM]: ["!a:unset.cc", 7, "!b:unset.cc"], [OTHER]: "!c:unset.cc", x: null });
    expect([...map]).toEqual([
      ["!a:unset.cc", THEM],
      ["!b:unset.cc", THEM],
    ]);
    expect(directRooms(null).size).toBe(0);
    expect(directRooms([THEM]).size).toBe(0);
  });
});

describe("toConversation", () => {
  test("chat.conversation_encrypted: a direct room with Megolm, named by the other person", () => {
    const r = dm("!a:unset.cc", THEM);
    r.setUnreadNotificationCount(NotificationCountType.Total, 3);
    expect(toConversation(r, directRooms({ [THEM]: ["!a:unset.cc"] }))).toEqual({
      id: "!a:unset.cc",
      with: { id: THEM, name: "Bea" },
      kind: "encrypted",
      available: true,
      request: false,
      unread: 3,
      lastActiveAt: Number.MIN_SAFE_INTEGER,
    });
  });

  test("chat.conversation_request: an invite marked direct is a request from its sender", () => {
    const r = room(
      "!i:unset.cc",
      [
        event({ type: "m.room.encryption", state_key: "", sender: THEM, content: MEGOLM }),
        joinRule("invite"),
        member(THEM, "join", { displayname: "Bea" }),
        event({
          type: "m.room.member",
          state_key: ME,
          sender: THEM,
          content: { membership: "invite", is_direct: true },
        }),
      ],
      KnownMembership.Invite,
    );
    expect(toConversation(r, new Map())).toMatchObject({
      with: { id: THEM, name: "Bea" },
      kind: "encrypted",
      available: true,
      request: true,
    });
  });

  test("chat.conversation_unavailable_crowded: a room with a third person joined or invited is unavailable", () => {
    const direct = directRooms({ [THEM]: ["!c:unset.cc"] });
    for (const theirs of ["join", "invite"]) {
      const crowded = dm("!c:unset.cc", THEM);
      const third = member(OTHER, theirs);
      third.event.room_id = "!c:unset.cc";
      crowded.currentState.setStateEvents([third]);
      expect(toConversation(crowded, direct)).toMatchObject({ with: { id: THEM }, available: false });
    }
    expect(toConversation(dm("!c:unset.cc", THEM), direct)?.available).toBe(true);
    // Sync's room summary counts everyone, even members lazy loading has not sent (spec v1.18 #_matrixclientv3sync).
    const summarised = dm("!c:unset.cc", THEM);
    summarised.setSummary({ "m.heroes": [THEM], "m.joined_member_count": 2, "m.invited_member_count": 1 });
    expect(toConversation(summarised, direct)?.available).toBe(false);
  });

  test("chat.conversation_unavailable_not_private: a room anyone may join, or without its join rule, is unavailable", () => {
    const direct = directRooms({ [THEM]: ["!o:unset.cc"] });
    for (const rule of ["public", "knock", "restricted", "knock_restricted", "private"]) {
      const open = room("!o:unset.cc", [joinRule(rule), member(ME, "join"), member(THEM, "join")]);
      expect(toConversation(open, direct)?.available).toBe(false);
    }
    const unruled = room("!o:unset.cc", [member(ME, "join"), member(THEM, "join")]);
    expect(toConversation(unruled, direct)?.available).toBe(false);
  });

  test("chat.conversation_not_encrypted: no Megolm encryption event is marked not encrypted", () => {
    const plain = room("!p:unset.cc", [member(ME, "join"), member(THEM, "join")]);
    const other = room("!o:unset.cc", [
      event({ type: "m.room.encryption", state_key: "", content: { algorithm: "m.olm.v1.curve25519-aes-sha2" } }),
      member(ME, "join"),
      member(THEM, "join"),
    ]);
    const direct = directRooms({ [THEM]: ["!p:unset.cc", "!o:unset.cc"] });
    expect(toConversation(plain, direct)?.kind).toBe("not_encrypted");
    expect(toConversation(other, direct)?.kind).toBe("not_encrypted");
  });

  test("chat.conversation_name_fallback: without a display name, or once erased, the other person is a Former member", () => {
    const direct = directRooms({ [THEM]: ["!a:unset.cc"] });
    const unnamed = room("!a:unset.cc", [member(ME, "join"), member(THEM, "join")]);
    expect(toConversation(unnamed, direct)?.with).toEqual({ id: THEM, name: "Former member" });
    const erased = room("!a:unset.cc", [member(ME, "join"), member(THEM, "leave", { displayname: "" })]);
    expect(toConversation(erased, direct)?.with).toEqual({ id: THEM, name: "Former member" });
    const noEvent = room("!a:unset.cc", [member(ME, "join")]);
    expect(toConversation(noEvent, direct)?.with).toEqual({ id: THEM, name: "Former member" });
  });

  test("chat.conversation_direct_only: a room that is not direct, or one this member left, is not listed", () => {
    expect(toConversation(dm("!g:unset.cc", THEM), new Map())).toBeNull();
    const left = room("!l:unset.cc", [member(ME, "leave"), member(THEM, "join")], KnownMembership.Leave);
    expect(toConversation(left, directRooms({ [THEM]: ["!l:unset.cc"] }))).toBeNull();
    const undirected = room("!u:unset.cc", [member(THEM, "join"), member(ME, "invite")], KnownMembership.Invite);
    expect(toConversation(undirected, new Map())).toBeNull();
  });
});

describe("otherMembership", () => {
  test("chat.other_membership: the other person joined, invited, or out (left, refused, banned or never there)", () => {
    expect(otherMembership(dm("!a:unset.cc", THEM), THEM)).toBe("join");
    expect(otherMembership(dm("!a:unset.cc", THEM, "invite"), THEM)).toBe("invite");
    expect(otherMembership(dm("!a:unset.cc", THEM, "leave"), THEM)).toBe("out");
    expect(otherMembership(dm("!a:unset.cc", THEM, "ban"), THEM)).toBe("out");
    expect(otherMembership(dm("!a:unset.cc", THEM), OTHER)).toBe("out");
  });
});

describe("findDirect", () => {
  test("chat.find_direct: the most recent direct room with them in it, as Element's findDMForUser finds it", () => {
    const old = dm("!old:unset.cc", THEM);
    old.addLiveEvents(
      [event({ type: "m.room.message", room_id: "!old:unset.cc", content: { msgtype: "m.text", body: "a" } })],
      { addToState: false },
    );
    const fresh = dm("!new:unset.cc", THEM, "invite");
    fresh.addLiveEvents(
      [event({ type: "m.room.message", room_id: "!new:unset.cc", content: { msgtype: "m.text", body: "b" } })],
      { addToState: false },
    );
    const gone = dm("!gone:unset.cc", THEM, "leave");
    const crowded = room("!crowd:unset.cc", [member(ME, "join"), member(THEM, "join"), member(OTHER, "join")]);
    const open = room("!open:unset.cc", [joinRule("public"), member(ME, "join"), member(THEM, "join")]);
    open.addLiveEvents(
      [event({ type: "m.room.message", room_id: "!open:unset.cc", content: { msgtype: "m.text", body: "c" } })],
      { addToState: false },
    );
    const ids = ["!old:unset.cc", "!new:unset.cc", "!gone:unset.cc", "!crowd:unset.cc", "!open:unset.cc"];
    const direct = directRooms({ [THEM]: ids });
    const rooms = new Map([old, fresh, gone, crowded, open].map((r) => [r.roomId, r]));
    expect(findDirect((id) => rooms.get(id) ?? null, direct, THEM)?.roomId).toBe("!new:unset.cc");
    expect(findDirect((id) => rooms.get(id) ?? null, direct, OTHER)).toBeUndefined();
    expect(
      findDirect((id) => rooms.get(id) ?? null, directRooms({ [THEM]: ["!gone:unset.cc"] }), THEM),
    ).toBeUndefined();
  });
});

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
    const marks = toMessages([confirmed, unconfirmed], ME, new Set([unconfirmed.getId() as string])).map((m) => [
      m.kind,
      m.unconfirmed,
    ]);
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

describe("withDirect", () => {
  test("chat.direct_record: a room is recorded for one person only, as Element's setDMRoom records it", () => {
    const before = { [OTHER]: ["!x:unset.cc", "!a:unset.cc"], [THEM]: ["!y:unset.cc"], bad: "!z:unset.cc" };
    expect(withDirect(before, "!a:unset.cc", THEM)).toEqual({
      [OTHER]: ["!x:unset.cc"],
      [THEM]: ["!y:unset.cc", "!a:unset.cc"],
    });
    expect(withDirect(undefined, "!a:unset.cc", THEM)).toEqual({ [THEM]: ["!a:unset.cc"] });
    expect(withDirect({ [THEM]: ["!a:unset.cc"] }, "!a:unset.cc", THEM)).toEqual({ [THEM]: ["!a:unset.cc"] });
  });
});
