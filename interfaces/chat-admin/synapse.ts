// The Synapse admin calls the room sweep makes (ADR 0091 decision 3), sent through outbound.ts to the one internal
// origin checked at boot. Exactly five, by fixed path, each with the token the run passes in; nothing here keeps it.
// Every answer is parsed into what the sweep needs; anything else throws SynapseUnavailable. Read from Synapse 1.165.0
// (docs/admin_api/rooms.md; synapse/rest/admin/rooms.py): the room list (offset `from`, `next_batch`, `encryption`,
// rooms.py:285-346), room state (rooms.py:513-556), timestamp_to_event (200 `event_id`, or 404 M_NOT_FOUND when no
// event is at or after `ts`, handlers/room.py:2186-2285), Delete Room v2 (`delete_id`, rooms.py:139-214) and its
// status (`scheduled`, `active`, `complete`, `failed`; rooms.py:248-269).
import type { Resolve } from "@unset/shared-admin-envelope";
import { type Answer, createSender, field } from "./outbound.ts";

export class SynapseUnavailable extends Error {}

/** A room ID: `!` and an opaque string, with a server part before room version 12 (Matrix spec v1.18, room IDs). */
export type RoomId = string & { readonly __brand: "RoomId" };
export type ListedRoom = { readonly id: RoomId; readonly encrypted: boolean };
export type StateEvent = {
  readonly type: string;
  readonly stateKey: string;
  readonly content: Record<string, unknown>;
};
export type DeleteStatus = "scheduled" | "active" | "complete" | "failed";

export type Synapse = {
  readonly rooms: (token: string, from: number) => Promise<{ rooms: ListedRoom[]; next: number | null }>;
  readonly state: (token: string, room: RoomId) => Promise<StateEvent[]>;
  /** Whether the room has any event with origin_server_ts at or after `ts`. */
  readonly eventSince: (token: string, room: RoomId, ts: number) => Promise<boolean>;
  /** Starts the delete with purge and no block; answers its delete ID. */
  readonly deleteRoom: (token: string, room: RoomId) => Promise<string>;
  readonly deleteStatus: (token: string, deleteId: string) => Promise<DeleteStatus>;
};
export type SynapseOptions = { readonly adminUrl: URL; readonly resolve?: Resolve };

const ROOM = /^![A-Za-z0-9._~=+/-]{1,255}(?::[A-Za-z0-9.:[\]-]{1,255})?$/;
const DELETE_ID = /^[A-Za-z0-9]{1,64}$/;
const PAGE = 100;
/** The one delete body (ADR 0091 decision 4): purge every trace, block nothing, make no replacement room. */
const DELETE_BODY = JSON.stringify({ block: false, purge: true });
const STATUSES: readonly string[] = ["scheduled", "active", "complete", "failed"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function createSynapse(options: SynapseOptions): Synapse {
  const send = createSender(SynapseUnavailable, options.resolve);
  const call = (token: string, method: "GET" | "DELETE", path: string, body?: string): Promise<Answer> => {
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    return send(new URL(path, options.adminUrl), method, headers, body);
  };
  const roomPath = (room: RoomId, rest = "") => `/_synapse/admin/v1/rooms/${encodeURIComponent(room)}${rest}`;
  const refuse = (op: string, answer: Answer): never => {
    throw new SynapseUnavailable(`${op}_${answer.status}`);
  };

  const listed = (entry: unknown): ListedRoom => {
    const id = field(entry, "room_id");
    const encryption = field(entry, "encryption");
    if (typeof id !== "string" || !ROOM.test(id)) throw new SynapseUnavailable("rooms_shape");
    if (encryption !== null && typeof encryption !== "string") throw new SynapseUnavailable("rooms_shape");
    return { id: id as RoomId, encrypted: encryption !== null };
  };
  const stateEvent = (event: unknown): StateEvent => {
    const type = field(event, "type");
    const stateKey = field(event, "state_key");
    const content = field(event, "content");
    if (typeof type !== "string" || typeof stateKey !== "string" || !isRecord(content)) {
      throw new SynapseUnavailable("state_shape");
    }
    return { type, stateKey, content };
  };

  return {
    rooms: async (token, from) => {
      const answer = await call(token, "GET", `/_synapse/admin/v1/rooms?from=${from}&limit=${PAGE}`);
      const { rooms, next_batch: next } = answer.body;
      if (answer.status !== 200 || !Array.isArray(rooms)) return refuse("rooms", answer);
      if (next !== undefined && !(Number.isSafeInteger(next) && (next as number) > from))
        return refuse("rooms", answer);
      return { rooms: rooms.map(listed), next: next === undefined ? null : (next as number) };
    },
    state: async (token, room) => {
      const answer = await call(token, "GET", roomPath(room, "/state"));
      const { state } = answer.body;
      if (answer.status !== 200 || !Array.isArray(state)) return refuse("state", answer);
      return state.map(stateEvent);
    },
    eventSince: async (token, room, ts) => {
      const answer = await call(token, "GET", roomPath(room, `/timestamp_to_event?ts=${ts}&dir=f`));
      if (answer.status === 200 && typeof answer.body.event_id === "string") return true;
      if (answer.status === 404 && answer.body.errcode === "M_NOT_FOUND") return false;
      return refuse("since", answer);
    },
    deleteRoom: async (token, room) => {
      const path = `/_synapse/admin/v2/rooms/${encodeURIComponent(room)}`;
      const answer = await call(token, "DELETE", path, DELETE_BODY);
      const id = answer.body.delete_id;
      return answer.status === 200 && typeof id === "string" && DELETE_ID.test(id) ? id : refuse("delete", answer);
    },
    deleteStatus: async (token, deleteId) => {
      if (!DELETE_ID.test(deleteId)) throw new SynapseUnavailable("delete_id");
      const answer = await call(token, "GET", `/_synapse/admin/v2/rooms/delete_status/${deleteId}`);
      const { status } = answer.body;
      if (answer.status !== 200 || typeof status !== "string" || !STATUSES.includes(status)) {
        return refuse("status", answer);
      }
      return status as DeleteStatus;
    },
  };
}
