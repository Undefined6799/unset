---
status: Proposed
date: "2026-11-23"
step: P3.13
supersedes:
  - adr: "0063"
  - adr: "0025"
    part: "the staging handle bullet: one hand-added `_atproto` TXT record per tester, and no wildcard through Pangolin"
  - adr: "0031"
    part: "Decision 6: staging handle hosts stay internal, verified over DNS TXT"
  - adr: "0067"
    part: "who keeps a hosted name's proof: the DNS record steps of rules 1, 2, 3, 5 and 7, and the writer's check in rule 6"
---
# 0113 — Hosted handles are answered by the PDS behind one wildcard record; nothing of ours writes DNS per member

Alex, 2026-11-23, after a new staging account (`alex2.staging.unset.name`) could not go on because nobody had added
its DNS record by hand: "is there not an atproto way to do this? can the pds handle it?" (03:03Z), "can we have
wildcard on desec??" (03:04Z), "ok do that" (03:04Z).

## Context

A handle is valid when the DID's document claims it and the handle resolves back to that DID, by a DNS TXT record or
by `https://<handle>/.well-known/atproto-did`. The spec names who each method is for: "The DNS TXT method is the
recommended and preferred resolution method for individual handle configuration, but services should fully support
both methods. The intended use-case for the HTTPS method is existing large-scale web services which may not have the
infrastructure to automate the registration of thousands or millions of DNS TXT records"
(https://atproto.com/specs/handle, "Handle Resolution"; bluesky-social/atproto-website `main`,
`src/app/[locale]/specs/handle/en.mdx`, read 2026-11-23). A PDS that issues names under its own domain is that
second case.

The stock PDS already does it. The pinned `@atproto/pds` 0.5.51 answers `/.well-known/atproto-did` from its account
table by the request's host, for hosts under `PDS_SERVICE_HANDLE_DOMAINS` (`packages/pds/src/well-known.ts:8-29`),
with the lookup that leaves out deactivated and taken-down accounts (`account-manager/helpers/account.ts:32-58`, the
defaults of `includeDeactivated` and `includeTakenDown`). Its install guide asks for one wildcard address record and
says: "The wildcard record is required when allowing users to create new accounts on your PDS"
(bluesky-social/pds `main`, README, "Configure DNS for your domain", read 2026-11-23). bsky.social works this way
(ADR 0067, Context).

Our plan has always named this for production: `*.unset.name` to the edge, the well-known path passed to the PDS
(plan §5.4 "Handle hosts"; book step P3.13, which checked the PDS source in its first review). Our resolver already
asks the handle's own address when it finds no TXT record (`domains/identity/resolve-handle.ts`), so the app is
ready for it.

Staging went another way only because of its front door. ADR 0025 chose one hand-added TXT record per tester
(ADR 0031 Decision 6 kept it), and ADR 0063 (Proposed, never built) proposed to automate those records with a
deSEC API key in the indexer, a queue table, retries, and removal on deletion, takedown and erasure. Both rested on
one finding: Pangolin, which publishes the staging names (as public resources with no login since ADR 0031), has no
wildcard host in the edition we run. Read again on 2026-11-23:

- Wildcard resources are "Only available in Pangolin Cloud and Enterprise Edition"
  (https://docs.pangolin.net/manage/resources/public/wildcard-resources). The target "receives the original `Host`
  header", and "Access rules and authentication you set on that resource apply to all hostnames matched by the
  wildcard".
- "Enterprise Edition is free for personal use and organizations with less than $100,000 USD gross annual revenue";
  a personal-use licence "includes up to 25 users and 25 sites"
  (https://docs.pangolin.net/self-host/enterprise-edition and `/personal-use`). Switching "is a container swap"
  (`fosrl/pangolin:ee-latest`, the key entered at `/admin/license`); the two editions "share the same database
  schema, so there is no data migration" (`/faq`).
- It is licensed under the Fossorial Commercial License, which replaces AGPLv3 for those parts, requires a key
  "authenticated by the Licensor's designated license verification server" (3.5), and forbids disabling "any license
  validation, telemetry, or access control mechanism" (1.3) (https://pangolin.net/fcl, last modified 2026-06-09).
  What the telemetry sends is not documented on the pages read.
- A wildcard certificate needs DNS-01: "You must control the domain's DNS records and have API credentials for a DNS
  provider supported by Traefik" (https://docs.pangolin.net/self-host/advanced/wild-card-domains).

deSEC accepts a wildcard record: "Wildcard name components are denoted by `*`; this is allowed only once at the
beginning of the name" (desec-io/desec-stack `main`, `docs/dns/rrsets.rst`, read 2026-11-23). A wildcard does not
cover a name that has a record below it (RFC 4592 section 2.2.3), so `alex.staging.unset.name` is not covered while
`_atproto.alex.staging.unset.name` exists.

## Decision

1. **Hosted handles resolve by the HTTPS method, answered by our PDS.** Each handle domain has one wildcard address
   record that sends every handle host to our front door: `*.staging.unset.name` on the development system now,
   `*.unset.name` in production at P5. The edge passes `/.well-known/atproto-did` on those hosts to the PDS with the
   host kept, and nothing else (book step P3.13). No process of ours writes a DNS record for a member, holds a DNS
   key that can change a handle, or keeps a queue of handle records.
2. **The app does not change.** `resolveHandle` keeps the spec's order, TXT then HTTPS, for every handle. The
   indexer's extra check for hosted names (`interfaces/indexer/handles.ts`: our PDS is the DID's PDS, the repo is
   active, our PDS maps the name back) stays as it is.
3. **Staging's front door.** Pangolin publishes `*.staging.unset.name` as one wildcard resource to the edge, public
   with no login and no rules, like the other two staging names (ADR 0031 Decision 1, ADR 0032). That needs
   Pangolin's Enterprise Edition under its free licence. What a handle host serves is decided at our edge, not at
   Pangolin: the well-known path and nothing of the PDS or the app besides (P3.13). The answer on that path is a DID
   for a name that an active account holds and 404 otherwise, which is public in atproto by design.
4. **Certificates.** Pangolin's proxy gets the certificate for `*.staging.unset.name` by DNS-01 with a deSEC token
   whose policies allow writing only the TXT record `_acme-challenge.staging` in `unset.name`, nothing else, and no
   token management. `staging.unset.name` gets `CAA 0 issuewild "letsencrypt.org; validationmethods=dns-01"`. The
   edge's self-signed development leaf gains the wildcard name, made by hand with the runbook's command, as its
   other names are. Production's wildcard certificate is the edge's own, as the plan says, at P5.
5. **One mechanism.** Once the wildcard answers, the hand-added `_atproto` TXT records of the staging accounts are
   removed, so every hosted handle resolves the same way and no record outlives its account.
6. **ADR 0067's rules, as they now read.** The proof of a hosted name is the PDS's own answer, so:
   - Deletion and takedown (rules 2, 3 and 5) need no DNS step: the PDS stops answering for the name by itself. A
     reversed takedown answers again by itself.
   - Deactivation (rule 1): the name stops resolving while the account is deactivated and resolves again when it
     is reactivated, as on bsky.social. The name stays held, because the PDS keeps the row.
   - Burned names (rule 6): the PDS frees a deleted name at once, in this design as in the last. The second check,
     which was to sit where the DNS record is written, sits where the answer is given: the handle-host site refuses a
     burned name before the PDS is asked. How the edge learns the list is P3.08n's design, and P3.08n is rewritten
     before it is built. Until then the interim file of ADR 0067 stands.
   - Moving away (rule 7, not offered today): when it is built, a member who moves keeps the name by one
     `_atproto` TXT record for that name, added by an owner, and loses it when that record is removed. That is the
     only per-name record this design ever needs.
   - Rule 8, the indexer's check, and every other rule stand.
7. **ADR 0063 is not built.** ADR 0064 stands: handles are under `unset.name`, a signed zone at deSEC.

## Alternatives

- **Write one TXT record per member through the deSEC API (ADR 0063).** Works with the Pangolin edition we run.
  Rejected: it is our own code for something the PDS does as shipped; it puts a key that can repoint any hosted
  handle in a running process; deSEC allows 300 record writes a day per zone, 100 an hour and 15 a minute
  (`docs/rate-limits.rst`), and its token policies match a name exactly, never a pattern (`docs/auth/tokens.rst`), so
  staging would also need a zone of its own; and each write is a queue, a retry and an erasure step to keep right.
- **A hand-written router in Pangolin's own Traefik**, matching the handle hosts and reusing the PDS resource's
  target, with no Enterprise Edition. Not verified to work; it would live outside Pangolin's own model and break
  when Pangolin renames what it generates. Kept as the fallback if the licence is not wanted.
- **Ask our own PDS directly for hosted names**, inside the stack, with no public route. Rejected: our resolver would
  no longer do what every other atproto app does, and staging would differ from production.
- **Certificates on demand, one per handle**, as the stock PDS's bundled Caddy does. Not possible behind Pangolin,
  and one wildcard certificate is simpler than one certificate per member.

## Consequences

- A new account's handle is valid as soon as the PDS has the account. Nothing has to be added by hand, retried or
  removed, and deSEC learns nothing about any member.
- Staging's front door runs Pangolin's Enterprise Edition: a closed licence in place of AGPLv3, a key from an
  account at Fossorial that is bound to the host, a licence check against their server, and telemetry we may not
  switch off and whose content we have not seen. Staging holds test accounts only. Whether production sits behind
  Pangolin at all is Alex's choice at P5; if it does, this licence is weighed again there.
- The Pangolin host holds one deSEC token. It can only write the certificate challenge record for
  `staging.unset.name`. With it, someone could obtain a certificate for staging handle hosts; they could not change
  any DNS answer, so they would still need to intercept traffic to use it.
- Every staging handle host is reachable from the internet, like the two staging names already are. The one thing
  it answers tells anyone whether a staging name is held by an active account, and its DID.
- Handle validity now depends on the PDS, the edge and the front door being up. P3.13 answers 503, never 404, on an
  outage, so resolvers do not cache "no such handle".
- The plan's optional "DNS TXT at mint" (§5.4) is dropped. `docs/human/runbooks/erasure.md` loses its manual DNS
  step when P3.13 is deployed, and the comment in `interfaces/indexer/handles.ts` is updated then.

## Compliance

SE-1: P3.13 carries the Threats section (a forged forwarded host, a reserved or multi-label host, an outage answered
as 404, a handle host reaching any PDS or app route besides the one path). SE-2: its tests include the denials (a
PDS route asked for on a handle host, a write method on the well-known path). No new personal data, lawful basis or
processor; the deSEC row that ADR 0063 would have added to the RoPA is not needed. Deploy steps are owner
operations: the wildcard and CAA records at deSEC, the Pangolin edition, key and wildcard resource, the certificate
token, and the edge leaf.
