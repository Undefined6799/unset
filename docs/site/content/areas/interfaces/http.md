---
title: http
weight: 1
---

The web server for unset.sh. Package `@unset/interfaces-http`. `UNSET_SERVICE` is `http`. Compose service name is `web`.

Route table: [Endpoints](/endpoints/).

## Owns

Public pages, sign-in, the signed-in account page, and the adapters those routes call. `interfaces/http/compose.ts` is the only file here that builds adapters. It wires the `web` Postgres pools, the sealer, net-guard, the identity network, the OAuth client, the session store and the account store, then registers the route modules below. `main.ts` does not import `infrastructure/`.

The kit adds `GET /health` in `shared/http/server.ts`. The body is status, service and commit (`shared/http/health.ts`).

| Module | What it holds |
| --- | --- |
| `interfaces/http/routes/home.ts` | Landing page. |
| `interfaces/http/routes/legal.ts` | Terms, privacy and domains pages. |
| `interfaces/http/routes/security-txt.ts` | `security.txt`. The field checks are `interfaces/http/security-txt.ts`. |
| `interfaces/http/routes/prefs.ts` | Theme form. Return target: `interfaces/http/prefs/return-to.ts`. Cookie: `interfaces/http/prefs/theme.ts`. |
| `interfaces/http/routes/assets.ts` | Built files from apps/web, by exact name from the manifest read in `interfaces/http/web/build.ts`. |
| `interfaces/http/routes/oauth-metadata.ts` | OAuth client metadata and JWKS, built at boot. |
| `interfaces/http/routes/login.ts` | Sign-in form and the start of authorization. Browser binding: `interfaces/http/routes/sign-in-state.ts`. |
| `interfaces/http/routes/oauth-callback.ts` | Authorization callback. |
| `interfaces/http/routes/logout.ts` | Sign-out for this browser. Session count: `interfaces/http/logout-sessions.ts`. |
| `interfaces/http/routes/welcome.ts` | Onboarding. Account rows: `interfaces/http/account.ts`. |
| `interfaces/http/routes/verify-email.ts` | Email confirmation page. Refresh: `interfaces/http/email-refresh.ts`. |
| `interfaces/http/routes/settings.ts` | Settings profile page. |
| `interfaces/http/routes/me.ts` | Signed-in account page. |
| `interfaces/http/app-gate.ts` | Page gate `openApp`: session, then onboarding, then a confirmed email. |
| `interfaces/http/web/page.ts` | Page responses and the kit error-page hook. |
| `interfaces/http/web/render-entry.ts` | Loads `@unset/apps-web/server`. |
| `interfaces/http/routes/test-routes.ts` | Test-only pages. `compose.ts` imports this module only when `TEST_ROUTES` is on. `config.ts` allows that only when `UNSET_ENV` is `test`. |
| `interfaces/http/limits.ts` | Rate-limit policy names `default`, `login`, `search`, `report`, `follow`, `like`, `upload`. Which route uses which name is on [Endpoints](/endpoints/). |

Every route in this process sets `session: "none"`. `defineRoute` writes `requiresSession` only for `"required"`, so `interfaces/http/routes.manifest.json` has no session field (`shared/http/routes.ts`). That is not "no auth". Page gating is `openApp` (`interfaces/http/app-gate.ts`). `interfaces/http/routes/welcome.ts`, `interfaces/http/routes/verify-email.ts` and `interfaces/http/routes/logout.ts` read the session in the handler. `GET /login` reads it to send a signed-in visitor to `/did` (`interfaces/http/routes/login.ts`).

The confirmed-email cache is rechecked at the next gated page view, at most `EMAIL_RECHECK_S` (max 900s), and only on our own PDS. It is not a wall-clock timer. `emailGate` (`domains/identity/auth/gates.ts`) compares the cache age when `openApp` runs. A stale cache calls `emailRefresh` (`interfaces/http/email-refresh.ts`), which asks the PDS. The maximum is 900 in `interfaces/http/config.ts`.

`compose.ts` keeps `meRoutes` last so the one-segment DID route does not shadow the explicit paths.

Screens are `apps/web`. The loader requires `renderPage`, `islandName`, `screens` and `safeHref`.

## May import

The [`interface` row](../) on the section page, plus:

| Rule | This process |
| --- | --- |
| `interface-http-render` | May import `apps/web/render.tsx` and no other file under `apps/`. |
| `interface-http-render-build` | `interfaces/http/web/render-entry.ts` may import `@unset/apps-web/server`. |
| `web-not-admin` | Nothing whose path is `admin/…` or contains `/admin/`. |
| `no-interface-to-interface` | No other folder under `interfaces/`. |

Declared in `interfaces/http/package.json`:

| Dependency | Version |
| --- | --- |
| `@unset/apps-web` | workspace |
| `@unset/domains-identity` | workspace |
| `@unset/infrastructure-audit` | workspace |
| `@unset/infrastructure-net-guard` | workspace |
| `@unset/infrastructure-pds` | workspace |
| `@unset/infrastructure-postgres` | workspace |
| `@unset/infrastructure-seal` | workspace |
| `@unset/infrastructure-session` | workspace |
| `@unset/shared-config` | workspace |
| `@unset/shared-errors` | workspace |
| `@unset/shared-http` | workspace |
| `@unset/shared-islands` | workspace |
| `@unset/shared-log` | workspace |
| `@unset/shared-ui` | workspace |
| `react` | 19.3.0 |

## Entry points

| Role | Path |
| --- | --- |
| Process | `interfaces/http/main.ts` |
| Composition root | `interfaces/http/compose.ts` |
| Config | `interfaces/http/config.ts` |
| Image | `ENTRYPOINT ["node", "interfaces/http/main.ts"]` in `deployment/images/node-app.Dockerfile` |
| Compose | Service `web` in `deployment/compose.dev.yaml` and `deployment/compose.local.yaml` |

`main.ts` reads config, composes, runs `boot()` (the connection-budget check), then `listen`.

From the repository root:

```sh
npm run dev:up
```

That is `node deployment/preflight/stack.ts -- up --env dev --compose deployment/compose.dev.yaml …` (`package.json`). The container runs the entrypoint above. `UNSET_SERVICE` is `http`. `PG_USER` is `web`.

## Data

Role `web` in `infrastructure/postgres/roles.json`: class `service`, login, `connectionLimit` 40, `statement_timeout` `2s`, `passwordFrom` `pg_web_password`.

`compose.ts` calls `createPool` with `application_name` `web` and `createLockPool` with `application_name` `web-lock`. The login is `PG_USER` from `connectionOf` (`infrastructure/postgres/config.ts`). Building the pool opens no connection (`infrastructure/postgres/pool.ts`). `boot()` calls `checkConnectionBudget` before listen.

Grants for `web` in `infrastructure/postgres/grant-matrix.json`:

| Object | Privilege |
| --- | --- |
| database | `CONNECT` |
| schema `app`, `audit`, `idx`, `types` | `USAGE` |
| `audit.append` | `EXECUTE` |
| `app.end_sessions_for_did` | `EXECUTE` |
| `app.single_use` | `SELECT`, `INSERT` on `id`, `purpose`, `bind_did`, `bind_extra`, `expires_at`; `SELECT`, `INSERT`, `UPDATE` on `consumed_at` |
| `app.session` | `SELECT`, `INSERT` on `id_hash`, `did`, `created_at`, `absolute_expires_at`; `SELECT`, `INSERT`, `UPDATE` on `last_seen_at`; `SELECT`, `UPDATE` on `email_confirmed`, `email_checked_at`; `DELETE` |
| `app.oauth_state` | `SELECT`, `INSERT` on `key`; `SELECT`, `INSERT`, `UPDATE` on `sealed`, `expires_at`; `DELETE` |
| `app.oauth_session` | `SELECT`, `INSERT` on `did`; `SELECT`, `INSERT`, `UPDATE` on `sealed`, `client_kid`, `updated_at`; `DELETE` |
| `app.account` | `SELECT`, `INSERT` on `did`, `first_seen_at`; `SELECT`, `INSERT`, `UPDATE` on `onboarding`, `terms_version`, `terms_accepted_at`, `privacy_version`, `age_confirmed_at`; `SELECT` on `storage_quota_bytes` |

SQL in this folder names `app.account`, `app.session` and `app.oauth_session`. The stores composed here run the other statements: `infrastructure/session/store.ts` (`app.session`, `app.end_sessions_for_did`), `infrastructure/postgres/oauthStores.ts` (`app.oauth_state`, `app.oauth_session`), `infrastructure/postgres/singleUse/store.ts` (`app.single_use`), `infrastructure/audit/append.ts` (`audit.append`, called from `account.ts` on an underage block).

Schema `idx` has `USAGE` and no table grant in `grant-matrix.json`. No `CREATE TABLE` in schema `idx` is in `infrastructure/postgres/migrations/`.
