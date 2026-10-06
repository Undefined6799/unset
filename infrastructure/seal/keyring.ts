// The seal keyring (P1.14; plan §5.3): the key-encryption keys, by key id, and which one seals. Read once at boot from
// the secret file SEAL_KEYRING_FILE, never from plain env; a malformed keyring refuses boot (ConfigError).
import { inspect } from "node:util";
import type { Field } from "@unset/shared-config";

/** A key id: what a sealed value names in its second part. */
export const KID = /^[a-z0-9]{1,16}$/;
const KEY_BYTES = 32;
const MAX_KEYS = 4;
const HIDDEN = "[keyring]";

/**
 * The key-encryption keys. The keys sit in a private field, so no printing, JSON or enumeration (the config loader's
 * freeze walks enumerable values) ever reaches them; every way of printing the keyring gives `[keyring]`.
 */
export class Keyring {
  readonly active: string;
  readonly #keys: ReadonlyMap<string, Buffer>;

  constructor(active: string, keys: ReadonlyMap<string, Buffer>) {
    this.active = active;
    this.#keys = keys;
    Object.freeze(this);
  }

  /** The key for `kid`, or undefined when the keyring does not hold it. */
  key(kid: string): Buffer | undefined {
    return this.#keys.get(kid);
  }

  toString(): string {
    return HIDDEN;
  }

  toJSON(): string {
    return HIDDEN;
  }

  [inspect.custom](): string {
    return HIDDEN;
  }
}

/** Standard base64 with padding, as written; Buffer's decoder skips bad characters, so the round trip is checked. */
function key32(value: unknown): Buffer | undefined {
  if (typeof value !== "string") return undefined;
  const key = Buffer.from(value, "base64");
  return key.length === KEY_BYTES && key.toString("base64") === value ? key : undefined;
}

/**
 * `{ "active": "<kid>", "keys": { "<kid>": "<base64 of 32 bytes>", … } }`: one to four keys, every kid matching `KID`,
 * `active` among them, no other field. Anything else is undefined (the loader reports the key `invalid`).
 */
export function parseKeyring(raw: string): Keyring | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return undefined;
  const { active, keys, ...rest } = json as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || typeof active !== "string") return undefined;
  if (typeof keys !== "object" || keys === null || Array.isArray(keys)) return undefined;
  const entries = Object.entries(keys);
  if (entries.length < 1 || entries.length > MAX_KEYS) return undefined;
  const parsed = new Map<string, Buffer>();
  for (const [kid, value] of entries) {
    const key = key32(value);
    if (!KID.test(kid) || key === undefined) return undefined;
    parsed.set(kid, key);
  }
  return parsed.has(active) ? new Keyring(active, parsed) : undefined;
}

/** The keyring as a config field: read from the file named by `<KEY>_FILE`, like any `secretFile`. */
export const keyringFile = (): Field<Keyring> => ({ kind: "secretFile", parse: parseKeyring });

/** What a process that seals merges into its config schema. */
export const sealFields = { SEAL_KEYRING: keyringFile() };
