// The sealer a process builds once in its composition root from its keyring (P1.14). Every seal operation goes through
// it, so the per-kid wrap count (`seal.count_by_kid`) covers them all.
import { randomBytes } from "node:crypto";
import { checkContext, type SealContext } from "./context.ts";
import type { Keyring } from "./keyring.ts";
import { rewrap } from "./rewrap.ts";
import { type Keys, seal, unseal } from "./seal.ts";
import { sealStream, unsealStream } from "./sealStream.ts";

export type Sealer = {
  seal(plaintext: Uint8Array, context: SealContext): string;
  unseal(sealed: string, context: SealContext): Uint8Array;
  sealJson(value: unknown, context: SealContext): string;
  unsealJson(sealed: string, context: SealContext): unknown;
  sealStream(source: ReadableStream<Uint8Array>, context: SealContext, maxBytes: number): ReadableStream<Uint8Array>;
  unsealStream(sealed: ReadableStream<Uint8Array>, context: SealContext, maxBytes: number): ReadableStream<Uint8Array>;
  rewrap(sealed: string): string;
  /** `seal.count_by_kid`: how many DEKs each key has wrapped in this process. No context, no value. */
  countByKid(): ReadonlyMap<string, number>;
};

/** The context as given, after checking its shape at run time (fail closed on a cast from a free string). */
function checked(context: SealContext): SealContext {
  checkContext(context);
  return context;
}

/** `random` is fixed only by the known-answer tests; everything else uses the system CSPRNG. */
export function createSealer(keyring: Keyring, random: (bytes: number) => Buffer = randomBytes): Sealer {
  const keys: Keys = { keyring, random, wraps: new Map() };
  return {
    seal: (plaintext, context) => seal(keys, plaintext, checked(context)),
    unseal: (sealed, context) => unseal(keys, sealed, checked(context)),
    sealJson: (value, context) => seal(keys, Buffer.from(JSON.stringify(value), "utf8"), checked(context)),
    unsealJson: (sealed, context) => JSON.parse(Buffer.from(unseal(keys, sealed, checked(context))).toString("utf8")),
    sealStream: (source, context, maxBytes) => sealStream(keys, source, checked(context), maxBytes),
    unsealStream: (sealed, context, maxBytes) => unsealStream(keys, sealed, checked(context), maxBytes),
    rewrap: (sealed) => rewrap(keys, sealed),
    countByKid: () => new Map(keys.wraps),
  };
}
