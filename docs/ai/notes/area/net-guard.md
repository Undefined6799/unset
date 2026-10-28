---
id: net-guard
type: area
status: current
areas: ["[[net-guard]]"]
summary: "Hub for infrastructure/net-guard: the single egress classifier every caller-influenced request goes through."
code: [infrastructure/net-guard/index.ts]
sources: []
importance: normal
related: ["[[pds]]", "[[config]]", "[[node-dns-lookup-hides-nxdomain]]"]
replaced_by: null
tags: [area, net-guard]
checked: 2026-10-28
---
# net-guard

**What it owns.** Every outbound connection whose destination a caller can influence (plan §2 rule 13). A CI guard
sends all such traffic through this folder.

**Files.**
- `src/ranges.ts`: the one table of non-public address ranges, from the IANA special-purpose registries. Never
  write a second copy of "private".
- `src/classify.ts`: address and name classification.
- `src/resolve.ts`: resolve once, vet every answer, then pin the socket to the vetted addresses, which defeats DNS
  rebinding. P1.29t runs those checks inside the built web runtime image (`net_guard_resolve_pin_in_image`).
- `src/dns.ts`: TXT lookups on c-ares, bounded by our own timer.
- `src/policies.ts`: named egress policies; every request names one. There is no model-provider policy in v1.
  `plc` is plc.directory alone. `localPlc` (P1.34y) is dead: we host no PLC (ADRs 0022, 0023), P1.34z was
  dropped, and #1041 removes it. Since the P1.10 cleanup the index no longer exports it, nor `RANGES` or
  `normaliseHost`; the package's own tests import them from their modules.
- `src/request.ts`: the guarded request, with no redirects and caps on time, bytes and decompressed bytes.
- `src/libraryFetch.ts`: a fetch shape for libraries that take a custom fetch.

**How data flows.** Composition root builds it from parsed config (`shared/config/netGuard.ts`) → an adapter calls
it with a policy → resolve, vet, pin → request → capped body or an `egress.*` code.

**Links.** [[pds]], [[config]].
