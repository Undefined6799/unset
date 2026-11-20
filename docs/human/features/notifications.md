# Notifications

What a member is told about their own account (P2.27, ADR 0079): the bell in the navbar and `/notifications`.

## Path

apps/web (`lib/components/notifications/`, the shell's Notifications panel) → interfaces/web (`+layout.server.ts`
for the bell, `routes/notifications/` for the page and its two forms) → domains/notifications → infrastructure/session
(the session read and `app.session.sign_ins_seen_at`) and the account repository (the privacy notice's seen version).

## What shows

- **New sign-in to your account**, with its date and time: another live session of the member that began after the
  one this browser holds. Worked out from the sessions; nothing is stored, and the entry ends with its session.
- **We updated our privacy notice**: the notice changed since the member dismissed it. The shell's banner stays.

## How it behaves

- Viewing never changes anything. Each entry is a plain form button: it marks the entry opened, so it is gone, and
  goes to Settings › Account (a sign-in) or the notice. Mark all as read covers everything listed and every older
  sign-in, never one that arrived after the list was drawn. Both are safe to send twice.
- A sign-in's "opened" is per browser, so someone who signed in with a stolen password cannot hide it from the member.
- The bell's data comes with each page, at no extra database statement; there is no polling. Times show in UTC with
  no script and in the device's zone with it.
- Posts count against the `notifications` limit: the page limits and 120 a minute per member.

## Later

Stored notifications, the keep-30-days choice and the 30-day ceiling come with the first source that cannot be worked
out (ADR 0079 point 5, step P2.27a). A reminder for an unsaved profile can only be drawn on the device that holds it
(point 6).
