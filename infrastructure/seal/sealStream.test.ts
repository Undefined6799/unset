// P1.14: the chunked `s1c` envelope. The known answer was computed independently with Python's `cryptography` 49.0.0
// AESGCM (scratch script, not committed): the header line, the whole object's SHA-256 and the final chunk's bytes.
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { sealContext } from "./context.ts";
import { type Keyring, parseKeyring } from "./keyring.ts";
import { SealError } from "./seal.ts";
import { createSealer } from "./sealer.ts";
import { CHUNK_BYTES } from "./sealStream.ts";

const key = (fill: number): string => Buffer.alloc(32, fill).toString("base64");
const keyring = (active: string, keys: Record<string, string>): Keyring =>
  parseKeyring(JSON.stringify({ active, keys })) as Keyring;
const K1 = keyring("k1", { k1: key(1) });
const A1 = sealContext("app.legal_hold.media_key", "1");
const SEALED_CHUNK = CHUNK_BYTES + 16;
const LIMIT = 64 * 1024 * 1024;

/** A stream of `bytes` cut into pieces of `piece` bytes, so chunk boundaries never line up with reads. */
const streamOf = (bytes: Uint8Array, piece = 10_007): ReadableStream<Uint8Array> =>
  ReadableStream.from(
    (function* () {
      for (let at = 0; at < bytes.length; at += piece) yield bytes.subarray(at, at + piece);
    })(),
  );

const collect = async (stream: ReadableStream<Uint8Array>): Promise<Buffer> => {
  const parts: Uint8Array[] = [];
  for await (const part of stream) parts.push(part);
  return Buffer.concat(parts);
};

/** The code a stream fails with, or "ok". */
async function codeOf(stream: ReadableStream<Uint8Array>): Promise<string> {
  try {
    await collect(stream);
    return "ok";
  } catch (error) {
    return error instanceof SealError ? error.code : String(error);
  }
}

/** A sealed object split into its header line and its sealed chunks. */
function split(sealed: Buffer): { header: Buffer; chunks: Buffer[] } {
  const end = sealed.indexOf(0x0a) + 1;
  const chunks: Buffer[] = [];
  for (let at = end; at < sealed.length; at += SEALED_CHUNK) chunks.push(sealed.subarray(at, at + SEALED_CHUNK));
  return { header: sealed.subarray(0, end), chunks };
}

describe("sealStream", () => {
  test("stream_roundtrip", { timeout: 60_000 }, async () => {
    const sealer = createSealer(K1);
    for (const size of [0, 1, CHUNK_BYTES, 25 * 1024 * 1024 + 1]) {
      const plaintext = Buffer.alloc(size);
      for (let i = 0; i < size; i += 4096) plaintext[i] = i % 251;
      const sealed = await collect(sealer.sealStream(streamOf(plaintext), A1, LIMIT));
      const opened = await collect(sealer.unsealStream(streamOf(sealed, 65_521), A1, LIMIT));
      expect(opened.equals(plaintext), `${size} bytes`).toBe(true);
    }
  });

  test("stream_truncated", async () => {
    const sealer = createSealer(K1);
    const sealed = await collect(sealer.sealStream(streamOf(Buffer.alloc(3 * CHUNK_BYTES + 5, 1)), A1, LIMIT));
    const { header, chunks } = split(sealed);
    expect(chunks.length).toBe(4);
    const [c0, c1, c2, c3] = chunks as [Buffer, Buffer, Buffer, Buffer];
    const open = (...parts: Buffer[]) => codeOf(sealer.unsealStream(streamOf(Buffer.concat(parts)), A1, LIMIT));
    expect(await open(header, c0, c1, c2)).toBe("seal.format");
    expect(await open(header, c0, c2, c3)).toBe("seal.auth_failed");
    expect(await open(header, c1, c0, c2, c3)).toBe("seal.auth_failed");
    expect(await open(header, c0, c1, c2, c3, c3)).toBe("seal.auth_failed");
    expect(await open(header)).toBe("seal.format");
    expect(await open(header.subarray(0, header.length - 1))).toBe("seal.format");
    expect(await open(Buffer.alloc(300, 0x61))).toBe("seal.format");
  });

  test("stream_context_bound", async () => {
    const sealer = createSealer(K1);
    const sealed = await collect(sealer.sealStream(streamOf(Buffer.alloc(2 * CHUNK_BYTES, 1)), A1, LIMIT));
    const other = sealContext("app.legal_hold.media_key", "2");
    const emitted: Uint8Array[] = [];
    let code = "ok";
    try {
      for await (const part of sealer.unsealStream(streamOf(sealed), other, LIMIT)) emitted.push(part);
    } catch (error) {
      code = (error as SealError).code;
    }
    expect(code).toBe("seal.auth_failed");
    expect(emitted).toEqual([]);
  });

  test("stream_max_bytes", async () => {
    const sealer = createSealer(K1);
    expect(await codeOf(sealer.sealStream(streamOf(Buffer.alloc(1001)), A1, 1000))).toBe("seal.too_large");
    const sealed = await collect(sealer.sealStream(streamOf(Buffer.alloc(1001)), A1, 1001));
    expect(await codeOf(sealer.unsealStream(streamOf(sealed), A1, 1000))).toBe("seal.too_large");
    expect(await codeOf(sealer.unsealStream(streamOf(sealed), A1, 1001))).toBe("ok");
  });

  test("stream_rewrap", async () => {
    const sealed = await collect(createSealer(K1).sealStream(streamOf(Buffer.from("held media")), A1, LIMIT));
    const { header, chunks } = split(sealed);
    const rotated = createSealer(keyring("k2", { k1: key(1), k2: key(2) }));
    const line = rotated.rewrap(header.subarray(0, -1).toString("ascii"));
    expect(line.startsWith("s1c.k2.")).toBe(true);
    const onlyK2 = createSealer(keyring("k2", { k2: key(2) }));
    const moved = Buffer.concat([Buffer.from(`${line}\n`), ...chunks]);
    expect((await collect(onlyK2.unsealStream(streamOf(moved), A1, LIMIT))).toString()).toBe("held media");
  });

  test("stream_known_answer", async () => {
    // DEK 100..131, wrap IV 0x07 × 12, prefix 0x03 × 7, KEK 0..31; two chunks: 64 KiB of "a", then "tail!".
    const queue = [Buffer.from(Array.from({ length: 32 }, (_, i) => 100 + i)), Buffer.alloc(12, 7), Buffer.alloc(7, 3)];
    const ring = keyring("k1", { k1: Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64") });
    const sealer = createSealer(ring, (bytes) => {
      const next = queue.shift() as Buffer;
      expect(next.length).toBe(bytes);
      return next;
    });
    const context = sealContext("app.oauth_sessions.token_set", "did:plc:abcdefghijklmnopqrstuvwx");
    const plaintext = Buffer.concat([Buffer.alloc(CHUNK_BYTES, "a"), Buffer.from("tail!")]);
    const sealed = await collect(sealer.sealStream(streamOf(plaintext), context, LIMIT));
    const { header, chunks } = split(sealed);
    expect(header.toString("ascii")).toBe(
      "s1c.k1.BwcHBwcHBwcHBwcH.aw_AOwdmvZ-q8H3v8CCG6NUp-wTwjvtigsYghYRfsJgXKc_9npWgjur4GMNvyZ-u.AwMDAwMDAw\n",
    );
    expect(chunks[1]?.toString("hex")).toBe("a3c9f3e79c5883dcf1841328650f16cebffe6aa78b");
    expect(sealed.length).toBe(65_673);
    expect(createHash("sha256").update(sealed).digest("hex")).toBe(
      "ed0252141b73cb46d396f31f1fda7c8b232b4dfd44429d8764ea7d890a5ee846",
    );
  });
});
