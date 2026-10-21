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
| Session-required route | [`shared/http/server.ts`](https://github.com/Undefined6799/unset/blob/main/shared/http/server.ts) `admit` | `requiresSession` with no session returns `internal.error` and does not apply the per-DID bucket. No current `interfaces/http` route sets `session: "required"`. |
| Bootstrap | [`deployment/postgres/init/00-bootstrap.sh`](https://github.com/Undefined6799/unset/blob/main/deployment/postgres/init/00-bootstrap.sh) | A missing or empty password file exits before any SQL. |
| Security headers | `shared/http/server.ts` `secured` | A throw while applying the group's headers answers 500 with the `static` set. |

## Sessions

The browser cookie is host-only. The database stores a hash.

| Piece | Where | What it is for |
| --- | --- | --- |
| Cookie | [`interfaces/http/session-cookie.ts`](https://github.com/Undefined6799/unset/blob/main/interfaces/http/session-cookie.ts) | Name `__Host-sid`. Attributes are `Path=/; Secure; HttpOnly; SameSite=Lax` and `Max-Age`. Two cookies of that name are ignored. |
| Store | [`infrastructure/session/store.ts`](https://github.com/Undefined6799/unset/blob/main/infrastructure/session/store.ts) | 32 random bytes in the cookie; `app.session.id_hash` is their sha256. Expiry uses the database clock. A session lasts only while `app.oauth_session` has a row for the DID. |
| App pages | [`interfaces/http/app-gate.ts`](https://github.com/Undefined6799/unset/blob/main/interfaces/http/app-gate.ts) | `openApp` reads the session, then onboarding, then the email gate. A missing session redirects to `/login`. |
| Welcome, verify-email, logout | `interfaces/http/routes/welcome.ts`, `verify-email.ts`, `logout.ts` | These handlers read the session themselves. They do not call `openApp`. |
| Domain attribute | [`scripts/guards/cookie-domain.ts`](https://github.com/Undefined6799/unset/blob/main/scripts/guards/cookie-domain.ts) | A `Domain` attribute on a cookie fails CI. The guard has no allow. |

Two layers. The manifest value is not the page gate.

`defineRoute` records `session: "required"` or `"none"` with no default (`shared/http/routes.ts`). `requiresSession` is set only when the value is `"required"`. `shared/http/server.ts` `admit` returns before reading a session when that flag is absent, and `interfaces/http/compose.ts` does not pass a session reader to `createServer`. Every route under `interfaces/http/routes/` passes `"none"`. `"none"` does not mean no auth. No current route sets `"required"`, so the kit does not run its session middleware. `GET /health` is `session: "none"` and skips the host check and the trusted-proxy step.

The handlers are the second layer. `openApp` (`interfaces/http/app-gate.ts`) is the gate on an app page: session, then onboarding, then the email gate. `interfaces/http/routes/me.ts` calls `deps.open` for `/did`, `/me` and `/:did`, and `compose.ts` binds `open` to `openApp`. `interfaces/http/routes/settings.ts` calls `openApp` for `/settings/profile`. Welcome, verify-email and logout do not call `openApp`. `welcome.ts` reads the session in `located` and on `GET /welcome/blocked`. `verify-email.ts` reads it on `GET /verify-email` and `POST /verify-email/reconsent`. `logout.ts` reads it on `POST /logout` and `GET /signed-out`. Legal pages pass `"none"` and do not read the session.

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

Two layers, both in memory.

The process layer is a token bucket per policy (`shared/http/limits/rateLimit.ts`). Keys are an HMAC of the IP rate key or the DID under a salt that is not written. Each interface has its own table. `interfaces/http/limits.ts` defines `default`, `login`, `search`, `report`, `follow`, `like` and `upload`. Routes in the tree name `default`, `login` or `exempt` (`exempt` is the assets route and `GET /health`). `scripts/guards/route-policy.ts` fails a route whose policy is missing from that interface's table. A per-DID entry requires `session: "required"` (`shared/http/server.ts`, `checkRoutes`).

The edge layer is `deployment/edge/snippets/ratelimit.caddy`: caddy-ratelimit, sliding window, keyed by client address, no `distributed` block and no `storage` ([ADR 0018](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0018-edge-rate-limit-plugin.md)). The app site imports `app-ratelimit`; the PDS site imports `pds-ratelimit`.

## Logging allowlist

`shared/log/logger.ts` writes one JSON line per call. The event must be in `EVENTS`; any other name is logged as `log.unknown_event`. The fields a line may carry are the `ALLOWED` set: `code`, `route`, `method`, `status`, `ms`, `reqId`, `count`, `bytes`, `key`, `reason`, `phase`, `kind`, `job`, `attempt`, `version`, `sqlstate`, `island`. `route` must be a template. `reason`, `phase`, `job`, `kind`, `key` and `island` must match a fixed word shape. Other strings pass through `shared/log/scrub.ts`, which replaces control characters and redacts JWTs, `Bearer`/`Basic` credentials, email addresses, DIDs, multibase keys, IP addresses and long token-shaped runs. This is SE-7.
