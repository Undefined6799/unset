import type { NetGuardCode, Policy, TxtResolver } from "@unset/infrastructure-net-guard";
import { NetGuardError } from "@unset/infrastructure-net-guard";
import { describe, expect, test } from "vitest";
import { createIdentityNetwork } from "./index.ts";

type Seen = { policy: string; url: string; headers: unknown; timeoutMs: unknown; maxBytes: unknown };

/** A stub guard (the remote hosts are unmanaged dependencies, TE-1) recording each request. */
function guardAnswering(answer: () => Promise<{ status: number; body: Uint8Array }>) {
  const seen: Seen[] = [];
  const guard = {
    request: async (policy: Policy, req: { url: string; headers?: unknown; timeoutMs?: number; maxBytes?: number }) => {
      seen.push({
        policy: policy.name,
        url: req.url,
        headers: req.headers,
        timeoutMs: req.timeoutMs,
        maxBytes: req.maxBytes,
      });
      const { status, body } = await answer();
      return { status, headers: {}, body };
    },
  };
  return { guard, seen };
}

const resolverAnswering = (answer: () => Promise<string[][]>) => (): TxtResolver => ({
  resolveTxt: answer,
  cancel: () => undefined,
});

const network = (guard: ReturnType<typeof guardAnswering>["guard"], txt?: () => Promise<string[][]>) =>
  createIdentityNetwork({
    guard,
    plcUrl: new URL("https://plc.directory"),
    httpTimeoutMs: 3000,
    dnsTimeoutMs: 2000,
    ...(txt ? { createResolver: resolverAnswering(txt) } : {}),
  });

describe("identity network on net-guard", () => {
  test("get_uses_the_policy_for_the_target", async () => {
    const body = new TextEncoder().encode("{}");
    const { guard, seen } = guardAnswering(async () => ({ status: 200, body }));
    const net = network(guard);
    const request = { maxBytes: 64, accept: "application/json" };
    expect(await net.get(new URL("https://plc.directory/did:plc:x"), { ...request, target: "plc" })).toEqual({
      kind: "response",
      status: 200,
      body,
    });
    await net.get(new URL("https://example.com/.well-known/did.json"), { ...request, target: "public" });
    expect(seen).toEqual([
      {
        policy: "plc",
        url: "https://plc.directory/did:plc:x",
        headers: { accept: "application/json" },
        timeoutMs: 3000,
        maxBytes: 64,
      },
      {
        policy: "atproto",
        url: "https://example.com/.well-known/did.json",
        headers: { accept: "application/json" },
        timeoutMs: 3000,
        maxBytes: 64,
      },
    ]);
  });

  test("every_net_guard_code_maps_to_a_failure", async () => {
    // Typed over every code, so a new NetGuardCode fails here until its case is added.
    const expected: Record<NetGuardCode, "unavailable" | "no_such_host" | "refused"> = {
      "egress.dns_failed": "unavailable",
      "egress.dns_timeout": "unavailable",
      "egress.connect": "unavailable",
      "egress.tls": "unavailable",
      "egress.timeout": "unavailable",
      "egress.dns_no_record": "no_such_host",
      "egress.private_address": "refused",
      "egress.redirect": "refused",
      "egress.too_large": "refused",
      "egress.internal_name": "refused",
      "egress.host_not_allowed": "refused",
      "egress.scheme": "refused",
      "egress.port": "refused",
      "egress.encoding": "refused",
      "egress.content_type": "refused",
    };
    for (const [code, kind] of Object.entries(expected)) {
      const { guard } = guardAnswering(() => Promise.reject(new NetGuardError(code as NetGuardCode)));
      const outcome = await network(guard).get(new URL("https://example.com/"), {
        target: "public",
        maxBytes: 1,
        accept: "text/plain",
      });
      expect(outcome, code).toEqual({ kind });
    }
  });

  test("plc_bound_to_plc_url", async () => {
    const { guard, seen } = guardAnswering(async () => ({ status: 200, body: new Uint8Array() }));
    const request = { target: "plc", maxBytes: 64, accept: "application/json" } as const;
    for (const url of [
      "https://evil.example.com/did:plc:x",
      "http://plc.directory/did:plc:x",
      "https://plc.directory:8443/x",
    ]) {
      expect(await network(guard).get(new URL(url), request), url).toEqual({ kind: "refused" });
    }
    expect(seen).toEqual([]);
  });

  test("public_is_https_without_userinfo", async () => {
    const { guard, seen } = guardAnswering(async () => ({ status: 200, body: new Uint8Array() }));
    const request = { target: "public", maxBytes: 64, accept: "text/plain" } as const;
    for (const url of [
      "http://example.com/",
      "https://user:pw@example.com/",
      "https://user@example.com/",
      "file:///etc/passwd",
    ]) {
      expect(await network(guard).get(new URL(url), request), url).toEqual({ kind: "refused" });
    }
    expect(seen).toEqual([]);
  });

  test("max_bytes_capped_at_64_kib", async () => {
    const { guard, seen } = guardAnswering(async () => ({ status: 200, body: new Uint8Array() }));
    await network(guard).get(new URL("https://example.com/"), {
      target: "public",
      maxBytes: 10_000_000,
      accept: "x/y",
    });
    expect(seen[0]?.maxBytes).toBe(64 * 1024);
  });

  test("plc_url_must_be_the_plc_policy_host", () => {
    const { guard } = guardAnswering(async () => ({ status: 200, body: new Uint8Array() }));
    for (const plcUrl of ["https://plc.example.com", "http://plc.directory"]) {
      expect(() =>
        createIdentityNetwork({ guard, plcUrl: new URL(plcUrl), httpTimeoutMs: 1, dnsTimeoutMs: 1 }),
      ).toThrow(TypeError);
    }
  });

  test("other_errors_are_thrown", async () => {
    const { guard } = guardAnswering(() => Promise.reject(new TypeError("bad request")));
    await expect(
      network(guard).get(new URL("https://example.com/"), { target: "public", maxBytes: 1, accept: "text/plain" }),
    ).rejects.toThrow(TypeError);
  });

  test("txt_joins_chunks", async () => {
    const { guard } = guardAnswering(async () => ({ status: 200, body: new Uint8Array() }));
    const net = network(guard, async () => [["did=did:plc:", "abc"], ["v=spf1"]]);
    expect(await net.txt("_atproto.alice.example.com")).toEqual({
      kind: "records",
      records: ["did=did:plc:abc", "v=spf1"],
    });
  });

  test("txt_failures", async () => {
    const { guard } = guardAnswering(async () => ({ status: 200, body: new Uint8Array() }));
    const failing = (code: string) => () => Promise.reject(Object.assign(new Error(code), { code }));
    expect(await network(guard, failing("ENOTFOUND")).txt("_atproto.a.example.com")).toEqual({ kind: "no_record" });
    expect(await network(guard, failing("ENODATA")).txt("_atproto.a.example.com")).toEqual({ kind: "no_record" });
    expect(await network(guard, failing("ESERVFAIL")).txt("_atproto.a.example.com")).toEqual({ kind: "unavailable" });
    expect(await network(guard, failing("ETIMEOUT")).txt("_atproto.a.example.com")).toEqual({ kind: "unavailable" });
  });
});
