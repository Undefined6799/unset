# 0046 — The edge's checks read Caddy's own adapted config, not our reading of the Caddyfile

Status: Accepted by Alex, 2026-11-16 02:15:57Z, against f6e6789 (his line "loosen C18 reader call and accept ADR 0046
Undefined6799/unset#1627 at f6e6789", typed in the project chat after the coordinator's review of that commit).
Decisions 1 to 4 landed with P1.39a to P1.39c. Decision 5, the loosening, landed in two parts under P1.39e: C18
stopped calling the reader in #1627, and the reader, its tests and its dependency-cruiser entry were deleted in the
pull request that records this status.

## Context
`deployment/edge/caddyfile.ts` (1,210 lines, with 1,628 lines of tests in four files) is our own reader of the
Caddyfile format: a lexer, snippet and glob imports, `{$NAME}` substitution, an allowlist of directives, and the
edge's site rules on top. It was written on 2026-10-07 (P1.28h, #463; record
`2026-10-07-p130s-networks-and-caddyfile-reader`, point 2) because `edge.test.ts` read the Caddyfile with regular
expressions and the deploy preflight's C18 was about to read the same file: one strict reader, shared, so CI and the
deploy gate could not disagree. That reason stands. What it cost was not weighed: the reader has to model Caddy's
syntax exactly, every Caddy upgrade or new directive is a trusted change to it, and `caddyfile.image.test.ts` exists
only to prove it still agrees with Caddy.

Caddy already prints what it will do. `caddy adapt --adapter caddyfile` converts a Caddyfile to the JSON config
Caddy runs, and `caddy run --adapter caddyfile` loads that same conversion
(https://caddyserver.com/docs/command-line, "caddy adapt" and "caddy run"; Caddy v2.11.7
`caddyconfig/httpcaddyfile/httptype.go`, `Setup`). The whole-project review of 2026-11-15 (delivery finding 5)
recommended checking that output. Alex asked why we had reinvented this and chose to replace the reader ("yes 2",
2026-11-15 23:12:48Z).

Read with the pinned build on 2026-11-15 (Caddy v2.11.7 with caddy-ratelimit at 5625512f24f6 and the Dockerfile's
two replaces, built with Go from the same module versions):
- The adapted config is 8 to 12 KB for each env. `{$NAME}` values are substituted, snippets and globs are expanded,
  and directive order inside `route` is kept.
- `caddy adapt` does not open the certificate files a `tls <cert> <key>` line names.
- In the five value sets tried across the three envs, the same files adapted to the same config apart from the
  values themselves and two orders: a server's site routes and the names in a connection policy's SNI matcher,
  where Caddy puts the longer host first. This is an observation of those runs, not a proof about every value. A
  value that changes the output in any other way makes `reviewedDifference` fail, which is the safe side.

## Decision
1. **The edge's checks judge `caddy adapt` output.** No check reads the Caddyfile format itself. One source of truth
   for CI and the deploy gate stays: the adapted config.
2. **A reviewed adapted config for each env, in the trusted base** (P1.39a).
   `deployment/edge/adapted/{prod,dev,local}.generated.json` hold Caddy's output for each env's files as its compose
   file mounts them, adapted with fixed sentinel values for `PDS_HOST`, `PDS_UPSTREAM`, `ACME_EMAIL`, `APP_HOST` and
   `APP_UPSTREAM`. `adapted.image.test.ts` builds the edge image in CI and fails unless each file is exactly what the
   image adapts. A change to the Caddyfile, a snippet, a site or the Caddy version therefore shows as a diff of what
   the edge will do, in the same pull request. `reviewedDifference` compares a config adapted with real values to
   the reviewed one, key for key and value for value, after putting the two host-derived orders in a fixed order.
3. **The site rules move to the adapted config** (P1.39b), as pure functions over the JSON with unit tests that need
   no container. Every rule of `edgeSiteProblems` and of C18's `certificateProblems` keeps a counterpart; the table
   below maps them. A module, matcher or key the rules do not name fails.
4. **C18 runs `caddy adapt` in the edge image** (P1.39c), then requires `reviewedDifference` to be null and the
   rules to pass. It runs only an image the preflight already holds to account: the lock's edge reference, by
   digest, after the lock, digest and signature checks (C2 to C5) passed; or, under `--env local` and `--env dev
   --source`, an image built from `deployment/edge/Dockerfile` that C26 passed, built by the preflight before the
   check. The container has no network, a read-only root, every capability dropped but `NET_BIND_SERVICE` (the
   image's binary carries that file capability and the kernel will not start it without; with no network there is
   nothing to bind; the running edge has the same pair), no new privileges, the image's non-root user, and only
   the compose edge service's own read-only binds under `/etc/caddy`. Values reach it by variable name, never on the
   command line. No Docker, a failed or timed-out run, or output that is not JSON fails C18; nothing is skipped.
   C18's rules about the compose file itself (which image, which mounts, which secrets, which hosts) do not change.
5. **The reader is deleted** (P1.39d moves `edge.test.ts` to the adapted config; P1.39e deletes `caddyfile.ts`, its
   four test files and the dependency-cruiser row that names it). This is the loosening.
6. **No Caddy upgrade rides with this.** Main stays on 2.11.7 through these steps.

### What each reader rule becomes
| Reader rule (`caddyfile.ts`, `checks/edge.ts`) | On the adapted config |
| --- | --- |
| Lexer refusals: heredocs, escapes, quotes, non-ASCII | Gone. Caddy parses its own format; equality with the reviewed config pins the result. |
| Directive allowlist per block (`DIRECTIVES`) | Equality with the reviewed config at deploy; allowlists of handler modules, matchers and keys in the rules. |
| File and glob imports refused, snippets in byte order | Gone. Caddy expands them; the result is compared whole. |
| Containment: symlinks, hard links, resolved paths | Gone as reader rules. At deploy, Caddy reads through the real mounts in the real image (P1.39c). C18's mount-source rules stay. |
| `{$NAME}` only in its position; upstream never a literal | Each configured value only at its ruled path (host matcher, access-log name, SNI, certificate subject, ACME email, the font `font-src`, the site's upstream dial). |
| Value shapes; app values differ from the PDS's; dev app values exact | Unchanged, checked before the config is read. |
| LOCAL_ONLY and DEV_ONLY tokens by folder | The local and dev leaf paths only in that env's certificate loader; no secret path elsewhere. |
| Zones snippet: one `rate_limit`, global zone unmatched, keys `{client_ip}` | Each site's one `rate_limit` handler: its global zone has no matcher, every zone keyed on `{http.vars.client_ip}`. |
| One plain route per site, zones first, every proxy inside | The site's one subroute: its first route is unmatched and starts with the rate limiter; every `reverse_proxy` inside. |
| Proxy removes the client address headers, sets none | Same, on `headers.request.delete` and `set`. |
| `X-Forwarded-Host` set from `{host}` once | Same, as `{http.request.host}`. |
| One upstream per site, one site per upstream | Each site dials exactly its own configured upstream, and the two differ. |
| A site without an upstream is loopback only | The only server besides the public one is exactly the health site on 127.0.0.1. |
| Literal site address is loopback; host placeholder alone | The public server holds exactly the env's sites, each matched by its one host. |
| Trusted proxy only for the dev listener, exact values, shared timeouts | Same, on the server's `trusted_proxies`, `trusted_proxies_strict`, `client_ip_headers` and timeouts. |
| No plain-http public site; dev bound to the newt_edge address alone | The public server listens on `:443` alone, or under dev on that address alone. |
| Dev sites import tls, security-headers, noindex, xrpc-guard, blob-deny, signin-files | Each snippet's adapted handlers present on the site, each deny route before the upstream. |
| `(tls)` served is the env's own; no other certificate source | The whole `tls` app is the env's own: Let's Encrypt for the PDS host under prod, the leaf's two files under dev and local. |
| Health site alone is exempt from tls | The health server compared whole. |
| `(pds-fonts)` exact; once, before the upstream, on the PDS site only | The two font routes and the CSP append compared whole, once, before the upstream, on the PDS site only. |
| No file server, response matcher or CSP change outside the fonts | Same, on handlers. `(strict-csp)` is imported nowhere today; a site that imports it adds its handler to the rules. |
| Messages carry no configured value | Unchanged: fixed words and placeholder names. |

### What is lost when the reader goes
Five reader rules judge the source text, and the adapted config no longer carries what they read. Each is replaced,
not kept, and the replacement is a different kind of check:
- **Where a placeholder is written.** The reader fails a `{$NAME}` outside its one position and an upstream written
  as a literal. After adapting, a placeholder and a literal with the same value are the same text, so the new rule
  is about where each value ends up. A literal that equals the configured value passes, and behaves the same.
- **Which snippet a directive came from.** The reader requires, for example, that a site's rate limiter was imported
  from the zones snippet. The adapted config has no snippets. The new rules require the handlers themselves, compared
  whole, so a copy of a snippet written in place passes when it adapts to the same handlers.
- **Containment of the files read.** The reader refuses symlinks that leave `deployment/edge`, hard links and
  unresolved paths, so that it reads what Caddy will read. With `caddy adapt` in the container, Caddy reads through
  the real mounts, so that guarantee holds only where C18 runs it, at deploy (P1.39c). The CI image test uses its
  own list of mounts, written to match each compose file; for prod that list is an assumption until a prod compose
  file exists (P5). C18's own rules on mount sources (inside `deployment/edge`, read-only, exact files) stay.
- **The directive allowlist.** The reader fails any directive it does not model, before anyone reviews it. Afterwards
  a new directive is caught in two ways: the rules fail a module, matcher or key they do not name, and the deploy
  fails unless the adapted config equals the reviewed one. A directive that adapts only to keys the rules already
  allow reaches review as a diff of the saved JSON and is stopped there by a person, not by a machine.
- **Which names a placeholder may read.** The reader fails a `{$NAME}` for any name but the five. Caddy replaces
  `{$NAME}` from its process environment before it lexes, and an unset name with no default becomes nothing (v2.11.7
  `caddyconfig/caddyfile/parse.go:63-64`, `replaceEnvVars` `:67-108`). C18 and the image test hand `caddy adapt` the
  five names only, so a placeholder for a sixth adapts to the same config whatever the running edge would put there.
  The new rule is on the other side (P1.39e): C18 fails when the edge service's environment, from `environment` or an
  env file, holds any name beside the five. The running edge then reads exactly what adapt read, and a placeholder
  for another name is empty in both.

### Who reviews the saved JSON
A change to `deployment/edge/adapted/` is a trusted-base change: Alex reads the diff before merge, and the
coordinator reviews the head it names safe. Nothing enforces that review. `.github/CODEOWNERS` routes it and says
itself that code-owner review is not enforced, so this is a process rule, the same as for every other trusted path.
What a machine does enforce is that the saved JSON is what the image adapts (CI) and passes the rules (P1.39b).

## Alternatives
- **Keep the reader.** Costs a trusted review of a parser at every Caddy change, and still needs the image test.
- **Rules on live `caddy adapt` output only, no reviewed files.** Unit tests would need a container, and nothing
  would fail on a construct the rules never thought of.
- **Reviewed files only, no rules.** A wrong edit to the config would pass if the reviewer missed it in the diff;
  the rules are what a machine holds every version to.
- **`caddy validate`.** It proves the config loads, not that it is ours.

## Consequences
- About 2,800 lines of reader and reader tests go. About 650 lines of rules and comparison, their tests, and about
  2,300 lines of generated JSON arrive.
- A Caddy upgrade that changes how a directive adapts shows as a diff of the three files, reviewed as trusted base.
  Regenerating them needs the pinned Caddy: the image test prints the difference to copy.
- C18 starts a container. The preflight already needs Docker on the host (`stack.ts` asks the daemon its name; C3
  to C5 call `docker buildx`), so no place that runs it today loses the check. A checkout with no Docker cannot get a
  C18 verdict; it could not start the stack either.
- The preflight runs the edge image before `compose up`. Decision 4 bounds what that image is and what it can reach.
- Under `--env local` and `--env dev --source` the preflight builds the edge image before C18; `compose up` then
  reuses that build.
- Not changed: a file swapped between the check and `compose up` was out of scope for the reader and still is.

## Compliance
- `adapted.image.test.ts` (CI, built image): each reviewed file is what the image adapts.
- `adapted.test.ts`: equality holds for real values in both host orders, and fails for any other config.
- From P1.39b and P1.39c: each rule in the table has a failing test, and C18 fails closed without Docker.
