---
status: Proposed
date: "2026-11-21"
step: P2.27f
amends:
  - adr: "0085"
    part: points 1 and 4, the seen mark is the account's for every entry but the sign-in alert
---
# 0090 — Seen once is seen on the whole account, except a sign-in alert

Amends points 1 and 4 of [0085](0085-bell-count-clears-when-seen.md) ("Each browser session keeps a seen mark", "A
browser's mark is never another browser's"); its points 2 and 3 (what the badge counts, what marks entries seen)
stand, and so does every point of [0079](0079-notifications-in-core.md) and [0081](0081-notifications-stay-until-dismissed.md).
The staging bug hunt of 2026-11-21 found that a notification seen on one device still counted as new on another.
Asked whether one look should clear it everywhere, Alex said at 19:36Z: "once I open ... the bell icon ... it should
be reflected across my whole account as well ... I shouldn't have to see that multiple time, because then I
technically already saw it", and named the chat notification the same way.

## Context

0085 kept the mark per browser for one reason: under a mark per account, the browser a sign-in is about could open
the bell and clear that sign-in's alert on the member's laptop and phone. That reason holds for the sign-in alert
only. Every other entry (today the privacy notice, later chat and the rest) says nothing a stranger in the account
would want to hide, and counting it again on each device is the nuisance Alex found.

## Decision

1. **The account keeps a seen mark**: `app.account.notifications_seen_at` (migration 0041), the time of the newest
   entry any of the member's browsers has shown. Opening the bell or a visit to `/notifications` that marks seen
   under 0085 point 3 moves this mark and the browser's own mark together, in one statement, only forward and only to
   an entry that browser may see (0085 point 4's checks, unchanged).
2. **An entry is seen when either mark covers it, except a sign-in alert.** `app.inbox.seen` is true when this
   browser's own mark covers the entry, or the account's does and the entry was not sent `older_sessions_only`. The
   sign-in alert is the one row sent that way (0079 point 4), so it counts on each older browser until that browser
   has shown it: the new browser, which may not see the alert, cannot clear it anywhere, and a look at a newer entry
   there does not cover it either.
3. **Kinds added later follow the account mark** with nothing to change: a source that sends without
   `older_sessions_only` is cleared everywhere by one look. A source that must warn each browser on its own sends with
   it, as the sign-in alert does, and is then also seen only by browsers signed in before it.

## Consequences

- One timestamp more on the account row, about the member's own use of the app. Purpose: the badge. Lawful basis:
  contract, as the account. It goes with the account (`core.erase_did`). It is not exported: it says nothing about the
  member beyond the entries, which go within 30 days.
- A member with two browsers no longer has to look on both, except for a sign-in alert, which each older browser
  still counts until it is seen there. That is deliberate: each of the member's devices is told of a new sign-in.
- The per-browser mark of 0039 stays and is still moved; it is what covers the sign-in alert.

## Alternatives

- **One mark per account for every entry**, sign-in alert included (Bluesky's `app.bsky.notification.updateSeen`,
  read in @atproto/api 0.30.3 for 0085): simplest, but lets the browser a sign-in is about clear its alert on the
  member's other devices, the attack 0079 and 0085 guard against. Rejected.
- **Keep 0085's mark per browser**: Alex asked for the opposite. Rejected.
- **Let only browsers older than the sign-in clear the alert account-wide**: one look on the member's own laptop would
  clear the phone's alert, but an older browser can be the intruder's too (a stolen laptop), and the rule is harder to
  read. Rejected for the one-per-browser rule above.

## Compliance

`tests/integration/postgres/notification-store.test.ts` holds the marks as `web`: a look on one browser counts on
every browser and never moves back; the new browser's look at a newer entry covers that entry everywhere and never the
alert; an alert seen on one older browser still counts on another; nothing moves for a later browser's or another
member's id; the session read brings `seen` by the same view. `tests/integration/web/app/notifications.test.ts`
holds the routes: the page clears the count on every browser until a newer entry, and a sign-in alert seen on one
browser still counts on the others. Acceptance is Alex's line on the pull request that adds this record.
