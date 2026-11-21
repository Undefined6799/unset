// P6.10a: the server rule, black-box against the pinned Synapse with the module loaded (tests/support/synapse.ts).
// A room is encrypted (the default: only Megolm ciphertext) or plain (asked for with the 30-day retention policy:
// only m.text), fixed at creation; createRoom can ask for nothing else, and invites, joins and receipts still work.
// Paths and bodies are the client-server API of spec.matrix.org v1.18 (createRoom, rooms/{roomId}/send, /state,
// /redact, /receipt, /invite, /join, /leave). A room holds two people for good. Retention purging itself is
// retention.test.ts; reactions, replies and redacting one's own reaction are relations.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  type Answer,
  clientCall,
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
let carol: MatrixUser;
/** A server admin, whom Synapse lets skip the invite check, so a test can reach the join check with a third person. */
let admin: MatrixUser;
let encrypted: string;
let plain: string;
/** A real event in the encrypted room, so a relation to it passes Synapse's own checks and reaches the module. */
let target: string;
let txn = 0;

const room = (id: string): string => `/rooms/${encodeURIComponent(id)}`;
const call = (user: MatrixUser, method: string, path: string, body?: unknown): Promise<Answer> =>
  clientCall(synapse, user, method, path, body);
const send = (id: string, type: string, content: unknown, user = alice): Promise<Answer> =>
  call(user, "PUT", `${room(id)}/send/${type}/t${++txn}`, content);
const setState = (id: string, type: string, content: unknown): Promise<Answer> =>
  call(alice, "PUT", `${room(id)}/state/${type}/`, content);
const createRoom = (body: unknown): Promise<Answer> => call(alice, "POST", "/createRoom", body);

/** What matrix-js-sdk 43's Rust crypto puts in a Megolm room event (spec v1.18 m.room.encrypted; values are fake). */
const MEGOLM = {
  algorithm: "m.megolm.v1.aes-sha2",
  ciphertext: "AwgAEnB5bGlrZSBjaXBoZXJ0ZXh0",
  sender_key: "c2VuZGVyLWtleQ",
  device_id: "ALICEDEVICE",
  session_id: "c2Vzc2lvbi1pZA",
};
/** What matrix-js-sdk 43's sendTextMessage sends (ContentHelpers.makeTextMessage). */
const TEXT = { msgtype: "m.text", body: "hello" };
const THIRTY_DAYS_MS = 2_592_000_000;
const PLAIN_STATE = [{ type: "m.room.retention", state_key: "", content: { max_lifetime: THIRTY_DAYS_MS } }];
const refused = { status: 403, errcode: "M_FORBIDDEN" };
const outcome = (answer: Answer) => ({ status: answer.status, errcode: answer.body.errcode });

/** Every attempt's outcome, in order, so one run shows each one that got through rather than only the first. */
async function outcomes<T>(attempts: readonly T[], attempt: (item: T) => Promise<Answer>) {
  const seen: { item: T; status: number; errcode: unknown }[] = [];
  for (const item of attempts) seen.push({ item, ...outcome(await attempt(item)) });
  return seen;
}
const allRefused = <T>(attempts: readonly T[]) => attempts.map((item) => ({ item, ...refused }));

async function startConversation(extra: Record<string, unknown>): Promise<string> {
  const created = await createRoom({ preset: "trusted_private_chat", is_direct: true, invite: [bob.userId], ...extra });
  expect(created.status).toBe(200);
  const id = created.body.room_id as string;
  expect((await call(bob, "POST", `/join/${encodeURIComponent(id)}`, {})).status).toBe(200);
  return id;
}

/** State that the plaintext rule must refuse in either kind of room. */
const LATER_STATE: [string, unknown][] = [
  ["m.room.name", { name: "our plans" }],
  ["m.room.topic", { topic: "our plans" }],
  ["m.room.avatar", { url: "mxc://unset.test/x" }],
  ["m.room.encryption", { algorithm: "m.megolm.v1.aes-sha2", rotation_period_ms: 1 }],
  ["m.room.encryption", {}],
  ["m.room.retention", { max_lifetime: 10 * THIRTY_DAYS_MS }],
  ["m.room.retention", {}],
  ["m.room.history_visibility", { history_visibility: "world_readable" }],
  ["m.room.join_rules", { join_rule: "public" }],
  ["m.room.encrypted", MEGOLM],
];

beforeAll(async () => {
  synapse = await startSynapse();
  alice = await registerUser(synapse, "alice");
  bob = await registerUser(synapse, "bob");
  carol = await registerUser(synapse, "carol");
  admin = await registerUser(synapse, "admin", true);
  // The request the chat page sends to start a conversation (build plan step 3, client.createRoom).
  encrypted = await startConversation({});
  plain = await startConversation({ initial_state: PLAIN_STATE });
  const sent = await send(encrypted, "m.room.encrypted", MEGOLM);
  expect(sent.status).toBe(200);
  target = sent.body.event_id as string;
}, 180_000);
afterAll(stopAllSynapse, STOP_SYNAPSE_MS);

describe("an encrypted room takes only ciphertext", () => {
  test("plain_message_refused", async () => {
    expect(outcome(await send(encrypted, "m.room.message", TEXT))).toEqual(refused);
  });

  test("megolm_message_accepted_from_both_members", async () => {
    const fromAlice = await send(encrypted, "m.room.encrypted", MEGOLM);
    expect(fromAlice.status).toBe(200);
    expect(fromAlice.body.event_id).toMatch(/^\$/);
    expect((await send(encrypted, "m.room.encrypted", { ...MEGOLM, device_id: "BOBDEVICE" }, bob)).status).toBe(200);
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
    const sent = await outcomes(attempts, ([type, content]) => send(encrypted, type, content));
    expect(sent).toEqual(allRefused(attempts));
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
    const sent = await outcomes(attempts, (content) => send(encrypted, "m.room.encrypted", content));
    expect(sent).toEqual(allRefused(attempts));
  });

  test("state_events_after_creation_refused", async () => {
    const set = await outcomes(LATER_STATE, ([type, content]) => setState(encrypted, type, content));
    expect(set).toEqual(allRefused(LATER_STATE));
  });

  test("redaction_refused_so_the_encryption_event_keeps_its_content", async () => {
    const state = await call(alice, "GET", `${room(encrypted)}/state/m.room.encryption/`);
    expect(state.body.algorithm).toBe("m.megolm.v1.aes-sha2");
    const events = await call(alice, "GET", `${room(encrypted)}/messages?dir=b&limit=50`);
    const chunk = events.body.chunk as { type: string; event_id: string }[];
    const encryption = chunk.find((event) => event.type === "m.room.encryption");
    expect(encryption).toBeDefined();
    const path = `${room(encrypted)}/redact/${encodeURIComponent(encryption?.event_id ?? "")}/t${++txn}`;
    expect(outcome(await call(alice, "PUT", path, {}))).toEqual(refused);
  });

  test("receipts_still_work", async () => {
    const path = `${room(encrypted)}/receipt/m.read.private/${encodeURIComponent(target)}`;
    expect((await call(bob, "POST", path, {})).status).toBe(200);
  });
});

describe("a plain room takes only text, under its 30-day policy", () => {
  test("plain_text_accepted_from_both_members_and_readable", async () => {
    const fromAlice = await send(plain, "m.room.message", TEXT);
    expect(fromAlice.status).toBe(200);
    expect((await send(plain, "m.room.message", { msgtype: "m.text", body: "hi" }, bob)).status).toBe(200);
    const read = await call(
      bob,
      "GET",
      `${room(plain)}/event/${encodeURIComponent(fromAlice.body.event_id as string)}`,
    );
    expect(read.body.content).toEqual(TEXT);
  });

  test("anything_but_m_text_refused", async () => {
    const attempts: [string, unknown][] = [
      ["m.room.message", { msgtype: "m.notice", body: "hello" }],
      ["m.room.message", { msgtype: "m.emote", body: "waves" }],
      ["m.room.message", { msgtype: "m.image", body: "a cat", url: "mxc://unset.test/x" }],
      ["m.room.message", { ...TEXT, format: "org.matrix.custom.html", formatted_body: "<b>hello</b>" }],
      ["m.room.message", { msgtype: "m.text", body: "" }],
      ["m.room.encrypted", MEGOLM],
      ["m.sticker", { body: "a cat", url: "mxc://unset.test/x", info: {} }],
      ["com.example.note", { text: "secret" }],
    ];
    const sent = await outcomes(attempts, ([type, content]) => send(plain, type, content));
    expect(sent).toEqual(allRefused(attempts));
  });

  test("state_events_after_creation_refused_so_the_policy_cannot_change", async () => {
    const set = await outcomes(LATER_STATE, ([type, content]) => setState(plain, type, content));
    expect(set).toEqual(allRefused(LATER_STATE));
    const policy = await call(alice, "GET", `${room(plain)}/state/m.room.retention/`);
    expect(policy.body).toEqual({ max_lifetime: THIRTY_DAYS_MS });
  });

  test("redaction_refused", async () => {
    const sent = await send(plain, "m.room.message", TEXT);
    const path = `${room(plain)}/redact/${encodeURIComponent(sent.body.event_id as string)}/t${++txn}`;
    expect(outcome(await call(alice, "PUT", path, {}))).toEqual(refused);
  });
});

describe("createRoom makes one of the two kinds and nothing else", () => {
  test("client_request_creates_a_megolm_room_without_a_policy", async () => {
    const created = await createRoom({ preset: "trusted_private_chat", is_direct: true, invite: [bob.userId] });
    expect(created.status).toBe(200);
    const id = created.body.room_id as string;
    expect((await call(alice, "GET", `${room(id)}/state/m.room.encryption/`)).body.algorithm).toBe(
      "m.megolm.v1.aes-sha2",
    );
    expect((await call(alice, "GET", `${room(id)}/state/m.room.retention/`)).status).toBe(404);
  });

  test("plain_request_creates_a_room_with_the_policy_and_no_encryption", async () => {
    const created = await createRoom({
      preset: "trusted_private_chat",
      invite: [bob.userId],
      initial_state: PLAIN_STATE,
    });
    expect(created.status).toBe(200);
    const id = created.body.room_id as string;
    expect((await call(alice, "GET", `${room(id)}/state/m.room.encryption/`)).status).toBe(404);
    expect((await call(alice, "GET", `${room(id)}/state/m.room.retention/`)).body).toEqual({
      max_lifetime: THIRTY_DAYS_MS,
    });
  });

  test("create_room_carrying_plaintext_or_other_state_refused", async () => {
    const base = { preset: "trusted_private_chat", is_direct: true, invite: [bob.userId] };
    const retention = (content: unknown) => [{ type: "m.room.retention", state_key: "", content }];
    const encryption = { type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } };
    const attempts: unknown[] = [
      { ...base, name: "our plans" },
      { ...base, topic: "our plans" },
      { ...base, initial_state: [{ ...encryption, content: { algorithm: "none" } }] },
      { ...base, initial_state: [{ ...encryption, content: {} }] },
      { ...base, initial_state: [encryption] },
      { ...base, initial_state: [{ type: "com.example.note", state_key: "", content: { text: "secret" } }] },
      { ...base, initial_state: retention({ max_lifetime: THIRTY_DAYS_MS + 1 }) },
      { ...base, initial_state: retention({ max_lifetime: THIRTY_DAYS_MS, min_lifetime: 1 }) },
      { ...base, initial_state: retention({}) },
      { ...base, initial_state: [...PLAIN_STATE, encryption] },
      { ...base, initial_state: [{ ...PLAIN_STATE[0], state_key: "x" }] },
      { ...base, creation_content: { note: "secret" } },
      { ...base, room_alias_name: "plans" },
      {
        ...base,
        invite_3pid: [{ id_server: "id.example", id_access_token: "t", medium: "email", address: "a@example.com" }],
      },
      { ...base, visibility: "public" },
      { ...base, preset: "public_chat" },
      { ...base, preset: "unknown" },
      { is_direct: true, invite: [bob.userId] },
      { ...base, invite: [bob.userId, carol.userId] },
      { ...base, invite: [] },
      { ...base, invite: "@bob:unset.test" },
      { preset: "trusted_private_chat", is_direct: true },
    ];
    expect(await outcomes(attempts, createRoom)).toEqual(allRefused(attempts));
  });
});

describe("a room holds two people", () => {
  const invite = (user: MatrixUser, id: string, who: MatrixUser): Promise<Answer> =>
    call(user, "POST", `${room(id)}/invite`, { user_id: who.userId });
  const join = (user: MatrixUser, id: string): Promise<Answer> =>
    call(user, "POST", `/join/${encodeURIComponent(id)}`, {});

  test("third_person_invite_refused_from_either_member", async () => {
    expect(outcome(await invite(alice, encrypted, carol))).toEqual(refused);
    expect(outcome(await invite(bob, plain, carol))).toEqual(refused);
  });

  test("third_person_invite_refused_while_the_first_invite_is_pending", async () => {
    const created = await createRoom({ preset: "trusted_private_chat", is_direct: true, invite: [bob.userId] });
    expect(created.status).toBe(200);
    expect(outcome(await invite(alice, created.body.room_id as string, carol))).toEqual(refused);
  });

  test("one_who_left_may_be_invited_back_but_nobody_new", async () => {
    const id = await startConversation({});
    expect((await call(bob, "POST", `${room(id)}/leave`, {})).status).toBe(200);
    expect(outcome(await invite(alice, id, carol))).toEqual(refused);
    expect((await invite(alice, id, bob)).status).toBe(200);
  });

  test("third_person_join_refused_even_after_an_admin_invite", async () => {
    const created = await call(admin, "POST", "/createRoom", {
      preset: "trusted_private_chat",
      is_direct: true,
      invite: [alice.userId],
    });
    expect(created.status).toBe(200);
    const id = created.body.room_id as string;
    expect((await join(alice, id)).status).toBe(200);
    expect((await invite(admin, id, carol)).status).toBe(200);
    expect(outcome(await join(carol, id))).toEqual(refused);
  });
});
