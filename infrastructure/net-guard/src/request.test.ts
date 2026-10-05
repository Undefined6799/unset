import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { atproto, type Policy, plc } from "./policies.ts";
import { fakeResolver, type Handler, httpServer, httpsServer, loopbackDial, testCertificate } from "./remote.fake.ts";
import { createNetGuardWith, type EgressEvent } from "./request.ts";
import { NetGuardError } from "./resolve.ts";

const tls = testCertificate();
const COMMIT = "c".repeat(40);
const PUBLIC = "93.184.215.14";

let handler: Handler = (_req, res) => res.end("ok");
const servers = { https: { port: 0 }, http: { port: 0 } } as { https: { port: number }; http: { port: number } };
const closers: (() => Promise<void>)[] = [];
beforeAll(async () => {
  const https = await httpsServer(tls, (req, res) => handler(req, res));
  const http = await httpServer((req, res) => handler(req, res));
  servers.https = https;
  servers.http = http;
  closers.push(https.close, http.close);
});
afterAll(async () => {
  for (const close of closers) await close();
});

/** A guard whose resolver answers from `answers` and whose sockets land on the fake server. */
function guardFor(answers: Record<string, readonly string[]>, port = servers.https.port, internalHosts = ["unset.ac"]) {
  const resolver = fakeResolver(answers);
  const dial = loopbackDial(port);
  const events: EgressEvent[] = [];
  const guard = createNetGuardWith(
    { internalHosts, allowLoopback: false, commit: COMMIT, ca: tls.cert, onRequest: (e) => events.push(e) },
    { lookup: resolver.lookup, ...dial.hooks },
  );
  return { guard, resolver, dialled: dial.dialled, events };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof NetGuardError) return error.code;
    throw error;
  }
  return "resolved";
}

describe("guardedRequest", () => {
  test("public_with_internal_exception", async () => {
    const policy = atproto;
    const ok = guardFor({ "unset.ac": ["172.20.0.5"], "bsky.social": [PUBLIC] });
    expect((await ok.guard.request(policy, { url: "https://unset.ac/x" })).status).toBe(200);
    expect((await ok.guard.request(policy, { url: "https://bsky.social/x" })).status).toBe(200);
    const bad = guardFor({ "unset.ac": [PUBLIC], "bsky.social": ["10.0.0.7"] });
    expect(await codeOf(bad.guard.request(policy, { url: "https://unset.ac/x" }))).toBe("egress.private_address");
    expect(await codeOf(bad.guard.request(policy, { url: "https://bsky.social/x" }))).toBe("egress.private_address");
  });

  test("internal_names_refused_on_public_policy", async () => {
    const { guard } = guardFor({ "pds.internal": [PUBLIC] });
    expect(await codeOf(guard.request(atproto, { url: "https://pds.internal/" }))).toBe("egress.internal_name");
  });

  test("pinned_connection", async () => {
    let calls = 0;
    const dial = loopbackDial(servers.https.port);
    const guard = createNetGuardWith(
      { internalHosts: [], allowLoopback: false, commit: COMMIT, ca: tls.cert },
      { lookup: async () => [{ address: calls++ === 0 ? PUBLIC : "127.0.0.1", family: 4 }], ...dial.hooks },
    );
    expect((await guard.request(plc, { url: "https://plc.directory/did:plc:x" })).status).toBe(200);
    expect(calls).toBe(1);
    expect(dial.dialled).toEqual([PUBLIC]);
  });

  test("no_redirects", async () => {
    const target = await httpsServer(tls, (_req, res) => res.end("target"));
    closers.push(target.close);
    handler = (_req, res) => {
      res.writeHead(302, { location: `https://plc.directory:${target.port}/` });
      res.end("moved");
    };
    const { guard } = guardFor({ "plc.directory": [PUBLIC] });
    expect(await codeOf(guard.request(plc, { url: "https://plc.directory/" }))).toBe("egress.redirect");
    expect(target.requests).toHaveLength(0);
  });

  test("not_modified_is_status", async () => {
    handler = (_req, res) => {
      res.writeHead(304);
      res.end();
    };
    const { guard } = guardFor({ "plc.directory": [PUBLIC] });
    expect((await guard.request(plc, { url: "https://plc.directory/" })).status).toBe(304);
  });

  test("too_large_by_length", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-length": "2000000" });
      res.write("x");
    };
    const { guard } = guardFor({ "plc.directory": [PUBLIC] });
    expect(await codeOf(guard.request(plc, { url: "https://plc.directory/", maxBytes: 1 << 20 }))).toBe(
      "egress.too_large",
    );
  });

  test("too_large_streamed", async () => {
    handler = (_req, res) => {
      const chunk = Buffer.alloc(64 * 1024, 120);
      for (let i = 0; i < 32; i += 1) res.write(chunk);
      res.end();
    };
    const { guard } = guardFor({ "plc.directory": [PUBLIC] });
    expect(await codeOf(guard.request(plc, { url: "https://plc.directory/", maxBytes: 1 << 20 }))).toBe(
      "egress.too_large",
    );
  });

  test("gzip_bomb_request", async () => {
    const bomb = gzipSync(Buffer.alloc(10 << 20));
    handler = (_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(bomb);
    };
    const { guard } = guardFor({ "plc.directory": [PUBLIC] });
    expect(await codeOf(guard.request(plc, { url: "https://plc.directory/", maxBytes: 1 << 20 }))).toBe(
      "egress.too_large",
    );
  });

  test("gzip_within_cap_is_decoded", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip", "content-type": "application/json" });
      res.end(gzipSync('{"a":1}'));
    };
    const { guard } = guardFor({ "plc.directory": [PUBLIC] });
    const response = await guard.request(plc, { url: "https://plc.directory/", accept: ["application/json"] });
    expect(new TextDecoder().decode(response.body)).toBe('{"a":1}');
  });

  test("encoding_and_content_type_refused", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-encoding": "zstd", "content-type": "text/html" });
      res.end("x");
    };
    const { guard } = guardFor({ "plc.directory": [PUBLIC] });
    const url = "https://plc.directory/";
    expect(await codeOf(guard.request(plc, { url, accept: ["application/json"] }))).toBe("egress.content_type");
    expect(await codeOf(guard.request(plc, { url }))).toBe("egress.encoding");
  });

  test("timeout", async () => {
    handler = () => undefined;
    const { guard } = guardFor({ "plc.directory": [PUBLIC] });
    const started = Date.now();
    expect(await codeOf(guard.request(plc, { url: "https://plc.directory/", timeoutMs: 200 }))).toBe("egress.timeout");
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test("caller_signal_aborts", async () => {
    handler = () => undefined;
    const { guard, resolver } = guardFor({ "plc.directory": [PUBLIC] });
    const started = Date.now();
    const signal = AbortSignal.timeout(200);
    expect(await codeOf(guard.request(plc, { url: "https://plc.directory/", timeoutMs: 10_000, signal }))).toBe(
      "egress.timeout",
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    const before = resolver.calls.length;
    const aborted = AbortSignal.abort();
    expect(await codeOf(guard.request(plc, { url: "https://plc.directory/", signal: aborted }))).toBe("egress.timeout");
    expect(resolver.calls.length).toBe(before);
  });

  test("scheme_and_port", async () => {
    const { guard } = guardFor({ x: [PUBLIC] });
    const policy = atproto;
    expect(await codeOf(guard.request(policy, { url: "http://bsky.social/" }))).toBe("egress.scheme");
    expect(await codeOf(guard.request(policy, { url: "https://bsky.social:8443/" }))).toBe("egress.port");
    expect(await codeOf(guard.request(policy, { url: "https://u:p@bsky.social/" }))).toBe("egress.scheme");
    expect(await codeOf(guard.request(policy, { url: "not a url" }))).toBe("egress.scheme");
  });

  test("fixed_policy", async () => {
    const { guard } = guardFor({ "plc.directory.evil.example": [PUBLIC] });
    expect(await codeOf(guard.request(plc, { url: "https://plc.directory.evil.example/" }))).toBe(
      "egress.host_not_allowed",
    );
  });

  test("internal_policy", async () => {
    handler = (_req, res) => res.end("ok");
    const objects: Policy = { name: "object-store", kind: "internal", origins: ["http://objects:8333"] };
    const ok = guardFor({ objects: ["172.20.0.9"] }, servers.http.port);
    expect((await ok.guard.request(objects, { url: "http://objects:8333/bucket" })).status).toBe(200);
    const bad = guardFor({ objects: [PUBLIC], other: ["172.20.0.9"] }, servers.http.port);
    expect(await codeOf(bad.guard.request(objects, { url: "http://objects:8333/" }))).toBe("egress.private_address");
    expect(await codeOf(bad.guard.request(objects, { url: "http://objects:9000/" }))).toBe("egress.host_not_allowed");
    expect(await codeOf(bad.guard.request(objects, { url: "http://other:8333/" }))).toBe("egress.host_not_allowed");
    expect(await codeOf(bad.guard.request(plc, { url: "http://plc.directory/" }))).toBe("egress.scheme");
  });

  test("log_has_no_url", async () => {
    handler = (_req, res) => res.end("ok");
    const { guard, events } = guardFor({ "bsky.social": [PUBLIC] });
    await guard.request(atproto, { url: "https://bsky.social/xrpc/secret.path?did=did:plc:abc" });
    await codeOf(guard.request(atproto, { url: "https://unknown.example/other" }));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event: "egress.request", dep: "atproto", status: 200 });
    expect(events[1]).toMatchObject({ dep: "atproto", status: null, code: "egress.dns_failed" });
    const text = JSON.stringify(events);
    for (const piece of ["bsky.social", "unknown.example", "xrpc", "secret", "did:plc", "93.184", "other"]) {
      expect(text).not.toContain(piece);
    }
  });

  test("log_callback_never_sees_target", async () => {
    handler = (_req, res) => res.end("ok");
    const { guard, events } = guardFor({ "bsky.social": [PUBLIC] });
    await guard.request(atproto, { url: "https://bsky.social/x" });
    await codeOf(guard.request(atproto, { url: "https://10.0.0.1/x" }));
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual(expect.arrayContaining(["counts", "dep", "event", "ms", "status"]));
      expect(Object.keys(event.counts)).toEqual(["bytes"]);
      for (const [key, value] of Object.entries(event)) {
        expect(["event", "dep", "status", "ms", "counts", "code"], key).toContain(key);
        if (typeof value === "string") expect(value).toMatch(/^(atproto|egress\.[a-z_]+)$/);
      }
    }
  });
});
