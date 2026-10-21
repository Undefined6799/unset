---
title: Security model
weight: 5
---

Checks the http process runs, and what each one is for. The rule table and its CI job stay in [`docs/human/architecture.md`](https://github.com/Undefined6799/unset/blob/main/docs/human/architecture.md). Edge and egress are [Trust boundaries](trust-boundaries.md).

## Fail closed

| Check | For | Code |
| --- | --- | --- |
| CSRF gate throws | deny (`reason: error`) | `shared/http/csrf/gate.ts` |
| Rate-limit `consume` throws | deny, 1s retry, log `ratelimit.error` | `shared/http/limits/rateLimit.ts` |
| Trusted-proxy resolver throws | client address null | `shared/http/trustedProxy.ts` |
| Session read throws | `service.unavailable` (503); cookie kept | `infrastructure/session/store.ts`, `shared/errors/catalog.ts` |
| `session: "required"` and no session | `internal.error`; handler does not run; log `ratelimit.no_session` | `shared/http/server.ts` `admit` |
| Security-header write throws | 500 with the `static` header set | `shared/http/server.ts` `secured` |
| OAuth seal does not open | row deleted, read as missing; log `oauth.unseal_failed` | `infrastructure/postgres/oauthStores.ts` |

The `session: "required"` row is the kit rule. No current http route sets it ([Data flow](data-flow.md)).

## Session

The cookie is `__Host-sid` (`interfaces/http/session-cookie.ts`): `Path=/; Secure; HttpOnly; SameSite=Lax`, and no `Domain` attribute. The value is 32 random bytes, base64url. `app.session` keys the row by sha256 of those bytes (`infrastructure/session/store.ts`). Two cookies of that name count as none.

| Limit | Default | Code |
| --- | --- | --- |
| Idle | 604800 s | `SESSION_IDLE_S` in `interfaces/http/config.ts` |
| Absolute | 2592000 s | `SESSION_ABSOLUTE_S` |
| Touch interval | 300 s | `SESSION_TOUCH_INTERVAL_S` |

Expiry uses `now()` in the database. A session also ends when `app.oauth_session` has no row for its DID. `openApp` (`interfaces/http/app-gate.ts`) then requires onboarding (`requireOnboarded`) and a confirmed email (`emailGate`), and redirects otherwise.

Sign-in and the stored grant are the OAuth client in `infrastructure/pds` ([ADR 0021](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0021-atproto-oauth-client.md)). Handle and DID checks are `domains/identity/verify-handle.ts`.

## CSRF

Every `POST` passes `createCsrfGate` (`shared/http/csrf/gate.ts`). `GET` and `HEAD` do not. A `GET` with `mutates: true` is refused at startup unless the path is in `shared/http/csrf/exceptions.ts`. The only entry is `GET /oauth/callback`.

| Signal | Result |
| --- | --- |
| `Sec-Fetch-Site: same-origin` | allow |
| `Sec-Fetch-Site: cross-site` or `same-site` | deny |
| `Origin` present | allow only when `origin.toLowerCase()` equals `new URL(PUBLIC_ORIGIN).origin`; the literal `null` is deny |
| `Origin` absent, `Referer` present | allow only when the Referer origin equals that same value |
| none of the three | deny |

A denial is 403 `csrf.denied` and a log line with the route template and a fixed reason word.

## Rate limits

Buckets live in the process (`shared/http/limits/rateLimit.ts`). The map key is an HMAC of the IP rate key or the DID, with a salt of 32 random bytes kept in memory and replaced every 24 h. An unknown client, and a new key once `RATE_LIMIT_MAX_KEYS` is full, uses a bucket of one tenth the capacity (at least 1).

`interfaces/http/limits.ts`:

| Policy | Buckets | Named by an http route |
| --- | --- | --- |
| `default` | IP burst 60, refill 300/min; global burst 3000, refill 3000/min | yes |
| `login` | IP burst 10, refill 10/min | yes (`POST` login, OAuth callback, verify-email) |
| `search` | IP 60/min and DID 60/min | no |
| `report` | IP 5/min and DID 10/min | no |
| `follow` | DID 120/min | no |
| `like` | DID 120/min | no |
| `upload` | DID 10/min | no |

`exempt` is allowed only for group `static` (`shared/http/routes.ts`). A per-DID bucket is consumed only after `session: "required"` (`admit`). `interfaces/admin/limits.ts` and `interfaces/media/limits.ts` define `default` only. `interfaces/api/limits.ts` defines `default` and `search`. Indexer and review have no `limits.ts`; their manifests are `exempt` on `GET /health` only.

Over the limit the kit returns 429 with `Retry-After`.

## Headers and logs

`securityHeaders` (`shared/http/csp/headers.ts`) is built once at boot. The server sets it on every response. A handler `Content-Security-Policy` is replaced and logged as `csp.handler_override`.

| Header | Value |
| --- | --- |
| `content-security-policy` | the route group's policy (`shared/http/csp/policies.ts`) |
| `x-content-type-options` | `nosniff` |
| `referrer-policy` | `same-origin`, or `no-referrer` for group `media` |
| `cross-origin-opener-policy` | `same-origin` |
| `cross-origin-resource-policy` | `same-origin`, or `cross-origin` for group `media` |
| `x-frame-options` | `DENY` |
| `permissions-policy` | camera, microphone, geolocation, payment, usb, serial, bluetooth and browsing-topics denied |
| `strict-transport-security` | `max-age=63072000; includeSubDomains` |

`shared/log/logger.ts` writes one JSON line. Fields outside the allowlist are dropped. `route` must be a template. `reason`, `phase`, `kind` and `job` must match a fixed word shape. String values are scrubbed in `shared/log/scrub.ts`.

| Allowlisted fields |
| --- |
| `code`, `route`, `method`, `status`, `ms`, `reqId`, `count`, `bytes`, `key`, `reason`, `phase`, `kind`, `job`, `attempt`, `version`, `sqlstate`, `island` |
