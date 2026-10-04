import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { guardedFetch } from "./libraryFetch.ts";
import { atproto, plc } from "./policies.ts";
import {
  type FakeServer,
  fakeResolver,
  type Handler,
  httpsServer,
  loopbackDial,
  testCertificate,
} from "./remote.fake.ts";
import { createNetGuardWith } from "./request.ts";
import { NetGuardError } from "./resolve.ts";

const tls = testCertificate();
const PUBLIC = "93.184.215.14";
let handler: Handler = (_req, res) => res.end("ok");
let server: FakeServer;
beforeAll(async () => {
  server = await httpsServer(tls, (req, res) => handler(req, res));
});
afterAll(() => server.close());

function fetchFor(defaults: { maxBytes?: number; timeoutMs?: number } = {}, policy = plc) {
  const resolver = fakeResolver({ "plc.directory": [PUBLIC], "bsky.social": [PUBLIC] });
  const guard = createNetGuardWith(
    { internalHosts: [], allowLoopback: false, commit: "c".repeat(40), ca: tls.cert },
    { lookup: resolver.lookup, ...loopbackDial(server.port).hooks },
  );
  return { fetch: guardedFetch(guard, policy, defaults), resolver };
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

describe("guardedFetch", () => {
  test("fetch_roundtrip", async () => {
    handler = (req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        res.writeHead(201, { "content-type": "application/json", "set-cookie": ["a=1", "b=2"] });
        res.end(
          JSON.stringify({
            method: req.method,
            type: req.headers["content-type"],
            body,
            ua: req.headers["user-agent"],
          }),
        );
      });
    };
    const { fetch } = fetchFor({}, atproto);
    const response = await fetch("https://bsky.social/oauth/par", {
      method: "POST",
      body: new URLSearchParams({ a: "1" }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      method: "POST",
      type: "application/x-www-form-urlencoded;charset=UTF-8",
      body: "a=1",
      ua: `unset.sh/${"c".repeat(40)}`,
    });
    expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
  });

  test("no_redirects", async () => {
    const target = await httpsServer(tls, (_req, res) => res.end("target"));
    handler = (_req, res) => {
      res.writeHead(307, { location: `https://plc.directory:${target.port}/` });
      res.end();
    };
    const { fetch } = fetchFor();
    expect(await codeOf(fetch("https://plc.directory/", { redirect: "follow" }))).toBe("egress.redirect");
    expect(target.requests).toHaveLength(0);
    await target.close();
  });

  test("gzip_bomb_fetch", async () => {
    const bomb = gzipSync(Buffer.alloc(10 << 20));
    handler = (_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(bomb);
    };
    const { fetch } = fetchFor({ maxBytes: 1 << 20 });
    expect(await codeOf(fetch("https://plc.directory/"))).toBe("egress.too_large");
  });

  test("decoded_response_drops_encoding_headers", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip", "content-type": "text/plain" });
      res.end(gzipSync("hello"));
    };
    const response = await fetchFor().fetch("https://plc.directory/");
    expect(await response.text()).toBe("hello");
    expect(response.headers.get("content-encoding")).toBeNull();
  });

  test("caller_signal_aborts", async () => {
    handler = () => undefined;
    const { fetch, resolver } = fetchFor({ timeoutMs: 10_000 });
    const started = Date.now();
    expect(await codeOf(fetch("https://plc.directory/", { signal: AbortSignal.timeout(200) }))).toBe("egress.timeout");
    expect(Date.now() - started).toBeLessThan(1_000);
    const before = resolver.calls.length;
    expect(await codeOf(fetch("https://plc.directory/", { signal: AbortSignal.abort() }))).toBe("egress.timeout");
    expect(resolver.calls.length).toBe(before);
  });

  test("stream_body_capped", async () => {
    handler = (_req, res) => res.end("ok");
    const big = new Blob([new Uint8Array((1 << 20) + 1)]).stream();
    const init = { method: "POST", body: big, duplex: "half" } as RequestInit;
    expect(await codeOf(fetchFor().fetch("https://plc.directory/", init))).toBe("egress.too_large");
  });

  test("no_model_provider_policy", () => {
    const source = readFileSync(join(import.meta.dirname, "policies.ts"), "utf8").toLowerCase();
    for (const provider of ["anthropic", "openai", "claude", "gemini", "mistral"]) {
      expect(source, provider).not.toContain(provider);
    }
  });
});
