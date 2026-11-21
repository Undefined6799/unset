// P6.10a: the server rule, black-box against the pinned Synapse with the module loaded (tests/support/synapse.ts).
// Synapse refuses every room event a client sends unless it is Megolm ciphertext, and every createRoom that carries
// plaintext or overrides the room's initial state; invites, joins and receipts still work. Paths and bodies are the
// client-server API of spec.matrix.org v1.18 (createRoom, rooms/{roomId}/send, /state, /redact, /receipt).
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  type MatrixUser,
  registerUser,
  STOP_SYNAPSE_MS,
  type Synapse,
  startSynapse,
  stopAllSynapse,
} from "../../../support/synapse.ts";

let synapse: Synapse;
let alice: MatrixUser;
let bob: MatrixUser;
let roomId: string;
/** A real event in the room, so a relation to it passes Synapse's own checks and reaches the module. */
let target: string;
let txn = 0;

type Answer = { status: number; body: Record<string, unknown> };

async function call(user: MatrixUser, method: string, path: string, body?: unknown): Promise<Answer> {
  const res = await fetch(`${synapse.origin}/_matrix/client/v3${path}`, {
    method,
    headers: { authorization: `Bearer ${user.token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const send = (type: string, content: unknown, user = alice): Promise<Answer> =>
  call(user, "PUT", `/rooms/${encodeURIComponent(roomId)}/send/${type}/t${++txn}`, content);
const setState = (type: string, content: unknown): Promise<Answer> =>
  call(alice, "PUT", `/rooms/${encodeURIComponent(roomId)}/state/${type}/`, content);
const createRoom = (body: unknown): Promise<Answer> => call(alice, "POST", "/createRoom", body);

/** What matrix-js-sdk 43's Rust crypto puts in a Megolm room event (spec v1.18 m.room.encrypted; values are fake). */
const MEGOLM = {
  algorithm: "m.megolm.v1.aes-sha2",
  ciphertext: "AwgAEnB5bGlrZSBjaXBoZXJ0ZXh0",
  sender_key: "c2VuZGVyLWtleQ",
  device_id: "ALICEDEVICE",
  session_id: "c2Vzc2lvbi1pZA",
};
const refused = { status: 403, errcode: "M_FORBIDDEN" };
const outcome = (answer: Answer) => ({ status: answer.status, errcode: answer.body.errcode });

/** Every attempt's outcome, in order, so one run shows each one that got through rather than only the first. */
async function outcomes<T>(attempts: readonly T[], attempt: (item: T) => Promise<Answer>) {
  const seen: { item: T; status: number; errcode: unknown }[] = [];
  for (const item of attempts) seen.push({ item, ...outcome(await attempt(item)) });
  return seen;
}
const allRefused = <T>(attempts: readonly T[]) => attempts.map((item) => ({ item, ...refused }));

beforeAll(async () => {
  synapse = await startSynapse();
  alice = await registerUser(synapse, "alice");
  bob = await registerUser(synapse, "bob");
  // The request the chat page sends to start a conversation (build plan step 3, client.createRoom).
  const created = await createRoom({ preset: "trusted_private_chat", is_direct: true, invite: [bob.userId] });
  expect(created.status).toBe(200);
  roomId = created.body.room_id as string;
  expect((await call(bob, "POST", `/join/${encodeURIComponent(roomId)}`, {})).status).toBe(200);
  const sent = await send("m.room.encrypted", MEGOLM);
  expect(sent.status).toBe(200);
  target = sent.body.event_id as string;
}, 180_000);
afterAll(stopAllSynapse, STOP_SYNAPSE_MS);

describe("the server rule: only ciphertext reaches a room", () => {
  test("plain_message_refused", async () => {
    expect(outcome(await send("m.room.message", { msgtype: "m.text", body: "hello" }))).toEqual(refused);
  });

  test("megolm_message_accepted_from_both_members", async () => {
    const fromAlice = await send("m.room.encrypted", MEGOLM);
    expect(fromAlice.status).toBe(200);
    expect(fromAlice.body.event_id).toMatch(/^\$/);
    expect((await send("m.room.encrypted", { ...MEGOLM, device_id: "BOBDEVICE" }, bob)).status).toBe(200);
  });

  test("other_plaintext_event_types_refused", async () => {
    const relatesTo = { "m.relates_to": { rel_type: "m.annotation", event_id: target, key: "yes" } };
    const attempts: [string, unknown][] = [
      ["m.sticker", { body: "a cat", url: "mxc://unset.test/x", info: {} }],
      ["m.reaction", relatesTo],
      ["m.poll.start", { "m.text": [{ body: "lunch?" }] }],
      ["org.matrix.msc3381.poll.start", { "org.matrix.msc3381.poll.start": { question: { body: "lunch?" } } }],
      ["m.call.invite", { call_id: "c", version: "1", lifetime: 60000, offer: { type: "offer", sdp: "v=0" } }],
      ["m.room.encrypted.not", MEGOLM],
      ["com.example.note", { text: "secret" }],
    ];
    expect(await outcomes(attempts, ([type, content]) => send(type, content))).toEqual(allRefused(attempts));
  });

  test("encrypted_event_that_is_not_plain_megolm_refused", async () => {
    const { ciphertext: _, ...noCiphertext } = MEGOLM;
    const attempts: unknown[] = [
      { ...MEGOLM, body: "hello" },
      { ...MEGOLM, "m.relates_to": { rel_type: "m.annotation", event_id: target, key: "yes" } },
      { ...MEGOLM, algorithm: "m.olm.v1.curve25519-aes-sha2" },
      { ...MEGOLM, ciphertext: "" },
      { ...MEGOLM, ciphertext: { key: { type: 0, body: "x" } } },
      noCiphertext,
    ];
    expect(await outcomes(attempts, (content) => send("m.room.encrypted", content))).toEqual(allRefused(attempts));
  });

  test("state_events_after_creation_refused", async () => {
    const attempts: [string, unknown][] = [
      ["m.room.name", { name: "our plans" }],
      ["m.room.topic", { topic: "our plans" }],
      ["m.room.avatar", { url: "mxc://unset.test/x" }],
      ["m.room.encryption", { algorithm: "m.megolm.v1.aes-sha2", rotation_period_ms: 1 }],
      ["m.room.encryption", {}],
      ["m.room.history_visibility", { history_visibility: "world_readable" }],
      ["m.room.join_rules", { join_rule: "public" }],
      ["m.room.encrypted", MEGOLM],
    ];
    expect(await outcomes(attempts, ([type, content]) => setState(type, content))).toEqual(allRefused(attempts));
  });

  test("redaction_refused_so_the_encryption_event_keeps_its_content", async () => {
    const state = await call(alice, "GET", `/rooms/${encodeURIComponent(roomId)}/state/m.room.encryption/`);
    expect(state.body.algorithm).toBe("m.megolm.v1.aes-sha2");
    const events = await call(alice, "GET", `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=50`);
    const chunk = events.body.chunk as { type: string; event_id: string }[];
    const encryption = chunk.find((event) => event.type === "m.room.encryption");
    expect(encryption).toBeDefined();
    const path = `/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(encryption?.event_id ?? "")}/t${++txn}`;
    expect(outcome(await call(alice, "PUT", path, {}))).toEqual(refused);
  });

  test("receipts_still_work", async () => {
    const path = `/rooms/${encodeURIComponent(roomId)}/receipt/m.read.private/${encodeURIComponent(target)}`;
    expect((await call(bob, "POST", path, {})).status).toBe(200);
  });
});

describe("the server rule: a new room cannot start in plaintext", () => {
  test("client_request_creates_a_megolm_room", async () => {
    const created = await createRoom({ preset: "trusted_private_chat", is_direct: true, invite: [bob.userId] });
    expect(created.status).toBe(200);
    const path = `/rooms/${encodeURIComponent(created.body.room_id as string)}/state/m.room.encryption/`;
    expect((await call(alice, "GET", path)).body.algorithm).toBe("m.megolm.v1.aes-sha2");
  });

  test("create_room_carrying_plaintext_or_own_state_refused", async () => {
    const base = { preset: "trusted_private_chat", is_direct: true, invite: [bob.userId] };
    const attempts: unknown[] = [
      { ...base, name: "our plans" },
      { ...base, topic: "our plans" },
      { ...base, initial_state: [{ type: "m.room.encryption", state_key: "", content: { algorithm: "none" } }] },
      { ...base, initial_state: [{ type: "m.room.encryption", state_key: "", content: {} }] },
      { ...base, initial_state: [{ type: "com.example.note", state_key: "", content: { text: "secret" } }] },
      { ...base, creation_content: { note: "secret" } },
      { ...base, room_alias_name: "plans" },
      {
        ...base,
        invite_3pid: [{ id_server: "id.example", id_access_token: "t", medium: "email", address: "a@example.com" }],
      },
      { ...base, visibility: "public" },
    ];
    expect(await outcomes(attempts, createRoom)).toEqual(allRefused(attempts));
  });
});
