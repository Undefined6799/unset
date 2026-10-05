// The client's address as a value that cannot leak (P1.05; plan §2 rule 16, invariant 3). It prints, serialises and
// inspects as `[ip]`; the only way out is `rateKey()`, the bucket key rate limits use (P1.06).
import { isIPv4, isIPv6 } from "node:net"; // guard-allow: egress parses addresses only, opens no socket

const HIDDEN = "[ip]";
const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const MAPPED_V4_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

export class ClientIp {
  readonly kind: "v4" | "v6";
  readonly #key: string;

  private constructor(kind: "v4" | "v6", key: string) {
    this.kind = kind;
    this.#key = key;
  }

  /**
   * A literal address, or null. An IPv4-mapped IPv6 address becomes IPv4, so one client keys one bucket. Zone ids,
   * hostnames and anything `node:net` does not accept as an address are null.
   */
  static parse(text: string): ClientIp | null {
    const address = unmapV4(text);
    if (isIPv4(address)) return new ClientIp("v4", address);
    if (isIPv6(address) && !address.includes("%")) return new ClientIp("v6", prefix64(address));
    return null;
  }

  /** The rate-limit key: the IPv4 address, or the IPv6 /64, so rotating inside a /64 earns no fresh bucket. */
  rateKey(): string {
    return this.#key;
  }

  toString(): string {
    return HIDDEN;
  }

  toJSON(): string {
    return HIDDEN;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return HIDDEN;
  }
}

/**
 * An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`, or its hex form `::ffff:a00:2`) as `a.b.c.d`; anything else unchanged.
 * Node 26.10's BlockList also matches the mapped forms against IPv4 rules (test mapped_forms_match_like_v4); we unmap
 * first anyway, as net-guard does, so the rate key never depends on how a proxy wrote the address.
 */
export function unmapV4(text: string): string {
  const dotted = MAPPED_V4.exec(text)?.[1];
  if (dotted !== undefined) return dotted;
  const hex = MAPPED_V4_HEX.exec(text);
  if (hex === null) return text;
  const [high, low] = [Number.parseInt(hex[1] ?? "", 16), Number.parseInt(hex[2] ?? "", 16)];
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

/** The first four hextets of a valid IPv6 address, expanded and lowercase, as `a:b:c:d::/64`. */
function prefix64(address: string): string {
  const [head = "", tail] = address.toLowerCase().split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return `${groups
    .slice(0, 4)
    .map((g) => g.padStart(4, "0"))
    .join(":")}::/64`;
}
