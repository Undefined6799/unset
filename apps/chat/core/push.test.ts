// The page's half of the chat count (ADR 0082, ADR 0090 decision 1): it asks the door for a pushkey for the device it
// holds, same-origin and uncached, and takes only a well-formed answer. The door is a stand-in fetch (an unmanaged
// dependency, TE-1); the door's own side is tests/integration/chat-auth/door.test.ts.
import { describe, expect, test } from "vitest";
import { askPushKey } from "./push.ts";

const KEY = "k".repeat(43);
const URL_ = "http://chat-auth:8091/_matrix/push/v1/notify";
const deadline = () => AbortSignal.timeout(1000);

function door(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetchFn, calls };
}

describe("askPushKey", () => {
  test("chat.push_key: posts only the device, and returns the door's key and address", async () => {
    const d = door(200, { pushkey: KEY, url: URL_ });
    expect(await askPushKey(d.fetchFn, "DEVICEAAAA", deadline())).toEqual({ pushkey: KEY, url: URL_ });
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]?.url).toBe("/push/key");
    expect(d.calls[0]?.init).toMatchObject({
      method: "POST",
      body: JSON.stringify({ deviceId: "DEVICEAAAA" }),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
  });

  test("chat.push_key_refused: a refusal, a fault or an answer of the wrong shape is null", async () => {
    for (const d of [
      door(401, { error: "chat.no_session" }),
      door(200, { pushkey: "short", url: URL_ }),
      door(200, { pushkey: KEY, url: "http://elsewhere/notify" }),
      door(200, { pushkey: KEY }),
    ]) {
      expect(await askPushKey(d.fetchFn, "DEVICEAAAA", deadline())).toBeNull();
    }
    const broken = async () => {
      throw new TypeError("network");
    };
    expect(await askPushKey(broken, "DEVICEAAAA", deadline())).toBeNull();
  });
});
