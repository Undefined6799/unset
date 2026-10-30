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
| `interfaces/http/routes/revoke.ts` | `withRevokeTimeout`, the 10 s grant-revocation limit shared by `logout.ts` and `welcome.ts`. |
| `interfaces/http/routes/verify-email.ts` | Email confirmation page. Refresh: `interfaces/http/email-refresh.ts`. |
| `interfaces/http/routes/settings.ts` | Settings pages: `GET /settings` (303 to `/settings/profile`, query kept), `GET /settings/profile` (Profile), `GET /settings/account` (Account). |
| `interfaces/http/routes/profile.ts` | `POST /profile`, the owner's profile save. Body limit `PROFILE_BODY_LIMIT_BYTES` is 96 KiB. The DID comes from the session. `domains/profile` reads the fields. `infrastructure/pds/profile-record.ts` writes the record. |
| `interfaces/http/routes/account-issuer.ts` | `AccountDeps` and `accountProps`: the deps `me.ts` and `settings.ts` share, and the account props they show (the checked handle and the issuer origin recorded at sign-in). |
| `interfaces/http/routes/me.ts` | Signed-in account page. |
| `interfaces/http/sign-in-lock.ts` | Holds the account's OAuth lock during a sign-in and a last-browser sign-out, so one can't revoke the token set the other just stored. |
| `interfaces/http/app-gate.ts` | Page gate `openApp`: session, then onboarding, then a confirmed email. |
| `interfaces/http/redirect.ts` | `redirect`: the 303, `no-store` answer the forms and the page gate send, with any cookies. |
| `interfaces/http/form-field.ts` | `single`: one value of a form or query field, or null when missing or repeated. |
| `interfaces/http/web/page.ts` | Page responses and the kit error-page hook. |
| `interfaces/http/web/render-entry.ts` | Loads `@unset/apps-web/server`. |
| `interfaces/http/routes/test-routes.ts` | Test-only pages. `compose.ts` imports this module only when `TEST_ROUTES` is on. `config.ts` allows that only when `UNSET_ENV` is `test`. |
| `interfaces/http/limits.ts` | Rate-limit policy names `default`, `login`, `search`, `report`, `follow`, `like`, `upload`. Which route uses which name is on [Endpoints](/endpoints/). |

Routes in this process set `session` to `"handler"` or `"none"`. None set `"required"`. `defineRoute` writes `requiresSession` only for `"required"` and `handlerSession` only for `"handler"` (`shared/http/routes.ts`). The kit adds its `session` middleware only when `requiresSession` is set (`shared/http/server.ts`). `interfaces/http/routes.manifest.json` therefore has `handlerSession: true` on the fifteen `"handler"` routes and no `requiresSession` field. Those routes are `GET /did`, `GET /me` and `GET /:did` (`routes/me.ts`), `POST /profile` (`routes/profile.ts`), `GET /settings/profile` and `GET /settings/account` (`routes/settings.ts`), `GET /verify-email` and `POST /verify-email/reconsent` (`routes/verify-email.ts`), and `GET /welcome`, `GET` and `POST /welcome/age`, `GET` and `POST /welcome/terms`, and `GET` and `POST /welcome/chat` (`routes/welcome.ts`). The [Endpoints](/endpoints/http/) session column shows `required (handler)` for them. Once the handler reads the session, a missing session is a 303 to `/login` with `next`: `openApp` for the account, settings and profile routes (`interfaces/http/app-gate.ts`), `located` for the welcome routes, and `login` in `verify-email.ts`. `GET /:did` parses the path first, and a segment that is not a DID is `http.not_found` before `openApp` (`routes/me.ts`). `interfaces/http/routes.session.test.ts` calls every composed route with no cookie and fails when the routes that answer 303 to `/login` with `next` and no `error` differ from the routes with `handlerSession: true`.

The other routes set `"none"`, which omits both manifest fields. `GET /welcome/blocked`, `POST /logout`, `GET /signed-out`, `GET /login` and `POST /login` still read the session in the handler. `GET /login` and `POST /login` send a signed-in visitor to `/did` (`interfaces/http/routes/login.ts`). `GET /settings` returns 303 to `/settings/profile` and does not read a session.

The confirmed-email cache is rechecked at the next gated page view, at most `EMAIL_RECHECK_S` (max 900s), and only on our own PDS. It is not a wall-clock timer. `emailGate` (`domains/identity/auth/gates.ts`) compares the cache age when `openApp` runs. A stale cache calls `emailRefresh` (`interfaces/http/email-refresh.ts`), which asks the PDS. The maximum is 900 in `interfaces/http/config.ts`. While the PDS can't be reached, that cached confirmation is served for at most 4 × `EMAIL_RECHECK_S`. After that, the gated page shows the PDS-unavailable page and the session stays.

`compose.ts` keeps `meRoutes` last so the one-segment DID route does not shadow the explicit paths.

Screens are `apps/web`. The loader requires `renderPage`, `islandName`, `screens` and `safeHref`.

`pageResponse` uses `islands: "on"` when the route omits `islands` (`interfaces/http/web/page.ts`). `GET /:did` (`routes/me.ts`) and `GET /settings/profile` and `GET /settings/account` (`routes/settings.ts`) omit it, so the drawer's theme picker can hydrate. The routes that pass `"off"` are `GET /` (`routes/home.ts`), the legal pages (`routes/legal.ts`), `GET /login` (`routes/login.ts`) and the welcome pages (`routes/welcome.ts`).

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
| `react` | 19.3.1 |

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

## Config

Keys defined in `interfaces/http/config.ts`.

### Session

| Key | Range | Default | Meaning |
| --- | --- | --- | --- |
| `SESSION_IDLE_S` | integer 300..2592000, at most `SESSION_ABSOLUTE_S` | 604800 | Idle lifetime in seconds. |
| `SESSION_ABSOLUTE_S` | integer 300..2592000 | 2592000 | Absolute lifetime in seconds, and the session cookie `Max-Age`. |
| `SESSION_TOUCH_INTERVAL_S` | integer 1..3600, less than `SESSION_IDLE_S` | 300 | Least gap, in seconds, before `last_seen_at` is updated. |

### Identity

| Key | Range | Default | Meaning |
| --- | --- | --- | --- |
| `PLC_URL` | `https` URL, no userinfo | none | PLC directory URL for `did:plc`. Boot also requires its host on net-guard's `plc` policy. |
| `IDENTITY_HTTP_TIMEOUT_MS` | integer 500..10000 | 3000 | HTTP timeout, in milliseconds, for an identity fetch. |
| `IDENTITY_DNS_TIMEOUT_MS` | integer 500..10000 | 2000 | DNS timeout, in milliseconds, for an identity TXT lookup. |
| `DID_DOC_CACHE_TTL_S` | integer 1..3600 | 300 | How long a resolved DID document may be reused, in seconds. |
| `DID_DOC_CACHE_MAX` | integer 1..100000 | 10000 | Most DID documents held in that cache. |
| `HANDLE_VERIFY_TTL_S` | integer 1..3600 | 600 | How long a verified handle verdict is kept, in seconds. |
| `HANDLE_INVALID_TTL_S` | integer 1..3600 | 60 | How long an invalid handle verdict is kept, in seconds. |
| `HANDLE_CACHE_MAX` | integer 1..100000 | 10000 | Most handle verdicts held. |

### Sign-in

| Key | Range | Default | Meaning |
| --- | --- | --- | --- |
| `PDS_HOSTNAME` | lowercase hostname: labels of 1-63, `[a-z0-9]` and inner hyphens, no scheme, port or trailing dot | none | Host of our PDS. `pdsIssuerOf` builds the sign-in issuer from it. |
| `HANDLE_SUFFIX` | a leading `.` plus that same hostname | none | Suffix for a sign-in name that contains no dot. |
| `EMAIL_RECHECK_S` | integer 60..900 | 900 | Seconds a confirmed-email cache is trusted before the PDS is asked again. |
| `MIN_AGE` | integer 16..120 | 16 | Full years of age required before onboarding continues. |
| `INVITE_COUNTRY_RULE` | `on` or `off` | `on` | When `on`, `POST /welcome/terms` requires `country=yes`. |

### Legal

| Key | Range | Default | Meaning |
| --- | --- | --- | --- |
| `PRIVACY_OFFICER_TITLE` | 1-200 characters, no C0 control and no DEL | none | Privacy-officer title on the legal pages. Required. |
| `PRIVACY_OFFICER_CONTACT` | 1-200 characters, no C0 control and no DEL | none | Privacy-officer contact text on the legal pages. Required. |
| `SUPPORT_EMAIL` | 1-200 characters, no C0 control and no DEL | none | Support contact text on the legal pages and on welcome. Required. |
| `SECURITY_CONTACT` | `privacy-page`, `mailto:` plus non-space, or `https://` plus non-space on `PUBLIC_ORIGIN` with no userinfo | none | `security.txt` Contact. `privacy-page` is served as this origin's `/legal/privacy`. Required. |
| `SECURITY_TXT_EXPIRES` | `YYYY-MM-DDTHH:MM:SSZ`, a real UTC instant, after now and at most 365 days ahead; inside 30 days still accepted | none | `security.txt` Expires. Required. |

### Build

| Key | Range | Default | Meaning |
| --- | --- | --- | --- |
| `WEB_BUILD_DIR` | any string | `""` | Directory of the apps/web browser build (`.vite/manifest.json`). Empty uses `apps/web/dist/client`. |

### Test

| Key | Range | Default | Meaning |
| --- | --- | --- | --- |
| `TEST_ROUTES` | `true` or `false`; `true` only when `UNSET_ENV` is `test` | `false` | Turns on the test-only pages. Any other profile refuses the key. |

`defineEntrypointConfig` also reads `UNSET_ENV`, `UNSET_SERVICE`, `UNSET_COMMIT` and `LISTEN_PORT` ([config](../../shared/config/)). The same object merges `httpKitConfig` ([shared http](../../shared/http/)), `postgresFields`, `poolFields` and `lockPoolFields` ([postgres](../../infrastructure/postgres/)), `sealFields` ([seal](../../infrastructure/seal/)), `netGuardFields` ([net-guard](../../infrastructure/net-guard/)) and `oauthFields` ([pds](../../infrastructure/pds/)). `PG_PASSWORD`, `SEAL_KEYRING` and `OAUTH_CLIENT_KEYS` are required secrets.

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
