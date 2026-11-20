import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { atproto, localPlc, objectStore, type Policy, pdsAdmin, plc } from "./policies.ts";
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

  test("object_store_policy_exact_origin", async () => {
    // P2.18k: the object store by the one origin the composition root passes in (OBJECT_STORE_URL), nothing wider.
    handler = (_req, res) => res.end("ok");
    const policy = objectStore("http://objects:8333");
    expect(policy).toMatchObject({ name: "object-store", kind: "internal", origins: ["http://objects:8333"] });
    const ok = guardFor({ objects: ["172.20.0.9"] }, servers.http.port);
    expect((await ok.guard.request(policy, { url: "http://objects:8333/unset-private/drafts/x" })).status).toBe(200);
    const other = guardFor({ objects: ["172.20.0.9"], db: ["172.20.0.9"] }, servers.http.port);
    for (const url of ["http://objects:8334/", "http://db:8333/", "https://objects:8333/", "http://172.20.0.9:8333/"]) {
      expect(await codeOf(other.guard.request(policy, { url })), url).toBe("egress.host_not_allowed");
    }
    expect(() => objectStore("http://objects:8333/bucket")).toThrow(TypeError);
    expect(() => objectStore("")).toThrow(TypeError);
  });

  test("object_store_policy_private_only", async () => {
    const bad = guardFor({ objects: [PUBLIC] }, servers.http.port);
    expect(await codeOf(bad.guard.request(objectStore("http://objects:8333"), { url: "http://objects:8333/" }))).toBe(
      "egress.private_address",
    );
  });

  test("pds_admin_policy_exact_origin", async () => {
    // P2.09k: web reaches pds-admin by the one origin its composition root passes in (PDS_ADMIN_URL), nothing wider.
    handler = (_req, res) => res.end("ok");
    const policy = pdsAdmin("http://pds-admin:8080");
    expect(policy).toEqual({ name: "pds-admin", kind: "internal", origins: ["http://pds-admin:8080"] });
    const ok = guardFor({ "pds-admin": ["172.20.0.11"] }, servers.http.port);
    expect((await ok.guard.request(policy, { url: "http://pds-admin:8080/v1/invite.issue" })).status).toBe(200);
    const other = guardFor({ "pds-admin": ["172.20.0.11"], pds: ["172.20.0.12"] }, servers.http.port);
    for (const url of [
      "http://pds-admin:8081/",
      "http://pds:8080/",
      "https://pds-admin:8080/",
      "http://172.20.0.11:8080/",
    ]) {
      expect(await codeOf(other.guard.request(policy, { url })), url).toBe("egress.host_not_allowed");
    }
    expect(() => pdsAdmin("http://pds-admin:8080/v1")).toThrow(TypeError);
    expect(() => pdsAdmin("")).toThrow(TypeError);
  });

  test("pds_admin_policy_private_only", async () => {
    const bad = guardFor({ "pds-admin": [PUBLIC] }, servers.http.port);
    const policy = pdsAdmin("http://pds-admin:8080");
    expect(await codeOf(bad.guard.request(policy, { url: "http://pds-admin:8080/" }))).toBe("egress.private_address");
  });

  test("put_only_on_internal_policy", async () => {
    // P2.18k: the object store takes PUT (objects and tags); every other policy keeps GET and POST alone.
    let seen = "";
    handler = (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        seen = `${req.method} ${Buffer.concat(chunks).toString()}`;
        res.end();
      });
    };
    const policy = objectStore("http://objects:8333");
    const ok = guardFor({ objects: ["172.20.0.9"] }, servers.http.port);
    const put = { url: "http://objects:8333/b/k", method: "PUT", body: new TextEncoder().encode("bytes") } as const;
    expect((await ok.guard.request(policy, put)).status).toBe(200);
    expect(seen).toBe("PUT bytes");
    const pub = guardFor({ "bsky.social": [PUBLIC], "plc.directory": [PUBLIC] });
    await expect(pub.guard.request(atproto, { ...put, url: "https://bsky.social/" })).rejects.toThrow(TypeError);
    await expect(pub.guard.request(plc, { ...put, url: "https://plc.directory/" })).rejects.toThrow(TypeError);
    const del = { url: "http://objects:8333/b/k", method: "DELETE" } as unknown as Parameters<
      typeof ok.guard.request
    >[1];
    await expect(ok.guard.request(policy, del)).rejects.toThrow(TypeError);
    expect(pub.dialled).toEqual([]);
  });

  test("local_plc_is_one_exact_private_origin", async () => {
    // P1.34y (record 2026-10-13-local-plc, Amendment 4): the local stack's PLC by its one internal origin, never a
    // private range; the public `plc` policy keeps plc.directory alone.
    handler = (_req, res) => res.end("ok");
    expect(localPlc).toEqual({ name: "plc", kind: "internal", origins: ["http://plc:2582"] });
    expect(plc).toEqual({ name: "plc", kind: "fixed", hosts: ["plc.directory"] });
    const ok = guardFor({ plc: ["172.20.0.9"] }, servers.http.port);
    expect((await ok.guard.request(localPlc, { url: "http://plc:2582/did:plc:x" })).status).toBe(200);
    const bad = guardFor({ plc: [PUBLIC], db: ["172.20.0.9"], "plc.directory": [PUBLIC] }, servers.http.port);
    expect(await codeOf(bad.guard.request(localPlc, { url: "http://plc:2582/" }))).toBe("egress.private_address");
    for (const url of [
      "http://db:2582/",
      "http://plc:2583/",
      "http://plc:25820/",
      "http://plc/",
      "https://plc:2582/",
      "http://plc.directory/",
      "https://plc.directory/",
      "http://10.0.0.7:2582/",
      "http://172.20.0.9:2582/",
      "http://plc.evil.example:2582/",
    ]) {
      expect(await codeOf(bad.guard.request(localPlc, { url })), url).toBe("egress.host_not_allowed");
    }
    expect(await codeOf(bad.guard.request(localPlc, { url: "http://user@plc:2582/" }))).toBe("egress.scheme");
    expect(await codeOf(bad.guard.request(plc, { url: "http://plc:2582/" }))).toBe("egress.scheme");
    expect(await codeOf(bad.guard.request(plc, { url: "https://plc/" }))).toBe("egress.host_not_allowed");
    expect(await codeOf(bad.guard.request(plc, { url: "https://plc:2582/" }))).toBe("egress.port");
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
