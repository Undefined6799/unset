// The page's half of Log out (ADR 0083 decision 5): it asks the door to end the device this browser holds, naming only
// that device, same-origin and uncached, and reads the answer as done or not. The door is the unmanaged dependency
// here (TE-1); its own rule runs against real Postgres and chat-admin in tests/integration/chat-auth/door.test.ts.
import { describe, expect, test } from "vitest";
import { signOutDevice } from "./sign-out.ts";

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
