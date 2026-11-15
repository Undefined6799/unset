# 0042 — Behind the edge, the app's rate limits are site-wide ceilings

Status: Accepted by Alex, 2026-11-15 22:53:23Z, against d8c8ff8. The coordinator's project-chat post asked for the
line "accept ADR 0042 at d8c8ff8", on the head it had verified; Alex replied to that post with "go". From here the
record changes only to be marked superseded.

## Context
The edge never passes the client address upstream (plan §5.2; `deployment/edge/snippets/upstream.caddy` removes
`X-Forwarded-For`), and web runs in `TRUSTED_PROXY_MODE: socket` behind it (`deployment/compose.dev.yaml`). So web
sees the edge's address on every request, and each `scope: "ip"` entry in `interfaces/http/limits.ts` is one bucket
shared by all visitors.

ADR 0031 Decision 1 knew this and sized the edge's per-client zones (`app_signin` 5 per 5 minutes, `app_burst` 20
per 10 seconds) so that no single client can drain a shared bucket. The whole-project review of 2026-11-15 found
that the reasoning stops at one client. Three clients at their allowed 2 requests a second ask for 6 a second
against a `default` refill of 5, so every page for every member answers 429. Two clients spending their 5 sign-in
events at once empty the shared `login` bucket (10 at once, 10 a minute), and about ten addresses keep it empty.
With no attacker at all, the same numbers cap the service at about 5 page requests a second and 5 sign-ins a minute.

Alex chose on 2026-11-15 20:52:18Z ("do what is recomended", on the recommendation "edge per-client sign-in limit
plus app buckets as site-wide backstops; the app stays blind to client addresses").

## Decision
1. Web stays blind to client addresses. The edge is the only per-client rate limiter, with the zones of ADR 0031
   Decision 1, unchanged.
2. In `socket` mode web runs its policy table without the per-address entries (`policiesFor`,
   `interfaces/http/limits.ts`). What is left is a ceiling for the whole site:
   - `default`: its existing `global` entry, 3000 at once refilled at 3000 a minute (50 a second). That is 25
     clients at the edge's full sustained allowance at the same moment.
   - `login`: a new `global` entry, 120 at once refilled at 120 a minute. A sign-in is two events (`POST /login` and
     the callback), so about 60 sign-ins a minute. It takes about 120 addresses, each at its full `app_signin`
     allowance, to hold it empty.
   - Per-DID entries are unchanged.
3. In `header` mode, where a trusted proxy names the client, the table keeps its per-address entries as before.
4. A deployment that runs web in `socket` mode must put per-client limits in front of it. Today that is the edge's
   `app-ratelimit` snippet; the production edge must import it before it opens (a P5 preflight item).

## Alternatives
- **Give web the client address** (header mode, the edge as the only trusted peer). Limits would be exact per
  client in the app, and `ClientIp` cannot be logged or serialised. Not chosen: Alex chose that the address
  stays at the edge.
- **Leave it.** Rejected: a handful of ordinary clients, or two hostile ones, lock everyone out.
- **Raise the shared per-address buckets.** Same effect as a ceiling, but the table would keep calling a site-wide
  bucket "per IP".

## Consequences
- The ceilings are sized from arithmetic, not from a load test. They protect Postgres and the PDS from a flood the
  edge lets through from many addresses; they are not per-client fairness.
- An attacker with about 120 addresses can still hold sign-in closed, and 25 can exhaust `default`. Before, it took
  two and three. Pangolin's CrowdSec bouncer, when enabled, is the layer for that.
- Tests and the local stack run in `socket` mode with no edge in front, so they run the ceiling table too.
- This amends the sizing argument of ADR 0031 Decision 1 ("below web's shared bucket so no single client can drain
  it"): the edge values stay, the shared buckets they were sized against are gone.

## Compliance
`interfaces/http/limits.test.ts`: `socket_mode_has_no_per_address_bucket` and
`header_mode_keeps_the_per_address_table`. `compose.ts` passes `policiesFor(cfg.TRUSTED_PROXY_MODE)` to the server.
