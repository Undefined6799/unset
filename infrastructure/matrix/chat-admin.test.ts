// web's side of chat-admin (ADR 0081 decision 5): one signed envelope per call, through net-guard's chat-admin policy,
// and chat-admin's answers mapped to the domain's outcomes. The network is a double (chat-admin is an unmanaged
// dependency, TE-1); tests/integration/chat-admin/web-client.test.ts runs the same client against chat-admin itself.
import { generateKeyPairSync, verify } from "node:crypto";
import type { Handle } from "@unset/domains-identity";
import type { ChatUser } from "@unset/domains-messaging";
import { type GuardedRequest, type NetGuard, NetGuardError, type Policy } from "@unset/infrastructure-net-guard";
import { canonicalize } from "@unset/shared-admin-envelope";
import { describe, expect, test } from "vitest";
import { createChatAdminClient } from "./chat-admin.ts";

const USER = `u${"d".repeat(20)}` as ChatUser;
const NAME = "a.unset.name" as Handle;
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const settings = { origin: "http://chat-admin:8080", env: "dev", key: { kid: "web-1", privateKey } } as const;

/** A double of the network: records each request, answers `status` and `body` or throws. */
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

describe("createAccount", () => {
  test("chat.client_signed_create: one envelope naming the user and the verified handle, through chat-admin's policy", async () => {
    const { guard, seen } = network({ status: 200, body: { created: true } });
    const client = createChatAdminClient(guard, settings, () => 1_800_000_000_000);
    expect(await client.createAccount(USER, NAME)).toEqual({ kind: "created" });
    const [{ policy, request }] = seen as [(typeof seen)[number]];
    expect(policy).toEqual({ name: "chat-admin", kind: "internal", origins: ["http://chat-admin:8080"] });
    expect(request).toMatchObject({ url: "http://chat-admin:8080/v1/account.create", method: "POST" });
    expect(request.timeoutMs).toBeLessThanOrEqual(8000);
    const envelope = JSON.parse(new TextDecoder().decode(request.body as Uint8Array));
    expect(envelope.kid).toBe("web-1");
    expect(envelope.payload).toEqual({
      v: 1,
      env: "dev",
      aud: "chat-admin",
      verb: "account.create",
      user: USER,
      name: NAME,
      device: "",
      did: "",
      sid: "",
      state: "",
      jti: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      iat: 1_800_000_000,
      exp: 1_800_000_060,
    });
    const bytes = Buffer.from(canonicalize(envelope.payload));
    expect(verify(null, bytes, publicKey, Buffer.from(envelope.sig, "base64url"))).toBe(true);
  });

  test("chat.client_fresh_jti: a retry is a new request", async () => {
    const { guard, seen } = network({ status: 503, body: { error: "unavailable" } });
    const client = createChatAdminClient(guard, settings);
    await client.createAccount(USER, NAME);
    await client.createAccount(USER, NAME);
    const jtis = seen.map((s) => JSON.parse(new TextDecoder().decode(s.request.body as Uint8Array)).payload.jti);
    expect(new Set(jtis).size).toBe(2);
  });

  test.each([
    ["exists", { status: 200, body: { created: false } }, "created"],
    ["taken", { status: 409, body: { error: "username_taken" } }, "taken"],
    ["bad request", { status: 400, body: { error: "bad_request" } }, "rejected"],
    ["denied", { status: 403, body: { error: "denied" } }, "unavailable"],
    ["quota", { status: 429, body: { error: "quota" } }, "unavailable"],
    ["down", { status: 503, body: { error: "unavailable" } }, "unavailable"],
    ["odd 200", { status: 200, body: { created: "yes" } }, "unavailable"],
    ["odd 409", { status: 409, body: { error: "something_else" } }, "unavailable"],
    ["network", new NetGuardError("egress.timeout"), "unavailable"],
  ] as const)("chat.client_answer_%s", async (_name, answer, kind) => {
    const { guard } = network(answer);
    expect(await createChatAdminClient(guard, settings).createAccount(USER, NAME)).toEqual({ kind });
  });
});

describe("changeAccount", () => {
  test("chat.client_account_envelope: lock, unlock and deactivate each post one envelope naming only the user", async () => {
    for (const verb of ["account.lock", "account.unlock", "account.deactivate"] as const) {
      const { guard, seen } = network({
        status: 200,
        body: verb === "account.deactivate" ? { deactivated: true } : { locked: verb === "account.lock" },
      });
      expect(await createChatAdminClient(guard, settings).changeAccount(USER, verb)).toEqual({ kind: "done" });
      const [{ request }] = seen as [(typeof seen)[number]];
      expect(request.url).toBe(`http://chat-admin:8080/v1/${verb}`);
      const { payload } = JSON.parse(new TextDecoder().decode(request.body as Uint8Array));
      expect(payload).toMatchObject({ verb, user: USER, name: "", device: "", did: "", sid: "", state: "" });
    }
  });

  test("chat.client_set_locked: a lock and an unlock go to their own routes", async () => {
    const { guard, seen } = network({ status: 200, body: { locked: true } });
    const client = createChatAdminClient(guard, settings);
    expect(await client.setLocked(USER, true)).toEqual({ kind: "done" });
    expect(await client.setLocked(USER, false)).toEqual({ kind: "unavailable" });
    expect(seen.map((s) => s.request.url)).toEqual([
      "http://chat-admin:8080/v1/account.lock",
      "http://chat-admin:8080/v1/account.unlock",
    ]);
  });

  test.each([
    ["never made", { status: 200, body: { deactivated: false } }, "account.deactivate", "no_account"],
    ["no account", { status: 409, body: { error: "no_account" } }, "account.lock", "no_account"],
    ["bad request", { status: 400, body: { error: "bad_request" } }, "account.lock", "rejected"],
    ["denied", { status: 403, body: { error: "denied" } }, "account.unlock", "unavailable"],
    ["down", { status: 503, body: { error: "unavailable" } }, "account.deactivate", "unavailable"],
    ["odd 200", { status: 200, body: {} }, "account.lock", "unavailable"],
    ["network", new NetGuardError("egress.timeout"), "account.deactivate", "unavailable"],
  ] as const)("chat.client_account_answer_%s", async (_name, answer, verb, kind) => {
    const { guard } = network(answer);
    expect(await createChatAdminClient(guard, settings).changeAccount(USER, verb)).toEqual({ kind });
  });
});

describe("signTicket", () => {
  test("chat.ticket_envelope: a session.mint envelope naming member, session and state, encoded for a URL fragment", () => {
    const { guard, seen } = network({ status: 500, body: {} });
    const client = createChatAdminClient(guard, settings, () => 1_800_000_000_000);
    const ticket = { user: USER, did: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa", sid: "s".repeat(43), state: "t".repeat(43) };
    const encoded = client.signTicket(ticket as Parameters<typeof client.signTicket>[0]);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    const envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    expect(envelope.payload).toEqual({
      v: 1,
      env: "dev",
      aud: "chat-admin",
      verb: "session.mint",
      name: "",
      device: "",
      ...ticket,
      jti: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      iat: 1_800_000_000,
      exp: 1_800_000_060,
    });
    const bytes = Buffer.from(canonicalize(envelope.payload));
    expect(verify(null, bytes, publicKey, Buffer.from(envelope.sig, "base64url"))).toBe(true);
    // Signing is local: web sends a ticket nowhere; the browser carries it to the door.
    expect(seen).toEqual([]);
  });
});
