// ADR 0092 (amends ADR 0085 decision 1; Alex, 2026-11-21 18:59Z), black-box against the pinned Synapse with the module
// loaded (tests/support/synapse.ts), as room-policy.test.ts: what the server takes beside Megolm ciphertext.
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
let encrypted: string;
let plain: string;
let txn = 0;

const room = (id: string): string => `/rooms/${encodeURIComponent(id)}`;
const call = (user: MatrixUser, method: string, path: string, body?: unknown): Promise<Answer> =>
  clientCall(synapse, user, method, path, body);
const send = (id: string, type: string, content: unknown, user = alice): Promise<Answer> =>
  call(user, "PUT", `${room(id)}/send/${type}/t${++txn}`, content);

/** What matrix-js-sdk 43's Rust crypto puts in a Megolm room event (spec v1.18 m.room.encrypted; values are fake). */
const MEGOLM = {
  algorithm: "m.megolm.v1.aes-sha2",
  ciphertext: "AwgAEnB5bGlrZSBjaXBoZXJ0ZXh0",
  sender_key: "c2VuZGVyLWtleQ",
  device_id: "ALICEDEVICE",
  session_id: "c2Vzc2lvbi1pZA",
};
const TEXT = { msgtype: "m.text", body: "hello" };
const PLAIN_STATE = [{ type: "m.room.retention", state_key: "", content: { max_lifetime: 2_592_000_000 } }];
const refused = { status: 403, errcode: "M_FORBIDDEN" };
const outcome = (answer: Answer) => ({ status: answer.status, errcode: answer.body.errcode });

async function outcomes<T>(attempts: readonly T[], attempt: (item: T) => Promise<Answer>) {
  const seen: { item: T; status: number; errcode: unknown }[] = [];
  for (const item of attempts) seen.push({ item, ...outcome(await attempt(item)) });
  return seen;
}

async function startConversation(extra: Record<string, unknown>): Promise<string> {
  const body = { preset: "trusted_private_chat", is_direct: true, invite: [bob.userId], ...extra };
  const created = await call(alice, "POST", "/createRoom", body);
  expect(created.status).toBe(200);
  const id = created.body.room_id as string;
  expect((await call(bob, "POST", `/join/${encodeURIComponent(id)}`, {})).status).toBe(200);
  return id;
}

beforeAll(async () => {
  synapse = await startSynapse();
  alice = await registerUser(synapse, "alice");
  bob = await registerUser(synapse, "bob");
  encrypted = await startConversation({});
  plain = await startConversation({ initial_state: PLAIN_STATE });
}, 180_000);
afterAll(stopAllSynapse, STOP_SYNAPSE_MS);

// A reaction is a
// plain m.reaction annotation (spec v1.18 #event-annotations-and-reactions), with one of Element's quick reactions as its
// key (element-web v1.12.35 packages/shared-components/src/core/EmojiPicker/QuickReactions.tsx:22), on a message in
// the same room. A reply is Megolm with m.relates_to.m.in_reply_to in the clear (spec v1.18 #rich-replies). Taking a
// reaction back is a redaction of one's own m.reaction (spec v1.18 #redactions); every other redaction stays refused.
describe("reactions, replies and taking a reaction back", () => {
  const QUICK = ["👍", "👎", "😄", "🎉", "😕", "❤️", "🚀", "👀"];
  const annotation = (eventId: string, key: string) => ({
    "m.relates_to": { rel_type: "m.annotation", event_id: eventId, key },
  });
  const react = (id: string, eventId: string, key: string, user = alice) =>
    send(id, "m.reaction", annotation(eventId, key), user);
  const redact = (id: string, eventId: string, user: MatrixUser, body: unknown = {}) =>
    call(user, "PUT", `${room(id)}/redact/${encodeURIComponent(eventId)}/t${++txn}`, body);
  const message = async (id = encrypted, user = alice): Promise<string> => {
    const sent = await send(id, "m.room.encrypted", { ...MEGOLM, device_id: "D" }, user);
    expect(sent.status).toBe(200);
    return sent.body.event_id as string;
  };
  const stateEventId = async (id: string, type: string): Promise<string> => {
    const events = await call(alice, "GET", `${room(id)}/messages?dir=b&limit=50`);
    return ((events.body.chunk as { type: string; event_id: string }[]).find((e) => e.type === type)?.event_id ??
      "") as string;
  };
  const reply = (eventId: string) => ({ "m.relates_to": { "m.in_reply_to": { event_id: eventId } } });

  test("each_quick_reaction_on_a_message_accepted_from_either_member", async () => {
    const onIt = await message();
    const fromAlice = await outcomes(QUICK, (key) => react(encrypted, onIt, key));
    expect(fromAlice.map((r) => r.status)).toEqual(QUICK.map(() => 200));
    expect((await react(encrypted, onIt, "👍", bob)).status).toBe(200);
    const text = await send(plain, "m.room.message", TEXT);
    expect((await react(plain, text.body.event_id as string, "🎉", bob)).status).toBe(200);
  });

  test("reaction_that_is_not_a_quick_annotation_on_a_message_here_refused", async () => {
    const onIt = await message();
    const reaction = await react(encrypted, onIt, "👀");
    const encryption = await stateEventId(encrypted, "m.room.encryption");
    const elsewhere = await message(await startConversation({}));
    const attempts: unknown[] = [
      annotation(onIt, "meet me at 5"),
      annotation(onIt, "👍🏽"),
      annotation(onIt, ""),
      annotation(encryption, "👍"),
      annotation(reaction.body.event_id as string, "👍"),
      annotation(elsewhere, "👍"),
      annotation("$nothere", "👍"),
      { "m.relates_to": { rel_type: "m.reference", event_id: onIt } },
      { "m.relates_to": { rel_type: "m.annotation", event_id: onIt } },
      { "m.relates_to": { rel_type: "m.annotation", event_id: onIt, key: "👍", extra: 1 } },
      { ...annotation(onIt, "😄"), body: "hello" },
      {},
    ];
    const sent = await outcomes(attempts, (content) => send(encrypted, "m.reaction", content));
    expect(sent.map(({ item, status }) => ({ item, status: status === 400 ? 403 : status }))).toEqual(
      attempts.map((item) => ({ item, status: 403 })),
    );
  });

  test("own_reaction_may_be_taken_back_and_nothing_else_redacted", async () => {
    const onIt = await message();
    const mine = (await react(encrypted, onIt, "🚀")).body.event_id as string;
    const theirs = (await react(encrypted, onIt, "🚀", bob)).body.event_id as string;
    const withReason = (await react(encrypted, onIt, "❤️")).body.event_id as string;
    expect(outcome(await redact(encrypted, theirs, alice))).toEqual(refused);
    expect(outcome(await redact(encrypted, onIt, alice))).toEqual(refused);
    expect(outcome(await redact(encrypted, withReason, alice, { reason: "oops" }))).toEqual(refused);
    expect((await redact(encrypted, mine, alice)).status).toBe(200);
    expect((await redact(encrypted, theirs, bob)).status).toBe(200);
  });

  test("encrypted_reply_with_a_cleartext_in_reply_to_accepted", async () => {
    const onIt = await message();
    expect((await send(encrypted, "m.room.encrypted", { ...MEGOLM, ...reply(onIt) }, bob)).status).toBe(200);
  });

  test("encrypted_relation_that_is_not_a_reply_to_a_message_here_refused", async () => {
    const onIt = await message();
    const encryption = await stateEventId(encrypted, "m.room.encryption");
    const elsewhere = await message((await startConversation({})) as string);
    const attempts: unknown[] = [
      { ...MEGOLM, ...reply("$nothere") },
      { ...MEGOLM, ...reply(encryption) },
      { ...MEGOLM, ...reply(elsewhere) },
      { ...MEGOLM, "m.relates_to": { rel_type: "m.replace", event_id: onIt } },
      { ...MEGOLM, "m.relates_to": { rel_type: "m.thread", event_id: onIt, is_falling_back: true } },
      { ...MEGOLM, "m.relates_to": { "m.in_reply_to": { event_id: onIt }, rel_type: "m.thread", event_id: onIt } },
      { ...MEGOLM, "m.relates_to": { "m.in_reply_to": { event_id: onIt, extra: 1 } } },
      { ...MEGOLM, "m.relates_to": { "m.in_reply_to": { event_id: onIt }, is_falling_back: false } },
      { ...MEGOLM, "m.relates_to": { "m.in_reply_to": onIt } },
    ];
    const sent = await outcomes(attempts, (content) => send(encrypted, "m.room.encrypted", content));
    expect(sent.map(({ item, status }) => ({ item, status: status === 400 ? 403 : status }))).toEqual(
      attempts.map((item) => ({ item, status: 403 })),
    );
  });
});
