// Build step 6 (infrastructure/postgres/browserListStore.ts, migration 0045; ADR 0093 decision 4, ADR 0095 decision
// 4): the door's browser list, against real Postgres connected as `chat_auth`, the door's own role (TE-2). An entry is
// found only through its own browser; a second account on the browser gets its own entry; the lock key is sealed to
// its row; a lost race to add is `taken`; the role can reach nothing outside its schema.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { relative } from "node:path";
import type { Did } from "@unset/domains-identity";
import type { BrowserEntry, BrowserKey, ChatUser, DeviceId, LockKey, SessionRef } from "@unset/domains-messaging";
import { createBrowserListStore, createPool, type Pool, withClient } from "@unset/infrastructure-postgres";
import { createSealer, Keyring } from "@unset/infrastructure-seal";
import { afterAll, describe, expect, inject, test } from "vitest";

const provided = inject("postgres");
const database = provided.databases[relative(`${import.meta.dirname}/../../..`, import.meta.filename)] ?? "";
const connection = { host: provided.host, port: provided.port, ...provided.roles.chat_auth, database, ssl: false };
const door: Pool = createPool({ connection, service: "browser-list-store-test", max: 4, connectTimeoutMs: 5000 });
afterAll(() => door.end());

const sealer = createSealer(new Keyring("k1", new Map([["k1", randomBytes(32)]])));
const list = createBrowserListStore(door, sealer);
const deadline = () => AbortSignal.timeout(5000);

const browser = () => createHash("sha256").update(randomBytes(32)).digest() as unknown as BrowserKey;
const sid = (fill: string) => fill.repeat(43).slice(0, 43) as SessionRef;
let n = 0;
function entry(did: Did, device = `DEV${String(n++).padStart(7, "0")}`): BrowserEntry {
  return {
    id: randomUUID(),
    did,
    user: `u${"b".repeat(20)}` as ChatUser,
    device: device as DeviceId,
    lockKey: randomBytes(32) as unknown as LockKey,
  };
}
const A = `did:plc:${"a".repeat(24)}` as Did;
const B = `did:plc:${"b".repeat(24)}` as Did;

describe("browser list store", () => {
  test("door.browser_add_find: an added entry reads back with its lock key, by account and by device", async () => {
    const mine = browser();
    const added = entry(A);
    expect(await list.add(mine, added, sid("s"), deadline())).toBe("added");
    expect(await list.find(mine, A, deadline())).toEqual(added);
    expect(await list.findDevice(mine, added.device, deadline())).toEqual(added);
    expect(await list.holdsAny(mine, deadline())).toBe(true);
  });

  test("door.browser_scoped: another browser finds nothing, by account or by device (hidden reads as missing)", async () => {
    const mine = browser();
    const added = entry(A);
    await list.add(mine, added, sid("s"), deadline());
    const theirs = browser();
    expect(await list.find(theirs, A, deadline())).toBeNull();
    expect(await list.findDevice(theirs, added.device, deadline())).toBeNull();
    expect(await list.holdsAny(theirs, deadline())).toBe(false);
  });

  test("door.browser_per_account: a second account on one browser has its own entry; the first stays", async () => {
    const shared = browser();
    const first = entry(A);
    const second = entry(B);
    await list.add(shared, first, sid("s"), deadline());
    expect(await list.add(shared, second, sid("t"), deadline())).toBe("added");
    expect(await list.find(shared, A, deadline())).toEqual(first);
    expect(await list.find(shared, B, deadline())).toEqual(second);
  });

  test("door.browser_add_race: a second add for the same browser and account is taken and changes nothing", async () => {
    const mine = browser();
    const winner = entry(A);
    await list.add(mine, winner, sid("s"), deadline());
    expect(await list.add(mine, entry(A), sid("t"), deadline())).toBe("taken");
    expect(await list.find(mine, A, deadline())).toEqual(winner);
  });

  test("door.browser_renew: a renewal keeps device and key, and fails on an entry that is gone", async () => {
    const mine = browser();
    const added = entry(A);
    await list.add(mine, added, sid("s"), deadline());
    expect(await list.renew(added, sid("t"), deadline())).toBe(true);
    expect(await list.find(mine, A, deadline())).toEqual(added);
    await list.remove(added, deadline());
    expect(await list.renew(added, sid("u"), deadline())).toBe(false);
  });

  test("door.browser_signed_in_from: an entry names the web session that last added or renewed it, and no other", async () => {
    const mine = browser();
    const added = entry(A);
    await list.add(mine, added, sid("s"), deadline());
    expect(await list.signedInFrom(added, sid("s"), deadline())).toBe(true);
    expect(await list.signedInFrom(added, sid("t"), deadline())).toBe(false);
    await list.renew(added, sid("t"), deadline());
    expect(await list.signedInFrom(added, sid("t"), deadline())).toBe(true);
    expect(await list.signedInFrom(added, sid("s"), deadline())).toBe(false);
    await list.remove(added, deadline());
    expect(await list.signedInFrom(added, sid("t"), deadline())).toBe(false);
  });

  test("door.browser_remove: remove deletes the entry and its key, and a second remove is no error", async () => {
    const mine = browser();
    const added = entry(A);
    await list.add(mine, added, sid("s"), deadline());
    await list.remove(added, deadline());
    expect(await list.find(mine, A, deadline())).toBeNull();
    expect(await list.holdsAny(mine, deadline())).toBe(false);
    await expect(list.remove(added, deadline())).resolves.toBeUndefined();
  });

  test("door.browser_sealed: the stored lock key is a seal envelope bound to its row, never the key", async () => {
    const mine = browser();
    const added = entry(A);
    await list.add(mine, added, sid("s"), deadline());
    const { rows } = await withClient(door, null, (db) =>
      db.query<{ lock_key: string }>("SELECT lock_key FROM door.browser WHERE id = $1 AND did = $2", [added.id, A]),
    );
    const stored = rows[0]?.lock_key ?? "";
    expect(stored).toMatch(/^s1\.k1\./);
    expect(stored).not.toContain(Buffer.from(added.lockKey).toString("base64"));
    expect(stored).not.toContain(Buffer.from(added.lockKey).toString("base64url"));
  });

  test("door.role_confined: chat_auth reads no app table and cannot rewrite who or which device an entry is", async () => {
    const mine = browser();
    const added = entry(A);
    await list.add(mine, added, sid("s"), deadline());
    const run = (sql: string) => withClient(door, null, (db) => db.query(sql, [added.id]));
    await expect(run("SELECT did FROM app.account WHERE did = $1::text")).rejects.toThrow(/permission denied/);
    await expect(run("UPDATE door.browser SET did = 'did:plc:x' WHERE id = $1")).rejects.toThrow(/permission denied/);
    await expect(run("UPDATE door.browser SET device_id = 'AAAAAAAAAA' WHERE id = $1")).rejects.toThrow(
      /permission denied/,
    );
    await expect(run("UPDATE door.browser SET lock_key = lock_key WHERE id = $1")).rejects.toThrow(/permission denied/);
  });
});
