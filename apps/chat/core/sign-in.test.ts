// The page's half of the sign-in hop (ADR 0099 decisions 2 and 4): the ticket leaves the address bar before anything
// is sent, it goes only to the door's redeem path, and what comes back is held as our own session type or refused
// with a fixed code. The door is the one unmanaged dependency here: a stand-in fetch answers for it (TE-1).
import { describe, expect, test } from "vitest";
import { hopPath, redeem, renewDelayMs, takeTicket } from "./sign-in.ts";

const KEY = Buffer.alloc(32, 9).toString("base64url");
const ANSWER = {
  accessToken: "mat_secret",
  userId: "@abcdefghij:unset.cc",
  deviceId: "ABCDEFGHIJ",
  expiresAt: "2026-11-21T12:00:00.000Z",
  storageKey: KEY,
  newDevice: false,
  returnTo: "/c/x",
};

/** A window with only what takeTicket touches; replaceState records the URL and drops the fragment. */
function page(hash: string) {
  const calls: string[] = [];
  const location = { pathname: "/sign-in/return", hash };
  const history = {
    replaceState: (_state: unknown, _title: string, url: string) => {
      location.hash = "";
      calls.push(url);
    },
  };
  return { location, history, calls };
}

function door(status: number, body: unknown) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { sent, fetchFn };
}

describe("takeTicket", () => {
  test("chat.ticket_stripped: the fragment leaves the address bar and history at once", () => {
    const tab = page("#ticket=abc");
    expect(takeTicket(tab)).toBe("abc");
    expect(tab.calls).toEqual(["/sign-in/return"]);
    expect(tab.location.hash).toBe("");
  });

  test.each([[""], ["#"], ["#ticket="], ["#other=1"], ["#ticket=a&ticket=b"]])(
    "chat.ticket_missing: %s gives no ticket, and the fragment still goes",
    (hash) => {
      const tab = page(hash);
      expect(takeTicket(tab)).toBeNull();
      expect(tab.calls).toEqual(["/sign-in/return"]);
    },
  );
});

describe("redeem", () => {
  test("chat.redeem_posts_ticket: one same-origin JSON POST to the redeem path, no referrer, no cache", async () => {
    const { sent, fetchFn } = door(200, ANSWER);
    await redeem(fetchFn, "abc", AbortSignal.timeout(1000));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("/sign-in/redeem");
    expect(sent[0]?.init).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({ ticket: "abc" });
  });

  test("chat.redeem_session: the answer becomes our session, the key as its 32 bytes", async () => {
    const outcome = await redeem(door(200, ANSWER).fetchFn, "abc", AbortSignal.timeout(1000));
    expect(outcome).toEqual({
      kind: "signed_in",
      returnTo: "/c/x",
      session: {
        accessToken: "mat_secret",
        userId: "@abcdefghij:unset.cc",
        deviceId: "ABCDEFGHIJ",
        expiresAtMs: Date.parse(ANSWER.expiresAt),
        storageKey: new Uint8Array(Buffer.alloc(32, 9)),
        newDevice: false,
      },
    });
  });

  test.each([
    ["a short key", { ...ANSWER, storageKey: Buffer.alloc(31).toString("base64url") }],
    ["no token", { ...ANSWER, accessToken: "" }],
    ["a bad user", { ...ANSWER, userId: "abc" }],
    ["a bad device", { ...ANSWER, deviceId: "a b" }],
    ["a bad time", { ...ANSWER, expiresAt: "soon" }],
    ["no new-device flag", { ...ANSWER, newDevice: "yes" }],
    ["an offsite return", { ...ANSWER, returnTo: "//evil.example" }],
    ["a full URL return", { ...ANSWER, returnTo: "https://evil.example/" }],
    ["not an object", ["x"]],
  ])("chat.redeem_malformed: %s is refused as chat.unavailable", async (_name, body) => {
    const outcome = await redeem(door(200, body).fetchFn, "abc", AbortSignal.timeout(1000));
    expect(outcome).toEqual({ kind: "refused", code: "chat.unavailable" });
  });

  test("chat.redeem_refused: the door's catalog code comes through; anything else is chat.unavailable", async () => {
    expect(await redeem(door(403, { error: "chat.state_mismatch" }).fetchFn, "a", AbortSignal.timeout(1000))).toEqual({
      kind: "refused",
      code: "chat.state_mismatch",
    });
    expect(await redeem(door(500, { error: "<b>x</b>" }).fetchFn, "a", AbortSignal.timeout(1000))).toEqual({
      kind: "refused",
      code: "chat.unavailable",
    });
    const offline = async () => Promise.reject(new TypeError("offline"));
    expect(await redeem(offline, "a", AbortSignal.timeout(1000))).toEqual({
      kind: "refused",
      code: "chat.unavailable",
    });
  });
});

describe("hopPath and renewDelayMs", () => {
  test("chat.hop_path: the door's sign-in with this page's path to come back to", () => {
    expect(hopPath("/")).toBe("/sign-in?return=%2F");
    expect(hopPath("/c/x?y=1")).toBe("/sign-in?return=%2Fc%2Fx%3Fy%3D1");
  });

  test("chat.renew_before_expiry: a minute before the token ends, never below zero", () => {
    expect(renewDelayMs(10 * 60_000, 0)).toBe(9 * 60_000);
    expect(renewDelayMs(30_000, 0)).toBe(0);
  });
});
