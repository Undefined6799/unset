// The setup claim's rules (build step 8; ADR 0083 decision 2, ADR 0089): only a browser that holds the device it names
// may claim or release, the claim is always for that entry's own account, and a claim lasts SETUP_CLAIM_S. The ports
// are doubles of Postgres (the integration test runs the store against real Postgres as chat_auth).
import type { Did } from "@unset/domains-identity";
import { describe, expect, test } from "vitest";
import type { BrowserEntry, BrowserKey, BrowserList, DeviceId, LockKey } from "./browser.ts";
import type { ChatUser } from "./chat-account.ts";
import { claimSetup, releaseSetup, SETUP_CLAIM_S, type SetupClaims } from "./setup.ts";

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

function ports(answer: "claimed" | "elsewhere" = "claimed") {
  const calls: string[] = [];
  const list = {
    findDevice: async (browser: BrowserKey, device: DeviceId) =>
      Buffer.from(browser).equals(Buffer.from(MINE)) && device === ENTRY.device ? ENTRY : null,
  } as unknown as BrowserList;
  const claims: SetupClaims = {
    claim: async (entry, leaseS) => {
      calls.push(`claim ${entry.id} ${leaseS}`);
      return answer;
    },
    release: async (entry) => {
      calls.push(`release ${entry.id}`);
    },
  };
  return { list, claims, calls };
}

describe("claimSetup", () => {
  test("door.setup_claim: the holder of the device claims its account's setup for SETUP_CLAIM_S", async () => {
    const p = ports();
    expect(await claimSetup(p, { browser: MINE, device: ENTRY.device, deadline })).toEqual({ kind: "claimed" });
    expect(p.calls).toEqual([`claim ${ENTRY.id} ${SETUP_CLAIM_S}`]);
  });

  test("door.setup_elsewhere: another browser's live claim is reported, nothing else", async () => {
    const p = ports("elsewhere");
    expect(await claimSetup(p, { browser: MINE, device: ENTRY.device, deadline })).toEqual({ kind: "elsewhere" });
  });

  test("door.setup_denied: a browser without the device, or a device it does not hold, claims nothing", async () => {
    const p = ports();
    expect(await claimSetup(p, { browser: THEIRS, device: ENTRY.device, deadline })).toEqual({ kind: "no_session" });
    const other = "BBBBBBBBBB" as DeviceId;
    expect(await claimSetup(p, { browser: MINE, device: other, deadline })).toEqual({ kind: "no_session" });
    expect(p.calls).toEqual([]);
  });
});

describe("releaseSetup", () => {
  test("door.setup_release: the holder releases; a browser without the device releases nothing", async () => {
    const p = ports();
    expect(await releaseSetup(p, { browser: THEIRS, device: ENTRY.device, deadline })).toEqual({ kind: "no_session" });
    expect(p.calls).toEqual([]);
    expect(await releaseSetup(p, { browser: MINE, device: ENTRY.device, deadline })).toEqual({ kind: "released" });
    expect(p.calls).toEqual([`release ${ENTRY.id}`]);
  });
});
