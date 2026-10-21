---
title: Trust boundaries
weight: 4
---

## Edge

The edge is Caddy (`deployment/edge/Caddyfile`, `deployment/edge/snippets/upstream.caddy`). [ADR 0018](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0018-edge-rate-limit-plugin.md) is the in-memory rate-limit plugin. [ADR 0030](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0030-pangolin-checks-at-our-edge.md) and [ADR 0032](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0032-self-signed-dev-edge.md) are the dev edge.

| Fact | Where |
| --- | --- |
| Dev publishes no host port. Newt (`10.250.37.2`) and the edge (`10.250.37.3`) share internal network `newt_edge`. | `deployment/compose.dev.yaml`, `deployment/networks.dev.json` |
| Listener `10.250.37.3:443` trusts `10.250.37.2/32` only, `trusted_proxies_strict`, and reads `X-Forwarded-For`. The other `servers` block sets no trusted proxy. | `deployment/edge/Caddyfile` |
| Local publishes `127.0.0.1:80` and `127.0.0.1:443` and has no Newt service. | `deployment/compose.local.yaml` |
| Upstream to the app and the PDS drops `X-Forwarded-For`, `X-Real-IP` and `Forwarded`, and sets `X-Forwarded-Proto` to `https`. | `deployment/edge/snippets/upstream.caddy` |
| The default log is ERROR, and the filter deletes address, header and URI fields. Access logs are excluded. | `deployment/edge/Caddyfile` |
| Per-client zones are in memory, keyed on `{client_ip}`. | `deployment/edge/snippets/ratelimit.caddy` |
| Both Compose files set the PDS's own rate limits off (`PDS_RATE_LIMITS_ENABLED=false`). | `deployment/compose.dev.yaml`, `deployment/compose.local.yaml` |

`web` sets `TRUSTED_PROXY_MODE=socket` in both Compose files. In that mode `shared/http/trustedProxy.ts` returns the TCP peer and does not read a forwarding header. A resolver failure returns null.

## One process per container

Each Compose service is one container, on the networks in [Processes](processes.md). `web` is `interfaces/http`. `migrate` exits. The other interface folders are not in either Compose file.

Postgres roles are separate logins. The dev stack's running app uses `web`. `migrator` runs migrations and may `SET ROLE audit_owner` with `INHERIT FALSE` (migration `0003`). Roles with no password file are not given a password by `syncRolePasswords`.

## Egress

`interfaces/http/compose.ts` builds one net-guard and passes it to the OAuth client and the identity network. `infrastructure/net-guard/index.ts` is the egress classifier: a caller-influenced URL is resolved and vetted here, and the connection uses the pinned addresses.

`infrastructure/net-guard/src/request.ts`: each request names a policy, connects only to addresses from `resolveVetted`, does not follow a redirect, and is capped in time and bytes. The log line carries the policy name, status, duration and byte count. It does not carry the host, URL or address.

| Policy | Kind | Allows |
| --- | --- | --- |
| `plc` | fixed | `https://plc.directory` on port 443, public answers |
| `atproto` | public | any host, `https` port 443; a host in `internalHosts` must be a private answer |
| `internalPolicy(...)` | internal | one exact http(s) origin, private answers |
| `localPlc` | internal | `http://plc:2582`, selected only when a composition root under `UNSET_ENV=local` chooses it |

`web`'s route off the internal networks is `web_egress`. The PDS's is `pds_egress`. Dev `web` does not set `NETGUARD_INTERNAL_HOSTS` (default `[]` in `shared/config/netGuard.ts`). Local sets it to the PDS hostname.

## Trusted base (SE-6)

A pull request that touches a path in the `# trusted base (SE-6)` section of `.github/CODEOWNERS` touches only trusted-base files, their tests and docs. A pull request that changes a `# checks:` path touches no product path (`apps/`, `interfaces/`, `domains/`, `infrastructure/`, `shared/`, `deployment/`). `scripts/guards/change-shape.ts` reads that section. The test is `trusted_base_isolated` in `scripts/guards/change-shape.test.ts`.

Paths below are the section as it stands. **(planned)** means the folder is not in the tree; the path is still listed.

| Path | In the tree |
| --- | --- |
| `infrastructure/postgres/migrations/`, `grant-matrix.json`, `erasure-registry.json` | yes (the comment lists them as parsed) |
| `shared/http/` | yes |
| `infrastructure/session/` | yes |
| `interfaces/http/session-cookie.ts` | yes |
| `domains/identity/verify-handle.ts` | yes |
| `infrastructure/net-guard/` | yes |
| `shared/islands/` | yes |
| `shared/ui/safe-href.ts` | yes |
| `infrastructure/seal/` | yes |
| `infrastructure/postgres/roles.json`, `roles.ts` | yes |
| `deployment/postgres/init/`, `deployment/postgres/init-local/` | yes |
| `infrastructure/audit/` | yes |
| `shared/lexicons/` | yes |
| `deployment/edge/` | yes |
| `interfaces/media/headers.ts` | **(planned)** |
| `interfaces/http/jobs/erase-storage.ts`, `interfaces/indexer/erase-untrack.ts` | **(planned)** |
| `shared/admin-envelope/` | **(planned)** |
| `interfaces/pds-admin/`, `interfaces/chat-admin/`, `interfaces/chat-auth/` | **(planned)** |
| `domains/moderation/legal-hold/`, `interfaces/legal-hold-export/` | **(planned)** |
| `deployment/sigstore/` | **(planned)** |

The `# checks:` list in the same section includes `scripts/guards/`, `scripts/lint/`, `scripts/ci/`, `scripts/docs/`, `.github/`, `biome.json` and `.npmrc`. Adding a page under `docs/site/content/` does not touch those paths.
