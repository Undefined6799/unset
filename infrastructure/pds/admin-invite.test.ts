import { generateKeyPairSync, verify } from "node:crypto";
import type { Did } from "@unset/domains-identity";
import { type GuardedRequest, type NetGuard, NetGuardError, type Policy } from "@unset/infrastructure-net-guard";
import { canonicalize } from "@unset/shared-admin-envelope";
import { describe, expect, test } from "vitest";
import { createInviteIssuer } from "./admin-invite.ts";

const ALICE = "did:plc:aliceaaaaaaaaaaaaaaaaaaa" as Did;
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const settings = {
  origin: "http://pds-admin:8080",
  env: "dev",
  pdsDid: "did:web:pds.example.com",
  key: { kid: "web-1", privateKey },
} as const;

/** A double of the network: records the request, answers `status` and `body` or throws. */
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

describe("issueInvite", () => {
  test("posts one signed envelope for the member, through the pds-admin policy", async () => {
    const { guard, seen } = network({ status: 200, body: { code: "c-1", remaining: 4, availableAt: null } });
    expect(await createInviteIssuer(guard, settings, () => 1_800_000_000_000)(ALICE)).toEqual({
      kind: "ok",
      code: "c-1",
      remaining: 4,
      availableAt: null,
    });
    const [{ policy, request }] = seen as [(typeof seen)[number]];
    expect(policy).toEqual({ name: "pds-admin", kind: "internal", origins: ["http://pds-admin:8080"] });
    expect(request.url).toBe("http://pds-admin:8080/v1/invite.issue");
    const envelope = JSON.parse(new TextDecoder().decode(request.body as Uint8Array));
    expect(envelope.payload).toMatchObject({ target: ALICE, actor_did: ALICE, iat: 1_800_000_000, exp: 1_800_000_060 });
    expect(
      verify(null, Buffer.from(canonicalize(envelope.payload)), publicKey, Buffer.from(envelope.sig, "base64url")),
    ).toBe(true);
  });

  test.each([
    [
      "429",
      { status: 429, body: { error: "quota", availableAt: "2026-11-19T00:00:00.000Z" } },
      { kind: "quota", availableAt: "2026-11-19T00:00:00.000Z" },
    ],
    ["409", { status: 409, body: { error: "signups_closed" } }, { kind: "closed" }],
    ["403", { status: 403, body: { error: "denied" } }, { kind: "denied" }],
    ["503", { status: 503, body: { error: "unavailable" } }, { kind: "unavailable" }],
    ["200 with a bad shape", { status: 200, body: { code: 7 } }, { kind: "unavailable" }],
    ["a NetGuardError", new NetGuardError("egress.private_address"), { kind: "unavailable" }],
  ] as const)("web.issueInvite_mapping: %s", async (_name, answer, expected) => {
    const { guard } = network(answer as never);
    expect(await createInviteIssuer(guard, settings)(ALICE)).toEqual(expected);
  });
});
