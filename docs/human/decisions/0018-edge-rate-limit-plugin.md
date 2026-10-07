# 0018 — Edge rate limiting with caddy-ratelimit

Status: Accepted (Alex merged the P1.28 pull request, #409, at 2026-10-07T03:31:33Z;
architecture's reuse ruling 2026-10-07 00:45Z, record p128-edge-bases-and-ratelimit-adr)

## Context
P1.28 puts one edge, Caddy, in front of every public host. The edge must limit clients by address
before requests reach the PDS. The PDS's own per-address limits collapse into one bucket once the
edge stops forwarding the client address (P1b-A1: Alex tapped "Do not forward", 2026-10-07 00:57Z).
Standard Caddy has no rate limiter. The plugin Caddy's documentation points to is
`github.com/mholt/caddy-ratelimit`. It is a new runtime dependency and a security mechanism, so it
needs an ADR (D8). Everything below was read on 2026-10-07: the module through the Go module proxy
and the checksum database, and the repository's front page on GitHub.

## Decision
1. **Identity and pin.**
   - Module `github.com/mholt/caddy-ratelimit`, commit `5625512f24f6f59d6f64fb3aafe5eecff0b286db`
     (2026-06-12), pseudo-version `v0.1.1-0.20260612195517-5625512f24f6`
     (proxy.golang.org `@v/master.info`).
   - The only tagged release is `v0.1.0` (2024-08-28, commit `12435ecef5db`), so we pin the
     pseudo-version of the latest commit.
   - go.sum lines (sum.golang.org lookup):
     `github.com/mholt/caddy-ratelimit v0.1.1-0.20260612195517-5625512f24f6 h1:XLJEIxNlf80gg+nc7Oea070+veJffHYKiX6UaYVY+tM=`
     and `.../go.mod h1:53Zd3yf9HJ2GfXLr+T12yLxmT9Kqi3HFqez2Kvn0XDU=`.
   - The plugin is built into Caddy v2.11.7 (`h1:yj0Y4fYZGPkSvibBJ1sTWE33xC0fxztVyXEW5iIdUT4=`)
     with xcaddy v0.4.7 (`deployment/edge/Dockerfile`). The plugin's own go.mod requires Caddy
     v2.10.0 or later.
   - It registers exactly one module, `http.handlers.rate_limit` (handler.go:89).
2. **Licence.** The LICENSE file at that commit is the Apache License 2.0 (SPDX `Apache-2.0`).
   - The edge image holds the Caddy binary with the plugin (Apache-2.0) and our config files
     (AGPL-3.0-only). They are separate works shipped side by side, so neither licence reaches
     the other. Even combined, Apache 2.0 is "compatible with version 3 of the GNU GPL" (FSF licence
     list, gnu.org/licenses/license-list.html, read 2026-10-07). The image label says
     `AGPL-3.0-only AND Apache-2.0`.
   - Transitive modules: the plugin's direct requirements are caddy, certmagic, google/uuid,
     prometheus/client_golang and zap. Every one of them is already in Caddy v2.11.7's own go.mod,
     so minimal version selection uses Caddy's versions, and the plugin adds no module of its own.
     This is read from both go.mod files, not proven. The image SBOM (syft reads Go build info)
     lists the built binary's modules.
3. **Maintenance**, as read on 2026-10-07 from github.com/mholt/caddy-ratelimit (front page,
   issues, pull requests, tags), pkg.go.dev/github.com/mholt/caddy-ratelimit, osv.dev and
   pkg.go.dev/vuln:
   - The maintainer is Matt Holt, Caddy's author, under his personal account. The README marks it
     "not an official repository of the Caddy Web Server organization", so we treat it as
     third-party.
   - The pinned commit `5625512f24f6` is master's HEAD: 2026-06-12, "fix(metrics): re-register
     collectors on each config reload (#102)". Before it: `16aecbb` 2026-05-21 (ipv4_prefix and
     ipv6_prefix, #97) and `6cc6d95` 2026-05-14 (metrics, #85). 45 commits, about 14
     contributors.
   - One tag, `v0.1.0` (2024-08-28, commit `12435ec`, GPG-signed by the maintainer), and no
     GitHub releases. Only a pseudo-version pin gets the 2026 prefix and metrics work.
   - pkg.go.dev lists the pseudo-version (Apache-2.0, valid go.mod) with no vulnerability banner.
     No advisory on GitHub, OSV or the Go vulnerability database.
   - 12 open issues. Relevant to us: #103 "Too Much Logging" (2026-06-18), where the
     maintainer's answer is to exclude the handler's logger, which confirms our log design (point
     5); #94 (2025-12-26), an immediate 429 on a first visit after upgrading to Caddy 2.10.2 (see
     point 6); #96, distributed-mode sync errors (we do not use distributed mode); #6 and #69,
     connection and concurrency limits (see the gaps under point 4).
   - 1 open pull request, #98 "feat: concurrency limiter" (2026-04-20). It is the candidate fix
     for the concurrent firehose connections gap. An unmerged PR is never pinned; revisit when it
     merges.
   - Not verified: whether caddyserver.com's download registry lists the plugin.
   - The README states no experimental status. It lists "RL state persisted in storage for
     resuming after restarts" as planned. We do not want that, and we do not configure storage.
   - Judgement: active but low-cadence and untagged; small (about 1,500 lines of Go outside
     tests), by Caddy's author. Acceptable as one plugin at the edge.
   - Revisit on a new tag, on a Caddy minor upgrade, after six months without a commit, when #98
     merges, when #94 is resolved or reproduces here, or when an advisory is published.
4. **What it does and what it replaces.**
   - It applies per-zone sliding-window limits at the edge (`snippets/ratelimit.caddy`), keyed by
     `{remote_host}`, with architecture's starting values (record
     `2026-10-07-p1b-a1-pds-no-forwarded-address`, "Zone values for P1.28", 01:52Z; the same
     numbers as `limits.json` `rateLimitZones`): `session` (createSession) 30 per 5 min and
     `session_day` 300 per day; `oauth_signin` (POST to the OAuth provider's sign-in API) 30 per
     5 min; `oauth_token` (`/oauth/token`, refreshSession) 120 per 5 min; `signup` 10 per hour;
     `reset` (password reset and email routes, XRPC and OAuth API) 5 per hour; `sync` (sync.*
     except getBlob and subscribeRepos) 1500 per 5 min; `blob_read` (getBlob) 600 per 5 min;
     `blob_upload` (uploadBlob) 60 per 5 min; `firehose` (subscribeRepos) 6 per minute and
     `firehose_hour` 60 per hour; `identity` 300 per 5 min; `global` (every PDS request) 3000 per
     5 min. A request counts in every zone it matches.
   - Gaps, recorded (P1b-A1): per-account write limits keyed by DID (revisit before open
     sign-up), and concurrent firehose connections (the `firehose` zone limits new connections
     per minute only; candidate fix PR #98).
   - It replaces nothing. The app's own limits (the `rateLimitIp` middleware in each
     `interfaces/*/routes.manifest.json`) stay as the inner layer. No later step may drop them as "covered at the edge".
5. **Invariant 3 (no stored addresses).**
   - Zones hold client addresses as map keys in memory only (ratelimit.go `rateLimitersMap`).
   - No `distributed` block and no `storage` are configured. The handler reads or writes storage
     only from distributed mode (distributed.go:104-161, started at handler.go:136). So no key
     reaches disk or another instance.
   - `log_key` is off. The plugin's "rate limit exceeded" line still carries `remote_ip`
     unconditionally (handler.go:293-322), and its `rate_limit_exceeded` event carries it in
     `data`, logged by Caddy's events app at DEBUG (caddyevents/app.go:283-285). Both are INFO or
     DEBUG, so the edge's ERROR-level default log drops them. That log's filter also deletes
     `remote_ip` and `data>remote_ip` (`deployment/edge/Caddyfile`).
   - Prometheus metrics would label every key, that is every address (metrics.go:40-63 and 140).
     They are off twice: Caddy's `metrics` option is not set, and every `rate_limit` block sets
     `disable_metrics` (handler.go:103).
   - The access log has no address field: the P1.28 filter deletes `request>remote_ip`,
     `request>remote_port` and `request>client_ip` (`snippets/log.caddy`).
   - Tests: `edge_ratelimit_memory_only` (no `distributed`, `storage`, `log_key` or `metrics`;
     `disable_metrics` set; a fixture with any of them fails), `edge_logs_no_client_address`,
     `edge_all_logs_have_no_ip_path_or_query`.
6. **Failure modes.**
   - Plugin absent: a Caddyfile using `rate_limit` does not adapt, so Caddy refuses to start (fail
     closed). `edge_image_plugins_exact` checks that `caddy list-modules --skip-standard` shows
     exactly `http.handlers.rate_limit` and that `caddy validate` passes on the shipped Caddyfile.
   - Limit hit: 429 with `Retry-After`, set by the handler before the error (handler.go:301).
     The zone tests (`edge_rate_limit_auth_zone`, `edge_session_zone` and the other `edge_*_zone`
     tests) check it, one test per zone, each from its own client address.
   - Memory: each key allocates a ring of `events` timestamps (ringbuffer.go:46, 24 bytes each). A
     `global` key costs about 72 KB, a `sync` key about 36 KB and a `session` key about 720 bytes. A
     sweep every minute (handler.go:188) deletes keys whose newest event is older than the window
     (ratelimit.go:144), so memory follows the addresses seen in each zone's window (a day for
     `session_day`). There is no hard bound: a flood from many addresses grows it.
   - Every zone keys IPv6 clients by their /64 (`ipv6_prefix 64`, #97, README "JSON config"); IPv4
     stays per address. So rotating addresses inside one subnet neither escapes a limit nor
     allocates a ring per address. An IPv4-wide flood (10,000 addresses, about 720 MB in `global`
     alone) is a host-level DoS concern for P1.34's monitoring and P5's sizing. The numbers are
     revisited when they are tuned.
   - Version skew: the plugin declares Caddy v2.10.0 and we build v2.11.7. Issue #94 reports a
     spurious 429 after a Caddy upgrade, so the zone tests also assert that every request below
     each zone's limit passes (every `edge_*_zone` test).
   - Restart: counters reset. Accepted, because memory only is the point.
7. **Supply chain.**
   - Module downloads go through proxy.golang.org and are checked against sum.golang.org.
     `GOFLAGS=-mod=readonly` is set, and no `GONOSUMDB`, `GONOSUMCHECK`, `GOINSECURE`, `GOPRIVATE`
     or insecure flag. A test (`edge_dockerfile_pins_caddy_and_plugin`) asserts the pins and the
     absence of those variables.
   - The built binary is covered by the image SBOM and by Trivy's gobinary analyser in the images
     workflow's `edge` job (P1.28q).
   - GO-2026-6512 (CVE-2026-77281, published 2026-10-01) affects caddy/v2 before v2.11.4; we
     build v2.11.7.
   - It makes no outbound calls at run time. The only egress is Caddy's own ACME traffic.
8. **Exit plan.** If the plugin is abandoned or a CVE goes unfixed, a fix step booked then
   removes `import pds-ratelimit` and the Dockerfile's `--with` line, relies on the app limits,
   and picks a replacement through the reuse checklist. Nothing else depends on the plugin.

## Alternatives
- Caddy alone: it has no rate limiter.
- App limits only: every flood reaches Node, and the PDS cannot limit per client without the
  address we withhold.
- A second proxy with stick tables (HAProxy) in front of Caddy: another process, config language
  and image to keep, for the same in-memory counters.

## Consequences
The edge image carries one third-party Go module beyond Caddy, pinned by pseudo-version and
checksum. Limits reset on restart. Memory grows with the number of distinct client addresses in a
window. The access and default logs never hold the keys.

## Compliance
- `deployment/edge/edge.test.ts`: `edge_ratelimit_memory_only`, `edge_ratelimit_matches_limits`,
  `every_pds_route_has_a_zone`,
  `edge_dockerfile_pins_caddy_and_plugin`, `edge_from_matches_lock`.
- `tests/integration/deployment/edge/edge.test.ts`: `edge_image_plugins_exact`,
  `edge_caddyfile_validates`, the zone tests (`edge_rate_limit_auth_zone`, `edge_session_zone`,
  `edge_oauth_token_zone`, `edge_signup_zone`, `edge_reset_zone`, `edge_sync_zone`,
  `edge_blob_read_zone`, `edge_blob_upload_zone`, `edge_firehose_zone`, `edge_identity_zone`,
  `edge_global_zone`), `edge_logs_no_client_address`, `edge_all_logs_have_no_ip_path_or_query`.
- The images workflow's `edge` job: hadolint, Trivy (no ignore file), health check.
