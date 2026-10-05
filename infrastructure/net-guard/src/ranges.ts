// The one table of non-public address ranges (P1.18; plan §2 rule 13). Every egress decision and the forward proxy's
// deny list (P1.18b) derive from this table; never write a second copy of "private".
//
// Sources: IANA IPv4 and IPv6 Special-Purpose Address Registries
// (https://www.iana.org/assignments/iana-ipv4-special-registry, …/iana-ipv6-special-registry).
//
// Classes: `private` is the address space our own internal services live on (Docker networks, unique-local IPv6),
// the only space an internal-only policy accepts besides loopback. Link-local (cloud metadata), CGNAT (also used for
// metadata and VPN overlays) and every other special range are `reserved`: no policy ever connects to them.

export type AddressClass = "private" | "loopback" | "reserved";
export type Range = { readonly cidr: string; readonly class: AddressClass };

export const RANGES: readonly Range[] = [
  { cidr: "0.0.0.0/8", class: "reserved" }, // "this network"
  { cidr: "10.0.0.0/8", class: "private" },
  { cidr: "100.64.0.0/10", class: "reserved" }, // shared address space (CGNAT)
  { cidr: "127.0.0.0/8", class: "loopback" },
  { cidr: "169.254.0.0/16", class: "reserved" }, // link-local, cloud metadata
  { cidr: "172.16.0.0/12", class: "private" },
  { cidr: "192.0.0.0/24", class: "reserved" }, // IETF protocol assignments
  { cidr: "192.0.2.0/24", class: "reserved" }, // TEST-NET-1
  { cidr: "192.88.99.0/24", class: "reserved" }, // 6to4 relay anycast
  { cidr: "192.168.0.0/16", class: "private" },
  { cidr: "198.18.0.0/15", class: "reserved" }, // benchmarking
  { cidr: "198.51.100.0/24", class: "reserved" }, // TEST-NET-2
  { cidr: "203.0.113.0/24", class: "reserved" }, // TEST-NET-3
  { cidr: "224.0.0.0/4", class: "reserved" }, // multicast
  { cidr: "240.0.0.0/4", class: "reserved" }, // reserved for future use
  { cidr: "255.255.255.255/32", class: "reserved" }, // limited broadcast
  { cidr: "::/128", class: "reserved" }, // unspecified
  { cidr: "::1/128", class: "loopback" },
  { cidr: "64:ff9b:1::/48", class: "reserved" }, // NAT64 local use
  { cidr: "100::/64", class: "reserved" }, // discard-only
  { cidr: "::ffff:0:0:0/96", class: "reserved" }, // IPv4-translated (SIIT)
  { cidr: "2001::/23", class: "reserved" }, // IETF protocol assignments, whole block
  { cidr: "2001::/32", class: "reserved" }, // Teredo
  { cidr: "2001:2::/48", class: "reserved" }, // benchmarking
  { cidr: "2001:db8::/32", class: "reserved" }, // documentation
  { cidr: "2001:10::/28", class: "reserved" }, // ORCHID
  { cidr: "3fff::/20", class: "reserved" }, // documentation (RFC 9637)
  { cidr: "5f00::/16", class: "reserved" }, // SRv6 SIDs (RFC 9602)
  { cidr: "fc00::/7", class: "private" }, // unique local
  { cidr: "fe80::/10", class: "reserved" }, // link-local
  { cidr: "fec0::/10", class: "reserved" }, // site-local (deprecated)
  { cidr: "ff00::/8", class: "reserved" }, // multicast
];
