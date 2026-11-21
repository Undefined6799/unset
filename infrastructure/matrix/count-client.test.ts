// web's read of the chat count (ADR 0082 decision 5, ADR 0090 decision 2): one GET to the door's count port through
// net-guard's chat-count policy, a short timeout inside the page's deadline, and only a whole number or null taken
// back. The network is a double (the door is an unmanaged dependency, TE-1); the door's side is
// tests/integration/chat-auth/door.test.ts.
import type { Did } from "@unset/domains-identity";
import { type GuardedRequest, type NetGuard, NetGuardError, type Policy } from "@unset/infrastructure-net-guard";
import { describe, expect, test } from "vitest";
import { COUNT_TIMEOUT_MS, createChatCountClient } from "./count-client.ts";

const ORIGIN = "http://chat-auth:8091";
const DID = `did:plc:${"a".repeat(24)}` as Did;

function network(answer: { status: number; body: unknown } | Error) {
  const seen: { policy: Policy; request: GuardedRequest }[] = [];
  const guard = {
    request: async (policy: Policy, request: GuardedRequest) => {
      seen.push({ policy, request });
      if (answer instanceof Error) throw answer;
      return { status: answer.status, headers: {}, body: new TextEncoder().encode(JSON.stringify(answer.body)) };
    },
  } as unknown as NetGuard;
  return { guard, seen };
}

describe("createChatCountClient", () => {
  test("chat.count_read: one GET by DID through the door's internal policy, the number back", async () => {
    const { guard, seen } = network({ status: 200, body: { unread: 4 } });
    expect(await createChatCountClient(guard, ORIGIN).count(DID, AbortSignal.timeout(1000))).toBe(4);
    const [{ policy, request }] = seen as [(typeof seen)[number]];
    expect(policy).toEqual({ name: "chat-count", kind: "internal", origins: [ORIGIN] });
    expect(request).toMatchObject({ url: `${ORIGIN}/count?did=${encodeURIComponent(DID)}`, method: "GET" });
    expect(request.timeoutMs).toBe(COUNT_TIMEOUT_MS);
    expect(COUNT_TIMEOUT_MS).toBeLessThanOrEqual(500);
  });

  test("chat.count_none: no number yet, a refusal, a wrong shape or the door down is null", async () => {
    for (const answer of [
      { status: 200, body: { unread: null } },
      { status: 503, body: { error: "chat.unavailable" } },
      { status: 200, body: { unread: -1 } },
      { status: 200, body: { unread: "3" } },
      new NetGuardError("egress.timeout"),
    ]) {
      const { guard } = network(answer);
      expect(await createChatCountClient(guard, ORIGIN).count(DID, AbortSignal.timeout(1000))).toBeNull();
    }
  });
});
