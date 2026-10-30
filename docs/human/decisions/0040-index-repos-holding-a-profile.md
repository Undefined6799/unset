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
1. `tap-relay` sets `TAP_SIGNAL_COLLECTION=sh.unset.profile`, in a step of its own (book P3.08d) after ingest,
   erasure and the handle rule exist. The login-triggered queue for members is unchanged.
2. Only a create or update of a DID's own profile record discovers it; the track loop then creates its index row and
   makes Tap backfill. Membership is an `app.account` row; members are never capped or treated as non-members, and
   our own PDS's members stay on `tap-own`.
3. Erased people never reach our tables, not even as a plain DID; the HMAC tombstone is checked first.
4. Caps bound our index and outbound checks: a total cap on non-members, a rate limit on DID lookups before any
   resolution, and an all-time per-PDS-host cap. Over a cap, events are dropped at ingest; untracking is not relied
   on, because Tap re-adds the repo.
5. Non-members: lawful basis legitimate interests (GDPR Art. 6(1)(f)), an Art. 14 notice in the privacy policy, a
   RoPA row, and access and erasure through the request route for people who cannot log in, with proof of control of
   the DID. That route has no step yet, so discovery ships behind a setting that is off and stays off in production
   until the route exists and Alex turns it on (book P3.23 records this). A non-member who deletes their profile record is
   de-indexed (moderation and hold rows kept). Their public profile renders like a member's.

## Alternatives
- **Login-only tracking (decision 5).** No non-member data, but profiles written elsewhere never show. Rejected by
  Alex on 2026-10-30.
- **Full network.** Rejected again: days of backfill and far more data than we need.

## Consequences
- New personal data: people who never signed up. The legal docs, RoPA and erasure route must cover them before
  Phase 3 ships to production.
- Erasure is final in our tables but not in Tap: an erased person who writes a profile record again is tracked by Tap
  again on their next profile op and by its daily `listReposByCollection` crawl (indigo `cmd/tap` at 51095ab); their
  events are acked as dropped and never reach our index. In between, Tap holds the repo's metadata and the
  buffered record bodies until they are acked (P3.01's source table: `remove` does not purge the outbox).
- P3.01 must show discovery works (M19); if the relay does not serve `listReposByCollection`, only new profile writes
  are discovered until a host that serves it is configured.
- More outbound handle checks, bounded by the caps. Tap's own state is not bounded by them (Tap tracks every repo the
  signal finds before our caps run); its tracked-repo count is watched with an alert.

## Compliance
Book step P3.08d's named tests (one per rule there); P3.01's spike record for M19 and M20; the RoPA row "Indexing
non-members".
