// The conversations service on matrix-js-sdk 43.0.0's own client, Room and crypto (no module double, TE-1). Only the
// homeserver is unmanaged: the client's fetchFn, its own option for the network (src/http-api/interface.ts:65), records
// each request and answers a receipt with {} and anything else (the crypto's key backup check) with M_NOT_FOUND, as a
// server with no backup does (spec v1.18 #get_matrixclientv3room_keysversion), so no server is reached.
import { KnownMembership } from "matrix-js-sdk/lib/@types/membership.js";
import { createClient, MatrixEvent, Room } from "matrix-js-sdk/lib/matrix.js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { ConversationId } from "../core/conversations.ts";
import { createConversations } from "./conversation-service.ts";

const ME = "@uaaaaaaaaaaaaaaaaaaaa:unset.cc";
const THEM = "@ubbbbbbbbbbbbbbbbbbbb:unset.cc";
const ROOM = "!a:unset.cc";

const requests: { method: string; path: string }[] = [];
const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(input)).pathname;
  requests.push({ method: init?.method ?? "GET", path });
  const headers = { "content-type": "application/json" };
  if (path.includes("/receipt/")) return new Response("{}", { status: 200, headers });
  return new Response(JSON.stringify({ errcode: "M_NOT_FOUND", error: "none" }), { status: 404, headers });
};
const client = createClient({
  baseUrl: "http://127.0.0.1:9",
  userId: ME,
  deviceId: "DEVICEAAAA",
  accessToken: "t",
  fetchFn,
});

let n = 0;
const event = (fields: Record<string, unknown>) =>
  new MatrixEvent({ event_id: `$e${++n}`, origin_server_ts: n, room_id: ROOM, sender: ME, ...fields });
const member = (userId: string) =>
  event({ type: "m.room.member", state_key: userId, sender: userId, content: { membership: "join" } });

beforeAll(async () => {
  await client.initRustCrypto({ useIndexedDB: false });
  const room = new Room(ROOM, client, ME);
  room.currentState.setStateEvents([
    event({ type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }),
    event({ type: "m.room.join_rules", state_key: "", content: { join_rule: "invite" } }),
    member(ME),
    member(THEM),
  ]);
  room.updateMyMembership(KnownMembership.Join);
  room.addLiveEvents([event({ type: "m.room.message", sender: THEM, content: { msgtype: "m.text", body: "hi" } })], {
    addToState: false,
  });
  client.store.storeRoom(room);
  client.store.storeAccountDataEvents([event({ type: "m.direct", content: { [THEM]: [ROOM] } })]);
}, 20_000);
afterAll(() => client.stopClient());

describe("watch", () => {
  test("chat.read_receipt_public: the newest message from them is marked read with a public m.read, which they see", async () => {
    const crypto = client.getCrypto();
    if (crypto === undefined) throw new Error("no crypto");
    const conversations = createConversations(client, crypto, ME);
    const shown = await new Promise((resolve) => {
      const stop = conversations.watch(ROOM as ConversationId, (view) => {
        stop();
        resolve(view);
      });
    });
    expect(shown).not.toBeNull();
    await expect.poll(() => requests.filter((r) => r.path.includes("/receipt/")).length).toBe(1);
    const receipts = requests.filter((r) => r.path.includes("/receipt/"));
    expect(receipts[0]?.method).toBe("POST");
    expect(receipts[0]?.path).toMatch(/\/rooms\/!a%3Aunset\.cc\/receipt\/m\.read\/%24e\d+$/);
  });
});
