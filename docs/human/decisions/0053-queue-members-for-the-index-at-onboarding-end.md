# 0053 — Queue members for the index when their onboarding ends, in `idx`

Status: Accepted by Alex, 2026-11-17 13:51:50Z, against 2422ebf (his line "Accept ADR 0053 at 2422 EBF", typed in
the thread "Build the indexer for public profiles" after he chose "At onboarding end (new ADR)" and the coordinator
had reviewed that head). The only changes since that head are this status paragraph, the index rows and the ADR 0001
acceptance line. It supersedes one clause of ADR 0052 decision 3, and nothing else in it: the parenthesis
"(`app.track_request`, filled by the sign-in callback)". The rule of that decision, that only DIDs that signed in
here are indexed and that the track queue creates their `idx.account` row, stands.

## Context
ADR 0052 decision 3 names the track queue of book P3.02: `app.track_request`, with one insert in the sign-in
callback. Building it (book P3.02s, migration 0026) showed two problems with that wording.

- The callback runs before onboarding. A session exists for a person who has not yet passed the age gate, for an
  account the gate then blocks (`app.account.onboarding = 'blocked_underage'`), and for someone who stops before
  accepting the terms and privacy notice. An insert there would queue all of them, and the indexer would then publish
  the profile of a person under 16, or of a person who never accepted the notice that describes the index.
- `indexer` has no USAGE on schema `app` (`infrastructure/postgres/grant-matrix.json`). A queue there would need a
  new grant on an existing schema. `web` and `indexer` both already use `idx`.

## Decision
1. A DID is queued in the transaction that sets `app.account.onboarding` to `'done'`
   (`infrastructure/postgres/accountRepository.ts` `finishChat`, the only statement that sets it). At that point the
   person is 16 or over and has accepted the current terms and privacy notice. A sign-in alone queues nothing.
2. The queue is `idx.track_request(did, requested_at)`. `web` may only insert; `indexer` may only read and delete.
   It holds no decision of ours (rule DA-1): the fact is `app.account.onboarding`, and a rebuild of `idx` queues every
   member again with migration 0026's own statement (`onboarding = 'done'`).
3. Migration 0026 queues every account whose onboarding was already `'done'`.
4. A member whose repository is on another PDS also finishes onboarding and is queued. The track loop does not index
   such a DID: it stays queued with reason `foreign_pds` until the relay slice (book P3.02s row; ADR 0052
   Consequences), and `core.erase_did` deletes the row like any other.
5. The track loop lands no earlier than the P3.07s tombstone, so an erased DID that finishes onboarding again is
   never tracked again without an owner's action (book P3.07).

## Alternatives
- **Keep the callback insert and filter in the track loop.** The loop would have to read `app.account`, which needs
  `indexer` USAGE on `app` and SELECT on onboarding columns, and queues people who must never be indexed.
- **Queue at sign-in only when onboarding is already done.** Queues nobody at their first sign-in; a new member would
  wait for their next sign-in.

## Consequences
- Only people past the age gate who accepted the privacy notice reach the index.
- No role gains a grant on an existing object. The queue moves with `idx`, which already has the right grants.
- A member who re-accepts new terms is not queued again; that needs no queue, since their index row already exists.

## Compliance
`tests/integration/http/onboarding.test.ts` `track.only_a_finished_onboarding_queues_the_member` and
`track.grant_web_insert_only`, run as the real `web` and `indexer` roles; `track-queue-migration.test.ts` for the
backfill; the grant-matrix test pins the grants; `erase-did.test.ts` covers the column.
