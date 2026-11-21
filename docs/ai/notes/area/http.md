---
id: http
type: area
status: current
areas: ["[[http]]"]
summary: "Hub for shared/http, the server kit the web, review, media and indexer processes import."
code: [shared/http/index.ts, shared/http/limits/rateLimit.ts, shared/http/returnPath.ts, shared/http/trustedProxy.ts]
sources: []
importance: normal
related: ["[[web]]", "[[config]]", "[[errors]]", "[[case-insensitive-path-collision]]", "[[profile]]", "[[session]]"]
replaced_by: null
tags: [area, http]
checked: 2026-11-21
---
# http

**What it owns.** `shared/http`, the server kit: generic HTTP pieces with no product meaning (MIT), exported only
through `index.ts` as `@unset/shared-http`. Every process under `interfaces/` that answers HTTP imports it: web,
review, media and indexer. The web server itself is SvelteKit in `interfaces/web` (see [[web]]); its request gate is
`interfaces/web/server.ts` and `interfaces/web/src/hooks.server.ts`, and its CSRF and CSP checks live there, not here.
The Hono server, routes, CSRF gate and error pages that this kit used to hold were deleted in P1.20k (2026-11-18).

**Parts.**
- `config.ts`: `httpKitConfig`, the config fragment each entry point's schema spreads, and `hostAllowed` (P1.04k).
- `headers.ts`: `SECURITY_HEADERS`, the headers every web response carries besides its CSP (P1.08). Web sets them in
  `interfaces/web/server.ts`; the CSP is web's own (`interfaces/web/src/lib/server/csp.ts`).
- `health.ts`: `createHealth`, the `/health` answer: 200 with service and commit when ready, 503 otherwise. A check
  that throws or takes over 1 s counts as not ready (fail closed).
- `limits/policy.ts` and `limits/rateLimit.ts`: the rate-limit policy shape with its startup check, and the token
  bucket limiter (P1.06). Buckets live only in process memory, keyed by a salted HMAC of the client's rate key or DID;
  the 32-byte salt is replaced every 24 h and never written or logged. The values live with the interface that owns
  the routes (`interfaces/web/src/lib/server/limits.ts`), never in the kit.
- `clientIp.ts` and `trustedProxy.ts`: `ClientIp`, an address that prints as `[ip]` and leaves only as `rateKey()`
  (P1.05), and `createClientIpResolver`, which takes the client address from the one header the edge sets, only when
  the request came from the edge, or from the socket where there is no edge. Every doubt is null, never a guess.
- `returnPath.ts`: `safeReturnPath`, the one return-path validator (P1.09): an untrusted "where next" value becomes a
  same-origin relative path or nothing.
- `shutdown.ts`: `drain` and `exitOnSignals`: stop accepting, let requests in flight finish within the grace period,
  run the close hooks, report the exit code; a second signal exits at once.

**Watch out.** `shared/http` is trusted base (CODEOWNERS); a PR that changes it carries the `security-review` label
(ADR 0044). The kit imports no domain, infrastructure or app (dependency-cruiser).

**Links.** [[web]], [[config]], [[errors]], [[session]].
