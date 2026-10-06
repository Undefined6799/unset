# 0013 — Identity resolution behind a network port, DNS on c-ares

Status: Proposed (awaiting Alex in the P2.01 pull request; architecture ruling 2026-10-06 00:10Z)

## Context
P2.01 turns DIDs into DID documents and handles into DIDs. Every byte comes from servers others control: the PLC
directory, did:web hosts, DNS and handle domains. The step book had the identity domain call net-guard directly,
but domains import no infrastructure and no Node I/O (`domain-pure`, `domain-no-io-builtins`). It is also the first
domain with I/O behind it.

DNS was the second question. `dns.lookup()` runs on libuv's threadpool (four threads by default), so a stream of slow
names can stall file, crypto and zlib work. `dns.resolve*()` use c-ares off the threadpool, but skip `/etc/hosts`
(Node v26.10.0 docs, `node:dns`, "Implementation considerations"). net-guard's `resolveVetted` (P1.18) uses
`dns.lookup` and reports "no such name" as `dns_failed`, so a handle whose domain does not exist reads as "could not
tell" rather than "not found".

## Decision
1. `domains/identity/contract.ts` defines `IdentityNetwork`: `get(url, {target, maxBytes, accept})` and `txt(name)`.
   It carries no net-guard type and exactly three failures: `unavailable`, `refused` and `no_such_host`. `txt` answers
   `records`, `no_record` (NXDOMAIN or NODATA only) or `unavailable`.
2. `infrastructure/pds` implements it on net-guard, and each interface's composition root builds it (AB-2). The
   domain cannot widen its own egress: `plc` is bound to the configured PLC host, `public` is https GET only with no
   userinfo, `maxBytes` is capped at 64 KiB in the adapter, and the domain passes no policy or header but `accept`.
3. DNS runs on c-ares for public names: TXT already does (P2.01k), and P2.01m moves `resolveVetted`'s `allow:
   "public"` lookups to `resolve4` and `resolve6`, reporting NXDOMAIN or NODATA on both as `egress.dns_no_record`.
   `allow: "private"` keeps `dns.lookup`, because internal names may live in `/etc/hosts`.
4. Until P2.01m lands, identity fails closed: a handle domain that does not exist reads as `unavailable`, never as
   `not_found`.

## Alternatives
- The domain calls net-guard directly: rejected; it breaks `domain-pure`, and net-guard's codes would spread into
  product rules.
- Raise `UV_THREADPOOL_SIZE`: rejected; it moves the limit without removing it, does nothing for the NXDOMAIN
  reading, and would put a security-relevant behaviour in deployment config. It may still be set later on measured
  need (P5).
- `@atproto/identity` resolvers: rejected; they fetch with their own `fetch` and `dns`, outside net-guard.

## Consequences
The domain is tested with stand-ins of its own contract (TE-1); the adapter's mapping table has one test per
`egress.*` code. A new `NetGuardCode` fails the adapter's typecheck until it is mapped. Slice 1 cannot close (P2.13a)
before P2.01m.

## Compliance
`domain-pure` and `domain-no-io-builtins` (dependency-cruiser) keep the domain off the network; the adapter's mapping
test and P2.01m's resolver tests (`no_record_on_nxdomain`, `one_family_error_fails_closed`,
`private_mode_uses_lookup`) hold the rest. Reviewed when Phase 3 adds a PLC replica.
