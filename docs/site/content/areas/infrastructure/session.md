---
title: session
weight: 6
---

The browser session store. Package `@unset/infrastructure-session`. Decision 34's folder list does not name it. The tree has this folder, so the page is here.

## Owns

`infrastructure/session/store.ts` is the package. `createSessionStore` returns `create`, `read`, `destroy`, `destroyAllForDid`, `setEmailConfirmed` and `sweep`.

`create` draws 32 bytes (`randomBytes`), returns them as unpadded base64url `cookieValue`, and inserts `sha256` of those bytes into `app.session.id_hash`. `read` hashes the cookie the same way. A missing cookie is `session: null` and `clearCookie: false`. Any other value that is not the canonical 43-character form of 32 bytes is `clearCookie`. Expiry uses `now()` in the SQL. A row whose DID has no `app.oauth_session` is destroyed and returned as `clearCookie`.

`SessionDb` is a `query` method. `WithSessionDb` is how `read` takes a connection. The composition root passes them. This package does not import `infrastructure/postgres` or `pg`. The [`infrastructure` row](../) does not let it.

`END_SESSIONS_REASONS` is the same ten strings as the `IN` list in `infrastructure/postgres/migrations/0014_app_end_sessions.sql`. `destroyAllForDid` calls `app.end_sessions_for_did($1, $2)`. That function deletes `app.session` for the DID. When `p_why` is not `deactivated` it also deletes `app.oauth_session` for the DID.

`interfaces/http/compose.ts` calls `createSessionStore`. Cookie attributes are `interfaces/http`, not this package.

## May import

The [`infrastructure` row](../).

Declared in `infrastructure/session/package.json`:

| Dependency | Version |
| --- | --- |
| `@unset/domains-identity` | workspace |
| `@unset/shared-errors` | workspace |
| `@unset/shared-log` | workspace |

`store.ts` imports the `Did` type from `@unset/domains-identity`.

## Entry points

| Role | Path |
| --- | --- |
| Package export `.` | `infrastructure/session/index.ts` |
| Composition | `interfaces/http/compose.ts` |

No `main.ts`, no CLI, no Compose service.

## Data

SQL in `store.ts`:

| Statement | Objects |
| --- | --- |
| `INSERT` / `UPDATE` / `DELETE` on the session row | `app.session` |
| `EXISTS` subquery on read | `app.oauth_session` |
| `SELECT app.end_sessions_for_did($1, $2)` | `app.end_sessions_for_did` |

Grants for those objects are on the [postgres](../postgres/) page. `grant-matrix.json` gives them to `web` and to no other roster role. `0011_app_session.sql` says the same for `app.session`: the comment grants `web` and no other role.

`erasure-registry.json` lists `app.session.did` as `delete_row`.

`0011_app_session.sql` still comments `infrastructure/postgres/session/`. `store.ts` says the store moved here and the migration comment stays because `migrate.ts` checksums an applied file.
