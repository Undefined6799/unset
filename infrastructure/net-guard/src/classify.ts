// Address and name classification (P1.18). Salvaged from the prototype's net-guard (normalisation, embedded IPv4,
// the loopback-literal lesson); the hand-written range checks are replaced by RANGES and node:net BlockList.
import { BlockList, isIP } from "node:net";
import { type AddressClass, RANGES } from "./ranges.ts";

export type Classification = "public" | AddressClass;

/** One BlockList per class, built from the table once. */
const LISTS: readonly (readonly [AddressClass, BlockList])[] = (["loopback", "private", "reserved"] as const).map(
  (cls) => {
    const list = new BlockList();
    for (const range of RANGES.filter((r) => r.class === cls)) {
      const [network = "", prefix = ""] = range.cidr.split("/");
      list.addSubnet(network, Number(prefix), network.includes(":") ? "ipv6" : "ipv4");
    }
    return [cls, list] as const;
  },
);

/**
 * Lowercase, without URL brackets, a trailing dot or an IPv6 zone id. `pds.internal.` is the same name as
 * `pds.internal`, and a zone id (`fe80::1%eth0`) must not hide a link-local address.
 */
export function normaliseHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .replace(/%.*$/, "");
}

/** The eight 16-bit groups of an IPv6 literal (already checked by `isIP`), embedded dotted IPv4 included. */
function ipv6Groups(ip: string): number[] {
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  const hex = dotted
    ? ip.slice(0, dotted.index) +
      [
        ((Number(dotted[1]) << 8) | Number(dotted[2])).toString(16),
        ((Number(dotted[3]) << 8) | Number(dotted[4])).toString(16),
      ].join(":")
    : ip;
  const [head = "", tail] = hex.split("::");
  const parse = (part: string): number[] => (part === "" ? [] : part.split(":").map((g) => Number.parseInt(g, 16)));
  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);
  return [...left, ...Array<number>(8 - left.length - right.length).fill(0), ...right];
}

const ipv4Of = (hi: number, lo: number): string => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
const allZero = (groups: number[]): boolean => groups.every((g) => g === 0);

/**
 * The IPv4 address an IPv6 form carries to: mapped `::ffff:0:0/96`, compatible `::a.b.c.d`, NAT64 `64:ff9b::/96`
 * and 6to4 `2002::/16`. `::` and `::1` are not compatible addresses; the table classifies them.
 */
function embeddedIpv4(ip: string): string | null {
  const g = ipv6Groups(ip);
  const [g0 = 0, g1 = 0, g2 = 0, , , g5 = 0, g6 = 0, g7 = 0] = g;
  if (allZero(g.slice(0, 5)) && g5 === 0xffff) return ipv4Of(g6, g7);
  if (allZero(g.slice(0, 6)) && !(g6 === 0 && g7 <= 1)) return ipv4Of(g6, g7);
  if (g0 === 0x64 && g1 === 0xff9b && allZero(g.slice(2, 6))) return ipv4Of(g6, g7);
  if (g0 === 0x2002) return ipv4Of(g1, g2);
  return null;
}

/**
 * The class of an IP literal. Embedded IPv4 forms are classified as the address they carry. Anything that is not an
 * IP literal (a hostname, `127.attacker.example`, garbage) is `reserved`: classification never guesses.
 */
export function classifyAddress(ip: string): Classification {
  const address = normaliseHost(ip);
  const version = isIP(address);
  if (version === 0) return "reserved";
  if (version === 6) {
    const embedded = embeddedIpv4(address);
    if (embedded !== null) return classifyAddress(embedded);
  }
  const type = version === 4 ? "ipv4" : "ipv6";
  return LISTS.find(([, list]) => list.check(address, type))?.[0] ?? "public";
}

const INTERNAL_SUFFIXES = [".internal", ".local", ".localhost", ".home.arpa"];
const INTERNAL_NAMES = new Set(["localhost", "metadata.google.internal", "instance-data"]);

/** A name that can only mean something inside a private network: single labels, internal suffixes, metadata names. */
export function isInternalName(host: string): boolean {
  const name = normaliseHost(host);
  if (isIP(name) !== 0) return false;
  if (!name.includes(".")) return true; // single label: resolved by a search domain, never a public name
  return INTERNAL_NAMES.has(name) || INTERNAL_SUFFIXES.some((suffix) => name.endsWith(suffix));
}
