// Build step 10 (infrastructure/postgres/pushKeyStore.ts, migration 0040; ADR 0082, ADR 0090): the door's pushkeys and
// the chat count, against real Postgres connected as `chat_auth`, the door's own role (TE-2). A key is kept only as its
// hash on its own browser entry; a new key replaces the entry's last and keeps its number; a notification for a key
// no entry holds changes nothing; the member's number is the one counted last over their browsers; and the key and its
// number go with the entry (Log out, an ended device, erasure through core.erase_did's delete of door.browser).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { relative } from "node:path";
import type { Did } from "@unset/domains-identity";
import {
  type BrowserEntry,
  type BrowserKey,
  type ChatUser,
  type DeviceId,
  type LockKey,
  type PushKey,
  pushKeyHash,
  type SessionRef,
} from "@unset/domains-messaging";
import {
  createBrowserListStore,
  createPool,
  createPushKeyStore,
  type Pool,
  withClient,
} from "@unset/infrastructure-postgres";
import { createSealer, Keyring } from "@unset/infrastructure-seal";
import { afterAll, describe, expect, inject, test } from "vitest";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const connection = { host: provided.host, port: provided.port, ...provided.roles.chat_auth, database, ssl: false };
const door: Pool = createPool({ connection, service: "push-key-store-test", max: 4, connectTimeoutMs: 5000 });
afterAll(() => door.end());

const list = createBrowserListStore(door, createSealer(new Keyring("k1", new Map([["k1", randomBytes(32)]]))));
const keys = createPushKeyStore(door);
const deadline = () => AbortSignal.timeout(5000);
const SID = "s".repeat(43) as SessionRef;
const base32 = (length: number) =>
  Array.from(randomBytes(length), (b) => "abcdefghijklmnopqrstuvwxyz234567"[b % 32]).join("");
const newDid = () => `did:plc:${base32(24)}` as Did;
const newKey = () => randomBytes(32).toString("base64url") as PushKey;

let n = 0;
/** A browser signed in as `did` (a fresh member unless given), as the door's list keeps it. */
async function signedIn(did = newDid()): Promise<BrowserEntry> {
  const entry: BrowserEntry = {
    id: randomUUID(),
    did,
    user: `u${base32(20)}` as ChatUser,
    device: `PSH${String(n++).padStart(7, "0")}` as DeviceId,
    lockKey: randomBytes(32) as unknown as LockKey,
  };
  const browser = createHash("sha256").update(randomBytes(32)).digest() as unknown as BrowserKey;
  expect(await list.add(browser, entry, SID, deadline())).toBe("added");
  return entry;
}

describe("push key store", () => {
  test("door.push_record: a key issued to an entry records its member's number", async () => {
    const entry = await signedIn();
    const key = newKey();
    await keys.issue(entry, pushKeyHash(key), deadline());
    expect(await keys.latest(entry.did, deadline())).toBeNull();
    expect(await keys.record(pushKeyHash(key), 2, deadline())).toBe(true);
    expect(await keys.latest(entry.did, deadline())).toBe(2);
    expect(await keys.record(pushKeyHash(key), 0, deadline())).toBe(true);
    expect(await keys.latest(entry.did, deadline())).toBe(0);
  });

  test("door.push_only_hash: the row holds the key's sha256, never the key", async () => {
    const entry = await signedIn();
    const key = newKey();
    await keys.issue(entry, pushKeyHash(key), deadline());
    const { rows } = await withClient(door, null, (db) =>
      db.query<{ pushkey_hash: Buffer }>("SELECT pushkey_hash FROM door.push WHERE browser_id = $1", [entry.id]),
    );
    expect(rows.map((r) => r.pushkey_hash.toString("hex"))).toEqual([Buffer.from(pushKeyHash(key)).toString("hex")]);
  });

  test("door.push_replace: a new key replaces the entry's last one and keeps its number", async () => {
    const entry = await signedIn();
    const [first, second] = [newKey(), newKey()];
    await keys.issue(entry, pushKeyHash(first), deadline());
    await keys.record(pushKeyHash(first), 4, deadline());
    await keys.issue(entry, pushKeyHash(second), deadline());
    expect(await keys.record(pushKeyHash(first), 9, deadline())).toBe(false);
    expect(await keys.latest(entry.did, deadline())).toBe(4);
    expect(await keys.record(pushKeyHash(second), null, deadline())).toBe(true);
    expect(await keys.latest(entry.did, deadline())).toBe(4);
  });

  test("door.push_unknown: a key no entry holds records nothing for anyone", async () => {
    const entry = await signedIn();
    await keys.issue(entry, pushKeyHash(newKey()), deadline());
    expect(await keys.record(pushKeyHash(newKey()), 7, deadline())).toBe(false);
    expect(await keys.latest(entry.did, deadline())).toBeNull();
  });

  test("door.push_latest: over a member's browsers the number counted last wins; others are not mixed in", async () => {
    const did = newDid();
    const [a, b, stranger] = [await signedIn(did), await signedIn(did), await signedIn()];
    const [ka, kb, ks] = [newKey(), newKey(), newKey()];
    for (const [entry, key] of [
      [a, ka],
      [b, kb],
      [stranger, ks],
    ] as const)
      await keys.issue(entry, pushKeyHash(key), deadline());
    await keys.record(pushKeyHash(ka), 5, deadline());
    await keys.record(pushKeyHash(ks), 9, deadline());
    await keys.record(pushKeyHash(kb), 1, deadline());
    expect(await keys.latest(did, deadline())).toBe(1);
    expect(await keys.latest(stranger.did, deadline())).toBe(9);
  });

  test("door.push_follows_entry: when the entry is removed its key and number go with it", async () => {
    const entry = await signedIn();
    const key = newKey();
    await keys.issue(entry, pushKeyHash(key), deadline());
    await keys.record(pushKeyHash(key), 3, deadline());
    await list.remove(entry, deadline());
    expect(await keys.record(pushKeyHash(key), 3, deadline())).toBe(false);
    expect(await keys.latest(entry.did, deadline())).toBeNull();
  });
});
