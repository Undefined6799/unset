// The page's half of Log out (ADR 0095 decision 5): it asks the door to end the device this browser holds, naming only
// that device, same-origin and uncached, and reads the answer as done or not. unset.sh's Log out reaches the page at
// /sign-out/return (Alex 2026-11-21): the ticket is spent first, and only once it buys this browser's own device does
// any other tab stop or any store open. The door is the unmanaged dependency here (TE-1); its own rule runs against
// real Postgres and chat-admin in tests/integration/chat-auth/door.test.ts.
import { describe, expect, test } from "vitest";
import type { ChatSession } from "./chat.ts";
import { redeemForSignOut, type SignOutSteps, signOutDevice, signOutHere } from "./sign-out.ts";

const door = (status: number, body: unknown) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, fetchFn };
};
const deadline = () => AbortSignal.timeout(5000);

describe("signOutDevice", () => {
  test("chat.sign_out_posts_device: one POST to the door's sign-out, naming only this browser's device", async () => {
    const d = door(200, { signedOut: true });
    expect(await signOutDevice(d.fetchFn, "ABCDEFGHIJ", deadline())).toBe(true);
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]?.url).toBe("/sign-out");
    expect(d.calls[0]?.init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(d.calls[0]?.init.body).toBe(JSON.stringify({ deviceId: "ABCDEFGHIJ" }));
  });

  test("chat.sign_out_not_done: any other answer, or none, is not done, so the page keeps its locked store", async () => {
    expect(await signOutDevice(door(503, { error: "chat.unavailable" }).fetchFn, "ABCDEFGHIJ", deadline())).toBe(false);
    expect(await signOutDevice(door(200, { signedOut: false }).fetchFn, "ABCDEFGHIJ", deadline())).toBe(false);
    const down = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await signOutDevice(down, "ABCDEFGHIJ", deadline())).toBe(false);
  });
});

const KEY = Buffer.alloc(32, 9).toString("base64url");
const MINTED = {
  accessToken: "mat_secret",
  userId: "@abcdefghij:unset.cc",
  deviceId: "ABCDEFGHIJ",
  expiresAt: "2026-11-21T12:00:00.000Z",
  storageKey: KEY,
};

describe("redeemForSignOut", () => {
  test("chat.sign_out_redeem_posts: the ticket to the door's sign-out redeem, same-origin, uncached, no referrer", async () => {
    const d = door(200, MINTED);
    const outcome = await redeemForSignOut(d.fetchFn, "the-ticket", deadline());
    expect(d.calls.map((c) => [c.url, c.init.body])).toEqual([
      ["/sign-out/redeem", JSON.stringify({ ticket: "the-ticket" })],
    ]);
    expect(d.calls[0]?.init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(outcome).toEqual({
      kind: "signed_in",
      session: {
        accessToken: "mat_secret",
        userId: "@abcdefghij:unset.cc",
        deviceId: "ABCDEFGHIJ",
        expiresAtMs: Date.parse(MINTED.expiresAt),
        storageKey: new Uint8Array(Buffer.alloc(32, 9)),
        newDevice: false,
      },
    });
  });

  test("chat.sign_out_redeem_refused: the door's code, or chat.unavailable for anything else", async () => {
    expect(await redeemForSignOut(door(403, { error: "chat.ticket_refused" }).fetchFn, "t", deadline())).toEqual({
      kind: "refused",
      code: "chat.ticket_refused",
    });
    for (const body of [{ ...MINTED, storageKey: "short" }, { ...MINTED, userId: "x" }, null]) {
      expect(await redeemForSignOut(door(200, body).fetchFn, "t", deadline())).toEqual({
        kind: "refused",
        code: "chat.unavailable",
      });
    }
  });
});

describe("signOutHere", () => {
  const SESSION = { deviceId: "ABCDEFGHIJ" } as ChatSession;
  /** Steps that record their order; `redeemed` is what the door answers, `held` whether the tab lock is had. */
  function steps(redeemed: "signed_in" | "refused", held = true, logOut: () => Promise<void> = async () => undefined) {
    const calls: string[] = [];
    const run: SignOutSteps = {
      redeem: async (ticket) => {
        calls.push(`redeem ${ticket}`);
        return redeemed === "signed_in" ? { kind: "signed_in", session: SESSION } : { kind: "refused", code: "chat.x" };
      },
      takeOver: async () => {
        calls.push("take_over");
        return held;
      },
      logOut: async (session) => {
        calls.push(`log_out ${session.deviceId}`);
        await logOut();
      },
      endDevice: async (session) => {
        calls.push(`end ${session.deviceId}`);
        return true;
      },
      leave: () => calls.push("leave"),
    };
    return { run, calls };
  }

  test("chat.sign_out_here_order: the ticket is spent, then other tabs stop, then Log out, then back to unset.sh", async () => {
    const { run, calls } = steps("signed_in");
    await signOutHere(run, "t");
    expect(calls).toEqual(["redeem t", "take_over", "log_out ABCDEFGHIJ", "leave"]);
  });

  test("chat.sign_out_here_forged: a ticket the door refuses stops no tab and deletes nothing", async () => {
    const { run, calls } = steps("refused");
    await signOutHere(run, "forged");
    expect(calls).toEqual(["redeem forged", "leave"]);
  });

  test("chat.sign_out_here_no_ticket: with no ticket nothing is sent", async () => {
    const { run, calls } = steps("signed_in");
    await signOutHere(run, null);
    expect(calls).toEqual(["leave"]);
  });

  test("chat.sign_out_here_no_lock: without the tab lock the store stays shut and the device is still ended", async () => {
    const { run, calls } = steps("signed_in", false);
    await signOutHere(run, "t");
    expect(calls).toEqual(["redeem t", "take_over", "end ABCDEFGHIJ", "leave"]);
  });

  test("chat.sign_out_here_fails: a Log out that throws still goes back to unset.sh", async () => {
    const { run, calls } = steps("signed_in", true, async () => {
      throw new Error("store");
    });
    await signOutHere(run, "t").catch(() => undefined);
    expect(calls.at(-1)).toBe("leave");
  });
});
