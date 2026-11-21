---
status: Accepted
date: "2026-11-21"
accepted:
  at: "2026-11-21T06:12Z"
  head: 626ac89c84ed4aab93d1934d53478398059ba128
  line: "Merge 1910 at 626ac89"
  merged: 875dda7c501a429d7896da587c808fb13fb9f594
step: P2.27e
amends:
  - adr: "0081"
    part: points 1 and 3, looking writes nothing and the badge counts what is waiting
---
# 0085 — The bell's count clears once this browser has seen the list

Amends points 1 and 3 of [0081](0081-notifications-stay-until-dismissed.md) ("Looking changes nothing", "The badge
counts what is waiting");
every other point of 0081 and of [0079](0079-notifications-in-core.md) stands. Alex asked on 2026-11-21 at 05:16Z:
"When you click on it, like that number should disappear and only ... come back with like some more if like there's
new notification. Like I shouldn't have to dismiss it", and said "go" at 05:17Z.

## Context

Under 0081 the badge counted every entry this browser may see until it was dismissed, so an entry the member had
already read kept the number up. Alex wants the number to mean "new since you last looked", while the entries stay
listed until dismissed, as 0081 decided.

0079 rejected **one seen time per account**: anyone holding the account could clear a sign-in alert everywhere. A
browser that signs in as the member (the sign-in the alert is about) could open the bell and clear the badge on the
member's own laptop and phone. So the mark is kept per browser, not per account.

## Decision

1. **Each browser session keeps a seen mark**: `app.session.notifications_seen_at` (migration 0039), the time of the
   newest entry this browser has shown. `app.inbox` gains `seen`, true for an entry sent no later than the mark.
2. **The badge counts the entries this browser has not seen**, capped at "9+" as before. Seen entries stay listed,
   and in the bell's panel, until they are dismissed or their 30 days are up.
3. **What marks them seen:** opening the bell (with script, a background `POST /notifications?/seen` naming the newest
   entry the bell shows; the badge goes at once) and a visit to `/notifications` that the member made: its
   `Sec-Fetch-Site` is `same-origin` (our own links and client navigations) or `none` (a typed address or bookmark),
   and it is no prefetch. The page's GET therefore writes this one mark and nothing else; with no script the "View all"
   link is how the mark moves. A visit from another site, one with no Fetch Metadata, and a prefetch mark nothing, so
   another site cannot make a new-sign-in badge vanish by sending the member's browser there (SameSite=Lax still
   sends the cookie on that navigation). Opening the bell with no script marks nothing.
4. **The mark only moves forward and only to an entry this browser may see.** One `UPDATE ... FROM app.inbox` with
   `greatest()`, so an older id, another member's id, or the id of a sign-in entry this browser may not see marks
   nothing. A browser's mark is never another browser's: the new browser of a sign-in cannot clear the alert's badge
   on the member's older browsers (0079 point 4 still holds for the count).

## Consequences

- One timestamp more on a row that exists already, about the member's own use of the app. Purpose: the badge. Lawful
  basis: contract, as the session. It goes with its session row (sign out, expiry, sign out everywhere) and with the
  member (`core.erase_did` ends every session). It is not exported: it says nothing beyond the session it lives on.
- A member with two browsers sees the count on the second until they look there too. That is the cost of not letting
  one browser clear another's alert.
- A browser that sends no Fetch Metadata (older than Chrome 76, Firefox 90 or Safari 16.4) clears the badge only by
  opening the bell with script. No link on our pages preloads the page.
- The `seen` form counts against the notifications limit; it is sent only when the badge shows a number.

## Alternatives

- **One seen time per account**, as Bluesky does (`app.bsky.notification.updateSeen`, read in @atproto/api 0.30.3,
  dist/agent.d.ts): one look clears the badge on every device, which is what Alex described. Rejected here for the
  reason 0079 gave: the browser a sign-in alert is about could clear that alert's badge on the member's other
  browsers. It stays Alex's call; choosing it would make the mark per account and the sign-in alert an exception that
  always counts.
- **Mark seen in the browser only** (local storage): no migration, but the count comes back on every page the server
  draws, and with no script nothing clears it. Rejected: the server draws the bell on every page.
- **Keep 0081's count and dismiss on open**: Alex asked for the entries to stay. Rejected.

## Compliance

`tests/integration/postgres/notification-store.test.ts` holds the mark: this browser's only, never moving back, and
nothing for a later browser's or another member's id; the session read brings `seen` with the bell.
`tests/integration/web/app/notifications.test.ts` holds the routes: the page clears its own browser's count and not
another's, a newer entry counts again, a cross-site, header-less or prefetch visit marks nothing, the `seen` form from
the alert's new browser or another site clears nothing.
Acceptance is Alex's line on the pull request that adds this record.
