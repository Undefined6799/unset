---
id: http
type: area
status: current
areas: ["[[http]]"]
summary: "Hub for the web server process (interfaces/http) and the server kit in shared/http that every server uses."
code: [interfaces/http/compose.ts, shared/http/index.ts]
sources: []
importance: normal
related: ["[[web]]", "[[config]]", "[[errors]]", "[[case-insensitive-path-collision]]"]
replaced_by: null
tags: [area, http]
checked: 2026-10-07
---
# http

Two folders share this hub: `interfaces/http`, the web server for unset.sh, and `shared/http`, the server kit that
all six servers are built from.

**interfaces/http owns** the public site's routes: `routes/assets.ts` (apps/web's built files, by exact name from
the manifest), `routes/prefs.ts` (the theme form), `prefs/theme.ts` (theme cookie, applied on the server) and
`web/` (reads Vite's manifest once at startup and renders pages through apps/web). `limits.ts` holds its
rate-limit policies; a feature step adds its policy in the same PR as its route.

**Watch out (P1.23c).** Production renders with apps/web's server build, `apps/web/dist/server/render.js`, loaded
once from that fixed path by `web/render-entry.ts`; no config key moves it. `compose(cfg, web?)` takes a render only
from tests, which pass `import * as web from "@unset/apps-web"`; a new test that composes the server must pass it too,
or startup fails on the missing build. `main.test.ts` fails if `main.ts` statically reaches anything under apps/.

**shared/http owns** what every request passes through. `server.ts` fixes the middleware order: requestId,
hostCheck, trustedProxy, securityHeaders, methodCheck, contentTypeCheck, bodyLimit, rateLimitIp, csrf. Also:
- `routes.ts`: `defineRoute`, the only way to register a route; it refuses a route without limits or a deadline.
- `csrf/gate.ts`: the one CSRF gate (Sec-Fetch-Site, then exact Origin, then exact Referer, else deny).
- `csp/`: the Content-Security-Policy per route group. `public` (P1.25k) is for our own zero-JS pages (`/`, `/terms`,
  `/privacy`): no script-src, images from the assets path only, and no cookie read (any group but `app`).
- `trustedProxy.ts` and `clientIp.ts`: the client address, which prints as `[ip]` and only leaves as a rate key.
- `returnPath.ts`: the one redirect-target validator.
- `health.ts`: `/health`, which reveals only status and commit.
- `errors.ts`: every error response by code and group. An interface may pass `errorPage` (P1.25k) for the page
  groups' body only: it gets the shown code, the group and, for `internal.error`, the kit's request id, never request
  data. On a throw, a non-string or a body over 256 KiB the kit uses its fixed page; the status and headers stay the kit's.
  The fixed page shows the request id on `internal.error` (UUID shape only). The exported `errorResponse` takes no
  page; only `fail()` renders pages, through `kitErrorResponse`, which the index does not export (P1.25b).

**Watch out.** `shared/http` is trusted base (CODEOWNERS); its PRs carry only trusted files and their tests.

**Links.** [[web]], [[config]], [[errors]].
