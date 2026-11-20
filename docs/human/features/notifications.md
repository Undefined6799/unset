# Notifications

What a member is told about their own account (P2.27, ADR 0079): an inbox, the bell in the navbar, and
`/notifications`.

## Path

A source → `services().notifications.send` (or `sendIn` inside its own transaction) → domains/notifications `notify`
→ infrastructure/postgres `notificationStore` → `app.notification`.
The screens: apps/web (`lib/notifications/reasons.ts`, `lib/components/notifications/`, the shell's Notifications
panel) → interfaces/web (`+layout.server.ts` for the bell, `routes/notifications/` for the page and its two forms) →
domains/notifications `inboxList` → the same store.

## Adding a source

1. Add the reason to `REASONS` in `domains/notifications/notifications.ts` and to the table's `CHECK` in a migration.
2. Add its row to `REASON_SCREENS` in `apps/web/lib/notifications/reasons.ts`: title, hint, icon, and the page opening
   it leads to. The build fails until the two lists agree.
3. Call `notify` where the event happens, with a dedupe key if sending it twice must keep one entry.

The list, the badge, opening and Mark all as read do not change. Removing a source is the same steps in reverse.

## What shows today

- **New sign-in to your account**, with its date and time. Sent in the sign-in's own transaction, so its time is the
  session's start. Only browsers signed in before it see it, so whoever signed in cannot clear it from the member's
  other browsers.
- **We updated our privacy notice**: sent once per version at sign-in when the banner would show; dismissing the
  banner withdraws it, and opening it counts as seeing the change.

## How it behaves

- Viewing never changes anything. Each entry is a plain form button: opening deletes it and goes to its reason's page.
  Mark all as read deletes everything the list showed and older, never one sent after the list was drawn. Both are
  safe to send twice; an id that is gone, another member's, or one this browser may not see deletes nothing.
- Every entry is deleted 30 days after it was sent, opened or not (web's sweep). No text a person typed is stored.
- The bell's data comes with each page; there is no polling. Times show in UTC with no script and in the device's
  zone with it.
- Posts count against the `notifications` limit: the page limits and 120 a minute per member.

## Later

The keep-30-days choice on Settings › Privacy (P2.27a). Modules sending notifications follow the contract in ADR 0079
point 6 when the first one exists. A reminder for an unsaved profile can only be drawn on the device that holds it
(point 7).
