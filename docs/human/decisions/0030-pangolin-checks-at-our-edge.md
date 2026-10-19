# 0030 — Staging behind Pangolin: the method and TLS checks move to our edge

Status: Proposed (awaiting Alex)

## Context
Accepted ADR 0025 (2026-10-19 04:17:55Z) puts `staging.unset.sh` and `staging.unset.ac` behind Alex's
Pangolin. Four of its clauses describe Pangolin behaviour that Pangolin 1.24.0, the version the runbook
requires, does not have. The plan thread verified each against the 1.24.0 source on 2026-10-19 (recorded
in the staging rulings record, 04:41Z, 20:17Z, 20:47Z, 21:25Z and 21:49Z real UTC):

- 0025:74-78 says exactly two paths bypass the login "for GET and HEAD". A Pangolin rule matches one type
  only, and `checkRules` returns the first rule that matches (`server/routers/badger/verifySession.ts:1462-1527`;
  fosrl/pangolin#3704), so a PATH rule cannot also require a method.
- 0025:78-80 says Pangolin connects upstream "with certificate verification on and SNI `staging.unset.sh`".
  Stock 1.24.0 hard-codes `insecureSkipVerify: true` for the upstream transport
  (`server/lib/traefik/getTraefikConfig.ts:476` and `config/traefik/traefik_config.yml:45`).
- 0025:79 says Newt connects to "the edge's existing loopback bind". A loopback publish is reachable by every
  process on the host, so it cannot single Newt out as the edge's only trusted proxy.
- 0025:190 asks for "host-only cookies on the resource name". Pangolin's resource session cookie always carries
  a `Domain` attribute set to the resource's full name (`server/auth/sessions/resource.ts:188-195`, called
  with `resource.fullDomain` at `verifySession.ts:1173-1175`, and with the request host at
  `routers/badger/exchangeSession.ts:210-212`, which equals `fullDomain` for a resource without a wildcard,
  `:79-90`), so it is a domain cookie, not a host-only one. Stating that is a loosening of 0025:190, not a tightening.

Three further facts bear on what Pangolin stores about testers: its request audit log keeps the full URL of
every request unless the org's request-log retention is 0 (`server/routers/badger/logRequestAudit.ts:216-221`;
the setting is cached 300 seconds, `:158-163`, and rows are written in 5-second batches, `:55-56`); its
Traefik access log's request path field carries the query string; and at log level `debug` it logs the whole
verification body, URL, headers and query included, before parsing it (`verifySession.ts:145`; the default is
`info`, `server/lib/readConfigFile.ts:19-22`). A `/oauth/callback` URL carries the authorization `code` and
`state`, and a profile path names a DID, which P1.28 classes as personal data.

Accepted ADRs are never edited (DO-2). Architecture ruled on 2026-10-19 at 04:41Z that the fix is a new
Proposed record amending those clauses, that staging does not open until it is accepted, and that the choice
between patching Pangolin and moving the checks to our edge is Alex's. Alex chose "Move to our edge" on
2026-10-19 at 22:04:19Z, on the card "Patch your Pangolin, or move these two checks to our edge?", whose
option read "Our edge allows only reads on the two public sign-in files, and Newt sits on the edge's own host."

## Decision
This record amends ADR 0025 at the four clauses above. Everything else in 0025 stands, 0025 is not edited, and
its status does not change.

1. **Method scope at our edge.** Pangolin's rules for `staging.unset.sh` ACCEPT ("Bypass Auth",
   `verifySession.ts:301-315`; PASS, "Pass to Auth", still goes on to the login, `:332-337`) exactly two exact
   paths, `/oauth-client-metadata.json` and `/oauth/jwks.json`, for every method, and nothing else bypasses the
   login; `staging.unset.ac` has no bypass. Pangolin normalises a path before matching it
   (`server/lib/pathMatch.ts:28-53`: each segment percent-decoded, `.` and `..` resolved, empty segments from
   trailing and doubled slashes dropped; the comparison itself is case-sensitive, `:102`; and
   `config/traefik/traefik_config.yml:41-43` lets encoded slashes through), so the edge's rule matches after the
   same normalisation. Under dev the edge answers `405`, with `Allow: GET, HEAD` as RFC 9110 §10.2.1 requires of
   an origin's 405, to any method but `GET` and `HEAD` on those two paths, and a red pins the Caddy route and the
   header (the dev edge app site, P1.36b, gains this rule). The method check now lives in
   code we own and test; Pangolin keeps the path check. The deploy check against the live resource, run on the
   first deploy, after every rule or policy change and after every Pangolin update, in two groups. Without a
   login, because Pangolin's matcher folds them onto the two files: the two exact paths, the trailing-slash
   forms `/oauth/jwks.json/` and `/oauth-client-metadata.json/`, the encoded forms `/oauth%2Fjwks.json`,
   `/oauth/jwks%2Ejson` and `/%6Fauth-client-metadata.json`, and the dot-segment form `/x/../oauth/jwks.json`.
   A `GET` of either exact path returns exactly that file's bytes, with status `200`, since a `404` there would
   leave staging green while no client could sign in; a `GET` of every other spelling returns exactly that
   file's bytes or a `4xx`,
   never other content, so that a difference between how Pangolin, the edge and the app read a path cannot
   open another route; and a `POST` to any of them gets `405` from the edge. With the login demanded:
   `/oauth/callback`, `/oauth-client-metadata.json/x`, `/OAUTH/JWKS.JSON` and `/` itself. Probing paths is not
   enough on its own, since a third ACCEPT rule for some other path would pass every probe: the check also reads
   the resource's effective rule list, its own rules and its shared or default resource policy's rules
   (`server/db/queries/verifySessionQueries.ts:401-445`; the rules API, `GET /resource/{id}/rules`, returns only
   one of those sets, `listResourceRules.ts:170-197`), and asserts that its only ACCEPT rules are the two exact
   PATH rules above, and that `staging.unset.ac` has none.
2. **The last hop is host-local instead of verified.** Pangolin reaches the edge through Newt's WireGuard
   tunnel, which is authenticated and encrypted end to end. The segment Pangolin does not verify is Newt to
   the edge, and that segment never leaves the edge's host: Newt runs as a service in `compose.dev.yaml`,
   pinned by digest and non-root, on two networks, an egress network for its tunnel to Pangolin and
   `newt_edge`, an `internal: true` network with a fixed subnet whose only members are Newt, at a fixed
   `ipv4_address`, and the edge. Under dev the edge publishes no ports at all, and its `trusted_proxies` is
   exactly Newt's fixed address on `newt_edge` (P1.36j is unchanged). This replaces 0025's "loopback bind" and
   is step P1.37v (#1115). The edge keeps its own Let's Encrypt DNS-01 certificate for the staging names
   (0025:65, C18, ADR 0028), and Pangolin keeps its own HTTP-01 certificate; `insecureSkipVerify` stays as
   Pangolin ships it. One gap remains and is named rather than hidden: an `internal: true` bridge still has an
   address in the host's network namespace, so a process on the edge's host can reach the edge's container
   address directly. That process is never the trusted proxy, since its source is not Newt's address, so it
   cannot forge a client address; it arrives as a plain client and faces every app-side check, because
   Pangolin's login is the tester gate, not our authorization. The edge's host is therefore inside the staging
   trust boundary, as 0025:186 says of the Pangolin host: it runs the stack and holds its secrets. Three
   conditions make that true and are Alex's, on the runbook: the staging host is single-purpose, the staging
   VM; no container on it uses host networking unless it is part of the stack; nobody else's workloads run on
   it. Docker's isolation rules already block traffic from other bridges, so the host namespace is the only
   gap. Isolated gateway mode on `newt_edge`, which leaves the bridge with no host address, is a follow-up
   tightening when the host's engine supports it, with a fifth P1.37v red that inspects the live network and
   fails if the bridge has a host address; it needs no card and no line (architecture, 2026-10-19 22:17Z).
3. **Pangolin's cookie is a domain cookie on the resource name.** The resource session cookie is
   `Domain=staging.unset.sh` or `Domain=staging.unset.ac`, sent to that name and its descendants, never
   `Domain=unset.sh`, `Domain=unset.ac` or another parent. The runbook checks that no staging resource has a
   subdomain of its own, so the descendant scope reaches nothing. Our own cookies stay host-only `__Host-`
   cookies (0025:164-169).
4. **Four org-wide or global logging settings, before any staging resource is created.** (a) The staging org's
   request-log retention is 0, the only value at which 1.24.0 buffers no request URL; then, after at least six
   minutes (the 300-second cache plus the 5-second write batch), the rows already stored for the org are
   purged. (b) Pangolin's Traefik access log is a keep-list, globally: `accessLog.fields.defaultMode: drop`,
   `accessLog.fields.headers.defaultMode: drop`, and `accessLog.fields.names` keeping exactly `RequestHost`,
   `RouterName`, `DownstreamStatus`, `Duration` and `StartUTC`. Dropping `RequestPath` alone is not enough:
   Traefik keeps every field by default, and Pangolin's own crowdsec template keeps `ClientHost`, `User-Agent`
   and `X-Real-Ip` (`install/config/crowdsec/traefik_config.yml:40-60`), so the client address, the method and
   the raw path with its query would still be written. If the deployed Traefik cannot take the keep-list, the
   access log is off. (c) Pangolin's application log level stays at `info` or above, never `debug`. (d)
   `app.log_failed_attempts` is `false`: at `info` it writes "IP: <client address>" on every refused request,
   the unauthenticated request that starts a sign-in included (the flag gates every "IP:" line in
   `verifySession.ts`, e.g. `:400-402`, `:510-514`, `:554-558`, `:665-669`, `:713-717`, `:946-950`). Pangolin
   reads `config.yml` only at startup (`server/lib/readConfigFile.ts:502-521`), so each of these settings takes
   effect only after a restart. 0025's "short retention and a RoPA line" applies to what remains. The deploy check,
   after one sign-in from a known address and a wait of at least ten seconds, past the 5-second write batch, so
   that a buffered row cannot pass an early read: Pangolin's request audit table holds no row for the staging
   org; neither the access log nor the application log contains `sig=`, `code=`, `state=`, the tester's DID, a
   media object key or the tester's own address; the access log's effective field set is read back from
   Traefik's configuration and equals the five kept fields, so a regression to the default keep mode fails the
   check even when the path is dropped; and Pangolin's effective configuration shows retention 0, log level
   `info` or above and `log_failed_attempts` false, read from the running process after a restart that
   follows the last edit of `config.yml`, which the check confirms from the process start time.
5. **Runbook conditions unchanged.** Pangolin 1.24.0 or later, kept patched, share links off, MFA on its admin
   login, one Pangolin user login per tester, forwarded headers set by Pangolin alone, testers told it is a
   test system (0025:186-194).

## Alternatives
- **Patch Pangolin** so its rules match path and method together and its upstream transport verifies our
  certificate with SNI. The accepted text would then be true as written. Not chosen by Alex on 2026-10-19 at
  22:04:19Z; the card's option read "You carry a patch to Pangolin and reapply it on every update", and its
  reason for the recommended option read "No fork to maintain, and the method check moves to code we own and
  test".
- **Drop the edge's public certificate on the inner hop** and let the edge serve the dev root or plain HTTP
  to Newt. Not taken: C18 and 0025:65 keep Let's Encrypt as the only issuer of our certificates, and the
  edge's certificate is what every other client of the edge, including the PDS's own metadata fetch, verifies.
- **A loopback bind with a firewall rule** instead of the internal network. Rejected: a host firewall is
  outside the compose stack and outside preflight, so nothing we test pins it.
- **Per-resource logging settings.** None exist in 1.24.0; retention, the access-log format and the log level
  are org-wide or global, which is why this record carries them rather than a per-resource record.
- **Testers on the tailnet instead of Pangolin.** Already rejected in 0025.

## Consequences
- Staging does not open until Alex accepts this record (architecture, 04:41Z). P1.37v (#1115) is blocked on it
  and unblocks on acceptance; P1.36b gains the `405` rule and its red; P1.36j's Caddyfile rule and its typed
  line are unchanged.
- The method scope on the two public sign-in files is now ours to test. A regression at Pangolin, such as a
  rule that ACCEPTs a wider path, is caught by the live-resource deploy check in Decision 1; the repository
  test of 0025 covers only what the app itself serves without a session.
- The last hop's certificate is not checked. The compensating control is topology: the edge is reachable only
  by Newt, by the stack's own containers on the edge's other networks (web and the PDS, which reach the edge by
  design, 0025:86, `deployment/compose.dev.yaml:118,156-160,218`, and are inside the boundary as parts of the
  stack) and by the edge's own host; `newt_edge` is internal, and its only container members are Newt and the
  edge. Reds for P1.37v: only `newt` and `edge` are on `newt_edge`; `newt_edge` is internal; the edge
  publishes nothing under dev; the edge's trusted proxy equals Newt's `ipv4_address`. The fifth red, no host
  address on the bridge, follows when isolated gateway mode is available on the host.
- The Pangolin host stays inside the staging trust boundary (0025:186). The cookie clause is the one loosening
  in this record: 0025:190 promised a host-only cookie, and Pangolin 1.24.0 can only set a `Domain` cookie on
  the resource name. What still holds: the cookie never reaches `unset.sh`, `unset.ac` or any production name;
  it reaches only `staging.unset.sh` or `staging.unset.ac` and their subdomains, and the runbook check that no
  staging name has a subdomain keeps that set to the resource itself. Alex accepts this knowingly or the record
  is not accepted.
- Pangolin stores no request URL, no query string and no raw path for the staging org, so the `code`, `state`
  and `sig` values and the DIDs in paths never reach its tables or log files (0025:192-193 asked for short
  retention of what it stores). The RoPA line for Pangolin's access log names exactly the five kept fields:
  request host, router, status, duration and start time; no client address, method, path, query or header.
- The keep-list is global to that Pangolin's Traefik, so if CrowdSec is enabled there, its log-based HTTP
  scenarios lose the client address and request details they read from the access log, for every resource on
  that instance. The bouncer and AppSec check each request directly and keep working
  (`install/config/crowdsec/dynamic_config.yml:35-44`); only the log-based scenarios go blind. Alex accepts
  that loss with this record, or runs that Pangolin without CrowdSec's log-based HTTP scenarios; the runbook
  records which. Our own rate limits and gates at the edge and in the app do not depend on it.
- Alex's staging list gains: the two ACCEPT rules, the four logging settings in the order above (retention,
  wait, purge, then the access-log keep-list, the log level and failed-attempt logging off), the subdomain
  check, the three host
  conditions of Decision 2, and the live-resource deploy check of Decision 1.

## Compliance
- `deployment/edge` tests pin the `405` rule on the two paths under dev (P1.36b) and the four P1.37v reds.
- Both deploy checks run at the first staging deploy and after every Pangolin update, since path normalisation,
  rule precedence and policy selection are version-specific; Decision 1's also after every change to Pangolin's
  rules or policies, and Decision 4's also after every change to any of the four logging settings. Both results
  are recorded in the staging runbook.
- ADR 0025 changes nothing, not even its status line, since this record amends four clauses and supersedes
  none of its decisions.
- Acceptance line: "yes accept ADR 0030 staging Pangolin checks move to our edge
  docs/human/decisions/0030-pangolin-checks-at-our-edge.md".
