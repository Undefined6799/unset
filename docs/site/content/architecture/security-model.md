---
title: Security model
weight: 5
---

What each check is for. The behaviour below is what those files do. Rule statements live in [`docs/human/engineering/engineering-rules.md`](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/engineering-rules.md) (SE-4, SE-6, SE-7).

## Fail closed

A check that cannot decide denies.

| Check | Where | What a failure does |
| --- | --- | --- |
| Route policy | [`interfaces/web/src/lib/server/route-table.ts`](https://github.com/Undefined6799/unset/blob/main/interfaces/web/src/lib/server/route-table.ts) | A route folder with no `policy.ts` has no row, and the gate answers 500 `internal.error` without running it. `tests/integration/web/gate.test.ts` checks every route folder has one. |
| Form-only bodies | [`interfaces/web/src/hooks.server.ts`](https://github.com/Undefined6799/unset/blob/main/interfaces/web/src/hooks.server.ts) | A `POST` whose type is not `application/x-www-form-urlencoded` or `multipart/form-data` is 415. A body with no declared length, or one over the route's `maxBody`, is 413. Any method other than `GET`, `HEAD` and `POST`, or a `POST` to a route with no `maxBody`, is 405. |
| Session read | [`infrastructure/session/store.ts`](https://github.com/Undefined6799/unset/blob/main/infrastructure/session/store.ts) | A database error throws `service.unavailable` (503). The read does not return an anonymous session, and the cookie stays. |
| Rate limit | [`shared/http/limits/rateLimit.ts`](https://github.com/Undefined6799/unset/blob/main/shared/http/limits/rateLimit.ts) | `consume` on a thrown error returns a deny and calls `onError`. |
| Deadline | `interfaces/web/src/hooks.server.ts` `withDeadline` | Past the route's `deadlineMs` (or `REQUEST_DEADLINE_MS`) the answer is 503 `http.deadline`. A late result is logged, never sent. |
| Bootstrap | [`deployment/postgres/init/00-bootstrap.sh`](https://github.com/Undefined6799/unset/blob/main/deployment/postgres/init/00-bootstrap.sh) | A missing or empty password file exits before any SQL. |
| Error pages | `interfaces/web/src/hooks.server.ts` `handleError`, `caughtResponse` | Only a catalog code is sent, never an error's message or cause. Anything not in the catalog as public is 500 `internal.error`. |

## The request gate

[`interfaces/web/server.ts`](https://github.com/Undefined6799/unset/blob/main/interfaces/web/server.ts) is adapter-node's custom server. It runs for every response, files and SvelteKit's own refusals included: the host check, the security headers from `shared/http`, and the one log line. [`interfaces/web/src/hooks.server.ts`](https://github.com/Undefined6799/unset/blob/main/interfaces/web/src/hooks.server.ts) then runs, in order: the route's policy, test routes (404 unless `TEST_ROUTES`), the body checks, the client address and its limit, then, under the route's deadline, the session, the member's limit and the route, and last the group's CSP. [ADR 0054](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0054-web-process-on-sveltekit.md) and [ADR 0056](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0056-web-boundary-by-file-kind.md) are the record.

Each route folder holds a `policy.ts` beside its `+page` or `+server` file (`definePolicy` in [`interfaces/web/src/lib/server/policy.ts`](https://github.com/Undefined6799/unset/blob/main/interfaces/web/src/lib/server/policy.ts)). It names the CSP group (`app`, `public` or `static`), the rate-limit policy, an optional write policy for `POST`, the session mode, `maxBody` and an optional deadline. The generated [Endpoints](../../endpoints/) page lists every route's policy.

## Sessions

The browser cookie is host-only. The database stores a hash.

| Piece | Where | What it is for |
| --- | --- | --- |
| Cookie | [`interfaces/web/src/lib/server/session.ts`](https://github.com/Undefined6799/unset/blob/main/interfaces/web/src/lib/server/session.ts) | Name `__Host-sid`. Attributes are `Path=/; Secure; HttpOnly; SameSite=Lax` and `Max-Age`. Two cookies of that name are ignored. An unknown, malformed or expired cookie is cleared. |
| Store | [`infrastructure/session/store.ts`](https://github.com/Undefined6799/unset/blob/main/infrastructure/session/store.ts) | 32 random bytes in the cookie; `app.session.id_hash` is their sha256. Expiry uses the database clock. A session lasts only while `app.oauth_session` has a row for the DID. |
| App gate | [`interfaces/web/src/lib/server/app-gate.ts`](https://github.com/Undefined6799/unset/blob/main/interfaces/web/src/lib/server/app-gate.ts) | `openApp`: onboarding, then a confirmed email. The decisions are `domains/identity`'s; this file turns them into 303 redirects (`/welcome`, `/welcome/terms`, `/welcome/blocked`, `/verify-email`). A grant revoked at the PDS drops the cookie and sends the browser to sign-in. |
| Domain attribute | [`scripts/guards/cookie-domain.ts`](https://github.com/Undefined6799/unset/blob/main/scripts/guards/cookie-domain.ts) | A `Domain` attribute on a cookie fails CI. The guard has no allow. |

A policy's `session` is one of four modes, or absent:

| Mode | Signed out | Signed in |
| --- | --- | --- |
| `required` | 303 to `/login?next=<page>` | the member's limit, then the app gate |
| `writes` | `GET` and `HEAD` pass; a `POST` goes to sign-in | the member's limit, then the app gate (any method) |
| `onboarding` | 303 to sign-in | the member's limit, no app gate (welcome and verify-email are where the gate sends people) |
| `optional` | passes | the session is read, never gated; the page is private and varies on `Cookie` |
| absent | no session is read, except on an `app` page | the same |

The page sign-in returns to is the route's own id when it has no parameter, or the policy's fixed `returnTo`. A session route with a parameter and no `returnTo` is refused. It is never taken from the request.

## CSRF

Every method the server accepts other than `GET` and `HEAD` is `POST`. SvelteKit's own Origin check refuses a cross-site form post before the hook runs (kit 3.2.0 `src/runtime/server/respond.js`). It covers only the form types, so the hook refuses every other body type with 415, which puts every `POST` under that check. [`tests/integration/web/csrf-coverage.test.ts`](https://github.com/Undefined6799/unset/blob/main/tests/integration/web/csrf-coverage.test.ts) checks, on the built server, that every route that can write refuses a cross-site post and a post with no `Origin`, whatever the body type. The OAuth callback is the one `GET` that changes state; its state and nonce protect it.

## Rate limits

Two layers, both in memory. In `socket` mode the edge's per-client zones are the per-client layer ([ADR 0042](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0042-app-limits-behind-the-edge.md)).

The process layer is a token bucket per policy (`shared/http/limits/rateLimit.ts`). Keys are an HMAC of the IP rate key or the DID under a salt that is not written. [`interfaces/web/src/lib/server/limits.ts`](https://github.com/Undefined6799/unset/blob/main/interfaces/web/src/lib/server/limits.ts) defines the web table; a route names one of its keys, and a name that is not in it fails the endpoint check. `compose.ts` passes `policiesFor(config.TRUSTED_PROXY_MODE)`:

| `TRUSTED_PROXY_MODE` | Table |
| --- | --- |
| `header` | The full `policies` table |
| `socket` | Every `scope: "ip"` entry is dropped. `login` gains the site-wide sign-in ceiling. Per-DID entries stay |

`deployment/compose.dev.yaml`, `deployment/compose.dev.source.yaml` and `deployment/compose.local.yaml` set `socket` on web. `/health` is the one `probe` route: no host check and no rate limit, so the container probe always reaches it.

The edge layer is `deployment/edge/snippets/ratelimit.caddy`: caddy-ratelimit, sliding window, keyed by client address, no `distributed` block and no `storage` ([ADR 0018](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0018-edge-rate-limit-plugin.md)). Dev and dev-source mount `deployment/edge/dev/app.caddy`, which imports `app-ratelimit`. Local mounts `deployment/edge/local/app.caddy`, which imports `pds-ratelimit`, as the PDS sites do.

The edge's sign-in zone (`app_signin`) counts `POST /login` and `POST /join` only, per client address. Web reaches our PDS through the edge from one address, so web's own PDS calls carry `X-Unset-Web-Key`, built from the `pds_web_key` secret. A request with exactly that value skips the per-address `global` and `oauth_token` zones and counts in `web_global` and `web_oauth_token`, one bucket keyed `web`. Every other PDS zone (session, identity, sign-in, reset, upload, sync, firehose and the rest) still counts web by address, and a missing or wrong key counts as any other client. The key is compared, never logged, and `deployment/edge/snippets/upstream.caddy` drops it before the PDS. Whoever holds a leaked key skips the per-address `global` and `oauth_token` zones and shares web's one bucket until the key is replaced. [ADR 0071](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0071-limits-for-thousands-of-members.md) (Proposed) is the record; the numbers are on [Limits](../../settings/limits/).

## PDS fonts

The app's Content-Security-Policy is set per page group in `interfaces/web/src/lib/server/csp.ts`. On the PDS host, `deployment/edge/snippets/pds-fonts.caddy` serves `.woff2` files from `/_unset/fonts/` and answers every other `/_unset/` path with 404, inside the route and before the upstream. When the response Content-Type starts with `text/html`, it appends `font-src https://{$PDS_HOST}/_unset/fonts/` to a Content-Security-Policy the response already carries. `deployment/edge/adapted-rules.ts` (`fontProblems`, `strayProblems`), on the config `caddy adapt` prints, rejects a wider font route, a file server outside it, a response matcher outside it, and any other change to a Content-Security-Policy. The lines are on [edge](../../areas/deployment/edge/). [ADR 0027](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0027-pds-frontend-distribution.md) is the PDS frontend record.

## Logging allowlist

`shared/log/logger.ts` writes one JSON line per call. The event must be in `EVENTS`; any other name is logged as `log.unknown_event`. The fields a line may carry are the `ALLOWED` set: `code`, `route`, `method`, `status`, `ms`, `reqId`, `count`, `bytes`, `key`, `reason`, `phase`, `kind`, `job`, `attempt`, `version`, `sqlstate`, `island`. `route` must be a template. `reason`, `phase`, `job`, `kind`, `key` and `island` must match a fixed word shape. Other strings pass through `shared/log/scrub.ts`, which replaces control characters and redacts JWTs, `Bearer`/`Basic` credentials, email addresses, DIDs, multibase keys, IP addresses and long token-shaped runs. This is SE-7.
