# 0049 — A browser session ends with its token set, enforced by the database

Status: Accepted by Alex, 2026-11-16 00:03:50Z, against 51508e1 ("ccept ADR 0049 at 51508e1", read as accept). Step P2.03t.

## Context
A browser session is a row in `app.session`. It is only good while the member's OAuth token set exists in
`app.oauth_session` (P2.04s): the session store's read joins the two and treats a session with no token set as
signed out (`infrastructure/session/store.ts`, `lookup`).

That rule lived in the read only. The row itself stayed in the table until the browser that held it came back. So
when a token set was deleted and the step that should end the sessions did not run, the rows waited, and the
member's next sign-in stored a new token set and made every one of them valid again. Three paths can leave rows
that way:

- Sign out everywhere (P2.08j): the revoke deletes the set, then `app.end_sessions_for_did` runs. If that second
  step fails, a repeat of the request reads no session and cannot finish the job (Codex on #1566, 2026-11-15).
- A dead grant (P2.11a): the library deletes the set, then `endSessions` runs with no retry.
- The under-16 block (P2.12): revoke, then `endSessions`, whose failure is only logged.

In each case a copied cookie the member believed they had ended works again after they sign back in. #1566 narrowed
the first case with three tries and a log line; it could not close it from the web layer.

## Decision
1. `app.session.did` references `app.oauth_session(did)` with `ON DELETE CASCADE` (migration 0025, constraint
   `session_did_token_set`). Deleting a token set deletes that DID's sessions in the same statement, whoever deletes
   it and for whatever reason.
2. The same constraint refuses a session row for a DID with no token set, so the order is fixed: token set first,
   then session. The sign-in callback already works in that order (the library stores the set inside
   `completeAuthorization`; `createSession` runs after it). If the set is gone by the time the session is written,
   the insert fails with 23503 and the callback answers `login.failed`.
3. The migration first deletes the sessions that have no token set today, in the same transaction, before it adds
   the constraint. Each of those rows already reads as signed out, so nobody loses a working session.
4. The store keeps its `has_token_set` check, and sign out everywhere keeps its tries. Both are now a second line.

What does not delete a token set, and so ends no session:

- **A token refresh.** The library calls `setStored`, and `oauthStores.ts` `set` is `INSERT ... ON CONFLICT (did) DO
  UPDATE`: the row is updated in place. `session.token_refresh_keeps_sessions` fails if that ever becomes a delete
  and an insert.
- **A sign-in that replaces a set.** The library's callback revokes and deletes the old set and then stores the new
  one (`@atproto/oauth-client` 0.8.10, `dist/oauth-client.js`, `callback`). `interfaces/http/sign-in-lock.ts` holds
  that delete until the sign-in ends and drops it when a store followed, so the member's other browsers stay signed
  in. `logout.replacing_sign_in_keeps_other_browsers` runs that sequence against Postgres and fails if a delete
  reaches the table.
- **A deactivated account.** `app.end_sessions_for_did(did, 'deactivated')` deletes the sessions itself and keeps
  the set, as before.

What does, by design: a refresh the sign-in server refuses, a revoke, sign out everywhere, the under-16 block,
erasure, and a sign-in whose new set could not be stored (the held delete then runs). Each already meant "every
browser of this member is signed out"; now it is true at once and cannot be undone by signing in.

A member in the middle of a sign-in when their old set is deleted: the sign-in holds the account's lock from its
first token-set write until its session row exists, and sign out everywhere takes the same lock, so the two run one
after the other. If the delete comes first, the sign-in then stores its set and creates its session normally. If a
delete without the lock lands between the sign-in's store and its session insert, the insert fails and the member
sees the sign-in error and tries again. Nothing is left half made.

Privileges do not change. The cascade is performed by Postgres's own referential-integrity trigger with the table
owner's rights (migrator), not the caller's. `web` is still the only login role that can delete a token set, and it
already holds DELETE on `app.session`. No role gains a way to end sessions that it did not have. The token sets can
no longer be truncated without the sessions.

## Alternatives
- **A hand-written AFTER DELETE trigger.** Same effect on delete. Not chosen: it is our code where Postgres has a
  declarative constraint, it runs as the caller unless made a definer, and it covers neither the insert order nor
  TRUNCATE.
- **Sign-in ends a DID's older sessions when it stores a set for a DID that had none.** Not chosen: it leaves the
  rows in place until then, needs a rows-only delete that does not exist, and depends on every future path
  remembering it.
- **Bind each session to a token-set generation** (a column on both tables). Stronger than needed: it would also
  end sessions when a set is replaced, which we do not want, and it changes two tables and the store.
- **Run the definer before the revoke.** Not possible: the library's revoke needs the stored set and always deletes
  it itself.

## Consequences
- Adding the constraint takes a SHARE ROW EXCLUSIVE lock on both tables and scans `app.session` once
  (https://www.postgresql.org/docs/18/sql-altertable.html). Reads go on; session writes and token-set writes wait
  for the commit. The table holds one small row per signed-in browser and is indexed on `did`, so this is a moment,
  inside the runner's 5 s lock wait.
- Every session insert now takes a key-share lock on its token-set row. A refresh updates non-key columns and does
  not wait on it; a delete of the set waits for an in-flight session insert, or the insert fails. That is the
  ordering we want.
- Test helpers and fixtures must store a token set before they create a session. The ones in the tree already do,
  because a session without one never read as signed in; `session.needs_a_token_set` shows what a helper that
  forgets gets.
- `session.end_sessions_single_sql` is unchanged: no new statement deletes a DID's sessions. The cascade is a
  second way they end, stated here and in that test's comment.
- The one-time cleanup and the constraint were run by hand on a scratch Postgres 16; no automated test replays the
  cleanup against a database that holds orphan rows.
- Rollback is a contract migration that drops the constraint. The rows the cleanup deleted were unusable and are
  not restored.

## Compliance
`tests/integration/session/store.test.ts`: `session.no_token_set_ends` (the set's delete removes the rows, and a
new set does not bring an old cookie back), `session.needs_a_token_set`, `session.token_refresh_keeps_sessions`,
`session.token_set_constraint`. `tests/integration/http/logout.test.ts`:
`logout.replacing_sign_in_keeps_other_browsers`.
