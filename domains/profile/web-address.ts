// Web addresses a member types: the profile's website and, on cards, links, entries and buttons (ADR 0051).

/** A web address as people type it: "alice.dev" means https://alice.dev; one with any scheme is left as it is. */
export const withScheme = (text: string) => (/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);

/**
 * A plain http or https URL with a host and no credentials, as the lexicon's uri fields expect, on the public web: a
 * link that would open the visitor's own machine or local network (a router's admin page, a cloud metadata address)
 * is not one, though only the visitor's browser ever follows it (staging break test 2026-11-21).
 */
export function isWebAddress(text: string): boolean {
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const url = new URL(text);
    return url.hostname !== "" && url.username === "" && url.password === "" && !isLocalHost(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Names that never leave the visitor's machine or network: localhost (RFC 6761), .local (RFC 6762), home.arpa
 * (RFC 8375) and .internal (ICANN, 2024).
 */
const LOCAL_NAME = /(^|\.)(localhost|local|home\.arpa|internal)$/;

/**
 * `hostname` as WHATWG URL gives it: lower case, an IPv4 address in dotted decimal however it was typed ("127.1",
 * "0x7f.0.0.1" and "2130706433" are all 127.0.0.1), an IPv6 address in brackets, compressed, in hex.
 */
function isLocalHost(hostname: string): boolean {
  const name = hostname.replace(/\.$/, "");
  if (name.startsWith("[")) return isLocalIpv6(name.slice(1, -1));
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(name);
  if (ipv4 !== null) return isLocalIpv4(ipv4.slice(1).map(Number));
  return LOCAL_NAME.test(name);
}

/** This network, loopback, private, carrier-grade NAT and link-local (RFC 6890). */
function isLocalIpv4([a = 0, b = 0]: readonly number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/** Unspecified, loopback, unique local fc00::/7, link-local fe80::/10, and an IPv4-mapped local address. */
function isLocalIpv6(address: string): boolean {
  if (address === "::" || address === "::1") return true;
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (mapped !== null) {
    const [high = 0, low = 0] = mapped.slice(1).map((group) => Number.parseInt(group, 16));
    return isLocalIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  const first = Number.parseInt(address.split(":")[0] || "0", 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}
