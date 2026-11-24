// Request body caps (ADR 0070 point 8): every policy sends at most 1 MiB unless it names more, and only three do, each
// for one call or one internal origin. Each cap is tested with what normal use sends (it fits) and one byte past it.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { libraryFetch } from "./libraryFetch.ts";
import {
  atproto,
  atprotoBlobUpload,
  DEFAULT_REQUEST_BYTES,
  internalPolicy,
  objectStore,
  type Policy,
  pdsAdmin,
  plc,
  REQUEST_BODY_CEILING,
  review,
} from "./policies.ts";
import {
  type FakeServer,
  fakeResolver,
  httpServer,
  httpsServer,
  loopbackDial,
  testCertificate,
} from "./remote.fake.ts";
import { createNetGuardWith } from "./request.ts";
import { NetGuardError } from "./resolve.ts";

const tls = testCertificate();
const MiB = 1024 * 1024;
const PUBLIC = "93.184.215.14";
const PRIVATE = "172.20.0.9";
let http: FakeServer;
let https: FakeServer;
/** Every fake answer counts the bytes it read, so a passing case proves the whole body arrived. */
let received = 0;
beforeAll(async () => {
  const count = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
    received = 0;
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
    });
    req.on("end", () => res.end("ok"));
  };
  http = await httpServer(count);
  https = await httpsServer(tls, count);
});
afterAll(async () => {
  await http.close();
  await https.close();
});

function guardOn(port: number) {
  const resolver = fakeResolver({
    review: [PRIVATE],
    objects: [PRIVATE],
    "pds-admin": [PRIVATE],
    "bsky.social": [PUBLIC],
  });
  return createNetGuardWith(
    { internalHosts: [], allowLoopback: false, commit: "c".repeat(40), ca: tls.cert },
    { lookup: resolver.lookup, ...loopbackDial(port).hooks },
  );
}

async function send(policy: Policy, url: string, bytes: number): Promise<string> {
  const guard = guardOn(url.startsWith("https:") ? https.port : http.port);
  try {
    const res = await guard.request(policy, { url, method: "POST", body: new Uint8Array(bytes), timeoutMs: 30_000 });
    return res.status === 200 && received === bytes ? "sent" : `status ${res.status}, ${received} bytes`;
  } catch (error) {
    if (error instanceof NetGuardError) return error.code;
    throw error;
  }
}

describe("request body caps", () => {
  test("caps.default_unchanged: every other policy still sends at most 1 MiB", async () => {
    expect(DEFAULT_REQUEST_BYTES).toBe(MiB);
    for (const policy of [atproto, plc, pdsAdmin("http://pds-admin:8080")]) expect(policy.requestBytes).toBeUndefined();
    expect(await send(pdsAdmin("http://pds-admin:8080"), "http://pds-admin:8080/x", MiB)).toBe("sent");
    expect(await send(pdsAdmin("http://pds-admin:8080"), "http://pds-admin:8080/x", MiB + 1)).toBe("egress.too_large");
  });

  test("caps.review: a 60,000,000-byte upload reaches review; past 66 MiB is refused (ADR 0076)", async () => {
    const policy = review("http://review:8080");
    expect(policy).toEqual({
      name: "review",
      kind: "internal",
      origins: ["http://review:8080"],
      requestBytes: 66 * MiB,
    });
    expect(await send(policy, "http://review:8080/v1/process", 60_000_000)).toBe("sent");
    expect(await send(policy, "http://review:8080/v1/process", 66 * MiB)).toBe("sent");
    expect(await send(policy, "http://review:8080/v1/process", 66 * MiB + 1)).toBe("egress.too_large");
  });

  test("caps.object_store: a 5,000,000-byte main version is stored; past 5 MiB is refused (ADR 0088)", async () => {
    const policy = objectStore("http://objects:8333");
    expect(policy.requestBytes).toBe(5 * MiB);
    expect(await send(policy, "http://objects:8333/unset-private/drafts/k", 5_000_000)).toBe("sent");
    expect(await send(policy, "http://objects:8333/unset-private/drafts/k", 5 * MiB + 1)).toBe("egress.too_large");
  });

  test("caps.blob_upload: uploadBlob alone carries 5 MiB; any other atproto call keeps 1 MiB (ADR 0088)", async () => {
    expect(atprotoBlobUpload).toEqual({ name: "atproto-upload", kind: "public", requestBytes: 5 * MiB });
    const fetch = libraryFetch(guardOn(https.port));
    const post = async (path: string, bytes: number, method = "POST") => {
      try {
        const res = await fetch(`https://bsky.social${path}`, { method, body: new Uint8Array(bytes) });
        return res.status === 200 && received === bytes ? "sent" : `status ${res.status}`;
      } catch (error) {
        return error instanceof NetGuardError ? error.code : String(error);
      }
    };
    const UPLOAD = "/xrpc/com.atproto.repo.uploadBlob";
    expect(await post(UPLOAD, 5_000_000)).toBe("sent");
    expect(await post(UPLOAD, 5 * MiB + 1)).toBe("egress.too_large");
    expect(await post("/xrpc/com.atproto.repo.createRecord", MiB + 1)).toBe("egress.too_large");
    expect(await post(`${UPLOAD}/extra`, MiB + 1)).toBe("egress.too_large");
    expect(await post(`/x${UPLOAD}`, MiB + 1)).toBe("egress.too_large");
  });

  test("caps.ceiling: no policy may name more than 66 MiB, however it is built", async () => {
    expect(REQUEST_BODY_CEILING).toBe(66 * MiB);
    expect(() => internalPolicy("x", ["http://x:1"], 66 * MiB + 1)).toThrow(RangeError);
    expect(() => internalPolicy("x", ["http://x:1"], 0)).toThrow(RangeError);
    expect(() => internalPolicy("x", ["http://x:1"], 1.5)).toThrow(RangeError);
    const handBuilt: Policy = {
      name: "x",
      kind: "internal",
      origins: ["http://review:8080"],
      requestBytes: 66 * MiB + 1,
    };
    await expect(guardOn(http.port).request(handBuilt, { url: "http://review:8080/" })).rejects.toThrow(RangeError);
  });
});
