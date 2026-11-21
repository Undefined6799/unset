// The chat count's rules (build step 10; ADR 0082, ADR 0090): only a browser that holds the device it names gets a
// pushkey, a new one replacing its last; a notification records the number for the keys the door issued and lists every
// other key as rejected; the member's number is the latest one counted. The ports are doubles of Postgres (the
// integration test runs the store against real Postgres as chat_auth).
import type { Did } from "@unset/domains-identity";
import { describe, expect, test } from "vitest";
import type { BrowserEntry, BrowserKey, BrowserList, DeviceId, LockKey } from "./browser.ts";
import type { ChatUser } from "./chat-account.ts";
import {
  chatCount,
  issuePushKey,
  type PushKey,
  type PushKeyHash,
  type PushKeys,
  parsePushKey,
  pushKeyHash,
  recordCount,
} from "./push.ts";

const ENTRY: BrowserEntry = {
  id: "00000000-0000-4000-8000-000000000001",
  did: `did:plc:${"a".repeat(24)}` as Did,
  user: `u${"a".repeat(20)}` as ChatUser,
  device: "AAAAAAAAAA" as DeviceId,
  lockKey: new Uint8Array(32) as LockKey,
};
const MINE = new Uint8Array(32).fill(1) as BrowserKey;
const THEIRS = new Uint8Array(32).fill(2) as BrowserKey;
const deadline = AbortSignal.timeout(5000);
const hex = (hash: PushKeyHash) => Buffer.from(hash).toString("hex");

function ports(known: readonly PushKey[] = []) {
  const calls: string[] = [];
  const list = {
    findDevice: async (browser: BrowserKey, device: DeviceId) =>
      Buffer.from(browser).equals(Buffer.from(MINE)) && device === ENTRY.device ? ENTRY : null,
  } as unknown as BrowserList;
  const held = new Set(known.map((key) => hex(pushKeyHash(key))));
  const keys: PushKeys = {
    issue: async (entry, hash) => void calls.push(`issue ${entry.id} ${hex(hash)}`),
    record: async (hash, unread) => {
      calls.push(`record ${hex(hash)} ${unread}`);
      return held.has(hex(hash));
    },
    latest: async (did) => (did === ENTRY.did ? 3 : null),
  };
  return { list, keys, random: (n: number) => Buffer.alloc(n, 7), calls };
}

const KEY = parsePushKey(Buffer.alloc(32, 7).toString("base64url")) as PushKey;
const OTHER = parsePushKey(Buffer.alloc(32, 9).toString("base64url")) as PushKey;

describe("parsePushKey", () => {
  test("door.pushkey_shape: 32 random bytes in base64url and nothing else", () => {
    expect(KEY).toHaveLength(43);
    for (const bad of ["", "a".repeat(42), "a".repeat(44), `${"a".repeat(42)}+`, 7, null]) {
      expect(parsePushKey(bad)).toBeNull();
    }
  });
});

describe("issuePushKey", () => {
  test("door.pushkey_issue: the holder of the device gets a new key; only its hash is kept, on its own entry", async () => {
    const p = ports();
    expect(await issuePushKey(p, { browser: MINE, device: ENTRY.device, deadline })).toEqual({
      kind: "issued",
      key: KEY,
    });
    expect(p.calls).toEqual([`issue ${ENTRY.id} ${hex(pushKeyHash(KEY))}`]);
    expect(hex(pushKeyHash(KEY))).not.toContain(Buffer.from(KEY).toString("hex"));
  });

  test("door.pushkey_denied: another browser, or a device this browser does not hold, gets nothing", async () => {
    const p = ports();
    expect(await issuePushKey(p, { browser: THEIRS, device: ENTRY.device, deadline })).toEqual({ kind: "no_session" });
    const elsewhere = "BBBBBBBBBB" as DeviceId;
    expect(await issuePushKey(p, { browser: MINE, device: elsewhere, deadline })).toEqual({ kind: "no_session" });
    expect(p.calls).toEqual([]);
  });
});

describe("recordCount", () => {
  test("door.notify_known: the number is recorded for a key the door issued; nothing is rejected", async () => {
    const p = ports([KEY]);
    expect(await recordCount(p, { keys: [KEY], unread: 2, deadline })).toEqual([]);
    expect(p.calls).toEqual([`record ${hex(pushKeyHash(KEY))} 2`]);
  });

  test("door.notify_unknown: a key the door does not hold is rejected, so the homeserver drops its pusher", async () => {
    const p = ports([KEY]);
    expect(await recordCount(p, { keys: [OTHER, KEY], unread: null, deadline })).toEqual([OTHER]);
  });
});

describe("chatCount", () => {
  test("door.count_latest: the member's latest number, or null when none was counted", async () => {
    const p = ports();
    expect(await chatCount(p, ENTRY.did, deadline)).toBe(3);
    expect(await chatCount(p, `did:plc:${"b".repeat(24)}` as Did, deadline)).toBeNull();
  });
});
