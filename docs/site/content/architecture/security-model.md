---
title: Security model
weight: 5
---

What each check is for. The behaviour below is what those files do. Rule statements live in [`docs/human/engineering/engineering-rules.md`](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/engineering-rules.md) (SE-4, SE-6, SE-7).

## Fail closed

A check that cannot decide denies.

| Check | Where | What a failure does |
| --- | --- | --- |
| CSRF gate | [`shared/http/csrf/gate.ts`](https://github.com/Undefined6799/unset/blob/main/shared/http/csrf/gate.ts) | A throw becomes `reason: error`, which is a deny. No `Sec-Fetch-Site`, `Origin` or `Referer` is a deny. |
| Session read | [`infrastructure/session/store.ts`](https://github.com/Undefined6799/unset/blob/main/infrastructure/session/store.ts) | A database error throws `service.unavailable`. The read does not return an anonymous session. |
| Rate limit | [`shared/http/limits/rateLimit.ts`](https://github.com/Undefined6799/unset/blob/main/shared/http/limits/rateLimit.ts) | `consume` on a thrown error returns a deny and calls `onError`. |
| Session-required route | [`shared/http/server.ts`](https://github.com/Undefined6799/unset/blob/main/shared/http/server.ts) `checkRoutes`, `admit` | A `session: "required"` route and no `gate` throws at startup (`session: "required" needs the server's gate`). A missing gate at `admit` is `internal.error`. The gate runs after CSRF. A throw is an error response and the handler does not run: `internal.error`, or the thrown `AppError` code. An admission whose `did` is not a non-empty string is `internal.error` (`ratelimit.no_session`) and the per-DID bucket is not applied. A gate `Response` is the answer. `session: "handler"` leaves `requiresSession` unset, so `admit` returns before the gate. [ADR 0045](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0045-kit-enforces-the-session-gate.md). |
| Bootstrap | [`deployment/postgres/init/00-bootstrap.sh`](https://github.com/Undefined6799/unset/blob/main/deployment/postgres/init/00-bootstrap.sh) | A missing or empty password file exits before any SQL. |
| Security headers | `shared/http/server.ts` `secured` | A throw while applying the group's headers answers 500 with the `static` set. |

## Sessions

The browser cookie is host-only. The database stores a hash.

| Piece | Where | What it is for |
| --- | --- | --- |
| Cookie | [`interfaces/http/session-cookie.ts`](https://github.com/Undefined6799/unset/blob/main/interfaces/http/session-cookie.ts) | Name `__Host-sid`. Attributes are `Path=/; Secure; HttpOnly; SameSite=Lax` and `Max-Age`. Two cookies of that name are ignored. |
| Store | [`infrastructure/session/store.ts`](https://github.com/Undefined6799/unset/blob/main/infrastructure/session/store.ts) | 32 random bytes in the cookie; `app.session.id_hash` is their sha256. Expiry uses the database clock. A session lasts only while `app.oauth_session` has a row for the DID. |
| App pages | [`interfaces/http/app-gate.ts`](https://github.com/Undefined6799/unset/blob/main/interfaces/http/app-gate.ts) | `openApp` reads the session, then onboarding, then the email gate. A missing session redirects to `/login`. `compose.ts` passes `appSessionGate`, which calls `openApp`, as `createServer`'s `gate`. |
| Welcome, verify-email, logout | `interfaces/http/routes/welcome.ts`, `verify-email.ts`, `logout.ts` | These handlers read the session themselves. They do not call `openApp`. Logout reads it on `POST /logout` and `POST /logout/everywhere`. |
| Domain attribute | [`scripts/guards/cookie-domain.ts`](https://github.com/Undefined6799/unset/blob/main/scripts/guards/cookie-domain.ts) | A `Domain` attribute on a cookie fails CI. The guard has no allow. |

Two layers. [ADR 0045](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0045-kit-enforces-the-session-gate.md) is the record. The kit enforces `session: "required"`. `session: "handler"` is recorded, and the handler does the check.

`defineRoute` records `session` as `"required"`, `"handler"` or `"none"`, with no default (`shared/http/routes.ts`). `"required"` sets `requiresSession` and stores a handler that throws when the context has no `session`. `"handler"` sets `handlerSession` and leaves `requiresSession` unset. `admit` returns before the gate when `requiresSession` is absent, and `middlewareOf` adds `session` and `rateLimitDid` only when it is set. `createServer` takes one optional `gate` (`SessionGate` on `ServerOptions`). For a required route it calls that gate after the CSRF check, inside the route's deadline. A `Response` is the answer and the handler does not run. An admission is limited per DID when the policy has a `did` entry, and the handler is called with that admission's `session` as `ctx.session`.

`interfaces/http/compose.ts` passes `gate: appSessionGate(accountDeps.open)`. `appSessionGate` (`interfaces/http/app-gate.ts`) calls `open`, which compose binds to `openApp`. The admission's `session` is the `OpenedApp`, and its `did` is that value's `session.did`. A `Response` from `open` is the refusal. `RETURN_TO` is checked first: `GET /me` and `POST /profile` return to `/did`. A parameter-free `GET` or `HEAD` that is not listed returns to its own template. A route with neither throws, and the kit answers that throw as an error response.

Five routes set `"required"`, and `interfaces/http/routes.manifest.json` records `requiresSession: true` on each: `GET /did` and `GET /me` (`routes/me.ts`), `POST /profile` (`routes/profile.ts`), and `GET /settings/profile` and `GET /settings/account` (`routes/settings.ts`). Their handlers take the admitted `OpenedApp` and do not call `open`. `GET /did` and `GET /me` redirect to `/${session.session.did}`. `POST /profile` writes that session's DID. `GET /settings/profile` and `GET /settings/account` render from it. `POST /profile` names the `profile` policy, which has a per-DID entry. The other four name `default`, which has none, so `rateLimitDid` matches no entry and consumes nothing.

Ten routes set `"handler"`, recorded as `handlerSession: true`: `GET /:did` (`routes/me.ts`), `GET /verify-email` and `POST /verify-email/reconsent` (`routes/verify-email.ts`), and `GET /welcome`, `GET` and `POST /welcome/age`, `GET` and `POST /welcome/terms`, and `GET` and `POST /welcome/chat` (`routes/welcome.ts`). The kit does not call the gate. The other routes in that folder set `"none"`, which omits both fields. A `"none"` route may still read the session in its handler. `GET /health`, added in `shared/http/server.ts`, is `session: "none"` and skips the host check and the trusted-proxy step.

The handlers are the second layer on a route the kit does not gate. `openApp` is still session, then onboarding, then the email gate. A missing session redirects to `/login` with `next`. `GET /:did` parses the path first, and a segment that is not a DID throws `http.not_found` before `deps.open`. `GET /settings` sets `"none"`, returns 303 to `/settings/profile` and does not read a session. Welcome, verify-email and logout do not call `openApp`. `welcome.ts` reads the session in `located` and on `GET /welcome/blocked`. A missing session in `located` redirects to `/login` with `next`. `GET /welcome/blocked` sets `"none"` and renders the page when there is no session. `verify-email.ts` reads the session on `GET /verify-email` and `POST /verify-email/reconsent` and redirects a missing session to `/login` with `next`. `logout.ts` sets `"none"` and reads the session on `POST /logout`, `POST /logout/everywhere` and `GET /signed-out`. `POST /signed-out` does not read a session. Legal pages pass `"none"` and do not read the session.

## CSRF gate

Every method other than `GET` and `HEAD` that the server accepts is `POST`, and every `POST` passes the gate (`shared/http/server.ts`, `csrfDenied`). `GET` and `HEAD` are not gated. The decision (`shared/http/csrf/gate.ts`):

| Signal | Result |
| --- | --- |
| `Sec-Fetch-Site: same-origin` | allow |
| `Sec-Fetch-Site: cross-site` or `same-site` | deny |
| `Origin` present | allow only when it lower-cases to `PUBLIC_ORIGIN`'s origin; the value `null` denies |
| no `Origin`, `Referer` present | allow only when the Referer URL's origin equals that origin |
| none of the three | deny |

A denied POST is logged as `csrf.denied` with the route template and a fixed reason word, and the response is 403.

## Rate limits

Two layers, both in memory. In `socket` mode the edge's per-client zones are the per-client layer ([ADR 0042](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0042-app-limits-behind-the-edge.md)).

The process layer is a token bucket per policy (`shared/http/limits/rateLimit.ts`). Keys are an HMAC of the IP rate key or the DID under a salt that is not written. Each interface has its own table. `interfaces/http/limits.ts` defines `default`, `profile`, `login`, `search`, `report`, `follow`, `like` and `upload`. `interfaces/http/compose.ts` passes `policiesFor(cfg.TRUSTED_PROXY_MODE)`:

| `TRUSTED_PROXY_MODE` | Table |
| --- | --- |
| `header` | The full `policies` table |
| `socket` | Every `scope: "ip"` entry is dropped. `default` keeps its `global` entry. `login` gains the site-wide sign-in ceiling. Per-DID entries stay |

`deployment/compose.dev.yaml`, `deployment/compose.dev.source.yaml` and `deployment/compose.local.yaml` set `socket` on web. Routes in the tree name `default`, `login`, `profile` or `exempt` (`exempt` is the assets route and `GET /health`; `POST /profile` names `profile`). `scripts/guards/route-policy.ts` fails a route whose policy is missing from that interface's table. A per-DID entry requires `session: "required"` (`shared/http/server.ts`, `checkRoutes`).

The edge layer is `deployment/edge/snippets/ratelimit.caddy`: caddy-ratelimit, sliding window, keyed by client address, no `distributed` block and no `storage` ([ADR 0018](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0018-edge-rate-limit-plugin.md)). Dev and dev-source mount `deployment/edge/dev/app.caddy`, which imports `app-ratelimit`. Local mounts `deployment/edge/local/app.caddy`, which imports `pds-ratelimit`, as the PDS sites do.

## PDS fonts

The app's Content-Security-Policy is the kit ([http](../../areas/shared/http/)). On the PDS host, `deployment/edge/snippets/pds-fonts.caddy` serves `.woff2` files from `/_unset/fonts/` and answers every other `/_unset/` path with 404, inside the route and before the upstream. When the response Content-Type starts with `text/html`, it appends `font-src https://{$PDS_HOST}/_unset/fonts/` to a Content-Security-Policy the response already carries. `deployment/edge/adapted-rules.ts` (`fontProblems`, `strayProblems`), on the config `caddy adapt` prints, rejects a wider font route, a file server outside it, a response matcher outside it, and any other change to a Content-Security-Policy. The lines are on [edge](../../areas/deployment/edge/). [ADR 0027](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0027-pds-frontend-distribution.md) is the PDS frontend record.

## Logging allowlist

`shared/log/logger.ts` writes one JSON line per call. The event must be in `EVENTS`; any other name is logged as `log.unknown_event`. The fields a line may carry are the `ALLOWED` set: `code`, `route`, `method`, `status`, `ms`, `reqId`, `count`, `bytes`, `key`, `reason`, `phase`, `kind`, `job`, `attempt`, `version`, `sqlstate`, `island`. `route` must be a template. `reason`, `phase`, `job`, `kind`, `key` and `island` must match a fixed word shape. Other strings pass through `shared/log/scrub.ts`, which replaces control characters and redacts JWTs, `Bearer`/`Basic` credentials, email addresses, DIDs, multibase keys, IP addresses and long token-shaped runs. This is SE-7.
