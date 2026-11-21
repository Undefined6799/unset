# Notifications

What a member is told about their own account (P2.27, ADR 0079 and 0081): an inbox, the bell in the navbar, and
`/notifications`.

## Path

A source → `services().notifications.send` (or `sendIn` inside its own transaction) → domains/notifications `notify`
→ infrastructure/postgres `notificationStore` → `app.notification`.
The screens: apps/web (`lib/notifications/reasons.ts`, `lib/components/notifications/`, the shell's Notifications
panel, `inbox.svelte` for the page) → interfaces/web (`+layout.server.ts` for the bell, `routes/notifications/` for
the page and its two forms) →
domains/notifications `inboxList` → the same store.

## Adding a source

1. Add the reason to `REASONS` in `domains/notifications/notifications.ts` and to the table's `CHECK` in a migration.
2. Add its row to `REASON_SCREENS` in `apps/web/lib/notifications/reasons.ts`: title, hint, detail text, kind,
   icon, and the button's words and page. The build fails until the two lists agree.
3. Call `notify` where the event happens, with a dedupe key if sending it twice must keep one entry.

The list, the detail, the badge and dismissing do not change. Removing a source is the same steps in reverse.

## What shows today

- **New sign-in to your account**, with its date and time. Sent in the sign-in's own transaction, so its time is the
  session's start. Only browsers signed in before it see it, so whoever signed in cannot clear it from the member's
  other browsers.
- **We updated our privacy notice**: sent once per version at sign-in when the banner would show; dismissing the
  banner withdraws it, and dismissing it counts as seeing the change.

## How it behaves

- Looking never changes anything. A row is a link to its detail (`?n=<id>`): when, what kind, what to do, and a button
  to the reason's page. An entry goes only when it is dismissed: its detail's Dismiss, Dismiss selected (the ticked
  rows, at most the 50 listed) or Dismiss all (everything the list showed and older, never one sent after it). Each is
  safe to send twice; an id that is gone, another member's, or one this browser may not see deletes nothing.
- The page fills the window below the header; the list scrolls on its own beside the detail. With script, the split
  is dragged (or moved with the arrow keys) between 2/5 and 3/5 and kept on this device, and a row whose title is cut
  off is lifted over the detail after the pointer rests on it. On a phone the detail is its own screen.
- The bell counts the entries waiting, up to "9+", and its rows link to their detail.
- The count is of entries not yet seen: opening the bell or the page marks what it showed seen on every browser of the
  member (ADR 0085, ADR 0090). A sign-in alert is the exception: each browser signed in before it counts it until that
  browser has shown it, so whoever signed in cannot clear it anywhere.
- Every entry is deleted 30 days after it was sent, dismissed or not (web's sweep). No text a person typed is stored.
- The bell's data comes with each page; there is no polling. Times show in UTC with no script and in the device's
  zone with it.
- Posts count against the `notifications` limit: the page limits and 120 a minute per member.

## Sign-in history (P2.27c, ADR 0082)

- A tab beside Notifications, `/notifications/sign-ins`: the member's sign-ins in the last 30 days, newest first, at
  most 50, with the date and time and how long ago. Only the time is kept: no address, device or place.
- The OAuth callback writes one row per sign-in in the sign-in's own transaction. Web's sweep deletes rows after 30
  days; erasure removes them.
- The member deletes one, the ticked ones or all ("all" stops at the newest listed), from any of their browsers. A
  second check before deleting comes with book P2.28.

## Later

Modules sending notifications follow the contract in ADR 0079
point 6 when the first one exists. A reminder for an unsaved profile can only be drawn on the device that holds it
(point 7).
