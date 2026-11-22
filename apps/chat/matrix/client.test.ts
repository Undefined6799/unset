// The adapter's own decisions, as values (ADR 0099 decision 3): which store an account opens (when this browser counts as locked is
// recovery.ts phaseOf, tested beside it). The SDK calls themselves run in a real browser against a stand-in homeserver
// (tests/e2e/chat-page.chromium.spec.ts), the homeserver being the unmanaged dependency (TE-1).
import { afterEach, describe, expect, test, vi } from "vitest";
import { chatClient, REQUEST_DEADLINE_MS, serialReports, storePrefix } from "./client.ts";

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

describe("serialReports", () => {
  /** A read the test answers by hand, as the crypto answers readFacts in its own time. */
  const pending = () => {
    const answers: ((facts: string) => void)[] = [];
    const read = () => new Promise<string>((resolve) => answers.push(resolve));
    return { read, answer: (n: number, facts: string) => answers[n]?.(facts) };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("chat.report_one_setup: two trust events during one read start one setup, so one key is shown", async () => {
    let busy = false;
    const setups: string[] = [];
    const { read, answer } = pending();
    // As setUp does, the act holds the page before it makes and shows a key.
    const report = serialReports(
      () => busy,
      read,
      async (facts) => {
        busy = true;
        setups.push(facts);
      },
    );
    void report();
    void report();
    answer(0, "setup");
    answer(1, "setup");
    await settle();
    expect(setups).toEqual(["setup"]);
  });

  test("chat.report_held_after_read: a read still under way when a setup starts acts on nothing", async () => {
    let busy = false;
    const acts: string[] = [];
    const { read, answer } = pending();
    const report = serialReports(
      () => busy,
      read,
      async (facts) => void acts.push(facts),
    );
    void report();
    busy = true; // a setup showing its key, an unlock or a Log out
    answer(0, "setup");
    await settle();
    expect(acts).toEqual([]);
  });

  test("chat.report_latest_facts: an earlier read that answers last paints nothing over the later one", async () => {
    const acts: string[] = [];
    const { read, answer } = pending();
    const report = serialReports(
      () => false,
      read,
      async (facts) => void acts.push(facts),
    );
    void report();
    void report();
    answer(1, "ready");
    await settle();
    answer(0, "locked");
    await settle();
    expect(acts).toEqual(["ready"]);
  });

  test("chat.report_current_in_act: a step the act awaits learns that a later report has started", async () => {
    const seen: boolean[] = [];
    let release: () => void = () => undefined;
    const { read, answer } = pending();
    const report = serialReports(
      () => false,
      read,
      async (facts, current) => {
        if (facts !== "first") return;
        await new Promise<void>((resolve) => (release = resolve)); // as registerOnce awaits the pusher
        seen.push(current());
      },
    );
    void report();
    answer(0, "first");
    await settle();
    void report();
    release();
    await settle();
    expect(seen).toEqual([false]);
  });
});
