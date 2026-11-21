// The conversations service on matrix-js-sdk 43.0.0's own client, Room and crypto (no module double, TE-1). Only the
// homeserver is unmanaged: the client's fetchFn, its own option for the network (src/http-api/interface.ts:65), records
// each request and answers a receipt with {}, a redaction with its event id (or M_FORBIDDEN for the one marked to
// fail, spec v1.18 #put_matrixclientv3roomsroomidredacteventidtxnid) and anything else (the crypto's key backup check)
// with M_NOT_FOUND, as a server with no backup does (spec v1.18 #get_matrixclientv3room_keysversion), so no server is
// reached.
// This browser's storage is a Map behind the Storage methods the service calls (the page passes window.localStorage).
import { KnownMembership } from "matrix-js-sdk/lib/@types/membership.js";
import { createClient, MatrixEvent, Room, RoomEvent } from "matrix-js-sdk/lib/matrix.js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { ConversationId } from "../core/conversations.ts";
import { createConversations, forgetLocalChoices, type LocalChoices } from "./conversation-service.ts";

const ME = "@uaaaaaaaaaaaaaaaaaaaa:unset.cc";
const THEM = "@ubbbbbbbbbbbbbbbbbbbb:unset.cc";
const OTHER = "@ucccccccccccccccccccc:unset.cc";
const AWAY = "@udddddddddddddddddddd:unset.cc";
const ROOM = "!a:unset.cc";
const HIDDEN = "!h:unset.cc";
const LEFT = "@ueeeeeeeeeeeeeeeeeeee:unset.cc";
const LEAVES = "!l:unset.cc";
const DELETES = "!d:unset.cc";

const FAILS = "$refused";
const requests: { method: string; path: string }[] = [];
const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(input)).pathname;
  requests.push({ method: init?.method ?? "GET", path });
  const headers = { "content-type": "application/json" };
  if (path.includes("/receipt/")) return new Response("{}", { status: 200, headers });
  if (path.includes("/redact/") && path.includes(encodeURIComponent(FAILS)))
    return new Response(JSON.stringify({ errcode: "M_FORBIDDEN", error: "no" }), { status: 403, headers });
  if (path.includes("/redact/"))
    return new Response(JSON.stringify({ event_id: `$r${++n}` }), { status: 200, headers });
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
/** Alice's two-person room with `them`, as sync builds it, with `messages` in its timeline. */
function storeRoom(id: string, them: string, messages: MatrixEvent[]) {
  const room = new Room(id, client, ME);
  const inRoom = (e: MatrixEvent) => {
    e.event.room_id = id;
    return e;
  };
  room.currentState.setStateEvents(
    [
      event({ type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }),
      event({ type: "m.room.join_rules", state_key: "", content: { join_rule: "invite" } }),
      member(ME),
      member(them),
    ].map(inRoom),
  );
  room.updateMyMembership(KnownMembership.Join);
  room.addLiveEvents(messages.map(inRoom), { addToState: false });
  client.store.storeRoom(room);
}
const text = (id: string, sender: string) =>
  event({ event_id: id, type: "m.room.message", sender, content: { msgtype: "m.text", body: id } });
const memory = (): LocalChoices & { readonly keys: () => string[] } => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    keys: () => [...values.keys()],
  };
};
/** The page as the service reads it: its visibility, and the event that says it changed. */
const page = (visibilityState: DocumentVisibilityState) =>
  Object.assign(new EventTarget(), { visibilityState }) as EventTarget & { visibilityState: DocumentVisibilityState };
const receiptsIn = (roomId: string) =>
  requests.filter((r) => r.path.includes(`/rooms/${encodeURIComponent(roomId)}/receipt/`)).length;
const member = (userId: string) =>
  event({ type: "m.room.member", state_key: userId, sender: userId, content: { membership: "join" } });

beforeAll(async () => {
  await client.initRustCrypto({ useIndexedDB: false });
  storeRoom(ROOM, THEM, [event({ type: "m.room.message", sender: THEM, content: { msgtype: "m.text", body: "hi" } })]);
  storeRoom(DELETES, OTHER, [text("$mine1", ME), text("$theirs1", OTHER), text(FAILS, ME)]);
  storeRoom(HIDDEN, AWAY, [text("$away1", AWAY)]);
  storeRoom(LEAVES, LEFT, [text("$left1", LEFT)]);
  client.store.storeAccountDataEvents([
    event({ type: "m.direct", content: { [THEM]: [ROOM], [OTHER]: [DELETES], [AWAY]: [HIDDEN], [LEFT]: [LEAVES] } }),
  ]);
}, 20_000);
afterAll(() => client.stopClient());

describe("watch", () => {
  test("chat.read_receipt_public: the newest message from them is marked read with a public m.read, which they see", async () => {
    const crypto = client.getCrypto();
    if (crypto === undefined) throw new Error("no crypto");
    const conversations = createConversations(client, crypto, ME, memory(), page("visible"));
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

  test("chat.read_receipt_visible: nothing is marked read while the page is hidden; coming back marks it", async () => {
    const crypto = client.getCrypto();
    if (crypto === undefined) throw new Error("no crypto");
    const tab = page("hidden");
    const conversations = createConversations(client, crypto, ME, memory(), tab);
    let views = 0;
    const stop = conversations.watch(HIDDEN as ConversationId, () => void views++);
    await expect.poll(() => views).toBeGreaterThan(0);
    // A new message arrives while the tab is in the background: shown, not seen.
    const late = text("$away2", AWAY);
    late.event.room_id = HIDDEN;
    await client.getRoom(HIDDEN)?.addLiveEvents([late], { addToState: false });
    // Sync re-emits a room's timeline on the client (src/sync.ts:1964-1983); this room was stored by hand.
    (client as unknown as { emit(name: string): void }).emit(RoomEvent.Timeline);
    await expect.poll(() => views).toBeGreaterThan(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(receiptsIn(HIDDEN)).toBe(0);
    tab.visibilityState = "visible";
    tab.dispatchEvent(new Event("visibilitychange"));
    await expect.poll(() => receiptsIn(HIDDEN)).toBe(1);
    expect(requests.findLast((r) => r.path.includes("/receipt/"))?.path).toContain(encodeURIComponent("$away2"));
    stop();
  });
  test("chat.read_after_stop: a read still under way when the member leaves paints nothing and marks nothing", async () => {
    const crypto = client.getCrypto();
    if (crypto === undefined) throw new Error("no crypto");
    const conversations = createConversations(client, crypto, ME, memory(), page("visible"));
    let views = 0;
    // The first read awaits the crypto's answers; the member leaves before they come.
    const stop = conversations.watch(LEAVES as ConversationId, () => void views++);
    stop();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(views).toBe(0);
    expect(receiptsIn(LEAVES)).toBe(0);
  });
});

describe("delete", () => {
  test("chat.delete_many: each of one's own goes in its own request; theirs and a refused one come back as not deleted", async () => {
    const crypto = client.getCrypto();
    if (crypto === undefined) throw new Error("no crypto");
    const conversations = createConversations(client, crypto, ME, memory());
    const before = requests.length;
    const failed = await conversations.remove(DELETES as ConversationId, ["$mine1", "$theirs1", FAILS]);
    expect(failed).toEqual(["$theirs1", FAILS]);
    const redactions = requests.slice(before).filter((r) => r.path.includes("/redact/"));
    expect(redactions.map((r) => r.method)).toEqual(["PUT", "PUT"]);
    expect(redactions[0]?.path).toContain(`/redact/${encodeURIComponent("$mine1")}/`);
    expect(redactions[1]?.path).toContain(`/redact/${encodeURIComponent(FAILS)}/`);
    // The refused one is still shown as it was: the SDK applies a redaction only once the server has it.
    expect(client.getRoom(DELETES)?.findEventById(FAILS)?.isRedacted()).toBe(false);
  });

  test("chat.delete_prompt_local: Don't ask me again is kept for this account in this browser only, and Log out forgets it", async () => {
    const crypto = client.getCrypto();
    if (crypto === undefined) throw new Error("no crypto");
    const storage = memory();
    const mine = createConversations(client, crypto, ME, storage);
    const theirs = createConversations(client, crypto, THEM, storage);
    const before = requests.length;
    expect(mine.confirmsDelete()).toBe(true);
    mine.stopConfirmingDelete();
    theirs.stopConfirmingDelete();
    expect(mine.confirmsDelete()).toBe(false);
    expect(createConversations(client, crypto, ME, storage).confirmsDelete()).toBe(false);
    expect(storage.keys().every((key) => key.startsWith("unset-chat:"))).toBe(true);
    expect(requests.length).toBe(before);
    forgetLocalChoices(storage, ME);
    expect(mine.confirmsDelete()).toBe(true);
    expect(theirs.confirmsDelete()).toBe(false);
  });
});
