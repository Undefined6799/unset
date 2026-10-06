// Key rotation without downtime (P1.14): a value or a stream header sealed under an old KEK gets its DEK re-wrapped by
// the active one. The data part is untouched, so no plaintext is ever produced and the value stays bound to its context.
import { type Keys, SealError, unwrapDek, wrapDek } from "./seal.ts";

/**
 * `sealed` (an `s1` value, or an `s1c` header line without its newline) with its DEK wrapped by the active key.
 * A value already under the active key comes back unchanged.
 */
export function rewrap(keys: Keys, sealed: string): string {
  const parts = sealed.split(".");
  const shape = (parts[0] === "s1" && parts.length === 6) || (parts[0] === "s1c" && parts.length === 5);
  if (!shape) throw new SealError("seal.format");
  const [form, kid, wrapIv, wrapped, ...data] = parts as [string, string, string, string, ...string[]];
  const dek = unwrapDek(keys, kid, wrapIv, wrapped);
  if (kid === keys.keyring.active) return sealed;
  return [form, wrapDek(keys, dek), ...data].join(".");
}
