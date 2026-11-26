// The pusher the page registers (ADR 0094 decision 1, ADR 0101 decision 1), through the SDK as it ships
// (matrix-js-sdk 43.0.0 MatrixClient.setPusher, POST /_matrix/client/v3/pushers/set, src/client.ts:7904-7907). The
// homeserver is a stand-in fetch (the unmanaged dependency, TE-1); the SDK is real.
import { createClient } from "matrix-js-sdk/lib/matrix.js";
import { describe, expect, test } from "vitest";
import { registerPusher } from "./pusher.ts";

const TARGET = { pushkey: "k".repeat(43), url: "http://chat-auth:8091/_matrix/push/v1/notify" };

function homeserver(status: number) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "null")) });
    return new Response(status === 200 ? "{}" : '{"errcode":"M_UNKNOWN"}', {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createClient({
    baseUrl: "https://unset.cc",
    userId: "@uaaaaaaaaaaaaaaaaaaaa:unset.cc",
    deviceId: "DEVICEAAAA",
    accessToken: "t",
    fetchFn,
  });
  return { client, calls };
}

describe("registerPusher", () => {
  test("chat.pusher_set: one http pusher with the door's key and address, event IDs only, no chat words", async () => {
    const hs = homeserver(200);
    expect(await registerPusher(hs.client, TARGET)).toBe(true);
    expect(hs.calls).toHaveLength(1);
    expect(hs.calls[0]?.url).toBe("https://unset.cc/_matrix/client/v3/pushers/set");
    expect(hs.calls[0]?.body).toEqual({
      kind: "http",
      app_id: "sh.unset.count",
      app_display_name: "unset.sh",
      device_display_name: "unset.sh count",
      lang: "en",
      pushkey: TARGET.pushkey,
      data: { url: TARGET.url, format: "event_id_only" },
      append: false,
    });
  });

  test("chat.pusher_refused: a homeserver that refuses leaves chat running and says false", async () => {
    const hs = homeserver(500);
    expect(await registerPusher(hs.client, TARGET)).toBe(false);
  });
});
