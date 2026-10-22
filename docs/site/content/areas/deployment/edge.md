---
title: Edge
weight: 2
---

The Caddy process in front of the public hosts. The image is `deployment/edge/Dockerfile`. The config is `deployment/edge/Caddyfile` plus the snippets and the site files each stack mounts. [ADR 0018](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0018-edge-rate-limit-plugin.md) is the rate-limit plugin. [ADR 0030](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0030-pangolin-checks-at-our-edge.md), [ADR 0031](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0031-public-staging-pds.md) and [ADR 0032](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0032-self-signed-dev-edge.md) are the dev path in front of it. [ADR 0025](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0025-public-domains.md) is the domain record.

## Owns

`deployment/edge/Dockerfile` builds Caddy v2.11.7 with one plugin, `github.com/mholt/caddy-ratelimit` at `v0.1.1-0.20260612195517-5625512f24f6`, using `xcaddy build` on `docker.io/library/caddy:2.11.7-builder-alpine`, then copies the binary onto `docker.io/library/caddy:2.11.7-alpine`. Both bases are digest-pinned in `deployment/images/bases.lock.json`. The runtime stage sets `cap_net_bind_service` on `/usr/bin/caddy`, removes the package manager, and runs as `65532:65532`. `ENTRYPOINT` is `caddy run --config /etc/caddy/Caddyfile --adapter caddyfile`. `HEALTHCHECK` fetches `http://127.0.0.1:8081/health`. The image label licence is `AGPL-3.0-only AND Apache-2.0 AND OFL-1.1`. The product licence record is [ADR 0012](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0012-licence.md).

The runtime stage copies `deployment/edge/fonts/SpaceGrotesk-Variable.woff2` and `deployment/edge/fonts/JetBrainsMono-Variable.woff2` to `/etc/caddy/static/_unset/fonts/`, and `fonts/OFL-SpaceGrotesk.txt` and `fonts/OFL-JetBrainsMono.txt` to `/etc/caddy/static/licenses/`. `deployment/edge/edge.test.ts` (`pds_fonts_match_shared_ui`) requires those four files to equal `shared/ui/fonts/` byte for byte. [ADR 0027](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0027-pds-frontend-distribution.md) is the PDS frontend record the font snippet names.

`deployment/edge/final-stage-runs.json` lists the two `RUN` exec forms the runtime stage is allowed: `chown` and `chmod` of `/data` and `/config` to `65532:65532`, mode `u=rwX,go=`.

`deployment/edge/Caddyfile`, as checked in:

| Block | What it sets |
| --- | --- |
| global | `admin off`, `persist_config off` |
| `log default` | stderr, level `ERROR`, and the address, URI, header and TLS fields in the `fields` list deleted |
| `servers 10.250.37.3:443` | `trusted_proxies static 10.250.37.2/32`, `trusted_proxies_strict`, `client_ip_headers X-Forwarded-For` |
| `servers` | no `trusted_proxies`; `read_body 30s`, `write 135s`, `idle 2m` |
| `http://127.0.0.1:8081` | `bind 127.0.0.1`, `respond /health 200`, `respond 404` |
| imports | `snippets/*.caddy`, then `sites/enabled/*.caddy` |

`deployment/edge/caddyfile.ts` is the reader the edge tests and preflight C18 share. It imports nothing. Its header says it fails on syntax our files do not use, and that dev and local modes exist so C18 reads the files those stacks mount. `edgeSiteProblems` checks `(pds-fonts)` with `fontSnippetProblems` and `fontProblems`. The snippet must equal `PDS_FONTS`. The `{$PDS_HOST}` site's one plain `route` must import it once, before `reverse_proxy`. A site on another host that imports it fails. Outside that snippet, `file_server`, a `match` block inside `header`, and a Content-Security-Policy field other than the one `(strict-csp)` sets are rejected. `{$PDS_HOST}` is accepted inside a directive only as `FONT_SRC` on that replace (`isFontSrc`, `PLACEHOLDER_POSITIONS`). The route and snippet allowlists include `file_server`. A `match` block inside `header` is the `header_match` level, and the only name it allows is `header`.

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

`(pds-fonts)` as written in `snippets/pds-fonts.caddy`. `sites/pds.caddy` imports it after `xrpc-guard`. `dev/pds.caddy` imports it after `blob-deny`. Both imports are inside `route`, before `import upstream`. Inside `route`, Caddy v2.11.7 runs the directives in the order written.

| Line | Effect |
| --- | --- |
| `@pds_font path_regexp ^/_unset/fonts/[A-Za-z0-9-]+\.woff2$` | The only name `file_server` serves |
| `header @pds_font Content-Type font/woff2` | Set before `file_server`, which keeps a Content-Type already set |
| `file_server @pds_font { root /etc/caddy/static }` | GET and HEAD. Another method is 405. A missing file is 404 and stays here |
| `respond /_unset/* 404` | Any other path under `/_unset/` ends in this route, before the upstream |
| `match { header Content-Type text/html* }` | The CSP replace runs when the response Content-Type has that prefix |
| `>Content-Security-Policy "^(.+)$" "$1; font-src https://{$PDS_HOST}/_unset/fonts/"` | Appends that `font-src` to a policy the response already has. `>` applies the replace when the response headers are written |

The licence files copied to `/etc/caddy/static/licenses/` sit outside `/_unset/`, so this snippet does not serve them. The PDS sites import `security-headers` at site level, which sets `X-Content-Type-Options nosniff`. In Caddy's default order that `header` runs before `route`.

Read against Caddy v2.11.7: `caddyconfig/httpcaddyfile/directives.go` (`route` is the ordered group; `header` precedes it in the default order), `modules/caddyhttp/fileserver/staticfiles.go` (GET and HEAD only; `notFound` returns 404 when `pass_thru` is unset; an existing Content-Type is kept), `modules/caddyhttp/headers/caddyfile.go` (`>` sets the replace deferred) and `modules/caddyhttp/headers/headers.go` (`responseWriterWrapper` applies it at `WriteHeader`). `modules/caddyhttp/matchers.go` `matchHeaders` treats a trailing `*` as a prefix. A replace of `^(.+)$` needs one character, so a response with no Content-Security-Policy is left as the upstream wrote it.

`deployment/edge/image-cleanup.ts` exports `removeEveryTag` for the image tests. It imports nothing.

## May import

No `MATRIX` row has `from` under `deployment/edge/`. `caddyfile.ts` and `image-cleanup.ts` have no import. An import from this folder would fail as `not-in-allowed`.

`edge-not-preflight` (`scripts/lint/.dependency-cruiser.cjs`): no file under `deployment/edge/`, tests included, imports `deployment/preflight/`.

The preflight row may reach `deployment/edge/caddyfile.ts` and no other file under `deployment/edge/`. Tests are the tooling row. The full table is on [deployment](../).

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
| `app_burst` | 20 | 10s |
| `app_global` | 1200 | 5m |

No schema, role or table. Certificate and key files are Compose secrets named on [compose](../compose/). They are not in this folder.
