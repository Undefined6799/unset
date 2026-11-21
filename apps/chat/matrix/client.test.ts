// The adapter's own decisions, as values (ADR 0099 decision 3): which store an account opens (when this browser counts as locked is
// recovery.ts phaseOf, tested beside it). The SDK calls themselves run in a real browser against a stand-in homeserver
// (tests/e2e/chat-page.chromium.spec.ts), the homeserver being the unmanaged dependency (TE-1).
import { afterEach, describe, expect, test, vi } from "vitest";
import { chatClient, REQUEST_DEADLINE_MS, storePrefix } from "./client.ts";

describe("storePrefix", () => {
  test("chat.store_per_account: two accounts in one browser never name the same key store", () => {
    const a = storePrefix("@aaaaaaaaaa:unset.cc");
    const b = storePrefix("@bbbbbbbbbb:unset.cc");
    expect(a).not.toBe(b);
    expect(a).toBe("unset-chat:@aaaaaaaaaa:unset.cc");
    expect(storePrefix("@aaaaaaaaaa:unset.cc")).toBe(a);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("chatClient", () => {
  test("chat.request_deadline: every call the client makes without its own timeout ends within the deadline (RE-1)", () => {
    const session = {
      accessToken: "t",
      userId: "@aaaaaaaaaa:unset.cc",
      deviceId: "DEVICEAAAA",
      expiresAtMs: 0,
      storageKey: new Uint8Array(32),
      newDevice: false,
    };
    const client = chatClient(session, "http://127.0.0.1:9", {});
    expect(client.http.opts.localTimeoutMs).toBe(REQUEST_DEADLINE_MS);
    expect(REQUEST_DEADLINE_MS).toBeLessThanOrEqual(30_000);
    client.stopClient();
  });
});

describe("chatClient's requests", () => {
  // staging.unset.cc sits behind Pangolin's login (Alex, 2026-11-21 ~19:30Z): the page's homeserver calls must carry
  // that same-origin cookie. The network is the unmanaged dependency, so fetch is the one double here (TE-1).
  test("chat.homeserver_calls_same_origin: each call goes with same-origin credentials, the SDK's other options unchanged", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal("fetch", async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ user_id: "@aaaaaaaaaa:unset.cc" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const session = {
      accessToken: "t",
      userId: "@aaaaaaaaaa:unset.cc",
      deviceId: "DEVICEAAAA",
      expiresAtMs: 0,
      storageKey: new Uint8Array(32),
      newDevice: false,
    };
    const client = chatClient(session, "https://unset.cc", {});
    await client.whoami();
    client.stopClient();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://unset.cc/_matrix/client/v3/account/whoami");
    expect(calls[0]?.init).toMatchObject({
      method: "GET",
      credentials: "same-origin",
      mode: "cors",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      headers: { Authorization: "Bearer t" },
    });
  });
});
