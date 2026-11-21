// The page's half of the setup claim (ADR 0089): it posts the device it holds to the door, same-origin, no-store, and
// reads the door's answers into three outcomes. The door is the unmanaged dependency here (TE-1); its own rules run
// against real Postgres in tests/integration/chat-auth/door.test.ts.
import { describe, expect, test } from "vitest";
import { claimSetup, releaseSetup } from "./setup-claim.ts";

type Call = { url: string; init: RequestInit };
const door = (status: number, body: unknown) => {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, fetchFn };
};
const deadline = () => AbortSignal.timeout(5000);

describe("claimSetup", () => {
  test("chat.claim_posts_device: the claim names only this browser's device, same-origin and uncached", async () => {
    const d = door(200, { claimed: true });
    expect(await claimSetup(d.fetchFn, "ABCDEFGHIJ", deadline())).toBe("claimed");
    const [call] = d.calls;
    expect(call?.url).toBe("/setup/claim");
    expect(call?.init.method).toBe("POST");
    expect(call?.init.body).toBe(JSON.stringify({ deviceId: "ABCDEFGHIJ" }));
    expect(call?.init.credentials).toBe("same-origin");
    expect(call?.init.cache).toBe("no-store");
  });

  test("chat.claim_elsewhere: the door's 409 means another browser is setting up", async () => {
    expect(await claimSetup(door(409, { error: "chat.setup_elsewhere" }).fetchFn, "ABCDEFGHIJ", deadline())).toBe(
      "elsewhere",
    );
  });

  test("chat.claim_unavailable: any other answer, or none, is unavailable, never claimed", async () => {
    expect(await claimSetup(door(401, { error: "chat.no_session" }).fetchFn, "ABCDEFGHIJ", deadline())).toBe(
      "unavailable",
    );
    expect(await claimSetup(door(200, { claimed: false }).fetchFn, "ABCDEFGHIJ", deadline())).toBe("unavailable");
    const down = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await claimSetup(down, "ABCDEFGHIJ", deadline())).toBe("unavailable");
  });
});

describe("releaseSetup", () => {
  test("chat.release_posts_device: release posts the same device and reports whether the door took it", async () => {
    const d = door(200, { released: true });
    expect(await releaseSetup(d.fetchFn, "ABCDEFGHIJ", deadline())).toBe(true);
    expect(d.calls[0]?.url).toBe("/setup/release");
    expect(await releaseSetup(door(503, { error: "chat.unavailable" }).fetchFn, "ABCDEFGHIJ", deadline())).toBe(false);
  });
});
