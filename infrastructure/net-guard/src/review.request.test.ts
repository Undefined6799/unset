// Review-found gaps in the guarded request (P1.18a): Host and SNI, header precedence, raw-byte caps, null bodies,
// real pinning, error mapping and the event shape. Each test reproduces a reviewer probe.
import type { IncomingMessage } from "node:http";
import type { TLSSocket } from "node:tls";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { atproto, plc } from "./policies.ts";
import {
  type FakeServer,
  fakeResolver,
  type Handler,
  httpsServer,
  loopbackDial,
  testCertificate,
} from "./remote.fake.ts";
import { createNetGuardWith, type EgressEvent, type NetGuardHooks } from "./request.ts";
import { NetGuardError } from "./resolve.ts";

const tls = testCertificate();
const COMMIT = "c".repeat(40);
const PUBLIC = "93.184.215.14";
const URL_PLC = "https://plc.directory/";

let handler: Handler = (_req, res) => res.end("ok");
const seen: { sni: string | false | null; host: string | undefined; headers: IncomingMessage["headers"] }[] = [];
let server: FakeServer;
beforeAll(async () => {
  server = await httpsServer(tls, (req, res) => {
    seen.push({ sni: (req.socket as TLSSocket).servername, host: req.headers.host, headers: req.headers });
    handler(req, res);
  });
});
afterAll(() => server.close());

function guardFor(answers: Record<string, readonly string[]>, hooks?: NetGuardHooks, onRequest?: () => void) {
  const events: EgressEvent[] = [];
  const guard = createNetGuardWith(
    {
      internalHosts: ["unset.ac"],
      allowLoopback: false,
      commit: COMMIT,
      ca: tls.cert,
      onRequest: onRequest ?? ((e) => events.push(e)),
    },
    hooks ?? { lookup: fakeResolver(answers).lookup, ...loopbackDial(server.port).hooks },
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

describe("guardedRequest review", () => {
  test("caller_host_header_refused", async () => {
    handler = (_req, res) => res.end("ok");
    const { guard, events } = guardFor({ "plc.directory": [PUBLIC] });
    for (const name of ["host", "Host", "HOST"]) {
      const headers = { [name]: "unset.ac" };
      expect(await codeOf(guard.request(plc, { url: URL_PLC, headers })), name).toBe("TypeError");
    }
    expect(events.at(-1)).toMatchObject({ dep: "plc", code: "egress.invalid" });
    await guard.request(plc, { url: URL_PLC });
    expect(seen.at(-1)).toMatchObject({ sni: "plc.directory", host: "plc.directory" });
  });

  test("our_headers_win_over_caller_case", async () => {
    handler = (_req, res) => res.end("ok");
    const { guard } = guardFor({ "plc.directory": [PUBLIC] });
    const headers = { "User-Agent": "spoof", "ACCEPT-ENCODING": "zstd", "X-Trace": "1" };
    await guard.request(plc, { url: URL_PLC, headers });
    expect(seen.at(-1)?.headers).toMatchObject({
      "user-agent": `unset.sh/${COMMIT}`,
      "accept-encoding": "gzip, br, identity",
      "x-trace": "1",
    });
  });

  test("raw_bytes_capped_for_empty_gzip_members", async () => {
    const members = Buffer.concat(Array.from({ length: 3000 }, () => gzipSync(Buffer.alloc(0))));
    handler = (_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      const timer = setInterval(() => (res.destroyed ? clearInterval(timer) : res.write(members)), 1);
      res.on("close", () => clearInterval(timer));
    };
    const { guard } = guardFor({ "plc.directory": [PUBLIC] });
    const started = Date.now();
    expect(await codeOf(guard.request(plc, { url: URL_PLC, maxBytes: 65_536, timeoutMs: 5_000 }))).toBe(
      "egress.too_large",
    );
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test("null_body_statuses_skip_decoding", async () => {
    const { guard } = guardFor({ "plc.directory": [PUBLIC] });
    for (const status of [204, 304]) {
      handler = (_req, res) => {
        res.writeHead(status, { "content-encoding": "gzip", etag: "x" });
        res.end();
      };
      const response = await guard.request(plc, { url: URL_PLC, accept: ["application/json"] });
      expect(response.status).toBe(status);
      expect(response.body).toHaveLength(0);
    }
    handler = (_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip", "content-length": "0" });
      res.end();
    };
    expect((await guard.request(plc, { url: URL_PLC })).body).toHaveLength(0);
  });

  test("deflate_and_br_decoded_and_accept_encoding_sent", async () => {
    const { guard } = guardFor({ "plc.directory": [PUBLIC] });
    for (const [encoding, bytes] of [
      ["deflate", deflateSync("hello")],
      ["br", brotliCompressSync("hello")],
    ] as const) {
      handler = (_req, res) => {
        res.writeHead(200, { "content-encoding": encoding });
        res.end(bytes);
      };
      const response = await guard.request(plc, { url: URL_PLC });
      expect(new TextDecoder().decode(response.body), encoding).toBe("hello");
    }
    expect(seen.at(-1)?.headers["accept-encoding"]).toBe("gzip, br, identity");
  });

  test("corrupt_encoding_is_egress_encoding", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end("not gzip at all");
    };
    const { guard } = guardFor({ "plc.directory": [PUBLIC] });
    expect(await codeOf(guard.request(plc, { url: URL_PLC }))).toBe("egress.encoding");
  });

  test("redirect_308", async () => {
    handler = (_req, res) => {
      res.writeHead(308, { location: "https://plc.directory/elsewhere" });
      res.end();
    };
    const { guard } = guardFor({ "plc.directory": [PUBLIC] });
    expect(await codeOf(guard.request(plc, { url: URL_PLC }))).toBe("egress.redirect");
  });

  test("real_pinned_lookup_reaches_only_vetted_address", async () => {
    handler = (_req, res) => res.end("ok");
    const pinned = (address: string) => ({ lookup: fakeResolver({ "unset.ac": [address] }).lookup, port: server.port });
    const ok = guardFor({}, pinned("127.0.0.1"));
    expect((await ok.guard.request(atproto, { url: "https://unset.ac/" })).status).toBe(200);
    const elsewhere = guardFor({}, pinned("127.0.0.3"));
    expect(await codeOf(elsewhere.guard.request(atproto, { url: "https://unset.ac/" }))).toBe("egress.connect");
  });

  test("caller_abort_during_dns_is_timeout", async () => {
    const hang = { lookup: () => new Promise<never>(() => undefined), ...loopbackDial(server.port).hooks };
    const { guard } = guardFor({}, hang);
    const signal = AbortSignal.timeout(100);
    expect(await codeOf(guard.request(plc, { url: URL_PLC, signal }))).toBe("egress.timeout");
  });

  test("dns_timer_capped_below_request_deadline", async () => {
    const hang = { lookup: () => new Promise<never>(() => undefined), ...loopbackDial(server.port).hooks };
    const { guard } = guardFor({}, hang);
    const started = Date.now();
    expect(await codeOf(guard.request(plc, { url: URL_PLC, timeoutMs: 10_000 }))).toBe("egress.dns_timeout");
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  test("status_outside_final_range_refused", async () => {
    handler = (_req, res) => {
      res.writeHead(600);
      res.end("x");
    };
    const { guard, events } = guardFor({ "plc.directory": [PUBLIC] });
    expect(await codeOf(guard.request(plc, { url: URL_PLC }))).toBe("egress.connect");
    expect(events.at(-1)).toMatchObject({ status: 600, code: "egress.connect" });
  });

  test("throwing_log_callback_keeps_outcome", async () => {
    handler = (_req, res) => res.end("ok");
    const { guard } = guardFor({ "plc.directory": [PUBLIC] }, undefined, () => {
      throw new Error("logger down");
    });
    expect((await guard.request(plc, { url: URL_PLC })).status).toBe(200);
    expect(await codeOf(guard.request(plc, { url: "http://plc.directory/" }))).toBe("egress.scheme");
  });

  test("event_matches_log_ruling", async () => {
    handler = (_req, res) => res.end("four");
    const { guard, events } = guardFor({ "plc.directory": [PUBLIC] });
    await guard.request(plc, { url: URL_PLC });
    await codeOf(guard.request(plc, { url: "https://evil.example/" }));
    expect(events[0]).toEqual({
      event: "egress.request",
      dep: "plc",
      status: 200,
      ms: expect.any(Number),
      counts: { bytes: 4 },
    });
    expect(events[1]).toMatchObject({ event: "egress.request", dep: "plc", code: "egress.host_not_allowed" });
  });
});
