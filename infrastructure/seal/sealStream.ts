// The one chunked envelope (P1.14, format `s1c`) for objects too large for `seal`: held media and report evidence.
// A header line carries the wrapped DEK exactly as `s1` does, then the plaintext follows in 64 KiB chunks, each sealed
// on its own with IV = prefix ‖ uint32-BE index ‖ final flag. This is the STREAM construction (Hoang, Reyhanitabar,
// Rogaway and Vizár, "Online Authenticated-Encryption and its Nonce-Reuse Misuse-Resistance", CRYPTO 2015; as in age
// and Tink): a reordered or dropped chunk fails its index, and a stream that ends on a chunk not flagged final is cut.
import type { SealContext } from "./context.ts";
import { b64, decrypt, encrypt, type Keys, newDek, SealError, TAG_BYTES, unb64, unwrapDek } from "./seal.ts";

export const CHUNK_BYTES = 64 * 1024;
const PREFIX_BYTES = 7;
const MAX_HEADER = 256;
const CHUNK_AAD = "unset.seal.chunk.v1|";

const chunkIv = (prefix: Buffer, index: number, final: boolean): Buffer => {
  const iv = Buffer.alloc(PREFIX_BYTES + 5);
  prefix.copy(iv);
  iv.writeUInt32BE(index, PREFIX_BYTES);
  iv[PREFIX_BYTES + 4] = final ? 1 : 0;
  return iv;
};

/** Sealed `source` for `context`: the header line, then each chunk's ciphertext and tag. Errors `seal.too_large` once
 * the source passes `maxBytes`; the caller then discards what was written. */
export function sealStream(
  keys: Keys,
  source: ReadableStream<Uint8Array>,
  context: SealContext,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  return ReadableStream.from(
    (async function* () {
      const { dek, wrapParts } = newDek(keys);
      const prefix = keys.random(PREFIX_BYTES);
      yield Buffer.from(`s1c.${wrapParts}.${b64(prefix)}\n`, "ascii");
      let pending: Buffer = Buffer.alloc(0);
      let index = 0;
      let total = 0;
      for await (const piece of source) {
        total += piece.length;
        if (total > maxBytes) throw new SealError("seal.too_large");
        pending = Buffer.concat([pending, piece]);
        // A full chunk is sealed only once more data follows it, so the last chunk is always the one flagged final.
        while (pending.length > CHUNK_BYTES) {
          yield encrypt(dek, chunkIv(prefix, index++, false), pending.subarray(0, CHUNK_BYTES), CHUNK_AAD + context);
          pending = pending.subarray(CHUNK_BYTES);
        }
      }
      yield encrypt(dek, chunkIv(prefix, index, true), pending, CHUNK_AAD + context);
    })(),
  );
}

/** Reads the header line (at most 256 bytes) and unwraps its DEK; returns the DEK, the IV prefix and what follows. */
function readHeader(keys: Keys, head: Buffer): Header | null {
  const end = head.indexOf(0x0a);
  if (end === -1) {
    if (head.length > MAX_HEADER) throw new SealError("seal.format");
    return null;
  }
  if (end > MAX_HEADER) throw new SealError("seal.format");
  const parts = head.subarray(0, end).toString("latin1").split(".");
  if (parts.length !== 5 || parts[0] !== "s1c") throw new SealError("seal.format");
  const [, kid, wrapIv, wrapped, prefix] = parts as [string, string, string, string, string];
  const dek = unwrapDek(keys, kid, wrapIv, wrapped);
  return { dek, prefix: unb64(prefix, PREFIX_BYTES), rest: head.subarray(end + 1) };
}

/**
 * The plaintext of a stream sealed for `context`. A chunk is emitted only after its own tag verifies; on any error the
 * caller discards what was already emitted (verified earlier chunks of a stream that failed are never served).
 */
export function unsealStream(
  keys: Keys,
  sealed: ReadableStream<Uint8Array>,
  context: SealContext,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  const sealedChunk = CHUNK_BYTES + TAG_BYTES;
  return ReadableStream.from(
    (async function* () {
      let pending: Buffer = Buffer.alloc(0);
      let header: Header | null = null;
      let index = 0;
      let total = 0;
      const counted = (plain: Buffer): Buffer => {
        total += plain.length;
        if (total > maxBytes) throw new SealError("seal.too_large");
        return plain;
      };
      for await (const piece of sealed) {
        pending = Buffer.concat([pending, piece]);
        if (header === null) {
          header = readHeader(keys, pending);
          if (header === null) continue;
          pending = header.rest;
        }
        // A full chunk with more bytes after it is a middle chunk; the bytes left at the end are the final one.
        while (pending.length > sealedChunk) {
          yield counted(openChunk(header, context, index++, pending.subarray(0, sealedChunk), false));
          pending = pending.subarray(sealedChunk);
        }
      }
      if (header === null) throw new SealError("seal.format");
      yield counted(openLast(header, context, index, pending));
    })(),
  );
}

type Header = { dek: Buffer; prefix: Buffer; rest: Buffer };

const openChunk = (header: Header, context: SealContext, index: number, bytes: Buffer, final: boolean): Buffer =>
  decrypt(header.dek, chunkIv(header.prefix, index, final), bytes, CHUNK_AAD + context);

/** The last chunk must be flagged final. One that opens only as a middle chunk means the stream was cut: `format`. */
function openLast(header: Header, context: SealContext, index: number, bytes: Buffer): Buffer {
  try {
    return openChunk(header, context, index, bytes, true);
  } catch (error) {
    if (!(error instanceof SealError) || error.code !== "seal.auth_failed") throw error;
    openChunk(header, context, index, bytes, false); // Throws auth_failed again unless the stream was cut here.
    throw new SealError("seal.format");
  }
}
