// The processing stage against the pinned sharp (ADR 0070 points 2.2 and 3; book P2.17's tests, re-read for the new
// standard). Pictures are made here with sharp, so no fixture image is committed.
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import type { ProcessResult, VersionSpec } from "@unset/domains-content";
import sharp from "sharp";
import { afterAll, describe, expect, test } from "vitest";
import { createImagePool } from "./pool.ts";

const LIMITS = { maxBytes: 31_000_000, maxPixels: 70_000_000, maxEdge: 12_000 };
const MAIN: VersionSpec = {
  name: "main",
  format: "jpeg",
  fit: "inside",
  size: 2560,
  quality: 85,
  minQuality: 45,
  maxBytes: 2_000_000,
  required: true,
};
const SMALL: VersionSpec = {
  name: "w480",
  format: "webp",
  fit: "width",
  size: 480,
  quality: 70,
  minQuality: 30,
  maxBytes: 60_000,
  required: false,
};
const AVIF: VersionSpec = { ...SMALL, name: "w480a", format: "avif" };
const pool = createImagePool({ children: 2, queueMax: 8, timeoutMs: 20_000, addressSpaceMb: 8192 });
afterAll(() => pool.close());

const solid = (width: number, height: number, background = "#3366aa") =>
  sharp({ create: { width, height, channels: 3, background } });
const run = async (input: Buffer | Uint8Array, versions: VersionSpec[] = [MAIN]) =>
  pool.process(new Uint8Array(input), LIMITS, versions);
const ok = (result: ProcessResult) => {
  if (result.kind !== "ok") throw new Error(`refused: ${result.code}`);
  return result;
};
const contains = (haystack: Uint8Array, needle: string) => Buffer.from(haystack).includes(Buffer.from(needle));

/** A PNG holding only a header that declares `width` by `height`, with valid CRCs (a decompression bomb's front). */
function pngHeader(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = (crcTable[(c ^ b) & 0xff] as number) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(64))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("processing: what is kept", () => {
  test("ingest.strips_metadata: EXIF, GPS, XMP and ICC are gone from every version", async () => {
    const input = await solid(800, 600)
      .withExif({
        IFD0: { Copyright: "exif-marker-7731" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "43/1 39/1 0/1" },
      })
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">xmp-marker-7731</x:xmpmeta>')
      .jpeg()
      .toBuffer();
    expect(input.includes("exif-marker-7731")).toBe(true);
    const { versions } = ok(await run(input, [MAIN, SMALL, AVIF]));
    for (const version of versions) {
      expect(contains(version.bytes, "marker-7731")).toBe(false);
      const meta = await sharp(Buffer.from(version.bytes)).metadata();
      expect([meta.exif, meta.xmp, meta.iptc, meta.icc, meta.orientation]).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
    }
  });

  test("ingest.orientation: a tagged phone photo comes out upright", async () => {
    // 40x20, red left half; orientation 6 means "rotate 90 degrees clockwise to show", so red ends on top.
    const left = await solid(20, 20, "#ff0000").png().toBuffer();
    const input = await solid(40, 20, "#0000ff")
      .composite([{ input: left, left: 0, top: 0 }])
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 100 })
      .toBuffer();
    const result = ok(await run(input, [{ ...MAIN, format: "webp" }]));
    expect(result.source).toEqual({ format: "jpeg", width: 20, height: 40 });
    const { data } = await sharp(Buffer.from(result.versions[0]?.bytes ?? []))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(200); // top-left pixel is red
    expect(data[data.length - 1]).toBeGreaterThan(200); // bottom-right pixel is blue
  });

  test("ingest.srgb: a CMYK JPEG is converted to sRGB", async () => {
    const input = await solid(300, 200).toColourspace("cmyk").jpeg().toBuffer();
    expect((await sharp(input).metadata()).space).toBe("cmyk");
    const { versions } = ok(await run(input));
    expect((await sharp(Buffer.from(versions[0]?.bytes ?? [])).metadata()).space).toBe("srgb");
  });

  test("ingest.formats_and_sizes: proportions kept, never enlarged, each format as named", async () => {
    const big = ok(await run(await solid(4000, 3000).png().toBuffer(), [MAIN, SMALL, AVIF]));
    expect(big.versions.map((v) => [v.name, v.width, v.height])).toEqual([
      ["main", 2560, 1920],
      ["w480", 480, 360],
      ["w480a", 480, 360],
    ]);
    const formats = await Promise.all(
      big.versions.map(async (v) => (await sharp(Buffer.from(v.bytes)).metadata()).format),
    );
    expect(formats).toEqual(["jpeg", "webp", "heif"]);
    const tiny = ok(await run(await solid(100, 50).webp().toBuffer(), [MAIN]));
    expect([tiny.versions[0]?.width, tiny.versions[0]?.height]).toEqual([100, 50]);
  });

  test("ingest.avatar_crop: the chosen square, scaled to its size; a crop outside the picture is refused", async () => {
    const input = await solid(600, 400).jpeg().toBuffer();
    const avatar: VersionSpec = {
      ...MAIN,
      name: "avatar",
      fit: "square",
      size: 1000,
      crop: { left: 100, top: 50, size: 300 },
    };
    const made = ok(await run(input, [avatar]));
    expect([made.versions[0]?.width, made.versions[0]?.height]).toEqual([1000, 1000]);
    expect(await run(input, [{ ...avatar, crop: { left: 400, top: 0, size: 300 } }])).toEqual({
      kind: "refused",
      code: "image.cannot_use",
    });
  });

  test("ingest.variant_caps: a noisy 6000x4000 photo fits the main cap; an unreachable required cap is too large", async () => {
    const noise = await sharp({
      create: {
        width: 6000,
        height: 4000,
        channels: 3,
        background: "#808080",
        noise: { type: "gaussian", mean: 128, sigma: 60 },
      },
    })
      .jpeg({ quality: 95 })
      .toBuffer();
    const { versions } = ok(await run(noise));
    expect(versions[0]?.bytes.length).toBeLessThanOrEqual(2_000_000);
    expect(await run(noise, [{ ...MAIN, maxBytes: 1000 }])).toEqual({ kind: "refused", code: "image.too_large" });
  }, 60_000);
});

describe("processing: what is refused", () => {
  test("ingest.bomb: a header declaring 100,000 x 100,000 is refused before its pixels are decoded", async () => {
    const started = Date.now();
    expect(await run(pngHeader(100_000, 100_000))).toEqual({ kind: "refused", code: "image.too_many_pixels" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("ingest.pixel_cap: under the edge cap but over the pixel cap", async () => {
    expect(await run(pngHeader(10_000, 10_000))).toEqual({ kind: "refused", code: "image.too_many_pixels" });
  });

  test("ingest.truncated_is_cannot_use: half a JPEG", async () => {
    const whole = await solid(800, 600).jpeg().toBuffer();
    expect(await run(whole.subarray(0, whole.length / 2))).toEqual({ kind: "refused", code: "image.cannot_use" });
  });

  test("ingest.format_mismatch: PNG magic bytes in front of a JPEG", async () => {
    const jpeg = await solid(100, 100).jpeg().toBuffer();
    const input = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), jpeg]);
    expect(await run(input)).toEqual({ kind: "refused", code: "image.cannot_use" });
  });

  test("ingest.animated: an animated WebP is refused", async () => {
    const frames = [await solid(32, 32, "#123456").png().toBuffer(), await solid(32, 32, "#654321").png().toBuffer()];
    const animated = await sharp(frames, { join: { animated: true } })
      .webp()
      .toBuffer();
    expect(await run(animated)).toEqual({ kind: "refused", code: "image.animated" });
  });

  test("ingest.too_large and ingest.unsupported happen before any child is used", async () => {
    expect(await pool.process(new Uint8Array(32), { ...LIMITS, maxBytes: 16 }, [MAIN])).toEqual({
      kind: "refused",
      code: "image.too_large",
    });
    expect(await run(await solid(10, 10).gif().toBuffer())).toEqual({ kind: "refused", code: "image.unsupported" });
    expect(await run(await solid(10, 10).tiff().toBuffer())).toEqual({ kind: "refused", code: "image.unsupported" });
  });
});

describe("the pool", () => {
  const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname;
  const anyJpeg = () => solid(16, 16).jpeg().toBuffer();

  test("pool.sandbox: a child inherits no environment variable and no open file of its parent", async () => {
    const marker = join(mkdtempSync(join(tmpdir(), "pool-")), "pool-fd-marker");
    writeFileSync(marker, "secret");
    const fd = openSync(marker, "r");
    const probe = createImagePool({
      children: 1,
      queueMax: 1,
      timeoutMs: 5000,
      addressSpaceMb: 4096,
      childPath: fixture("report-child.ts"),
    });
    process.env.POOL_TEST_SECRET = "must-not-reach-the-child";
    try {
      const result = ok(await probe.process(new Uint8Array(await anyJpeg()), LIMITS, []));
      expect(result.source.width).toBe(0); // environment variables
      expect(result.source.height).toBe(0); // descriptors on the parent's open marker file
    } finally {
      closeSync(fd);
      delete process.env.POOL_TEST_SECRET;
      probe.close();
    }
  });

  test("pool.kill_on_timeout: a job that never ends is killed and the next child answers", async () => {
    const hanging = createImagePool({
      children: 1,
      queueMax: 2,
      timeoutMs: 300,
      addressSpaceMb: 4096,
      childPath: fixture("hang-child.ts"),
    });
    try {
      expect(await hanging.process(new Uint8Array(await anyJpeg()), LIMITS, [])).toEqual({
        kind: "refused",
        code: "image.timeout",
      });
      expect(await hanging.process(new Uint8Array(await anyJpeg()), LIMITS, [])).toEqual({
        kind: "refused",
        code: "image.timeout",
      });
    } finally {
      hanging.close();
    }
  });

  test("pool.native_crash: a child dying of SIGSEGV is cannot_use and is replaced", async () => {
    const crashing = createImagePool({
      children: 1,
      queueMax: 2,
      timeoutMs: 5000,
      addressSpaceMb: 4096,
      childPath: fixture("crash-child.ts"),
    });
    try {
      expect(await crashing.process(new Uint8Array(await anyJpeg()), LIMITS, [])).toEqual({
        kind: "refused",
        code: "image.cannot_use",
      });
      expect(await crashing.process(new Uint8Array(await anyJpeg()), LIMITS, [])).toEqual({
        kind: "refused",
        code: "image.cannot_use",
      });
    } finally {
      crashing.close();
    }
  });

  test("pool.queue_full: with one child and a queue of 8, the tenth job at once is busy", async () => {
    const hanging = createImagePool({
      children: 1,
      queueMax: 8,
      timeoutMs: 400,
      addressSpaceMb: 4096,
      childPath: fixture("hang-child.ts"),
    });
    try {
      const input = new Uint8Array(await anyJpeg());
      // Only a ready child takes a job; let the one child say it is ready first, so one job runs and eight wait.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const results = await Promise.all(Array.from({ length: 10 }, () => hanging.process(input, LIMITS, [])));
      expect(results.filter((r) => r.kind === "refused" && r.code === "image.busy")).toHaveLength(1);
    } finally {
      hanging.close();
    }
  }, 20_000);

  test("pool.memory_limit: children that cannot start back off, the pool goes down and answers busy", async () => {
    const events: string[] = [];
    const starved = createImagePool({
      children: 1,
      queueMax: 1,
      timeoutMs: 5000,
      addressSpaceMb: 256,
      onEvent: (event) => events.push(event),
    });
    try {
      expect(await starved.process(new Uint8Array(await anyJpeg()), LIMITS, [MAIN])).toEqual({
        kind: "refused",
        code: "image.busy",
      });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      // Backoff of 250, 500, 1000 ms: a tight loop would have forked hundreds of times by now.
      expect(events.filter((e) => e === "start_failed").length).toBeLessThanOrEqual(4);
      expect(events).toContain("down");
      expect(await starved.process(new Uint8Array(await anyJpeg()), LIMITS, [MAIN])).toEqual({
        kind: "refused",
        code: "image.busy",
      });
    } finally {
      starved.close();
    }
  }, 20_000);

  test("pool.recovers: a pool that went down comes back up once a child starts", async () => {
    // The fixture child counts its starts here (it runs with an empty environment, so its tmpdir is /tmp).
    const counter = `/tmp/pool-exit-twice-${process.pid}`;
    rmSync(counter, { force: true });
    const events: string[] = [];
    const flaky = createImagePool({
      children: 1,
      queueMax: 1,
      timeoutMs: 5000,
      addressSpaceMb: 4096,
      childPath: fixture("exit-twice-child.ts"),
      onEvent: (event) => events.push(event),
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      expect(events.slice(0, 3)).toEqual(["start_failed", "start_failed", "start_failed"]);
      expect(events).toContain("up");
    } finally {
      flaky.close();
      rmSync(counter, { force: true });
    }
  }, 20_000);
});
