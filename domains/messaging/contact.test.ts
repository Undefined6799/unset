// The Message link's rule (build step 10; ADR 0082 decision 6, ADR 0090 decision 3): only a browser that holds the
// device it names may ask, and then learns a member's chat user only when the store finds one. The ports are doubles
// of Postgres (the integration test reads the view as chat_auth).
import type { Did } from "@unset/domains-identity";
import { describe, expect, test } from "vitest";
import type { BrowserEntry, BrowserKey, BrowserList, DeviceId, LockKey } from "./browser.ts";
import type { ChatUser } from "./chat-account.ts";
import { type ChatContacts, type ChatNames, chatContact, chatName } from "./contact.ts";

const ENTRY: BrowserEntry = {
  id: "00000000-0000-4000-8000-000000000001",
  did: `did:plc:${"a".repeat(24)}` as Did,
  user: `u${"a".repeat(20)}` as ChatUser,
  device: "AAAAAAAAAA" as DeviceId,
  lockKey: new Uint8Array(32) as LockKey,
};
const MINE = new Uint8Array(32).fill(1) as BrowserKey;
const THEM = `did:plc:${"b".repeat(24)}` as Did;
const THEIR_USER = `u${"b".repeat(20)}` as ChatUser;
const deadline = AbortSignal.timeout(5000);

function ports() {
  const asked: Did[] = [];
  const list = {
    findDevice: async (browser: BrowserKey, device: DeviceId) =>
      Buffer.from(browser).equals(Buffer.from(MINE)) && device === ENTRY.device ? ENTRY : null,
  } as unknown as BrowserList;
  const contacts: ChatContacts = {
    chatUserOf: async (did) => {
      asked.push(did);
      return did === THEM ? THEIR_USER : null;
    },
  };
  return { list, contacts, asked };
}

describe("chatContact", () => {
  test("door.contact: a signed-in browser learns the member's chat user", async () => {
    const p = ports();
    expect(await chatContact(p, { browser: MINE, device: ENTRY.device, did: THEM, deadline })).toEqual({
      kind: "found",
      user: THEIR_USER,
    });
  });

  test("door.contact_missing: a member the store does not find reads as missing", async () => {
    const p = ports();
    const did = `did:plc:${"c".repeat(24)}` as Did;
    expect(await chatContact(p, { browser: MINE, device: ENTRY.device, did, deadline })).toEqual({ kind: "missing" });
  });

  test("door.contact_denied: without the device the store is never asked", async () => {
    const p = ports();
    const other = new Uint8Array(32).fill(2) as BrowserKey;
    expect(await chatContact(p, { browser: other, device: ENTRY.device, did: THEM, deadline })).toEqual({
      kind: "no_session",
    });
    expect(p.asked).toEqual([]);
  });
});

describe("chatName", () => {
  const names = () => {
    const asked: ChatUser[] = [];
    const store: ChatNames = {
      nameOf: async (user) => {
        asked.push(user);
        if (user === THEIR_USER) return "Bea";
        if (user === LONG_USER) return "x".repeat(641);
        return user === EMPTY_USER ? "" : null;
      },
    };
    return { ...ports(), names: store, asked };
  };
  const LONG_USER = `u${"c".repeat(20)}` as ChatUser;
  const EMPTY_USER = `u${"d".repeat(20)}` as ChatUser;

  test("door.name: a signed-in browser learns the member's public name", async () => {
    const p = names();
    expect(await chatName(p, { browser: MINE, device: ENTRY.device, user: THEIR_USER, deadline })).toEqual({
      kind: "found",
      name: "Bea",
    });
  });

  test("door.name_missing: unknown, empty or longer than the lexicon allows all read as missing", async () => {
    const p = names();
    for (const user of [`u${"e".repeat(20)}` as ChatUser, EMPTY_USER, LONG_USER]) {
      expect(await chatName(p, { browser: MINE, device: ENTRY.device, user, deadline })).toEqual({ kind: "missing" });
    }
  });

  test("door.name_denied: without the device the store is never asked", async () => {
    const p = names();
    const other = new Uint8Array(32).fill(2) as BrowserKey;
    expect(await chatName(p, { browser: other, device: ENTRY.device, user: THEIR_USER, deadline })).toEqual({
      kind: "no_session",
    });
    expect(p.asked).toEqual([]);
  });
});
