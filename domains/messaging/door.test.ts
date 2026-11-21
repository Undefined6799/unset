// The door's rules (build step 6; ADR 0081 decision 4, ADR 0083 decision 4): a ticket is redeemed only in the browser
// that holds its one-time value; a browser's entry for an account gives back the same device and lock key; another
// account on the browser never reaches the first one's; Log out ends the device before it forgets the key. The ports
// are doubles of Postgres and chat-admin, so the rule is read without either (the integration test runs both real).
import type { Did } from "@unset/domains-identity";
import { describe, expect, test } from "vitest";
import type { BrowserEntry, BrowserKey, BrowserList, DeviceId, LockKey } from "./browser.ts";
import type { ChatUser } from "./chat-account.ts";
import {
  type AccessToken,
  type DoorPorts,
  type MintOutcome,
  readTicket,
  redeem,
  redeemForSignOut,
  signOut,
  type Ticket,
} from "./door.ts";
import type { DoorState, SessionRef } from "./sign-in.ts";

const ALICE = `did:plc:${"a".repeat(24)}` as Did;
const BOB = `did:plc:${"b".repeat(24)}` as Did;
const USER_A = `u${"a".repeat(20)}` as ChatUser;
const USER_B = `u${"b".repeat(20)}` as ChatUser;
const STATE = "S".repeat(43) as DoorState;
const SID = "s".repeat(43) as SessionRef;
const BROWSER = new Uint8Array(32).fill(1) as BrowserKey;
const NOW_S = 1_800_000_000;

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
function ticketFor(did = ALICE, user = USER_A, overrides: Record<string, unknown> = {}): Ticket {
  const payload = {
    v: 1,
    verb: "session.mint",
    did,
    user,
    sid: SID,
    state: STATE,
    iat: NOW_S,
    exp: NOW_S + 60,
    ...overrides,
  };
  const ticket = readTicket(encode({ kid: "web-1", sig: "x".repeat(86), payload }));
  if (ticket === null) throw new Error("ticket");
  return ticket;
}

/** An in-memory browser list and a chat-admin that answers `mint` and records every call. */
function ports(mint: MintOutcome | ((device: DeviceId | null) => MintOutcome) = { kind: "unavailable" }) {
  const rows: { browser: BrowserKey; entry: BrowserEntry; sid: SessionRef }[] = [];
  const calls: string[] = [];
  let keys = 0;
  const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
  const list: BrowserList = {
    find: async (browser, did) => rows.find((r) => same(r.browser, browser) && r.entry.did === did)?.entry ?? null,
    findDevice: async (browser, device) =>
      rows.find((r) => same(r.browser, browser) && r.entry.device === device)?.entry ?? null,
    add: async (browser, entry, sid) => {
      if (rows.some((r) => same(r.browser, browser) && r.entry.did === entry.did)) return "taken";
      rows.push({ browser, entry, sid });
      return "added";
    },
    renew: async (entry, sid) => {
      const row = rows.find((r) => r.entry.id === entry.id);
      if (row !== undefined) row.sid = sid;
      return row !== undefined;
    },
    signedInFrom: async (entry, sid) => rows.some((r) => r.entry.id === entry.id && r.sid === sid),
    remove: async (entry) => {
      const at = rows.findIndex((r) => r.entry.id === entry.id);
      if (at >= 0) rows.splice(at, 1);
    },
    holdsAny: async (browser) => rows.some((r) => same(r.browser, browser)),
  };
  const door: DoorPorts = {
    list,
    mint: async (_envelope, device) => {
      calls.push(`mint ${device ?? "new"}`);
      return typeof mint === "function" ? mint(device) : mint;
    },
    end: async (_user, device) => {
      calls.push(`end ${device}`);
      return { kind: "ended" };
    },
    newLockKey: () => new Uint8Array(32).fill(++keys) as LockKey,
    newId: () => `00000000-0000-4000-8000-00000000000${rows.length}`,
    nowS: () => NOW_S,
  };
  return { door, rows, calls };
}
const minted = (device: string): MintOutcome => ({
  kind: "minted",
  token: "tok" as AccessToken,
  device: device as DeviceId,
  expiresInS: 3600,
});
const deadline = AbortSignal.timeout(5000);

describe("readTicket", () => {
  test("door.ticket_parsed: web's encoded envelope gives its member, chat user, session, state and expiry", () => {
    const ticket = ticketFor();
    expect([ticket.did, ticket.user, ticket.sid, ticket.state, ticket.exp]).toEqual([
      ALICE,
      USER_A,
      SID,
      STATE,
      NOW_S + 60,
    ]);
  });

  test.each([
    ["not base64url json", "!!!"],
    ["no payload", encode({ kid: "k", sig: "s" })],
    [
      "another verb",
      encode({
        kid: "k",
        sig: "s",
        payload: { verb: "session.end", did: ALICE, user: USER_A, sid: SID, state: STATE, exp: 1 },
      }),
    ],
    [
      "a bad did",
      encode({
        kid: "k",
        sig: "s",
        payload: { verb: "session.mint", did: "alice", user: USER_A, sid: SID, state: STATE, exp: 1 },
      }),
    ],
    [
      "a bad state",
      encode({
        kid: "k",
        sig: "s",
        payload: { verb: "session.mint", did: ALICE, user: USER_A, sid: SID, state: "x", exp: 1 },
      }),
    ],
    ["an array", encode([1])],
  ])("door.ticket_malformed: %s reads as no ticket", (_why, raw) => {
    expect(readTicket(raw)).toBeNull();
  });
});

describe("redeem", () => {
  test("door.redeem_new_browser: a new device is minted, and its entry holds a fresh lock key", async () => {
    const { door, rows, calls } = ports(minted("DEVICEAAAA"));
    const out = await redeem(door, { ticket: ticketFor(), state: STATE, browser: BROWSER, deadline });
    expect(out).toMatchObject({ kind: "signed_in", token: "tok", expiresAtS: NOW_S + 3600, newDevice: true });
    expect(calls).toEqual(["mint new"]);
    expect(rows.map((r) => [r.entry.did, r.entry.user, r.entry.device])).toEqual([[ALICE, USER_A, "DEVICEAAAA"]]);
    expect(out.kind === "signed_in" && out.entry.lockKey).toEqual(new Uint8Array(32).fill(1));
  });

  test("door.redeem_renews: after expiry the same browser gets the same device and the same lock key", async () => {
    const { door, calls } = ports(minted("DEVICEAAAA"));
    const first = await redeem(door, { ticket: ticketFor(), state: STATE, browser: BROWSER, deadline });
    const again = await redeem(door, { ticket: ticketFor(), state: STATE, browser: BROWSER, deadline });
    expect(calls).toEqual(["mint new", "mint DEVICEAAAA"]);
    expect(again.kind === "signed_in" && again.entry).toEqual(first.kind === "signed_in" && first.entry);
    expect(again).toMatchObject({ newDevice: false });
  });

  test("door.redeem_no_state: with no one-time value in the browser nothing is sent to chat-admin", async () => {
    const { door, calls } = ports(minted("DEVICEAAAA"));
    expect(await redeem(door, { ticket: ticketFor(), state: null, browser: BROWSER, deadline })).toEqual({
      kind: "refused",
      code: "chat.no_state",
    });
    expect(calls).toEqual([]);
  });

  test("door.redeem_wrong_state: a ticket for another browser's value is refused before chat-admin", async () => {
    const { door, calls } = ports(minted("DEVICEAAAA"));
    const other = "T".repeat(43) as DoorState;
    expect(await redeem(door, { ticket: ticketFor(), state: other, browser: BROWSER, deadline })).toEqual({
      kind: "refused",
      code: "chat.state_mismatch",
    });
    expect(calls).toEqual([]);
  });

  test("door.redeem_expired: a ticket past its exp is refused before chat-admin", async () => {
    const { door, calls } = ports(minted("DEVICEAAAA"));
    const old = ticketFor(ALICE, USER_A, { exp: NOW_S - 1 });
    expect(await redeem(door, { ticket: old, state: STATE, browser: BROWSER, deadline })).toEqual({
      kind: "refused",
      code: "chat.ticket_expired",
    });
    expect(calls).toEqual([]);
  });

  test("door.redeem_other_account: a ticket for another member never reaches the first one's device or key", async () => {
    const devices = ["DEVICEAAAA", "DEVICEBBBB"];
    const { door, calls, rows } = ports((device) => minted(device ?? (devices.shift() as string)));
    const alice = await redeem(door, { ticket: ticketFor(), state: STATE, browser: BROWSER, deadline });
    const bob = await redeem(door, { ticket: ticketFor(BOB, USER_B), state: STATE, browser: BROWSER, deadline });
    expect(calls).toEqual(["mint new", "mint new"]);
    if (alice.kind !== "signed_in" || bob.kind !== "signed_in") throw new Error("signed in");
    expect(bob.entry.device).toBe("DEVICEBBBB");
    expect(Buffer.from(bob.entry.lockKey).equals(Buffer.from(alice.entry.lockKey))).toBe(false);
    expect(rows).toHaveLength(2);
  });

  test("door.redeem_refused: chat-admin's refusal (bad signature, replay, locked account) is a refusal", async () => {
    const { door, rows } = ports({ kind: "refused" });
    expect(await redeem(door, { ticket: ticketFor(), state: STATE, browser: BROWSER, deadline })).toEqual({
      kind: "refused",
      code: "chat.ticket_refused",
    });
    expect(rows).toEqual([]);
  });

  test("door.redeem_unavailable: chat-admin down is a typed unavailable and writes nothing", async () => {
    const { door, rows } = ports({ kind: "unavailable" });
    expect(await redeem(door, { ticket: ticketFor(), state: STATE, browser: BROWSER, deadline })).toEqual({
      kind: "refused",
      code: "chat.unavailable",
    });
    expect(rows).toEqual([]);
  });

  test("door.redeem_device_ended: a device chat-admin no longer has is forgotten, so the next hop starts fresh", async () => {
    let answer: MintOutcome = minted("DEVICEAAAA");
    const { door, rows } = ports(() => answer);
    await redeem(door, { ticket: ticketFor(), state: STATE, browser: BROWSER, deadline });
    answer = { kind: "device_ended" };
    expect(await redeem(door, { ticket: ticketFor(), state: STATE, browser: BROWSER, deadline })).toEqual({
      kind: "refused",
      code: "chat.device_ended",
    });
    expect(rows).toEqual([]);
  });

  test("door.redeem_race: a first sign-in that loses the race ends its own new device and says busy", async () => {
    const { door, calls } = ports(minted("DEVICEBBBB"));
    door.list.add(
      BROWSER,
      { id: "x", did: ALICE, user: USER_A, device: "DEVICEAAAA" as DeviceId, lockKey: new Uint8Array(32) as LockKey },
      SID,
      deadline,
    );
    const racing = { ...door, list: { ...door.list, find: async () => null } };
    expect(await redeem(racing, { ticket: ticketFor(), state: STATE, browser: BROWSER, deadline })).toEqual({
      kind: "refused",
      code: "chat.busy",
    });
    expect(calls).toEqual(["mint new", "end DEVICEBBBB"]);
  });

  test("door.redeem_device_mismatch: a renewal answered on another device is ended and refused", async () => {
    const { door, calls } = ports((device) => minted(device === null ? "DEVICEAAAA" : "DEVICECCCC"));
    await redeem(door, { ticket: ticketFor(), state: STATE, browser: BROWSER, deadline });
    expect(await redeem(door, { ticket: ticketFor(), state: STATE, browser: BROWSER, deadline })).toEqual({
      kind: "refused",
      code: "chat.unavailable",
    });
    expect(calls).toEqual(["mint new", "mint DEVICEAAAA", "end DEVICECCCC"]);
  });
});

describe("redeemForSignOut", () => {
  /** A browser signed in once, with every later write to its list recorded. */
  async function signedInBrowser(mint: Parameters<typeof ports>[0]) {
    const made = ports(mint);
    await redeem(made.door, { ticket: ticketFor(), state: STATE, browser: BROWSER, deadline });
    made.calls.length = 0;
    const list: BrowserList = {
      ...made.door.list,
      add: async (...args) => {
        made.calls.push("add");
        return made.door.list.add(...args);
      },
      renew: async (...args) => {
        made.calls.push("renew");
        return made.door.list.renew(...args);
      },
    };
    return { ...made, door: { ...made.door, list } };
  }

  test("door.sign_out_redeem_own_entry: a session on this browser's device, with its lock key, and no write", async () => {
    const { door, rows, calls } = await signedInBrowser((device) => minted(device ?? "DEVICEAAAA"));
    const outcome = await redeemForSignOut(door, { ticket: ticketFor(), browser: BROWSER, deadline });
    expect(outcome).toEqual({ kind: "minted", entry: rows[0]?.entry, token: "tok", expiresAtS: NOW_S + 3600 });
    expect(calls).toEqual(["mint DEVICEAAAA"]);
  });

  test("door.sign_out_redeem_no_entry: a browser without the member's entry sends nothing to chat-admin", async () => {
    const { door, calls } = await signedInBrowser((device) => minted(device ?? "DEVICEAAAA"));
    const other = new Uint8Array(32).fill(9) as BrowserKey;
    expect(await redeemForSignOut(door, { ticket: ticketFor(), browser: other, deadline })).toEqual({
      kind: "no_session",
    });
    expect(await redeemForSignOut(door, { ticket: ticketFor(BOB, USER_B), browser: BROWSER, deadline })).toEqual({
      kind: "no_session",
    });
    expect(calls).toEqual([]);
  });

  test("door.sign_out_redeem_expired: past its exp nothing is read or sent", async () => {
    const { door, calls } = await signedInBrowser((device) => minted(device ?? "DEVICEAAAA"));
    const ticket = ticketFor(ALICE, USER_A, { exp: NOW_S - 1 });
    expect(await redeemForSignOut(door, { ticket, browser: BROWSER, deadline })).toEqual({
      kind: "refused",
      code: "chat.ticket_expired",
    });
    expect(calls).toEqual([]);
  });

  test("door.sign_out_redeem_other_user: a ticket naming another chat user for this member is refused", async () => {
    const { door, calls } = await signedInBrowser((device) => minted(device ?? "DEVICEAAAA"));
    expect(await redeemForSignOut(door, { ticket: ticketFor(ALICE, USER_B), browser: BROWSER, deadline })).toEqual({
      kind: "refused",
      code: "chat.ticket_refused",
    });
    expect(calls).toEqual([]);
  });

  test("door.sign_out_redeem_other_session: a ticket from a session that did not sign this entry in is refused", async () => {
    const { door, calls } = await signedInBrowser((device) => minted(device ?? "DEVICEAAAA"));
    const ticket = ticketFor(ALICE, USER_A, { sid: "o".repeat(43) });
    expect(await redeemForSignOut(door, { ticket, browser: BROWSER, deadline })).toEqual({
      kind: "refused",
      code: "chat.ticket_refused",
    });
    expect(calls).toEqual([]);
  });

  test("door.sign_out_redeem_device_mismatch: a session on another device is ended and refused", async () => {
    const { door, calls } = await signedInBrowser((device) => minted(device === null ? "DEVICEAAAA" : "DEVICECCCC"));
    expect(await redeemForSignOut(door, { ticket: ticketFor(), browser: BROWSER, deadline })).toEqual({
      kind: "refused",
      code: "chat.unavailable",
    });
    expect(calls).toEqual(["mint DEVICEAAAA", "end DEVICECCCC"]);
  });

  test("door.sign_out_redeem_ended: a device chat-admin no longer has is forgotten", async () => {
    const { door, rows } = await signedInBrowser((device) =>
      device === null ? minted("DEVICEAAAA") : { kind: "device_ended" },
    );
    expect(await redeemForSignOut(door, { ticket: ticketFor(), browser: BROWSER, deadline })).toEqual({
      kind: "refused",
      code: "chat.device_ended",
    });
    expect(rows).toEqual([]);
  });
});

describe("signOut", () => {
  test("door.sign_out_ends_then_forgets: the device is ended, then the entry and its key are deleted", async () => {
    const { door, rows, calls } = ports(minted("DEVICEAAAA"));
    await redeem(door, { ticket: ticketFor(), state: STATE, browser: BROWSER, deadline });
    expect(await signOut(door, { browser: BROWSER, device: "DEVICEAAAA" as DeviceId, deadline })).toEqual({
      kind: "signed_out",
      browserEmpty: true,
    });
    expect(calls).toEqual(["mint new", "end DEVICEAAAA"]);
    expect(rows).toEqual([]);
  });

  test("door.sign_out_keeps_others: another account's entry on the browser stays, so the cookie stays", async () => {
    const devices = ["DEVICEAAAA", "DEVICEBBBB"];
    const { door, rows } = ports((device) => minted(device ?? (devices.shift() as string)));
    await redeem(door, { ticket: ticketFor(), state: STATE, browser: BROWSER, deadline });
    await redeem(door, { ticket: ticketFor(BOB, USER_B), state: STATE, browser: BROWSER, deadline });
    expect(await signOut(door, { browser: BROWSER, device: "DEVICEAAAA" as DeviceId, deadline })).toEqual({
      kind: "signed_out",
      browserEmpty: false,
    });
    expect(rows.map((r) => r.entry.did)).toEqual([BOB]);
  });

  test("door.sign_out_other_browser: a device of another browser is never ended (hidden reads as missing)", async () => {
    const { door, rows, calls } = ports(minted("DEVICEAAAA"));
    await redeem(door, { ticket: ticketFor(), state: STATE, browser: BROWSER, deadline });
    const other = new Uint8Array(32).fill(2) as BrowserKey;
    expect(await signOut(door, { browser: other, device: "DEVICEAAAA" as DeviceId, deadline })).toEqual({
      kind: "signed_out",
      browserEmpty: true,
    });
    expect(calls).toEqual(["mint new"]);
    expect(rows).toHaveLength(1);
  });

  test("door.sign_out_unavailable: with chat-admin down the entry is kept, so Log out can be tried again", async () => {
    const { door, rows } = ports(minted("DEVICEAAAA"));
    await redeem(door, { ticket: ticketFor(), state: STATE, browser: BROWSER, deadline });
    const down = { ...door, end: async () => ({ kind: "unavailable" }) as const };
    expect(await signOut(down, { browser: BROWSER, device: "DEVICEAAAA" as DeviceId, deadline })).toEqual({
      kind: "unavailable",
    });
    expect(rows).toHaveLength(1);
  });
});
