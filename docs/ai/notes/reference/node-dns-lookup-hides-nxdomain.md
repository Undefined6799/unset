---
id: node-dns-lookup-hides-nxdomain
type: reference
status: current
areas: ["[[net-guard]]", "[[identity]]"]
summary: "Node dns.lookup uses the libuv threadpool and reads /etc/hosts; c-ares resolvers do neither and report NXDOMAIN."
code: [infrastructure/net-guard/src/resolve.ts, infrastructure/net-guard/src/dns.ts]
sources: [https://nodejs.org/docs/latest-v26.x/api/dns.html]
importance: high
related: ["[[net-guard]]", "[[identity]]"]
replaced_by: null
tags: [reference, net-guard, identity]
checked: 2026-10-06
---
# dns.lookup and dns.resolve behave differently

Read from the Node.js v26.10.0 `node:dns` docs, "Implementation considerations", `dns.lookup()`, `Resolver` and
"Error codes" (https://nodejs.org/docs/latest-v26.x/api/dns.html), as cited in ADR 0013.

**What Node does.**
- `dns.lookup()` calls the operating system's resolver on libuv's threadpool, four threads by default. It honours
  `/etc/hosts`. A run of slow names can stall file, crypto and zlib work that shares the pool.
- `dns.resolve*()` and a `Resolver` use c-ares off the threadpool. They skip `/etc/hosts`, and they return distinct
  codes: `ENOTFOUND` for a name that does not exist, `ENODATA` for a name with no record of that type.

**What we rely on.**
- Public names resolve on c-ares, so "this handle's domain does not exist" can be told apart from "could not tell
  right now". Only NXDOMAIN or NODATA counts as no record; anything else is `unavailable` and fails closed.
- Private names (our own services) keep `dns.lookup`, because they may live only in `/etc/hosts`.
- c-ares has its own per-try timeout that grows between tries, so `dns.ts` bounds both tries with our own timer.

**Links.** ADR 0013, [[net-guard]], [[identity]].
