# 0082 — Sign-in history: the time of each sign-in, kept 30 days

Status: Accepted by Alex, 2026-11-21 04:09Z, against 4202269 (his line naming that head, given after it was reviewed;
merged as 240e608). This status paragraph, the index row and the ADR 0001 acceptance line were added afterwards
(P1.38v). Book step P2.27c. Amends the plan's "no user sign-in records" (PLAN.md §6, Logging and retention) for this
one record, as [0079](0079-notifications-in-core.md) did for the sign-in notification.
Alex chose it on the notifications mock-up thread on 2026-11-21: a Sign-in history tab that keeps "the time ... 30
days, but the user can delete it"; at 00:57Z, that any signed-in browser may delete any entry for now, "because ...
we're gonna add like that extra security 2FA things later, and we can like require the 2FA to delete ... any history
type thing"; and at 00:58Z, that nothing is live yet, so the second check is noted and added when it is built.

## Context

A member told "New sign-in to your account" (0079) has no way to see when else their account was signed in to. The
plan kept no sign-in records at all, so that nothing about a member's comings and goings is stored. Alex asked for a
history the member can read, holding the least that answers "when": the time, nothing else.

## Decision

1. **One row per sign-in, the time only.** `app.sign_in` (migration 0038) holds an id, the member's DID and when.
   No address, device, browser, place or session id. The OAuth callback writes it in the sign-in's own transaction,
   beside the session and the sign-in notification, so its time is the session's; a first sign-in, before the
   account row exists, writes none. `web` may insert only the DID (the time is the database's), read, and delete.
2. **Kept 30 days.** Web's hourly sweep deletes rows older than 30 days. Erasure removes them: `core.erase_did`
   (replaced in 0038) deletes and counts them, and the foreign key cascades from `app.account`.
3. **The member may delete any entry, from any of their signed-in browsers:** one, the ticked ones, or all. "Delete
   all" names the newest row the page listed and deletes it and everything older, never a sign-in after the page was
   drawn. Every statement names the member's DID, so an id from a form never reaches another member's row.
4. **A second check comes later.** Deleting sign-in history is the first action on the list in book step P2.28 ("Ask
   for a second check before sensitive actions"). Until that step is built, a signed-in session is enough. This is
   a known gap, accepted while nothing is live (Alex 00:58Z): today someone who got into the account can erase the
   history of their own sign-in. The sign-in notification still reaches the member's older browsers (0079 point 4).
5. **The tab.** `/notifications/sign-ins`, beside Notifications, lists at most 50, newest first, with the date and
   time, how long ago, and a Delete per row; the list scrolls under a header row that stays. Its forms have a 4 KB
   limit and count against the notifications limit. With no script every part is a link or a form and times read in
   UTC.

## Consequences

- New personal data: purpose (showing the member their own sign-ins), lawful basis (contract, as the account), 30-day
  retention, erasure as above; the ROPA's Accounts row lists it. Export comes with P4.26, like the rest of the
  account's data.
- The callback writes one more row per sign-in; a failure rolls the sign-in back as for the session, so a sign-in is
  never kept without its row.

## Compliance

`tests/integration/postgres/sign-in-store.test.ts` holds the store as `web` (scoped to the member, no row without an
account, delete one, the ticked, all up to the listed, another member's ids, the sweep, no backdating or editing).
`tests/integration/web/app/sign-ins.test.ts` holds the routes (visitor, denial, double and stale posts, the largest
form, bad forms, cross-site, the no-script page). `tests/integration/web/sign-in.test.ts` checks one row per sign-in
at the session's time; `tests/integration/postgres/erase-did.test.ts` counts the rows at erasure;
`tests/e2e/notifications.spec.ts` holds the tab. Acceptance is Alex's line on the pull request that adds this record.

## Alternatives

- **Only sign-ins from before this browser's own may be deleted** (the sign-in notification's rule): blocks a stranger
  from erasing their own trace, but Alex preferred one rule for all history, guarded by the second check later.
- **Keep the device or address too**: more useful against a stranger, but it is the data the plan refuses to keep.
