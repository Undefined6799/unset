// The door's side of chat-admin (build step 6; ADR 0081 decisions 4 and 5): web's ticket is passed on untouched with
// the browser's device, and session.end is signed with the door's own key; chat-admin's answers map to the messaging
// domain's outcomes, and nothing it says but a well-formed session counts as one. The network is a double (TE-1);
// tests/integration/chat-auth/door.test.ts runs the client against chat-admin itself.
import { generateKeyPairSync, verify } from "node:crypto";
import type { ChatUser, DeviceId } from "@unset/domains-messaging";
import { type GuardedRequest, type NetGuard, NetGuardError } from "@unset/infrastructure-net-guard";
import { canonicalize } from "@unset/shared-admin-envelope";
import { describe, expect, test } from "vitest";
import { createDoorChatAdminClient } from "./door-client.ts";

const USER = `u${"d".repeat(20)}` as ChatUser;
const DEVICE = "DEVICEAAAA" as DeviceId;
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const settings = { origin: "http://chat-admin:8080", env: "dev", key: { kid: "door-1", privateKey } } as const;
const deadline = () => AbortSignal.timeout(5000);

function network(answer: { status: number; body: unknown } | Error) {
  const seen: GuardedRequest[] = [];
  const guard = {
    request: async (_policy: unknown, request: GuardedRequest) => {
      seen.push(request);
      if (answer instanceof Error) throw answer;
      return { status: answer.status, headers: {}, body: new TextEncoder().encode(JSON.stringify(answer.body)) };
    },
  } as unknown as NetGuard;
  return { client: createDoorChatAdminClient(guard, settings, () => 1_800_000_000_000), seen };
}
const sent = (request: GuardedRequest | undefined) =>
  JSON.parse(new TextDecoder().decode(request?.body as Uint8Array)) as Record<string, unknown>;

describe("mint", () => {
  test("door.client_mint_passes_ticket: the envelope goes as `ticket` beside the device, unchanged", async () => {
    const { client, seen } = network({ status: 200, body: { token: "mat_x", device: DEVICE, expiresIn: 3600 } });
    const envelope = { kid: "web-1", sig: "s", payload: { verb: "session.mint" } };
    expect(await client.mint(envelope, DEVICE, deadline())).toEqual({
      kind: "minted",
      token: "mat_x",
      device: DEVICE,
      expiresInS: 3600,
    });
    expect(seen[0]?.url).toBe("http://chat-admin:8080/v1/session.mint");
    expect(sent(seen[0])).toEqual({ ticket: envelope, device: DEVICE });
    expect(seen[0]?.timeoutMs).toBeLessThanOrEqual(8000);
  });

  test.each([
    [{ status: 409, body: { error: "device_ended" } }, { kind: "device_ended" }],
    [{ status: 403, body: { error: "denied" } }, { kind: "refused" }],
    [{ status: 409, body: { error: "no_account" } }, { kind: "refused" }],
    [{ status: 400, body: { error: "bad_request" } }, { kind: "refused" }],
    [{ status: 429, body: { error: "quota" } }, { kind: "unavailable" }],
    [{ status: 503, body: { error: "unavailable" } }, { kind: "unavailable" }],
    [{ status: 200, body: { token: "", device: DEVICE, expiresIn: 3600 } }, { kind: "unavailable" }],
    [{ status: 200, body: { token: "t", device: "bad", expiresIn: 3600 } }, { kind: "unavailable" }],
    [{ status: 200, body: { token: "t", device: DEVICE, expiresIn: -1 } }, { kind: "unavailable" }],
  ])("door.client_mint_answers: %j is %j", async (answer, outcome) => {
    expect(await network(answer).client.mint({}, null, deadline())).toEqual(outcome);
  });

  test("door.client_mint_down: a network failure is unavailable", async () => {
    const { client } = network(new NetGuardError("egress.timeout"));
    expect(await client.mint({}, null, deadline())).toEqual({ kind: "unavailable" });
  });
});

describe("end", () => {
  test("door.client_end_signed: session.end for the user and device, signed with the door's key", async () => {
    const { client, seen } = network({ status: 200, body: { ended: 1 } });
    expect(await client.end(USER, DEVICE, deadline())).toEqual({ kind: "ended" });
    expect(seen[0]?.url).toBe("http://chat-admin:8080/v1/session.end");
    const envelope = sent(seen[0]) as { kid: string; sig: string; payload: Record<string, string | number> };
    expect(envelope.kid).toBe("door-1");
    expect(envelope.payload).toMatchObject({ verb: "session.end", user: USER, device: DEVICE, did: "", state: "" });
    const bytes = Buffer.from(canonicalize(envelope.payload));
    expect(verify(null, bytes, publicKey, Buffer.from(envelope.sig, "base64url"))).toBe(true);
  });

  test("door.client_end_refused: any answer but 200 is unavailable, so Log out keeps the entry", async () => {
    expect(await network({ status: 403, body: { error: "denied" } }).client.end(USER, DEVICE, deadline())).toEqual({
      kind: "unavailable",
    });
  });
});
