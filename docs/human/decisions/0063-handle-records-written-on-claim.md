# 0063 — Each member's handle record is written to DNS when they claim it, in a zone at deSEC

Status: Proposed (awaiting Alex). Supersedes, for the dev profile, the sentence of accepted ADR 0025 that has Alex add
each tester's `_atproto` TXT record by hand through the runbook (0025:89-91). The rest of 0025 stands, including its
rejection of `*.staging.unset.im` through Pangolin (0025:93-94), which this record keeps.

## Context
A member's handle `<name>.staging.unset.name` shows as `handle.invalid` in our app until something on the internet maps
it to their DID. Our check is two-way (`domains/identity/verify-handle.ts`, `resolve-handle.ts`): it reads the TXT
record `_atproto.<handle>` first, then `https://<handle>/.well-known/atproto-did`
(https://atproto.com/specs/handle, "Handle Resolution"). The PDS (`@atproto/pds` 0.5.51) answers the well-known path
from its own database by the request's Host (`packages/pds/src/well-known.ts`), but no request for a handle host
reaches it: there is no wildcard DNS name, Pangolin resource or certificate for `*.staging.unset.name`.

ADR 0025 chose one TXT record per tester, added by hand. On 2026-11-19 Alex asked that handles work for every
account without that step ("we are going to have this set up for every account now right?", 01:17Z), and proposed
the trigger: "the user can claim the handle after he verified his email" (01:21Z). He chose deSEC for the zone
(01:24Z, "sure lets set up that", answering the zone choice).

What the wildcard route would have cost, checked on 2026-11-19: Pangolin's wildcard resources are Enterprise Edition
only (https://docs.pangolin.net/manage/resources/public/wildcard-resources); a wildcard certificate needs DNS-01
(https://docs.pangolin.net/self-host/advanced/wild-card-domains), so the Pangolin host would hold a DNS key;
Namecheap enables its API only with 20 domains or $50 spent, and its key controls the whole account
(https://www.namecheap.com/support/knowledgebase/article.aspx/9739/63/api-faq/); and our edge would need a new site,
a fourth file mount under C18 and a new SAN on the dev leaf. Pangolin's raw resources route by port only
(https://docs.pangolin.net/manage/resources/public/raw-resources), so Caddy's on-demand certificates at our edge are
not reachable through it either.

## Decision
1. **`unset.name` is a zone at deSEC** (desec.io, a nonprofit, free, open-source DNS host), with DNSSEC; handles
   moved there from `unset.im` by ADR 0064, because `.im` is unsigned at the root
   (https://www.iana.org/domains/root/db/im.html, checked 2026-11-19). Namecheap stays the registrar. deSEC allows
   a new account one domain until a domain is securely delegated, so `staging.unset.name` starts inside the
   `unset.name` zone. Token policies match exact subnames only (no patterns), so a token that can write staging
   handle records could also write production ones: the writer is not deployed until `staging.unset.name` is its
   own zone (the limit rises once `unset.name` is seen signed) and each environment's token is limited to its own
   zone. Alex owns the deSEC account; its password and recovery are his.
2. **One key, restricted.** A deSEC token whose token policies allow writes only to TXT RRsets in
   `staging.unset.name` and nothing else (https://desec.readthedocs.io/en/latest/auth/tokens.html, "Token Policies");
   production gets its own token, limited the same way to TXT in `unset.name`, created only when production's writer
   is deployed. It is a file secret of the one process in Decision 4, never in web, never in a log.
3. **When a record is written.** A member's `_atproto.<handle>` record (`did=<DID>`) is added once our app has seen
   both a confirmed email for that account (the email gate, `interfaces/web/src/lib/server/app-gate.ts`) and a
   handle under the configured handle domain whose DID document names it (`alsoKnownAs`, read through the existing
   resolver, never trusted from the request). It is replaced when the handle changes, and removed when the handle
   leaves our domain, when the account is deleted or taken down, and by `eraseDid`. Only names under the configured
   handle domain, one label deep, are ever written.
4. **Who writes it.** Web and the indexer only enqueue a request in an app-owned Postgres table (DID, wanted state,
   attempts; no handle history). The indexer drains it, because it already follows identity and account events on
   our PDS (`interfaces/indexer/consumer.ts`) and holds no inbound public surface. Its one new egress is HTTPS to
   `desec.io`'s API through net-guard, with no new package (plain `fetch`). pds-admin is not used: it stays
   dependency-free and PDS-only (ADR 0060).
5. **Failure.** A failed or refused write is retried with backoff from the queue; until it succeeds the handle reads
   `handle.invalid`, as today. Sign-up, sign-in and the email gate never wait on it. Logs carry the outcome and a
   count, never the handle or DID (SE-7). A removal that has failed for 24 hours raises the indexer's health signal
   and stays visible as a count, not retried in silence; the erasure is not reported complete until it succeeds.
6. **Erasure of the queue itself.** The queue row holds a DID. `eraseDid` enqueues the removal and deletes the row
   once deSEC has confirmed the record gone, so no DID stays in the queue after an erasure completes.
7. **A stronger check for our own handles, added by the implementing step.** Today `verifyHandle` compares public
   resolution with the DID document only (`domains/identity/verify-handle.ts`). For a handle under our handle domain,
   the step adds two conditions in web and the indexer: the DID document's PDS is ours, and our PDS's
   `com.atproto.identity.resolveHandle` returns the same DID. The writer is not deployed without them.

## Alternatives
- Wildcard `*.staging.unset.name` through Pangolin with a wildcard certificate: needs Enterprise Edition, a DNS key on
  the Pangolin host and an edge site; rejected, as in ADR 0025.
- Our own authoritative DNS on the Pangolin host (Knot or PowerDNS): no outside organisation, but a new public port
  (53) and a service to keep patched, and one server only. Not now; reconsidered in Phase 5 as a second server.
- Records kept at Namecheap by API: the key would control every domain on the account; rejected.
- Records added by hand (ADR 0025): stays the fallback, and is how the first two accounts get theirs tonight.

## Consequences
- What deSEC learns: each member's handle and DID, both already public through the PDS and the PLC directory, and
  when they change. No content, email or address. It is still a new processor of an identifier, so the ROPA gains a
  row and the privacy notice a sentence before the first invite.
- Production is decided now: `<name>.unset.name` sits at the apex of `unset.name`, so the whole zone is at deSEC. One
  provider then answers for every handle; deSEC runs several anycast servers, and a second, independent provider or
  our own server is a Phase 5 choice. Switching back is a name-server change at Namecheap. No production handle
  record or token exists until production's writer is deployed.
- The indexer now holds a credential and has a second outside destination. Until now it held none, and its only
  way out was the guarded egress to the PLC directory; that was the basis for its private network with the PDS. A
  compromised indexer can now, beyond what it could already do, rewrite or delete TXT records in
  `staging.unset.name`, and nothing else: the token's policies grant no other zone, type or account action. It was
  still chosen over web, which faces the internet and would put the token one request away from any attacker, and
  over a new writer process, which would add a service, an image and a network for one call, while the indexer
  already follows the events that trigger every write.
- `unset.name` is signed (`.name` is signed at the root), so resolvers can validate handle records; the DNSSEC
  concern that moved handles off `.im` is recorded in ADR 0064.

## Compliance
SE-1 Threats with the implementing step: a stolen token can rewrite handle TXT records in this one zone. Pointing a
member's handle at the attacker's own DID, whose document lists that handle in `alsoKnownAs`, passes the two-way check
(https://atproto.com/specs/handle, "Handle Resolution"), so other atproto apps would show the attacker's account under
the member's handle: impersonation, not only invalidation. With Decision 7, our own app and indexer require, for a
handle under our handle domain, that the DID's PDS is ours and that our PDS's `com.atproto.identity.resolveHandle`
returns the same DID, so the impersonator is never shown under that handle in our app; the real owner's handle still
reads invalid until the record is restored, because public resolution no longer returns their DID; outside apps cannot
be protected this way, which is why the token is limited to this one zone and record type, held only by the indexer,
and rotated on any suspicion. A stolen token can also delete records, turning every handle `handle.invalid` until they
are rewritten. Recovery: revoke and replace the token in deSEC, then re-enqueue every account; the queue rebuilds the
whole zone from Postgres, which is the source of truth (DA-1). SE-7 logging. DA-4: the queue row is the concurrency
mechanism, no network I/O inside a transaction. GDPR: erasure through `eraseDid` (Decision 3), ROPA row, notice
sentence.
