// The rooms half of chat-stack.ts's homeserver (build step 9): direct rooms for the one account, answered as Synapse
// answers the client-server API (https://spec.matrix.org/v1.18/client-server-api/#syncing, #post_matrixclientv3createroom,
// #post_matrixclientv3joinroomidoralias, #put_matrixclientv3roomsroomidsendeventtypetxnid, #receipts,
// #get_matrixclientv3roomsroomidmessages, #get_matrixclientv3roomsroomidmembers), with what our server's RoomPolicy does
// on creation (ADR 0085 decision 1): a createRoom with exactly {preset, is_direct, invite} gets Megolm, anything else is
// refused with 403. The other people have no devices, so the page's crypto encrypts to nobody but still sends
// m.room.encrypted. Invites carry the stripped state Synapse sends by default (room_prejoin_state: create, encryption,
// and the inviter's member event). A test drives the other side: an invite from someone, or their join.
type Json = Record<string, unknown>;
type Room = {
  readonly id: string;
  membership: "invite" | "join";
  /** The state when this member joined or made the room; later changes go through the timeline. */
  state: Json[];
  readonly invite: Json[];
  readonly timeline: { event: Json; at: number }[];
  /** The clock tick of the last change, and of the join (when the full state is sent). */
  at: number;
  joinedAt: number;
};

const MEGOLM = { algorithm: "m.megolm.v1.aes-sha2" };
const PLAIN = { max_lifetime: 2_592_000_000 };

export function fakeRooms(tick: () => number) {
  const rooms = new Map<string, Room>();
  const sent: { roomId: string; type: string; body: Json }[] = [];
  const created: Json[] = [];
  let n = 0;
  const event = (type: string, sender: string, content: Json, stateKey?: string): Json => ({
    type,
    sender,
    content,
    event_id: `$e${++n}`,
    origin_server_ts: Date.now(),
    ...(stateKey === undefined ? {} : { state_key: stateKey }),
  });
  const member = (userId: string, membership: string, sender = userId, extra: Json = {}) =>
    event("m.room.member", sender, { membership, ...extra }, userId);
  const stripped = ({ type, sender, content, state_key }: Json) => ({ type, sender, content, state_key });
  const members = (room: Room) => {
    const latest = new Map<string, Json>();
    for (const e of [...room.state, ...room.timeline.map((t) => t.event)]) {
      if (e.type === "m.room.member") latest.set(e.state_key as string, e);
    }
    return [...latest.values()];
  };

  /** Someone asks the account to talk: an invite marked direct, in an encrypted or a plain room. */
  function invite(me: string, from: string, name: string, kind: "encrypted" | "plain"): string {
    const id = `!r${++n}:staging.unset.cc`;
    const create = event("m.room.create", from, { room_version: "11" }, "");
    const policy =
      kind === "encrypted" ? event("m.room.encryption", from, MEGOLM, "") : event("m.room.retention", from, PLAIN, "");
    const theirs = member(from, "join", from, { displayname: name });
    const mine = member(me, "invite", from, { is_direct: true });
    const at = tick();
    rooms.set(id, {
      id,
      membership: "invite",
      state: [create, policy, theirs, mine],
      invite: [create, policy, theirs, mine].map(stripped),
      timeline: [],
      at,
      joinedAt: at,
    });
    return id;
  }

  /** The other person joins (they accepted the account's request). */
  function join(roomId: string, who: string, name: string) {
    const room = rooms.get(roomId);
    if (room === undefined) throw new Error(`no room ${roomId}`);
    room.at = tick();
    room.timeline.push({ event: member(who, "join", who, { displayname: name }), at: room.at });
  }

  function syncRooms(since: number) {
    const join: Json = {};
    const invite: Json = {};
    for (const room of rooms.values()) {
      if (room.at <= since) continue;
      if (room.membership === "invite") {
        invite[room.id] = { invite_state: { events: room.invite } };
        continue;
      }
      join[room.id] = {
        state: { events: room.joinedAt > since ? room.state : [] },
        timeline: {
          events: room.timeline.filter((t) => t.at > since).map((t) => t.event),
          limited: false,
          prev_batch: "p0",
        },
        account_data: { events: [] },
        ephemeral: { events: [] },
        unread_notifications: { notification_count: 0, highlight_count: 0 },
      };
    }
    return { join, invite, leave: {} };
  }

  const roomOf = (path: string) => rooms.get(decodeURIComponent(/^\/rooms\/([^/]+)/.exec(path)?.[1] ?? ""));

  type Answer = [number, unknown] | null;

  /** POST /createRoom as our server's RoomPolicy takes it: exactly {preset, is_direct, invite}, Megolm added. */
  function createRoom(body: Json, me: string): Answer {
    created.push(body);
    const invited = body.invite as string[] | undefined;
    if (Object.keys(body).sort().join(",") !== "invite,is_direct,preset" || invited?.length !== 1) {
      return [403, { errcode: "M_FORBIDDEN", error: "only preset, is_direct and invite are allowed" }];
    }
    const id = `!r${++n}:staging.unset.cc`;
    const at = tick();
    const state = [
      event("m.room.create", me, { room_version: "11" }, ""),
      member(me, "join"),
      event("m.room.encryption", me, MEGOLM, ""),
      member(invited[0] as string, "invite", me, { is_direct: true }),
    ];
    rooms.set(id, { id, membership: "join", state, invite: [], timeline: [], at, joinedAt: at });
    return [200, { room_id: id }];
  }

  function joinRoom(roomId: string, me: string): Answer {
    const room = rooms.get(roomId);
    if (room === undefined) return [404, { errcode: "M_NOT_FOUND", error: "No room" }];
    room.membership = "join";
    room.state = [...room.state.filter((e) => e.state_key !== me), member(me, "join")];
    room.at = room.joinedAt = tick();
    return [200, { room_id: room.id }];
  }

  /** PUT /rooms/{id}/send/{type}/{txn}: kept, and echoed back to the sender's sync with its transaction id. */
  function sendEvent(room: Room, type: string, txn: string, body: Json, me: string): Answer {
    sent.push({ roomId: room.id, type, body });
    const echo: Json = { ...event(type, me, body), unsigned: { transaction_id: txn } };
    room.at = tick();
    room.timeline.push({ event: echo, at: room.at });
    return [200, { event_id: echo.event_id }];
  }

  /** Answers a rooms call, or null for a path that is not one. */
  function answer(path: string, method: string, body: Json, me: string): Answer {
    if (path === "/createRoom" && method === "POST") return createRoom(body, me);
    const joining = /^\/join\/([^/]+)$/.exec(path);
    if (joining !== null && method === "POST") return joinRoom(decodeURIComponent(joining[1] ?? ""), me);
    const room = roomOf(path);
    return room === undefined ? null : roomCall(room, path, method, body, me);
  }

  /** A call on one room the account is in. */
  function roomCall(room: Room, path: string, method: string, body: Json, me: string): Answer {
    const send = /^\/rooms\/[^/]+\/send\/([^/]+)\/([^/]+)$/.exec(path);
    if (send !== null && method === "PUT") {
      return sendEvent(room, decodeURIComponent(send[1] ?? ""), decodeURIComponent(send[2] ?? ""), body, me);
    }
    if (/\/receipt\//.test(path)) return [200, {}];
    if (path.endsWith("/messages")) return [200, { chunk: [], start: "p0" }];
    if (path.endsWith("/members")) return [200, { chunk: members(room) }];
    return null;
  }

  return { rooms, sent, created, invite, join, syncRooms, answer };
}
export type FakeRooms = ReturnType<typeof fakeRooms>;
