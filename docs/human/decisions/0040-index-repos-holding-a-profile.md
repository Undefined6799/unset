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
1. `tap-relay` sets `TAP_SIGNAL_COLLECTION=sh.unset.profile`. The login-triggered queue stays.
2. Repos the signal finds go through `idx.discovered` and the track loop (book P3.02 "Discovery"): erased DIDs are
   untracked and never indexed; a DID on our PDS moves to `tap-own`; a non-member who deletes their profile record is
   untracked and de-indexed without a tombstone.
3. Caps: at most `DISCOVERY_MAX` non-members (default 50,000) and `DISCOVERY_PER_HOST_DAY` new ones per PDS host per
   day (default 200); over a cap they wait and an alert fires.
4. Non-members: lawful basis legitimate interests (GDPR Art. 6(1)(f)), an Art. 14 notice in the privacy policy, a
   RoPA row, access and erasure through the request route for people who cannot log in. Their public profile renders
   like a member's.

## Alternatives
- **Login-only tracking (decision 5).** No non-member data, but profiles written elsewhere never show. Rejected by
  Alex on 2026-10-30.
- **Full network.** Rejected again: days of backfill and far more data than we need.

## Consequences
- New personal data: people who never signed up. The legal docs, RoPA and erasure route must cover them before
  Phase 3 ships to production.
- Erasure is final in our tables but not in Tap: an erased person who writes a profile record again is tracked by Tap
  again and untracked again; their events never reach our index. Tap holds only repo metadata in between.
- P3.01 must show discovery works (M19); if the relay does not serve `listReposByCollection`, only new profile writes
  are discovered until a host that serves it is configured.
- More outbound handle checks and Tap state, bounded by the caps.

## Compliance
P3.02's tests `tap_relay_signal_collection`, `discovered_non_member_indexed`, `discovered_own_pds_routed_to_tap_own`,
`track_erased_rediscovered_untracked`, `discovered_left_deindexed`, `discovery_caps_defer_and_alert`; P3.01 M19 and
M20 in the ingest ADR; the RoPA row "Indexing non-members".
