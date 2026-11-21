// The review door against the real pool and web's real client (ADR 0070 point 2.2): what web sends comes back as
// checked versions, and a request is bounded before its body is read.
import { createServer, request as httpRequest, type Server } from "node:http"; // guard-allow: egress test client to its own loopback listener
import type { AddressInfo } from "node:net";
import { imageVersions, UPLOAD_LIMITS } from "@unset/domains-content";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createImagePool } from "./pool.ts";
import { createRemoteImageProcessor, type ReviewTransport } from "./remote.ts";
import { type Outcome, reviewListener } from "./serve.ts";
import { encodeJob, PROCESS_PATH } from "./wire.ts";

const pool = createImagePool({ children: 1, queueMax: 1, timeoutMs: 20_000, addressSpaceMb: 8192 });
const outcomes: Outcome[] = [];
let server: Server;
let origin: string;

beforeAll(async () => {
  server = createServer(reviewListener(pool, (o) => outcomes.push(o)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  pool.close();
  server.close();
});

const transport: ReviewTransport = async (body, headers) => {
  const answer = await fetch(`${origin}${PROCESS_PATH}`, { method: "POST", body, headers });
  return {
    status: answer.status,
    contentType: answer.headers.get("content-type") ?? "",
    body: new Uint8Array(await answer.arrayBuffer()),
  };
};
const remote = createRemoteImageProcessor(transport);

/** A raw request, so a test can lie about its length or skip the job. */
function raw(headers: Record<string, string>, body: Buffer): Promise<number> {
  return new Promise((resolve) => {
    const req = httpRequest(`${origin}${PROCESS_PATH}`, { method: "POST", headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", () => resolve(-1));
    req.end(body);
  });
}

describe("review door", () => {
  test("a photo comes back as the standard's versions, checked by web's client", async () => {
    const photo = await sharp({ create: { width: 6000, height: 4000, channels: 3, background: "#228844" } })
      .jpeg()
      .toBuffer();
    const result = await remote.process(new Uint8Array(photo), UPLOAD_LIMITS, imageVersions());
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.source).toEqual({ format: "jpeg", width: 6000, height: 4000 });
    const main = result.versions.find((v) => v.name === "main");
    expect([main?.width, main?.height]).toEqual([4096, 2731]);
    expect((await sharp(main?.bytes).metadata()).format).toBe("webp");
  }, 60_000);

  test("a file that is not a picture is refused with its code", async () => {
    const result = await remote.process(new TextEncoder().encode("<svg/>"), UPLOAD_LIMITS, imageVersions());
    expect(result).toEqual({ kind: "refused", code: "image.unsupported" });
  });

  test("a declared length over the job's limit is refused before the body is read", async () => {
    const job = encodeJob({ limits: { ...UPLOAD_LIMITS, maxBytes: 10 }, versions: imageVersions() });
    expect(await raw({ "x-unset-job": job, "content-length": "11" }, Buffer.alloc(11))).toBe(422);
    expect(outcomes.at(-1)).toBe("image.too_large");
  });

  test("a missing or malformed job, or no length, is a bad request", async () => {
    expect(await raw({ "content-length": "4" }, Buffer.alloc(4))).toBe(400);
    expect(await raw({ "x-unset-job": "e30", "content-length": "4" }, Buffer.alloc(4))).toBe(400);
    const job = encodeJob({ limits: UPLOAD_LIMITS, versions: imageVersions() });
    expect(await raw({ "x-unset-job": job, "transfer-encoding": "chunked" }, Buffer.alloc(4))).toBe(400);
  });

  test("anything but the one path answers 404, and health answers", async () => {
    expect((await fetch(`${origin}/health`)).status).toBe(200);
    expect((await fetch(`${origin}/v1/other`, { method: "POST", body: "x" })).status).toBe(404);
  });

  test("web reads review being down as busy, so the member can try again", async () => {
    const down = createRemoteImageProcessor(() => Promise.reject(new Error("ECONNREFUSED")));
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } })
      .png()
      .toBuffer();
    expect(await down.process(new Uint8Array(png), UPLOAD_LIMITS, imageVersions())).toEqual({
      kind: "refused",
      code: "image.busy",
    });
  });
});
