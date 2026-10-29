---
title: http
weight: 4
---

The server kit every interface process is built from. Package `@unset/shared-http`. The web server itself is `interfaces/http` (a later Areas page). Route tables are on [Endpoints](/endpoints/).

## Owns

`shared/http/server.ts` builds one Hono server per process (`createServer`). The checks a route passes through are `middlewareOf`:

| Check | When |
| --- | --- |
| `requestId` | Every route |
| `hostCheck`, `trustedProxy` | Every route except `/health` |
| `methodCheck` | Every route |
| `contentTypeCheck`, `bodyLimit` | `POST` |
| `rateLimitIp` | Unless `rateLimit` is `exempt` |
| `csrf` | `POST` |
| `session`, `rateLimitDid` | `session: "required"` |

`headerSets` (`shared/http/csp/headers.ts`) is applied to the final response (`secured` in `server.ts`). A handler's own Content-Security-Policy is replaced.

`/health` (`shared/http/health.ts`) returns JSON `{ status, service, commit }` with `cache-control: no-store`. Ready is 200 `ok`. `draining`, not yet ready, and a failed check are 503 (`draining`, `starting` or `unready`). A check that throws, rejects, or takes longer than 1 s counts as not ready.

| Piece | Path | What it is for |
| --- | --- | --- |
| Routes | `shared/http/routes.ts` | `defineRoute`, the only registration path |
| CSRF gate | `shared/http/csrf/gate.ts` | Same-origin check for anything other than GET and HEAD |
| GET mutations | `shared/http/csrf/exceptions.ts` | Paths a non-POST route may mark `mutates` |
| CSP | `shared/http/csp/policies.ts` | One policy per route group |
| Client address | `shared/http/trustedProxy.ts`, `shared/http/clientIp.ts` | The edge header, or the socket where there is no edge |
| Body limit | `shared/http/limits/bodyLimit.ts` | Caps the request body |
| Rate limit | `shared/http/limits/rateLimit.ts`, `shared/http/limits/policy.ts` | The primitive. Each interface owns its policy table |
| Return path | `shared/http/returnPath.ts` | Turns an untrusted "next" value into a same-origin path or nothing |
| Errors | `shared/http/errors.ts` | Response by code and group |
| Config fragment | `shared/http/config.ts` | `httpKitConfig`, merged into each entrypoint schema |
| Shutdown | `shared/http/shutdown.ts` | Drain on SIGTERM |

`defineRoute` accepts methods `GET`, `HEAD` and `POST`, and groups `app`, `public`, `profile`, `static`, `media`, `admin`, `api`. `rateLimit` is required. `exempt` is allowed only for group `static`. `session` is `"required"`, `"handler"` or `"none"`, with no default. `"required"` sets `requiresSession`. `"handler"` sets `handlerSession` and leaves `requiresSession` unset, so `middlewareOf` does not add `session` or `rateLimitDid`, and a per-DID policy still requires `session: "required"` (`checkRoutes` and `middlewareOf` in `server.ts`). A route's deadline is its `deadlineMs` or `REQUEST_DEADLINE_MS`. A set `deadlineMs` is an integer from 1000 to 120000.

`defineRoute` refuses `{ mutates: true }` on a non-POST unless the path is in `GET_MUTATION_EXCEPTIONS`. The only entry is `GET /oauth/callback`. The CSRF gate still runs only for `POST` (`csrfDenied`).

`createCsrfGate` (`shared/http/csrf/gate.ts`) allows GET and HEAD. For anything else it decides in this order, and a throw denies:

| Step | Result |
| --- | --- |
| `Sec-Fetch-Site: same-origin` | Allow |
| `Sec-Fetch-Site: cross-site` or `same-site` | Deny |
| `Origin` present | Allow only when its lowercase value equals `PUBLIC_ORIGIN`'s origin. The value `null` denies. |
| No `Origin`, `Referer` present | Allow only when the Referer's origin equals that same origin |
| None of those headers | Deny |

`ClientIp` prints, serialises and inspects as `[ip]`. The address leaves through `rateKey()`.

`policiesFor` builds one policy per route group from config origins. `public` and `profile` set no `script-src`. `public` images are the assets path. `profile` images are the media origin. `media` sets `sandbox`.

`safeReturnPath` returns a `SafePath` or `null`. `DENIED_TARGETS` is `/login`, `/logout` and `/oauth`.

The kit's `index.ts` does not export the gate, the CSP builder, the proxy resolver or `/health`. Interfaces reach those through `createServer`.

## May import

The non-leaf [`shared` row](../). Declared in `shared/http/package.json`:

| Dependency | Version |
| --- | --- |
| `@hono/node-server` | 2.1.5 |
| `hono` | 4.13.13 |
| `@unset/shared-config` | workspace |
| `@unset/shared-errors` | workspace |
| `@unset/shared-log` | workspace |

Who may import it is the [shared](../) table. On this tree the product importers are `interfaces/{admin,api,http,indexer,media,review}`. `apps/` does not import it.

## Entry points

| Export | Path |
| --- | --- |
| Package export `.` | `shared/http/index.ts` |
| `createServer` | `shared/http/server.ts` |
| `defineRoute` | `shared/http/routes.ts` |
| `definePolicies`, `createRateLimiter` | `shared/http/limits/policy.ts`, `shared/http/limits/rateLimit.ts` |
| `httpKitConfig`, `hostAllowed` | `shared/http/config.ts` |
| `safeReturnPath`, `DENIED_TARGETS` | `shared/http/returnPath.ts` |
| `errorResponse` | `shared/http/errors.ts` |

Each interface calls `createServer` from its `compose.ts` and `defineRoute` from its route files. `bootOrExit` stays in [config](../config/).

## Data

No schema, role or table. Policy tables live in each interface's `limits.ts`. The kit's own keys are `httpKitConfig` in `shared/http/config.ts`, plus the common entrypoint keys from [config](../config/):

| Key | Default in the field |
| --- | --- |
| `PUBLIC_ORIGIN` | none |
| `HTTP_ALLOWED_HOSTS` | none |
| `SHUTDOWN_GRACE_MS` | 10000 |
| `REQUEST_DEADLINE_MS` | 30000 |
| `TRUSTED_PROXY_MODE` | none (`header` or `socket`) |
| `TRUSTED_PROXY_HEADER` | `""` |
| `TRUSTED_PROXY_CIDRS` | `[]` |
| `TRUSTED_PROXY_HOPS` | 1 |
| `HTTP_BODY_LIMIT_BYTES` | 65536 |
| `RATE_LIMIT_MAX_KEYS` | 100000 |
| `MEDIA_ORIGIN` | none |
| `ASSETS_BASE` | `""` |
| `DEV_VITE_ORIGIN` | `""` |

`DEV_VITE_ORIGIN` is refused unless `UNSET_ENV` is `dev`. `MEDIA_ORIGIN` must be a different site from `PUBLIC_ORIGIN`, except when `UNSET_SERVICE` is `media`.
