# 0040 — Index any repo that holds our profile record

Status: Proposed, awaiting Alex. Alex chose the direction on 2026-10-30: "Yes use sh.unset.profile" (00:27:43Z,
cmsg_01GKYqaAGu4Vob5JHVyDmG7ASmYLKHDHqTf2XdQFiTrCuR) and, after being shown that it reverses decision 5, the card
option "Switch to signal mode" (00:47:06Z, card cmsg_01GKYqaAGu4Vob5JHVyDmG7AG9LygBzMQmD5f2igv9fZCT). Acceptance is
his typed line on the pull request that adds this record. Once accepted it supersedes, in decision 5 (ADR 0001 log,
"Indexer source") and plan §5.2's Tap row, the clause "repos are added at first login or signup, never by
network-wide discovery" and the rejection of collection-signal mode. "No own relay or full-network index" stands.

## Context
Tap (indigo `cmd/tap`, README at 51095ab, "Network Boundary Modes") can track every repo that holds at least one
record in a named collection (`TAP_SIGNAL_COLLECTION`): it watches the firehose for ops in that collection and
crawls `listReposByCollection` daily. Our profile is a self-keyed `sh.unset.profile` record, so that collection marks
exactly the people who use our lexicon. As planned, only people who sign in here are indexed, so a profile written
from another app never appears. Statusphere (bluesky-social/statusphere-example-app dbb9773) uses the same setting.
The atproto review of 2026-10-29 suggested it; decision 5 had rejected it, partly because the endpoint is not served
by a PDS.

## Decision
1. `tap-relay` sets `TAP_SIGNAL_COLLECTION=sh.unset.profile` when the `DISCOVERY` setting is on, in steps of their
   own (book P3.08k, then P3.08d) after ingest, erasure and the handle rule exist. The login-triggered queue for
   members is unchanged.
2. Only a create or update of a DID's own profile record discovers it; the track loop then creates its index row and
   makes Tap backfill. For a non-member we keep only that profile record and the blobs it references; when they sign
   up, Tap backfills the rest. Membership is an `app.account` row; members are never capped or treated as
   non-members, and our own PDS's members stay on `tap-own`.
3. Erased people never reach our tables, not even as a plain DID; the HMAC tombstone is checked first, and each
   dropped event of an erased DID also asks Tap to untrack the repo.
4. Caps bound what we store and look up: a total cap on non-members, checked under a lock before any write (the real
   bound, alerting when reached); a rate limit on DID lookups before any resolution; and a per-PDS-host cap (weak:
   wildcard subdomains). A refused DID is not kept and its events are dropped at ingest. There is no eviction, and
   untracking is not relied on, because Tap re-adds the repo. Handle checks for non-members are rate-limited.
5. Non-members: lawful basis legitimate interests (GDPR Art. 6(1)(f)), an Art. 14 notice in the privacy policy, a
   RoPA row, and access and erasure through the request route for people who cannot log in, with proof of control
   of the DID. That route has no step yet, so `DISCOVERY` is off by default, which leaves `TAP_SIGNAL_COLLECTION`
   unset (preflight checks it). Turning it off after it was on untracks and de-indexes every discovered person. It
   stays off in every environment that follows the public relay, staging included, until the route exists, a later
   step polls Bluesky labels for non-members, and Alex turns it on (book P3.23 records this). A non-member who deletes their
   profile record is de-indexed (moderation, label and hold rows kept). Their public profile renders like a
   member's.

## Alternatives
- **Login-only tracking (decision 5).** No non-member data, but profiles written elsewhere never show. Rejected by
  Alex on 2026-10-30.
- **Full network.** Rejected again: days of backfill and far more data than we need.

## Consequences
- New personal data: people who never signed up. The legal docs, RoPA and erasure route must cover them before
  discovery is turned on anywhere that follows the public relay.
- Tap holds data our caps do not bound: for every repo it tracks, the DID and a key and CID for each record in its
  filter, for as long as it tracks the repo, plus buffered record bodies until acked (P3.01's source table: `remove`
  does not purge the outbox). The RoPA row lists it.
- Erasure is final in our tables but not in Tap: an erased person who keeps their record is tracked by Tap again on
  their next op in the collection, deletes included, and its crawler may list them again (indigo `cmd/tap` at
  51095ab). Their events are acked as dropped and never reach our index, and each one triggers a rate-limited
  untrack, so Tap's copy lasts only between their ops.
- An `idx` rebuild brings members back from `app.account`; non-members come back only on their next profile op.
- P3.01 must show discovery works (M19); if the relay does not serve `listReposByCollection`, only new profile writes
  are discovered until a host that serves it is configured.
- A full total cap stops discovery for everyone until it is raised; with no eviction, that is the price of a cap a
  rewritten profile cannot get around. `discovery.cap_reached` alerts.
- More outbound handle checks, bounded by the caps and a per-DID rate limit. Tap's tracked-repo count is watched with
  an alert.

## Compliance
Book steps P3.08k and P3.08d's named tests; P3.01's spike record for M19 and M20; the RoPA row "Indexing
non-members".
