// The adapter's own decisions, as values (ADR 0088 decision 3): which store an account opens (when this browser counts as locked is
// recovery.ts phaseOf, tested beside it). The SDK calls themselves run in a real browser against a stand-in homeserver
// (tests/e2e/chat-page.chromium.spec.ts), the homeserver being the unmanaged dependency (TE-1).
import { describe, expect, test } from "vitest";
import { storePrefix } from "./client.ts";

describe("storePrefix", () => {
  test("chat.store_per_account: two accounts in one browser never name the same key store", () => {
    const a = storePrefix("@aaaaaaaaaa:unset.cc");
    const b = storePrefix("@bbbbbbbbbb:unset.cc");
    expect(a).not.toBe(b);
    expect(a).toBe("unset-chat:@aaaaaaaaaa:unset.cc");
    expect(storePrefix("@aaaaaaaaaa:unset.cc")).toBe(a);
  });
});
