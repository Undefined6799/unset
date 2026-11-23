---
status: Proposed
date: "2026-11-22"
step: P2.27g
amends:
  - adr: "0090"
    part: point 2, a sign-in alert shown on an older browser is seen on every browser
  - adr: "0085"
    part: point 3, the bell on a page with no script is a link to /notifications
---
# 0108 — A sign-in alert seen once is seen everywhere, and the bell links where no script runs

Amends point 2 of [0090](0090-bell-count-clears-on-the-whole-account.md) ("An entry is seen when either mark covers
it, except a sign-in alert") and point 3 of [0085](0085-bell-count-clears-when-seen.md) ("Opening the bell with no
script marks nothing"); every other point of 0079, 0081, 0085 and 0090 stands. The staging test of 2026-11-21 23:50Z
had browsers A and B signed in and C signing in after them: A showed "2 waiting", B "1 waiting", and after B opened
`/notifications`, A still showed 2. Every entry was a sign-in alert, which 0090 left per browser. Opening the bell on A
sent nothing and read the times in UTC, because that page (home) runs no script. Alex chose on 2026-11-21 at 23:56Z:
a sign-in alert seen on any browser signed in before it counts as seen everywhere, while the browser that signed in
still never sees or clears its own alert; and, with no objection, the bell on a page with no script becomes a link.

## Context

0090 kept the sign-in alert per browser so that the browser a sign-in is about could not clear it. That browser never
sees its own alert: `app.inbox` shows an `older_sessions_only` row only to sessions that began before it (0079 point
4). The account's one time mark cannot carry the finer rule: an intruder who signs in twice is told on its first
browser of its second sign-in, and a time moved to that alert would cover the alert about the first sign-in too.

0090 rejected letting older browsers clear the alert because an older browser can be the intruder's (a stolen
laptop). Such a browser can already dismiss the alert, which deletes it for every browser (0081), so a seen mark gives
it nothing it lacks; the rule only spares the member counting the same alert again on each device.

On home, the profile pages and the legal pages no script runs (ADR 0054). Their bell opened a native popover that
could mark nothing (0085 point 3), so its count stayed until the member opened `/notifications`, and its times were
the server's UTC.

## Decision

1. **Each sign-in alert keeps its own seen mark**: `app.notification.seen_at` (migration 0043), set the first time a
   browser that may see the alert shows it: opening the bell, or a visit to `/notifications` that marks seen under
   0085 point 3. It is set in the same statement that moves the browser's and the account's marks, only on alerts up
   to the entry shown and only on alerts that browser may see.
2. **A sign-in alert is seen once its own mark is set**, on every browser of the member; until then each older
   browser counts it, as before. Other entries follow 0090 point 2 unchanged. The browser a sign-in is about never
   sees that alert, so no browser the intruder signed in can mark the alert about its own first sign-in.
3. **On a page that runs no script, the bell is a link to `/notifications`**, in the header and in More actions on a
   phone; the page's visit marks the list seen (0085 point 3). Only pages that run SvelteKit's client (CSP group
   `app`) draw the bell's panel, so a panel's times are always the device's own. No script and no CSP change.

## Consequences

- One timestamp more on a notification row, about the member's own use of the app. Purpose: the badge. Lawful basis:
  contract, as the inbox. It goes with the row (dismissal, the 30-day sweep, `core.erase_did`). It is not exported.
- A member with several browsers looks at a sign-in alert once. An alert about a browser is still counted on every
  browser signed in before it until one of them shows it.
- On home, the profile pages and the legal pages, the bell no longer opens a panel: one click takes the member to the
  list. A visitor's click there goes to sign in, by way of `/notifications`.

## Alternatives

- **Keep 0090's per-browser alert** and explain it in the alert: Alex chose against it. Rejected.
- **Move the account's time mark over alerts too**: one look by the intruder's first browser at its second sign-in
  would cover the alert about the first. Rejected.
- **Run the bell's script on members' copies of the no-script pages**: loosens ADR 0054's no-script groups for a
  badge. Rejected.

## Compliance

`tests/integration/postgres/notification-store.test.ts` holds the marks as `web`: an alert shown on an older browser
is seen on every browser; an intruder's look at its second sign-in never covers the alert about its first.
`tests/integration/web/app/notifications.test.ts` holds the routes: the staging case (A, B, C), the intruder signing in
twice, an alert seen on one older browser clearing on all, and the bell drawn as a link on `/` and `/legal/terms` but
as a panel on a page with script. `tests/e2e/nojs.spec.ts` holds the link in a browser with no script. Acceptance is
Alex's line on the pull request that adds this record.
