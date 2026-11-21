# 0081 — Notifications stay until they are dismissed

Status: Proposed (awaiting Alex), 2026-11-21 (P2.27b). Amends point 3 of [0079](0079-notifications-in-core.md) ("Opened
means gone"); every other point of 0079 stands. Alex chose this on the mock-up of 2026-11-21 between 00:15Z and
00:36Z: "they shouldn't be deleted as soon as you open it. ... let the user select them ... or maybe have a button at
the top like dismiss all", a page that uses the full window with a list beside the chosen entry, a split he can drag
with each side at least 2/5, and a cut-off row lifted over the detail on hover; "perfect implement that" at 00:36Z.

## Context

Under 0079 point 3, an entry was a form button that deleted the row and went to the reason's page. Looking at a
notification therefore removed it, and a member could not read one, come back and decide later. Alex asked for the
inbox to behave like a mail list: open an entry to read it, and remove entries by choice, one, several or all.

## Decision

1. **Looking changes nothing.** A row on `/notifications` is a link to `?n=<id>`, which shows that entry's detail
   (what happened, when, its kind, and a button to the reason's page). The bell's rows link there too. A GET never
   writes, as before.
2. **Dismissing is the only way an entry goes before its 30 days.** Three plain forms post to `/notifications`:
   `?/dismiss` with one id (the detail's Dismiss) or the ticked ids (Dismiss selected, at most the 50 the page lists),
   and `?/dismissAll` with the newest id listed, which deletes it and everything older, never one sent after the list
   was drawn. Each deletes only rows this browser may see (0079 point 4) and is safe to send again.
3. **The badge counts what is waiting.** The count is the entries this browser may see, capped at "9+", since none is
   "read" without being gone. The bell's name says "N waiting".
4. **The privacy notice entry counts as seen when it is dismissed**, alone or with all, as 0079 point 5 said of
   opening it.
5. **The page** fills the window below the header; the list scrolls on its own. With script, a row is shown without a
   round trip on a wide screen, the split moves between 2/5 and 3/5 by pointer or arrow keys and is kept in this
   browser's local storage only (a layout preference, not personal data), and a cut-off title lifts the whole row
   over the detail after a 0.4 s rest, never within 40 px of the split. On a phone the detail is its own screen at
   `?n=`, so Back returns to the list. With no script every part is a link or a form.

## Consequences

- No new data and no migration: the rows, the view `app.inbox`, the grants and the 30-day sweep are unchanged.
- The page's form limit grows from 1 KB to 4 KB, so Dismiss selected can name all 50 listed entries (about 40 bytes
  each); a test sends that largest form.
- An entry a member never dismisses stays, and counts on the bell, until its 30 days are up.

## Compliance

`tests/integration/postgres/notification-store.test.ts` holds dismissing (only the named rows, once, another member's
or the new browser's ids deleting nothing, dismiss all bounded by the list). `tests/integration/web/app/notifications.test.ts`
holds the routes: showing an entry changes nothing, its button leads to the reason's page, dismissing several, the
largest form, double and stale posts, denial, cross-site, and the notice recorded as seen on dismiss.
`tests/e2e/notifications.spec.ts` holds the page: the footer below the fold, the list scrolling, the split's bounds,
showing without leaving, the lifted row, and the phone's detail screen. Acceptance is Alex's line on the pull request
that adds this record.

## Alternatives

- **A read state** (a `read_at` column, opening marks it): kept entries would need a migration and a second idea of
  "unread" next to "waiting"; Alex asked only that opening not delete.
- **Keep opening-deletes and add an undo**: still loses an entry a member only wanted to look at.
