// Envelope encryption for values the app must store and read back itself (P1.14; plan §5.3, §6.1 ASVS V11). Each
// value gets a fresh 32-byte data key (DEK), wrapped by the active key-encryption key (KEK) named in the value, and the
// data is bound to its column and row by the context as additional data. AES-256-GCM throughout (node:crypto,
// https://nodejs.org/docs/latest-v26.x/api/crypto.html#class-cipher).
//
// Random IVs are safe here: every value has its own DEK, so a data IV never repeats under a key, and a KEK wraps one
// DEK per value with a random 96-bit IV, far below NIST SP 800-38D's 2^32 bound for random IVs per key. The per-kid
// wrap count lets rotation happen long before that.
import { createCipheriv, createDecipheriv } from "node:crypto";
import type { SealContext } from "./context.ts";
import { SealError } from "./error.ts";
import { type Keyring, KID } from "./keyring.ts";

/** What every seal operation needs: the keys, a source of random bytes (fixed in the known-answer tests), and the
 * per-kid count of wraps (the `seal.count_by_kid` metric). */
export type Keys = {
  readonly keyring: Keyring;
  readonly random: (bytes: number) => Buffer;
  readonly wraps: Map<string, number>;
};

export const IV_BYTES = 12;
export const KEY_BYTES = 32;
export const TAG_BYTES = 16;
export const MAX_PLAINTEXT = 1024 * 1024;
const WRAP_AAD = "unset.seal.wrap.v1|";
const DATA_AAD = "unset.seal.data.v1|";
const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** AES-256-GCM with a 16-byte tag appended. */
export function encrypt(key: Buffer, iv: Buffer, plaintext: Uint8Array, aad: string): Buffer {
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES }).setAAD(Buffer.from(aad));
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

/** The plaintext, or `seal.auth_failed` when the tag does not verify; nothing is returned before it does. */
export function decrypt(key: Buffer, iv: Buffer, sealed: Buffer, aad: string): Buffer {
  if (sealed.length < TAG_BYTES) throw new SealError("seal.format");
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES }).setAAD(Buffer.from(aad));
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
  try {
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)), decipher.final()]);
  } catch {
    throw new SealError("seal.auth_failed");
  }
}

export const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

/** Unpadded base64url of exactly `length` bytes (any length when null), or `seal.format`. */
export function unb64(text: string, length: number | null): Buffer {
  const bytes = Buffer.from(text, "base64url");
  if (!BASE64URL.test(text) || b64(bytes) !== text || (length !== null && bytes.length !== length))
    throw new SealError("seal.format");
  return bytes;
}

/** A fresh DEK wrapped by the active KEK: the `<kid>.<wrapIv>.<wrappedDek+tag>` parts and the DEK itself. */
export function newDek(keys: Keys): { dek: Buffer; wrapParts: string } {
  const dek = keys.random(KEY_BYTES);
  return { dek, wrapParts: wrapDek(keys, dek) };
}

/** `dek` wrapped by the active KEK, as `<kid>.<wrapIv>.<wrappedDek+tag>`, counted against that kid. */
export function wrapDek(keys: Keys, dek: Buffer): string {
  const kid = keys.keyring.active;
  const kek = keys.keyring.key(kid);
  if (kek === undefined) throw new SealError("seal.unknown_kid"); // The keyring parser already refuses this.
  const wrapIv = keys.random(IV_BYTES);
  keys.wraps.set(kid, (keys.wraps.get(kid) ?? 0) + 1);
  return `${kid}.${b64(wrapIv)}.${b64(encrypt(kek, wrapIv, dek, WRAP_AAD + kid))}`;
}

/** Steps 2 to 4 for the key: the DEK the three wrap parts hold, or the code that refuses them. */
export function unwrapDek(keys: Keys, kid: string, wrapIv: string, wrapped: string): Buffer {
  const kek = KID.test(kid) ? keys.keyring.key(kid) : undefined;
  if (kek === undefined) throw new SealError("seal.unknown_kid");
  return decrypt(kek, unb64(wrapIv, IV_BYTES), unb64(wrapped, KEY_BYTES + TAG_BYTES), WRAP_AAD + kid);
}

/** `s1.<kid>.<wrapIv>.<wrappedDek+tag>.<iv>.<ciphertext+tag>`; at most 1 MiB of plaintext (larger: `sealStream`). */
export function seal(keys: Keys, plaintext: Uint8Array, context: SealContext): string {
  if (plaintext.length > MAX_PLAINTEXT) throw new SealError("seal.too_large");
  const { dek, wrapParts } = newDek(keys);
  const iv = keys.random(IV_BYTES);
  return `s1.${wrapParts}.${b64(iv)}.${b64(encrypt(dek, iv, plaintext, DATA_AAD + context))}`;
}

/** The plaintext of a value sealed for `context`, checked in order: shape, key id, lengths, key tag, data tag. */
export function unseal(keys: Keys, sealed: string, context: SealContext): Uint8Array {
  const parts = sealed.split(".");
  if (parts.length !== 6 || parts[0] !== "s1") throw new SealError("seal.format");
  const [, kid, wrapIv, wrapped, iv, data] = parts as [string, string, string, string, string, string];
  const dek = unwrapDek(keys, kid, wrapIv, wrapped);
  const ciphertext = unb64(data, null);
  if (ciphertext.length > MAX_PLAINTEXT + TAG_BYTES) throw new SealError("seal.too_large");
  return decrypt(dek, unb64(iv, IV_BYTES), ciphertext, DATA_AAD + context);
}
