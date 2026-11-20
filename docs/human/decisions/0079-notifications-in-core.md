# 0079 — Notifications are a core feature, worked out from what the app already keeps

Status: Proposed (awaiting Alex), 2026-11-20 (P2.27). Supersedes the "generic notification inbox" item of
decision 25 (ADR 0001; PLAN.md §4 "Deferred until the first plugin needs them" and §5.5) and nothing else in it: the
plugin manifest, registry, nav slots, mail transport, cron hooks and tenancy tables stay deferred. Alex asked for the
notification center on 2026-11-20 at 20:02Z ("a system to handle all the notification per user") and at 20:22Z said
"it's gonna have to be a core feature", with the sources and retention below.

## Context

The navbar has had a Notifications button since P1.20k whose panel said "coming soon". Decision 25 deferred a
notification inbox until the first plugin needed one, but notifications are per-member product data like invites,
not an optional extension, and Alex already sees several uses for them (account events now; chat invitations,
communities and social activity later).

Three constraints shape the first version:

- **No sign-in records.** PLAN.md §6 and ADR 0001 say there are no user sign-in records ("sign-in history stays
  counts only"); the OAuth callback writes no audit row for that reason. A stored "new sign-in" row would be one.
- **Privacy first.** Alex (20:22Z): 500 notifications for 180 days "is quite a long time if we're gonna claim to be
  like privacy focused"; a notification should go once it is opened, and a member may choose to keep the last
  30 days.
- **No code for features that do not exist.** Only real events may notify: today a new sign-in to the account and a
  change to the privacy notice (terms changes are already a gate that stops the member, so they need no entry).

atproto and Bluesky (read in `@atproto/api` 0.32.5, `dist/client/lexicons.js`, `app.bsky.notification.*`): a
notification is not a record in the member's repository. The AppView works it out from records other people publish
and serves it through `listNotifications` (newest first, a `reason` per item, `limit` 1 to 100, a cursor); read state
is one time per account (`updateSeen {seenAt}`), and `isRead` is computed from it. Preferences are private server
state. Notifications are therefore private, server-side data, never PDS records.

## Decision

1. **Core.** Notifications are a core capability with their own domain, `domains/notifications` (the list, its
   order, the caps and the parsed times), a page at `/notifications`, and the navbar bell. The bell shows an unread
   badge and the newest 5; the page shows 50.
2. **Worked out, not stored, while that is possible.** An entry that can be derived from data the app already keeps
   is derived, and nothing new is kept for it:
   - **New sign-in to your account**: another live session of the member that began after the one this browser
     holds and after this browser last opened its sign-in entries (`infrastructure/session` `newerSignIns`). The
     session row is the only record. When that session ends (sign-out, sign out everywhere, 7 days idle, 30 days at
     most), its entry goes with it. The entry shows the date and time only: we keep no address or device.
   - **We updated our privacy notice**: the privacy notice changed since the member dismissed it (P2.12b's
     `privacy_notice_seen_version`). The shell's banner stays as well.
3. **Opened means gone.** Each entry is a plain form button. Posting it marks the entry opened, so it no longer
   lists, and goes to what it is about: Settings › Account for a sign-in, the notice for the notice. "Mark all as
   read" names the newest sign-in listed and the notice version listed, and covers every older sign-in. Viewing the
   bell or the page never changes anything (a GET never writes). For a sign-in, "opened" is one time per browser
   session, `app.session.sign_ins_seen_at` (migration 0036). It only moves forward, never past now(), and only on
   the browser's own session, so a person who signed in with a stolen password can hide the alert only in their own
   browser, never in the member's.
4. **No polling, no push.** The bell's data comes with every page a member opens: the newest sign-ins come back with
   the session read the gate already makes, so the bell costs no database statement of its own. With script, times
   show in the device's time zone; without it, in UTC. Live updates, email and push are out of scope until a source
   needs them, and each gets its own decision then.
5. **Stored notifications, when the first source needs them.** A source that cannot be derived (account deletion
   scheduled, an upload refused, later follows, likes, chat invitations, communities) brings the stored model in its
   own PR, built as this ADR fixes it now:
   - one row per member and notification in the app schema: `did`, a `reason` from a closed list that grows by
     migration, an optional actor DID and subject AT-URI (the shape of Bluesky's `reason`, `author` and
     `reasonSubject`), a dedupe key, and `created_at`; no text a member typed;
   - by default a row is deleted when it is opened or marked read; the member may choose, on Settings › Privacy,
     to keep read notifications for 30 days instead;
   - every row, read or not, is deleted 30 days after it was made, in both modes;
   - erasure (`core.erase_did`) deletes the member's rows and the rows naming them as the actor; the privacy export
     lists them; the ROPA and the privacy notice gain their line in that PR.
6. **A device-only reminder is not a notification.** A profile left unsaved lives only on that device (ADR 0074's
   device-only drafts), so the server cannot know of it. Any reminder for it is drawn on that device from its own
   draft state, never stored or sent; it belongs to the in-place editing work.

## Consequences

- No new personal data: the session row already holds when it began; the new column holds when this browser last
  opened its sign-in entries and leaves with the row. Erasure, export and retention are unchanged for this slice.
- An entry can vanish before it is read when its session ends. That is the intended trade: once a session is gone it
  can no longer act, and keeping a record of it would be the sign-in history the plan rules out.
- Opening a newer sign-in also clears the older ones, as Bluesky's one `seenAt` does.
- The bell reads at most 11 newer sign-ins with each session read (one more than the badge counts); the page reads up
  to 51 on its own.
- Limits: opening and marking all as read count against a `notifications` policy (the page limits and 120 a minute
  per member, `interfaces/web/src/lib/server/limits.ts`), and a test holds that a member pressing the buttons
  repeatedly stays inside it.

## Compliance

`tests/integration/session/sign-ins.test.ts` holds the derived entry: only the member's own newer live sessions, newest
first, exact to the microsecond, forward-only marks per browser, no future mark, an ended or idle session taking its
entry with it, and no INSERT of the mark by web. `tests/integration/web/app/notifications.test.ts` holds the routes:
sign-in required, another member's sessions never shown, viewing changes nothing, opening and marking all as read
(repeated, stale, after a newer sign-in, malformed, cross-site) and the privacy notice entry.
`interfaces/web/src/lib/server/limits.budget.test.ts` holds that pressing the buttons repeatedly fits the
`notifications` limit, and `tests/integration/web/query-budget.test.ts` that the bell adds no statement to any page.
Acceptance is Alex's line on the pull request that adds this record.

## Alternatives

- **Store every notification now**, sign-ins included, with a retention sweep: rejected, as it keeps a sign-in
  history (plan §6) and stores data the app already has.
- **One "seen" time per account**, as Bluesky does: rejected for sign-ins, as anyone holding the account could hide
  the alert from every browser.
- **Records on the PDS**: rejected. They would be public, and atproto keeps notifications in the AppView, not the
  repository.
- **Polling or a live connection** for the count: not needed while every entry changes only when the member signs
  in or the notice is deployed.
