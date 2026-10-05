// Review-found gaps in the guarded request (P1.18a): the dev loopback flag, limit bounds, internal policy origins,
// events for early refusals and TLS failures.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { atproto, internalPolicy, plc } from "./policies.ts";
import {
  type FakeServer,
  fakeResolver,
  httpServer,
  httpsServer,
  loopbackDial,
  testCertificate,
} from "./remote.fake.ts";
import { createNetGuardWith, type EgressEvent, type NetGuardSettings } from "./request.ts";
import { NetGuardError } from "./resolve.ts";

const tls = testCertificate();
const PUBLIC = "93.184.215.14";
const URL_PLC = "https://plc.directory/";
let http: FakeServer;
let https: FakeServer;
beforeAll(async () => {
  http = await httpServer((_req, res) => res.end("loop"));
  https = await httpsServer(tls, (_req, res) => res.end("ok"));
});
afterAll(async () => {
  await http.close();
  await https.close();
});

function guardWith(settings: Partial<NetGuardSettings>, lookup = fakeResolver({ localhost: ["127.0.0.1"] }).lookup) {
  const events: EgressEvent[] = [];
  const guard = createNetGuardWith(
    { internalHosts: [], allowLoopback: false, commit: "c".repeat(40), onRequest: (e) => events.push(e), ...settings },
    { lookup },
  );
  return { guard, events };
}

function publicGuard(settings: Partial<NetGuardSettings> = { ca: tls.cert }) {
  const events: EgressEvent[] = [];
  const guard = createNetGuardWith(
    { internalHosts: [], allowLoopback: false, commit: "c".repeat(40), onRequest: (e) => events.push(e), ...settings },
    { lookup: fakeResolver({ "plc.directory": [PUBLIC] }).lookup, ...loopbackDial(https.port).hooks },
  );
  return { guard, events };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof NetGuardError) return error.code;
    return `${(error as Error).name}`;
  }
  return "resolved";
}

describe("dev loopback", () => {
  test("flag_off_refuses_loopback", async () => {
    const { guard } = guardWith({ allowLoopback: false });
    expect(await codeOf(guard.request(atproto, { url: `http://127.0.0.1:${http.port}/` }))).toBe("egress.scheme");
    expect(await codeOf(guard.request(atproto, { url: `http://localhost:${http.port}/` }))).toBe("egress.scheme");
  });

  test("flag_on_reaches_loopback", async () => {
    const { guard } = guardWith({ allowLoopback: true });
    for (const host of ["127.0.0.1", "localhost"]) {
      const response = await guard.request(atproto, { url: `http://${host}:${http.port}/` });
      expect(new TextDecoder().decode(response.body), host).toBe("loop");
    }
  });

  test("flag_on_keeps_fixed_policy_hosts", async () => {
    const { guard } = guardWith({ allowLoopback: true });
    expect(await codeOf(guard.request(plc, { url: `http://127.0.0.1:${http.port}/` }))).toBe("egress.host_not_allowed");
    expect(await codeOf(guard.request(plc, { url: `http://localhost:${http.port}/` }))).toBe("egress.host_not_allowed");
  });

  test("ip_literal_gets_no_servername", async () => {
    const { guard } = guardWith({ allowLoopback: true, ca: tls.cert });
    // The certificate names hosts only, so an IP target fails the certificate check rather than the TLS setup.
    expect(await codeOf(guard.request(atproto, { url: `https://127.0.0.1:${https.port}/` }))).toBe("egress.tls");
  });
});

describe("limits and early refusals", () => {
  test("limit_upper_bounds", async () => {
    const { guard, events } = publicGuard();
    expect(await codeOf(guard.request(plc, { url: URL_PLC, timeoutMs: 30_001 }))).toBe("RangeError");
    expect(await codeOf(guard.request(plc, { url: URL_PLC, maxBytes: 64 * 1024 * 1024 + 1 }))).toBe("RangeError");
    expect(events.at(-1)).toMatchObject({ dep: "plc", status: null, code: "egress.invalid" });
    expect(await codeOf(guard.request(plc, { url: URL_PLC, timeoutMs: 30_000, maxBytes: 64 << 20 }))).toBe("resolved");
  });

  test("method_checked_at_runtime", async () => {
    const { guard, events } = publicGuard();
    const req = { url: URL_PLC, method: "DELETE" } as unknown as Parameters<typeof guard.request>[1];
    expect(await codeOf(guard.request(plc, req))).toBe("TypeError");
    expect(events).toHaveLength(1);
  });

  test("request_body_capped_with_event", async () => {
    const { guard, events } = publicGuard();
    async function* big() {
      yield new Uint8Array(1 << 20);
      yield new Uint8Array(1);
    }
    expect(await codeOf(guard.request(plc, { url: URL_PLC, method: "POST", body: big() }))).toBe("egress.too_large");
    expect(events.at(-1)).toMatchObject({ dep: "plc", code: "egress.too_large" });
  });

  test("untrusted_certificate_is_tls", async () => {
    const { guard, events } = publicGuard({});
    expect(await codeOf(guard.request(plc, { url: URL_PLC }))).toBe("egress.tls");
    expect(events.at(-1)).toMatchObject({ code: "egress.tls" });
  });
});

describe("internal policy", () => {
  test("origins_validated_when_built", () => {
    expect(internalPolicy("objects", ["http://objects:8333"])).toEqual({
      name: "objects",
      kind: "internal",
      origins: ["http://objects:8333"],
    });
    for (const bad of ["null", "http://objects:8333/", "http://Objects:8333", "ftp://objects", "foo://objects", ""]) {
      expect(() => internalPolicy("objects", [bad]), bad).toThrow(TypeError);
    }
  });

  test("non_http_url_refused_even_with_null_origin", async () => {
    const { guard } = guardWith({});
    const policy = { name: "o", kind: "internal", origins: ["null"] } as const;
    expect(await codeOf(guard.request(policy, { url: "foo://objects/" }))).toBe("egress.scheme");
  });
});
