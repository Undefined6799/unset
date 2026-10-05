// Trusted proxy (P1.05; plan §2 rule 16, §5.2, §5.7): the client address comes from the one header the edge sets,
// only when the request came from the edge, or from the socket where there is no edge (admin, behind Tailscale).
// Every doubt is null, never a guess: P1.06 limits an unknown client in the strictest shared bucket.
import { BlockList, isIPv4, isIPv6 } from "node:net"; // guard-allow: egress CIDR matching only, no socket
import { ClientIp, unmapV4 } from "./clientIp.ts";

export type ProxySettings = Readonly<{
  TRUSTED_PROXY_MODE: "header" | "socket";
  TRUSTED_PROXY_HEADER: string;
  TRUSTED_PROXY_CIDRS: readonly string[];
  TRUSTED_PROXY_HOPS: number;
}>;

/** A CIDR `address/prefix` with a non-zero prefix in range, or undefined: a trust-everything range is refused. */
export function parseCidr(text: string): { address: string; prefix: number; type: "ipv4" | "ipv6" } | undefined {
  const [address = "", bits, extra] = text.split("/");
  if (bits === undefined || extra !== undefined || !/^[1-9][0-9]{0,2}$/.test(bits)) return undefined;
  const prefix = Number(bits);
  if (isIPv4(address)) return prefix <= 32 ? { address, prefix, type: "ipv4" } : undefined;
  if (isIPv6(address) && !address.includes("%")) return prefix <= 128 ? { address, prefix, type: "ipv6" } : undefined;
  return undefined;
}

const PORTED_V4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
const BRACKETED_V6 = /^\[([^\]]+)\](?::\d{1,5})?$/;

/** One forwarded entry as a bare address: `[v6]`, `[v6]:port` and `v4:port` lose their decoration. */
function bareAddress(entry: string): string {
  return BRACKETED_V6.exec(entry)?.[1] ?? PORTED_V4.exec(entry)?.[1] ?? entry;
}

/**
 * Resolves the client address of a request: `(headers, peer) → ClientIp | null`, where `peer` is the socket's remote
 * address. `onUntrustedPeer` runs when a header-mode request did not come from the edge (it carries no address).
 */
export function createClientIpResolver(settings: ProxySettings, onUntrustedPeer: () => void) {
  const trusted = new BlockList();
  for (const cidr of settings.TRUSTED_PROXY_CIDRS) {
    const parsed = parseCidr(cidr);
    if (parsed) trusted.addSubnet(parsed.address, parsed.prefix, parsed.type);
  }
  /** Whether a parsed address (`ip` from `address`) is one of the edge's own. */
  const isTrusted = (ip: ClientIp, address: string) =>
    trusted.check(unmapV4(address), ip.kind === "v4" ? "ipv4" : "ipv6");

  /** Step 3d–f: the rightmost entry that is not a trusted proxy, looking at most TRUSTED_PROXY_HOPS entries. */
  function fromHeader(value: string): ClientIp | null {
    const entries = value.split(",").map((e) => e.trim());
    for (let hop = 0; hop < settings.TRUSTED_PROXY_HOPS; hop += 1) {
      const entry = entries[entries.length - 1 - hop];
      if (entry === undefined || entry === "") return null;
      const address = bareAddress(entry);
      const ip = ClientIp.parse(address);
      if (ip === null) return null;
      if (!isTrusted(ip, address)) return ip;
    }
    return null;
  }

  function resolve(headers: Headers, peer: string | undefined): ClientIp | null {
    if (peer === undefined) return null;
    const peerIp = ClientIp.parse(peer);
    if (peerIp === null) return null;
    if (settings.TRUSTED_PROXY_MODE === "socket") return peerIp;
    if (!isTrusted(peerIp, peer)) {
      onUntrustedPeer();
      return null;
    }
    // Headers.get joins repeated lines with ", " (RFC 9110 list semantics); no other forwarding header is read.
    const value = headers.get(settings.TRUSTED_PROXY_HEADER);
    return value === null || value.trim() === "" ? null : fromHeader(value);
  }

  return (headers: Headers, peer: string | undefined): ClientIp | null => {
    try {
      return resolve(headers, peer);
    } catch {
      return null; // fail closed: an unknown client, never someone else
    }
  };
}
