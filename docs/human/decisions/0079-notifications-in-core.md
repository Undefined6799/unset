# 0079 — Notifications are a core inbox with one way to send into it

Status: Accepted by Alex, 2026-11-21 00:38Z, against e8dcaa5 (his line "Merge 1855 at e8dcaa5", given after that head
was reviewed; merged as d4e3599). This status paragraph, the index row and the ADR 0001 acceptance line were added
afterwards in the P2.27b pull request. Point 3 is amended by [0081](0081-notifications-stay-until-dismissed.md).
Supersedes the "generic notification inbox" item of
decision 25 (ADR 0001; PLAN.md §4 "Deferred until the first plugin needs them" and §5.5) and nothing else in it: the
plugin manifest, registry, nav slots, mail transport, cron hooks and tenancy tables stay deferred. Point 4 amends the
"no user sign-in records" rule of PLAN.md §6 and ADR 0001 for one record kind, by Alex's decision of 2026-11-20. Alex asked for the
notification center on 2026-11-20 at 20:02Z ("a system to handle all the notification per user"), said at 20:22Z
"it's gonna have to be a core feature" with the retention below, and at 20:58Z and 21:00Z that it is an inbox with
"a proper interface" and "an easy way to send notification there", easy to add sources to and remove them from, which
a module installed later can use.

## Context

The navbar has had a Notifications button since P1.20k whose panel said "coming soon". Decision 25 deferred a
notification inbox until the first plugin needed one, but notifications are per-member product data like invites,
and Alex sees several uses for them (account events now; chat invitations, communities and social activity later).

A first draft of this step worked each entry out from data the app already kept, with no table. Adding a source then
meant changing about seven places, which Alex rejected: the list, the badge and opening must not change when a source
is added.

atproto and Bluesky (read in `@atproto/api` 0.32.5, `dist/client/lexicons.js`, `app.bsky.notification.*`): a
notification is not a record in the member's repository. The AppView keeps it and serves it through
`listNotifications` (newest first, a `reason` per item, an `author`, a `reasonSubject`, `limit` 1 to 100, a cursor).
Notifications are private, server-side data, never PDS records.

## Decision

1. **One inbox.** `app.notification` (migration 0036) holds one row per notification a member has not opened: the
   member's DID, a `reason` from a closed list that grows by migration, an optional `topic` the reason defines (1 to
   64 printable ASCII characters), an optional dedupe key (1 to 128; one row per member and key), `older_sessions_only`
   (point 4) and when it was sent. No text a person typed is stored. The bell shows an unread badge (capped at "9+")
   and the newest 5; `/notifications` shows 50. Notifications are a core capability with their own domain,
   `domains/notifications`.
2. **One way in, one table out.** A source sends with `notify(notification)` from `domains/notifications`, through
   web's `notifications.send`, or `sendIn` on the source's own transaction. `notify` refuses a reason outside the list
   or an over-long topic or key before anything is stored. The screens know a reason only through one table,
   `apps/web/lib/notifications/reasons.ts`: its words, its icon and the page opening it leads to, a path on this site.
   The build fails unless that table and the domain's reasons name the same set. The list, the badge, opening and
   "mark all as read" read only the inbox and that table, so adding a source is a reason in the list and the table's
   CHECK, its row in the reason table, and a `notify` call; removing one is the reverse.
3. **Opened means gone; 30 days at most.** Each entry is a plain form button; posting it deletes the row and goes to
   the reason's page. "Mark all as read" deletes everything up to the newest entry listed, never one sent after the
   list was drawn. Viewing never changes anything (a GET never writes). Every row is deleted 30 days after it was
   sent, opened or not, by web's sweep. Alex (20:22Z) may let a member keep opened notifications for the last 30 days
   instead, chosen on Settings › Privacy (P2.27a); the 30-day ceiling holds in both modes.
4. **A new sign-in is a stored entry that whoever signed in cannot clear.** The OAuth callback sends it in the
   transaction that makes the session, so its sent time is the session's start (both are the transaction's now()).
   It is marked `older_sessions_only`: only a browser of the member signed in before it may see, open or clear it, so
   a person who signed in with a stolen password cannot hide it from the member's other browsers, and the browser it
   is about never sees an alert about itself. It keeps the time only: no address, device or session id. This is a
   sign-in record, which PLAN.md §6 and ADR 0001 ("sign-in history stays counts only") ruled out; this ADR allows this
   one kind, bounded as above: one row per sign-in, deleted when opened and at 30 days at most, erased with the member,
   readable only by the member. Nothing else about sign-ins is kept. Alex decided this on 2026-11-20 at 21:26Z ("I
   guess we could keep a record of the sign in ... the last sign in and that stuff could still be kept"), so this
   amends that rule.
5. **The privacy notice entry** is sent at sign-in, once per notice version (its dedupe key), when the changed-notice
   banner would show (P2.12b's rule). Dismissing the banner withdraws it, and opening it records the notice as seen,
   as dismissing does, so a later sign-in does not send it again. A member already signed in when a notice is
   deployed has the banner, and gets the entry at their next sign-in.
6. **The contract a module will get.** No module exists, so no module may send yet, and no registry is built (decision
   25; architecture rule 7). When the first one arrives, it sends through the same `notify`, with these limits, which
   its own ADR may tighten and never loosen:
   - **Who may send:** only a module the install approved, and only reasons it declared, named under the module.
   - **To whom:** only the member the event is about; no broadcast and no list of recipients.
   - **Content:** a reason and, optionally, a DID and an AT-URI it names; never free text. Our reason table draws the
     words, so a module cannot put its own text or links in front of a member.
   - **Rate:** a cap per module and per member, and the 30-day ceiling; a member can mute a module.
7. **A device-only reminder is not a notification.** A profile left unsaved lives only on that device (ADR 0074's
   device-only drafts), so the server cannot know of it. Any reminder for it is drawn on that device from its own
   draft state, never stored or sent; it belongs to the in-place editing work.
8. **No polling, no push.** The bell's data comes with every page a member opens. With script, times show in the
   device's time zone; without it, in UTC. Live updates, email and push are out of scope until a source needs them,
   and each gets its own decision then.

## Consequences

- New personal data: a member's unopened notifications. Purpose: telling the member about their own account.
  Lawful basis: contract (GDPR Art. 6(1)(b)), as for the account itself. Erasure: `core.erase_did` deletes them, and
  they go by cascade with `app.account`. Export: they join the privacy export when it is built. The ROPA has the line.
- The bell costs a page no statement of its own: the session read brings the newest 11 entries this browser may
  see, through `app.inbox`, the one view where the rule of point 4 is written, which the inbox's own statements read
  too. The per-route query budget is unchanged.
- A member who signs in on a new device with no other browser signed in sees no sign-in alert there; any older
  browser that later opens the app does, until the entry is 30 days old.
- Limits: opening and marking all as read count against a `notifications` policy (the page limits and 120 a minute
  per member, `interfaces/web/src/lib/server/limits.ts`), and a test holds that a member pressing the buttons
  repeatedly stays inside it.

## Compliance

`tests/integration/postgres/notification-store.test.ts` holds the inbox: only the member's own entries and only with
their own live session, newest first, one row per dedupe key, nothing kept without an account, a sign-in entry out of
reach of its own and later browsers, opening once, another member's id opening nothing, mark-all bounded by the list,
withdraw, the sweep, no backdating or editing by web, and the reason CHECK. `tests/integration/web/app/notifications.test.ts`
holds the routes (sign-in required, denial, the new browser cannot clear the alert, viewing changes nothing, double and
stale posts, bad forms, cross-site, the notice and its withdrawal), `tests/integration/web/sign-in.test.ts` that a real
sign-in sends its entry in the session's transaction and the notice once, and `erase-did.test.ts` the erasure.
`apps/web/lib/notifications/reasons.test.ts` holds every reason's icon and link. Acceptance is Alex's line on the pull
request that adds this record.

## Alternatives

- **Work each entry out at read time** (the first draft): rejected by Alex, as every source touched the list, the
  badge, opening and marking.
- **One "seen" time per account**, as Bluesky does: rejected, as anyone holding the account could clear a sign-in
  alert from every browser.
- **Records on the PDS**: rejected. They would be public, and atproto keeps notifications in the AppView.
- **A source registry built now**: rejected until a module exists; the fixed list and the reason table cover the
  sources the app has.
