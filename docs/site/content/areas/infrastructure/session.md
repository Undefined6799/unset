---
title: session
weight: 6
---

The browser session store. Package `@unset/infrastructure-session`. Decision 34's folder list does not name it. The tree has this folder, so the page is here.

## Owns

`infrastructure/session/store.ts` is the package. `createSessionStore` returns `create`, `read`, `destroy`, `destroyAllForDid`, `countLive`, `setEmailConfirmed` and `sweep`. `countLive(db, did)` counts that DID's sessions that are still within both lifetimes and still have a stored token set. It uses the same `WITHIN_LIFETIMES` SQL as the lookup inside `read`. A count that is not a non-negative whole number throws (`session count missing`), so a broken read never passes for no browser left. Sign-out uses the count to tell whether this browser is the member's last one (`interfaces/web/src/lib/server/sign-out.ts`).

`create` draws 32 bytes (`randomBytes`), returns them as unpadded base64url `cookieValue`, and inserts `sha256` of those bytes into `app.session.id_hash`. `read` hashes the cookie the same way. A missing cookie is `session: null` and `clearCookie: false`. Any other value that is not the canonical 43-character form of 32 bytes is `clearCookie`. A row whose DID has no `app.oauth_session` is destroyed and returned as `clearCookie`. `read` also returns that session's newest rows of the `app.inbox` view as `inbox`. The view is defined in `infrastructure/postgres/migrations/0043_app_notification_seen_at.sql`. The limit is `BELL_READ` from `@unset/domains-notifications`.

`create` also takes `issuerOrigin`, the origin of the sign-in server ([ADR 0048](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0048-session-issuer-origin.md)). It writes it to `app.session.issuer_origin` once, and `read` returns it as `issuerOrigin`. An origin the column's check would refuse (migration 0019) is stored as null, as is a missing one. Nothing updates the column: `web` holds SELECT and INSERT on it only.

A session ends at whichever limit comes first. `create` sets `absolute_expires_at` to `now()` plus `SESSION_ABSOLUTE_S`. `read` treats the row as expired when `now()` is after `absolute_expires_at` or after `last_seen_at` plus `SESSION_IDLE_S` (`infrastructure/session/store.ts`). When `now()` minus `last_seen_at` is greater than `SESSION_TOUCH_INTERVAL_S`, `read` sets `last_seen_at` to `now()`. A failed touch logs a warning `session.touch_failed` and the read still returns the session. `sweep` deletes rows past either limit and takes no lock. `interfaces/web/src/lib/server/sweeps.ts` runs it (`job` `sweep.session`) from `interfaces/web/src/lib/server/compose.ts`, then hourly. Ranges and defaults for `SESSION_IDLE_S`, `SESSION_ABSOLUTE_S` and `SESSION_TOUCH_INTERVAL_S` are in `interfaces/web/src/lib/server/config.ts`. `SESSION_ABSOLUTE_S` is also the session cookie `Max-Age`: `interfaces/web/src/lib/server/oauth-callback.ts` passes it to `putSessionCookie` in `interfaces/web/src/lib/server/session.ts`.

`SessionDb` is a `query` method. `WithSessionDb` is how `read` takes a connection. The composition root passes them. This package does not import `infrastructure/postgres` or `pg`. The [`infrastructure` row](../) does not let it.

`END_SESSIONS_REASONS` is the same ten strings as the `IN` list in `infrastructure/postgres/migrations/0014_app_end_sessions.sql`. `destroyAllForDid` calls `app.end_sessions_for_did($1, $2)`. That function deletes `app.session` for the DID. Since migration `0024_app_session_token_set_fk.sql`, `app.session.did` also references `app.oauth_session(did)` with `ON DELETE CASCADE`: deleting a member's token set deletes their sessions, and a session cannot be inserted before its token set (ADR 0049). When `p_why` is not `deactivated` it also deletes `app.oauth_session` for the DID.

`interfaces/web/src/lib/server/compose.ts` calls `createSessionStore`. Cookie attributes are `interfaces/web`, not this package.

## May import

The [`infrastructure` row](../).

Declared in `infrastructure/session/package.json`:

| Dependency | Version |
| --- | --- |
| `@unset/domains-identity` | workspace |
| `@unset/domains-notifications` | workspace |
| `@unset/shared-errors` | workspace |
| `@unset/shared-log` | workspace |

`store.ts` imports the `Did` type from `@unset/domains-identity`, and `BELL_READ` from `@unset/domains-notifications`.

## Entry points

| Role | Path |
| --- | --- |
| Package export `.` | `infrastructure/session/index.ts` |
| Composition | `interfaces/web/src/lib/server/compose.ts` |

No `main.ts`, no CLI, no Compose service.

## Data

SQL in `store.ts`:

| Statement | Objects |
| --- | --- |
| `INSERT` / `SELECT` / `UPDATE` / `DELETE` on the session row, including `countLive`'s `count(*)` | `app.session` |
| `EXISTS` subquery on read and on `countLive` | `app.oauth_session` |
| `json_agg` of the newest rows of the `app.inbox` view on read | `app.inbox` |
| `SELECT app.end_sessions_for_did($1, $2)` | `app.end_sessions_for_did` |

Column lists are in `infrastructure/postgres/grant-matrix.json`. That file gives `app.session`, `app.oauth_session` and `app.inbox` to `web` and to no other roster role. It gives `EXECUTE` on `app.end_sessions_for_did` to `web` and to `indexer` (migration `0027_indexer_end_sessions.sql`). `0011_app_session.sql` comments that `app.session` is granted to `web` and no other role.

`erasure-registry.json` lists `app.session.did` as `delete_row`.

`0011_app_session.sql` still comments `infrastructure/postgres/session/`. `store.ts` says the store moved here and the migration comment stays because `migrate.ts` checksums an applied file.
