// P6.10a: a plain room's messages are deleted by Synapse's retention purge (element-hq/synapse v1.165.0
// docs/message_retention_policies.md), and an encrypted room's are not. The module pins every plain room to a 30-day
// policy; this server caps policies at 5 s (`allowed_lifetime_max`, which the stack sets to 30d) and runs the purge
// every second, so the rule under test is the production one with a shorter clock. Synapse's own tables are read
// inside the container: event_json holds each event's full JSON and event_search the search index.
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
  synapseRows,
} from "../../../support/synapse.ts";

const LIFETIME_MS = 5_000;
const THIRTY_DAYS_MS = 2_592_000_000;
const MEGOLM = {
  algorithm: "m.megolm.v1.aes-sha2",
  ciphertext: "AwgAEnB5bGlrZSBjaXBoZXJ0ZXh0",
  // Built at run time: a committed key-shaped string trips the secret scan (.github/.gitleaks.toml).
  sender_key: Buffer.from("sender-key").toString("base64").replace(/=+$/u, ""),
  device_id: "ALICEDEVICE",
  session_id: "c2Vzc2lvbi1pZA",
};

let synapse: Synapse;
let alice: MatrixUser;
let bob: MatrixUser;
let plain: string;
let encrypted: string;
let txn = 0;

const room = (id: string): string => `/rooms/${encodeURIComponent(id)}`;
const call = (user: MatrixUser, method: string, path: string, body?: unknown): Promise<Answer> =>
  clientCall(synapse, user, method, path, body);
async function send(id: string, type: string, content: unknown): Promise<string> {
  const sent = await call(alice, "PUT", `${room(id)}/send/${type}/t${++txn}`, content);
  expect(sent.status).toBe(200);
  return sent.body.event_id as string;
}
async function startConversation(extra: Record<string, unknown>): Promise<string> {
  const created = await call(alice, "POST", "/createRoom", {
    preset: "trusted_private_chat",
    invite: [bob.userId],
    ...extra,
  });
  expect(created.status).toBe(200);
  const id = created.body.room_id as string;
  expect((await call(bob, "POST", `/join/${encodeURIComponent(id)}`, {})).status).toBe(200);
  return id;
}
const stored = (ids: readonly string[]): unknown[] =>
  synapseRows(synapse, `SELECT event_id FROM event_json WHERE event_id IN (${ids.map(() => "?").join(",")})`, ids).map(
    ([id]) => id,
  );
async function timelineTypes(user: MatrixUser, id: string): Promise<string[]> {
  const page = await call(user, "GET", `${room(id)}/messages?dir=b&limit=100`);
  return (page.body.chunk as { type: string }[]).map((event) => event.type);
}

beforeAll(async () => {
  synapse = await startSynapse(undefined, { allowedLifetimeMax: `${LIFETIME_MS / 1000}s`, purgeInterval: "1s" });
  alice = await registerUser(synapse, "alice");
  bob = await registerUser(synapse, "bob");
  plain = await startConversation({
    initial_state: [{ type: "m.room.retention", state_key: "", content: { max_lifetime: THIRTY_DAYS_MS } }],
  });
  encrypted = await startConversation({ is_direct: true });
}, 180_000);
afterAll(stopAllSynapse, STOP_SYNAPSE_MS);

/** Waits until the purge has run past `ids`, which must then hold exactly `left`. */
async function purgedDownTo(ids: readonly string[], left: readonly string[]): Promise<void> {
  const until = Date.now() + 60_000;
  while (stored(ids).length > left.length && Date.now() < until) await new Promise((r) => setTimeout(r, 1_000));
  expect(stored(ids)).toEqual(left);
}

describe("a plain room's messages are purged and an encrypted room's are kept", () => {
  test("plain_messages_leave_the_database_and_every_member_view", { timeout: 150_000 }, async () => {
    const texts: string[] = [];
    for (const body of ["one", "two", "three"]) {
      texts.push(await send(plain, "m.room.message", { msgtype: "m.text", body }));
    }
    const [one, two, three] = texts as [string, string, string];
    const ciphertext = await send(encrypted, "m.room.encrypted", MEGOLM);
    expect(stored([...texts, ciphertext])).toHaveLength(4);
    // enable_search: false, so not even a plain body is indexed.
    expect(synapseRows(synapse, "SELECT count(*) FROM event_search", [])).toEqual([[0]]);

    // Synapse never purges a room's newest event (its forward extremity, storage/databases/main/purge_events.py):
    // the purge deletes everything before the newest expired event, which goes when a later message expires.
    await purgedDownTo(texts, [three]);
    const page = await call(bob, "GET", `${room(plain)}/messages?dir=b&limit=100`);
    const shown = (page.body.chunk as { event_id: string }[]).map((event) => event.event_id);
    expect(shown).not.toContain(one);
    expect(shown).not.toContain(two);
    expect((await call(bob, "GET", `${room(plain)}/event/${encodeURIComponent(one)}`)).status).toBe(404);
    const synced = JSON.stringify((await call(bob, "GET", "/sync?timeout=0")).body);
    expect([synced.includes(one), synced.includes(two)]).toEqual([false, false]);

    const four = await send(plain, "m.room.message", { msgtype: "m.text", body: "four" });
    await purgedDownTo([...texts, four], [four]);

    // The room, its members and its policy stay; only the messages go. Ciphertext has no policy and stays.
    const policy = await call(bob, "GET", `${room(plain)}/state/m.room.retention/`);
    expect(policy.body).toEqual({ max_lifetime: THIRTY_DAYS_MS });
    expect((await call(bob, "GET", "/joined_rooms")).body.joined_rooms).toContain(plain);
    expect(stored([ciphertext])).toEqual([ciphertext]);
    expect(await timelineTypes(bob, encrypted)).toContain("m.room.encrypted");
  });
});
