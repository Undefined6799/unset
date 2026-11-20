---
title: Edge
weight: 2
---

The Caddy process in front of the public hosts. The image is `deployment/edge/Dockerfile`. The config is `deployment/edge/Caddyfile` plus the snippets and the site files each stack mounts. [ADR 0018](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0018-edge-rate-limit-plugin.md) is the rate-limit plugin. [ADR 0030](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0030-pangolin-checks-at-our-edge.md), [ADR 0031](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0031-public-staging-pds.md) and [ADR 0032](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0032-self-signed-dev-edge.md) are the dev path in front of it. [ADR 0025](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0025-public-domains.md) is the domain record.

## Owns

`deployment/edge/Dockerfile` builds Caddy v2.11.9 with one plugin, `github.com/mholt/caddy-ratelimit` at `v0.1.1-0.20260612195517-5625512f24f6`, using `xcaddy build` on `docker.io/library/caddy:2.11.9-builder-alpine`, then copies the binary onto `docker.io/library/caddy:2.11.9-alpine`. Both bases are digest-pinned in `deployment/images/bases.lock.json`. The runtime stage sets `cap_net_bind_service` on `/usr/bin/caddy`, removes the package manager, and runs as `65532:65532`. `ENTRYPOINT` is `caddy run --config /etc/caddy/Caddyfile --adapter caddyfile`. `HEALTHCHECK` fetches `http://127.0.0.1:8081/health`. The image label licence is `AGPL-3.0-only AND Apache-2.0 AND OFL-1.1`. The product licence record is [ADR 0012](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0012-licence.md).

The runtime stage copies `deployment/edge/fonts/SpaceGrotesk-Variable.woff2` and `deployment/edge/fonts/JetBrainsMono-Variable.woff2` to `/etc/caddy/static/_unset/fonts/`, and `fonts/OFL-SpaceGrotesk.txt` and `fonts/OFL-JetBrainsMono.txt` to `/etc/caddy/static/licenses/`. `deployment/edge/edge.test.ts` (`pds_fonts_match_shared_ui`) requires those four files to equal `shared/ui/fonts/` byte for byte. [ADR 0027](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0027-pds-frontend-distribution.md) is the PDS frontend record the font snippet names.

`deployment/edge/final-stage-runs.json` lists the two `RUN` exec forms the runtime stage is allowed: `chown` and `chmod` of `/data` and `/config` to `65532:65532`, mode `u=rwX,go=`.

`deployment/edge/Caddyfile`, as checked in:

| Block | What it sets |
| --- | --- |
| global | `admin off`, `persist_config off` |
| `log default` | stderr, level `ERROR`, and the address, URI, header and TLS fields in the `fields` list deleted |
| `servers 10.250.37.3:443` | `trusted_proxies static 10.250.37.2/32`, `trusted_proxies_strict`, `client_ip_headers X-Forwarded-For` |
| `servers` | no `trusted_proxies`; `read_header 10s`, `read_body 120s`, `write 255s`, `idle 2m` (ADR 0076) |
| `http://127.0.0.1:8081` | `bind 127.0.0.1`, `respond /health 200`, `respond 404` |
| imports | `snippets/*.caddy`, then `sites/enabled/*.caddy` |

No file in the repository reads the Caddyfile format (P1.39e; ADR 0046 decision 5). The hand-written reader `deployment/edge/caddyfile.ts` was deleted; the edge tests and preflight C18 judge what `caddy adapt` prints. `adaptedProblems` in `adapted-rules.ts` checks the PDS fonts with `fontProblems`: the `{$PDS_HOST}` site's route serves font files once, from `FONT_ROOT` (`/etc/caddy/static`), before its upstream, and appends the one `font-src` (`cspAppend`) to an HTML response's Content-Security-Policy. A site on another host that serves them fails. Outside that, a file server, a response matcher and a changed Content-Security-Policy are rejected (`strayProblems`, `touchesCsp`).

| Path | Mounted by | What the file header says it is |
| --- | --- | --- |
| `sites/pds.caddy` | image `COPY`; local also bind-mounts it | PDS host. Name and upstream come from the environment, with no default. |
| `dev/app.caddy` | dev, read-only, `sites/enabled/app.caddy` | App site on the `newt_edge` address, self-signed leaf. |
| `dev/pds.caddy` | dev, read-only, `sites/enabled/pds.caddy` | PDS site on that address, self-signed leaf. |
| `dev/tls.caddy` | dev, read-only, over `snippets/tls.caddy` | Replaces the shipped TLS snippet. No ACME. |
| `local/app.caddy` | local, read-only, `sites/enabled/app.caddy` | App host with the dev leaf. Not copied into the image. |
| `local/tls.caddy` | local, read-only, over `snippets/tls.caddy` | Replaces the shipped TLS snippet with the dev leaf. |
| `snippets/log.caddy` | image `COPY` | Access log fields: time, host, method, route class, status, duration, size. |
| `snippets/pds-fonts.caddy` | image `COPY` | PDS page fonts from the image, and one `font-src` on HTML responses. Imported in the PDS route after the zones and guards, before the upstream. |
| `snippets/ratelimit.caddy` | image `COPY` | `rate_limit` zones. Numbers are `limits.json`. |
| `snippets/route-class.caddy` | image `COPY` | Closed route-class names for the access log. |
| `snippets/security-headers.caddy` | image `COPY` | Response headers on every public host. |
| `snippets/signin-files.caddy` | image `COPY` | Methods other than `GET` and `HEAD` on the two sign-in files get 405. |
| `snippets/tls.caddy` | image `COPY`; replaced by the dev and local mounts | Let's Encrypt issuer. |
| `snippets/upstream.caddy` | image `COPY` | Upstream timeout and the forwarding headers the file deletes. |
| `snippets/xrpc-guard.caddy` | image `COPY` | PDS admin surface. The dev PDS site also shuts blob routes. |

`(pds-fonts)` as written in `snippets/pds-fonts.caddy`. `sites/pds.caddy` imports it after `xrpc-guard`. `dev/pds.caddy` imports it after `blob-deny`. Both imports are inside `route`, before `import upstream`. Inside `route`, Caddy v2.11.9 runs the directives in the order written.

| Line | Effect |
| --- | --- |
| `@pds_font path_regexp ^/_unset/fonts/[A-Za-z0-9-]+\.woff2$` | The only name `file_server` serves |
| `header @pds_font Content-Type font/woff2` | Set before `file_server`, which keeps a Content-Type already set |
| `file_server @pds_font { root /etc/caddy/static }` | GET and HEAD. Another method is 405. A missing file is 404 and stays here |
| `respond /_unset/* 404` | Any other path under `/_unset/` ends in this route, before the upstream |
| `match { header Content-Type text/html* }` | The CSP replace runs when the response Content-Type has that prefix |
| `>Content-Security-Policy "^(.+)$" "$1; font-src https://{$PDS_HOST}/_unset/fonts/"` | Appends that `font-src` to a policy the response already has. `>` applies the replace when the response headers are written |

The licence files copied to `/etc/caddy/static/licenses/` sit outside `/_unset/`, so this snippet does not serve them. The PDS sites import `security-headers` at site level, which sets `X-Content-Type-Options nosniff`. In Caddy's default order that `header` runs before `route`.

Read against Caddy v2.11.9: `caddyconfig/httpcaddyfile/directives.go` (`route` is the ordered group; `header` precedes it in the default order), `modules/caddyhttp/fileserver/staticfiles.go` (GET and HEAD only; `notFound` returns 404 when `pass_thru` is unset; an existing Content-Type is kept), `modules/caddyhttp/headers/caddyfile.go` (`>` sets the replace deferred) and `modules/caddyhttp/headers/headers.go` (`responseWriterWrapper` applies it at `WriteHeader`). `modules/caddyhttp/matchers.go` `matchHeaders` treats a trailing `*` as a prefix. A replace of `^(.+)$` needs one character, so a response with no Content-Security-Policy is left as the upstream wrote it.

`deployment/edge/image-cleanup.ts` exports `removeEveryTag` for the image tests. It imports nothing.

`deployment/edge/adapted.ts` compares JSON Caddy adapted with an env's values to the reviewed JSON for that env (P1.39a; [ADR 0046](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0046-edge-checks-read-caddy-adapt.md), Proposed). It imports nothing, and it does not run Caddy. Its header says `caddy adapt --adapter caddyfile` turns the Caddyfile, its snippets and the enabled sites into the JSON config Caddy runs, and that `adapted/<env>.generated.json` holds that output for each env, adapted with `SENTINELS`, and is reviewed as trusted base. Those values are `PDS_HOST` `pds-host.invalid`, `PDS_UPSTREAM` `pds-upstream.invalid:1`, `ACME_EMAIL` `acme-email@sentinel.invalid`, `APP_HOST` `app-host.invalid` and `APP_UPSTREAM` `app-upstream.invalid:2`. `ADAPTED_ENVS` is `prod`, `dev` and `local`. `reviewedDifference` returns null when the adapted JSON equals the reviewed one after each sentinel the env sets is replaced, and after two orders Caddy derives from the host names are fixed: a server's site routes, sorted by each route's canonical JSON, and the names in a connection policy's SNI matcher. A server's routes are reordered only when every one is a terminal host route; a route that is not keeps its place. Any other difference returns `the edge config Caddy adapts is not the reviewed one`. That message carries none of the env's values. The function reads no file and runs no process.

The reviewed files are `deployment/edge/adapted/prod.generated.json`, `deployment/edge/adapted/dev.generated.json` and `deployment/edge/adapted/local.generated.json`. `deployment/edge/adapted.test.ts` requires that directory to hold exactly those three names, requires each reviewed file to equal itself and to equal the same JSON with the sentinels replaced by real values, and requires every other change it tries to return that message. `deployment/edge/adapted.image.test.ts` builds `deployment/edge/Dockerfile` twice. The first test proves the built image holds the repository's config under `/etc/caddy` byte for byte (`Caddyfile`, `sites/pds.caddy` and every snippet, via `ls`, `stat -c %s` and one `cat`), and then adapts: the second build runs `caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile` in that image once per env, with `--read-only`, `--network none`, the sentinel environment and that env's read-only binds. Prod binds `sites/pds.caddy` at `sites/enabled/pds.caddy`. Dev binds `dev/app.caddy` and `dev/pds.caddy` under `sites/enabled/` and `dev/tls.caddy` over `snippets/tls.caddy`. Local binds `sites/pds.caddy` and `local/app.caddy` under `sites/enabled/` and `local/tls.caddy` over `snippets/tls.caddy`. The adapt fails unless the image's JSON equals the reviewed file.

`deployment/edge/adapted-rules.ts` (P1.39b; [ADR 0046](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0046-edge-checks-read-caddy-adapt.md) decision 3) judges that JSON. It imports nothing. `adaptedProblems` returns why the JSON breaks a rule. Its header says every module, matcher and key it does not name fails, that it reads no file and runs no process, and that nothing but `deployment/edge/adapted-rules.test.ts` reads it until P1.39c.

## May import

No `MATRIX` row has `from` under `deployment/edge/`. `image-cleanup.ts`, `adapted.ts` and `adapted-rules.ts` have no import. An import from this folder would fail as `not-in-allowed`.

`edge-not-preflight` (`scripts/lint/.dependency-cruiser.cjs`): no file under `deployment/edge/`, tests included, imports `deployment/preflight/`.

The preflight row may reach `deployment/edge/adapted.ts` and `deployment/edge/adapted-rules.ts`, and no other file under `deployment/edge/`. Tests are the tooling row. The full table is on [deployment](../).

## Entry points

The image entrypoint is the Dockerfile `ENTRYPOINT` above. Compose starts the service `edge`. Dev uses the lock ref. Local builds this Dockerfile. See [compose](../compose/).

The `edge` job in `.github/workflows/images.yml` lints, builds and scans `deployment/edge/Dockerfile`. `discover` lists Dockerfiles under `deployment/` through `scripts/ci/list-dockerfiles.ts`.

There is no `main.ts`.

## Data

`deployment/edge/limits.json`:

| Key | Value |
| --- | --- |
| `EDGE_UPSTREAM_TIMEOUT_S` | `130` |

`rateLimitZones`:

| Zone | `events` | `window` |
| --- | --- | --- |
| `session` | 30 | 5m |
| `session_day` | 300 | 24h |
| `oauth_signin` | 30 | 5m |
| `oauth_token` | 120 | 5m |
| `signup` | 10 | 1h |
| `reset` | 5 | 1h |
| `sync` | 1500 | 5m |
| `blob_read` | 600 | 5m |
| `blob_upload` | 60 | 5m |
| `firehose` | 6 | 1m |
| `firehose_hour` | 60 | 1h |
| `identity` | 300 | 5m |
| `global` | 3000 | 5m |

`appRateLimitZones`:

| Zone | `events` | `window` |
| --- | --- | --- |
| `app_signin` | 5 | 5m |
| `app_burst` | 60 | 10s |
| `app_files` | 120 | 10s |
| `app_global` | 1200 | 5m |

No schema, role or table. Certificate and key files are Compose secrets named on [compose](../compose/). They are not in this folder.
