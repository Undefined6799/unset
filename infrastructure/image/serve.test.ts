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

/**
 * A photo-like JPEG: smooth shapes and gradients under fine grain, from a fixed seed so every run encodes the same
 * pixels. At q92 it is about as large as a phone camera's own file (3 to 5 MB at 12 megapixels).
 */
async function phonePhoto(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 0x2f6b_3c1d;
  const grain = () => {
    seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
    return (seed >>> 24) / 8 - 16;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const disc = Math.hypot(x - width / 3, y - height / 2) < height / 3;
      const base = [
        disc ? 200 : (x * 255) / width,
        (y * 255) / height,
        disc ? 60 : 128 + 90 * Math.sin(x / 37 + y / 53),
      ];
      for (let c = 0; c < 3; c++) pixels[i + c] = Math.max(0, Math.min(255, (base[c] ?? 0) + grain()));
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer();
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

  // The staging bug of 2026-11-21: a 4032x3024 phone photo (4.2 MB) came back image.timeout after review's 20 s,
  // because a flat colour, as above, encodes in no time and a photo's detail does not. One child, as each job gets,
  // and a budget well under review's deadline so slower hardware still fits.
  test("photo.phone_within_budget: a 12-megapixel phone photo comes back within 7 s", async () => {
    const photo = await phonePhoto(4032, 3024);
    expect(photo.length).toBeGreaterThan(3_000_000);
    const started = performance.now();
    const result = await remote.process(new Uint8Array(photo), UPLOAD_LIMITS, imageVersions());
    const seconds = (performance.now() - started) / 1000;
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.versions.map((v) => v.name)).toEqual(imageVersions().map((v) => v.name));
    expect(seconds).toBeLessThan(7);
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
