// The adapter's own decisions, as values (ADR 0088 decision 3): which store an account opens, and when this browser
// counts as locked. The SDK calls themselves run in a real browser against a stand-in homeserver
// (tests/integration/chat-auth/chat-page.test.ts), the homeserver being the unmanaged dependency (TE-1).
import { describe, expect, test } from "vitest";
import { lockOf, storePrefix } from "./client.ts";

describe("storePrefix", () => {
  test("chat.store_per_account: two accounts in one browser never name the same key store", () => {
    const a = storePrefix("@aaaaaaaaaa:unset.cc");
    const b = storePrefix("@bbbbbbbbbb:unset.cc");
    expect(a).not.toBe(b);
    expect(a).toBe("unset-chat:@aaaaaaaaaa:unset.cc");
    expect(storePrefix("@aaaaaaaaaa:unset.cc")).toBe(a);
  });
});

describe("lockOf", () => {
  test.each([
    [{ crossSigningReady: false, deviceCrossSigned: false }, "locked"],
    [{ crossSigningReady: true, deviceCrossSigned: false }, "locked"],
    [{ crossSigningReady: false, deviceCrossSigned: true }, "locked"],
    [{ crossSigningReady: true, deviceCrossSigned: true }, "ready"],
  ] as const)("chat.lock_state: %o is %s", (facts, state) => {
    expect(lockOf(facts)).toBe(state);
  });
});
