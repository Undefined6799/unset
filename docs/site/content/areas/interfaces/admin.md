---
title: admin
weight: 2
---

The admin server. Package `@unset/interfaces-admin`. `UNSET_SERVICE` is `admin`.

Route table: [Endpoints](/endpoints/).

## Owns

The admin server is health-only and not deployed yet. Tailscale-only with socket mode is planned (guideline §1; `shared/http/trustedProxy.ts` reads the socket when there is no edge).

`interfaces/admin/main.ts` reads config, composes and listens. `interfaces/admin/compose.ts` builds a logger and `createServer` from `@unset/shared-http`. The routes argument is `[]`. The kit adds `GET /health` (`shared/http/server.ts`). The comment in `compose.ts` says later steps add adapters here. `interfaces/admin/config.ts` adds no proxy key. No Compose service sets `UNSET_SERVICE: admin`. The manifest test passes `TRUSTED_PROXY_MODE: socket` so the kit config loads (`interfaces/admin/routes.manifest.test.ts`). That is not a deployed listener.

Compose service `web` (`UNSET_SERVICE: http`) sets `TRUSTED_PROXY_MODE: socket` in `deployment/compose.dev.yaml` and `deployment/compose.local.yaml`. That socket mode is the web service's, from [ADR 0031](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0031-public-staging-pds.md#L67).

`interfaces/admin/limits.ts` defines one policy, `default`. No route in this process names it. Health is `rateLimit: exempt` in `interfaces/admin/routes.manifest.json`.

`apps/admin` is not on the tree **(planned)**. This process does not import an app.

## May import

The [`interface` row](../), plus `interface-admin-render`: the file `apps/admin/render.tsx` only. That file is not on the tree **(planned)**. `no-interface-to-interface` still applies.

Declared in `interfaces/admin/package.json`: `@unset/shared-config`, `@unset/shared-http`, `@unset/shared-log`, all workspace.

## Entry points

| Role | Path |
| --- | --- |
| Process | `interfaces/admin/main.ts` |
| Composition root | `interfaces/admin/compose.ts` |
| Config | `interfaces/admin/config.ts` (`httpKitConfig` only) |
| Policies | `interfaces/admin/limits.ts` |
| Manifest | `interfaces/admin/routes.manifest.json` |

No Dockerfile `ENTRYPOINT` and no Compose service names this process. `npm run dev:up` starts service `web` only.

## Data

`compose.ts` does not open a pool.

Role `admin` in `infrastructure/postgres/roles.json`: class `service`, login, `connectionLimit` 10, `statement_timeout` `5s`, `passwordFrom` null. `infrastructure/postgres/roles.ts` skips password sync when `passwordFrom` is null.

Grants in `infrastructure/postgres/grant-matrix.json`:

| Object | Privilege |
| --- | --- |
| database | `CONNECT` |
| schema `app`, `audit`, `idx`, `types` | `USAGE` |
| `audit.append` | `EXECUTE` |

No table privilege for `admin` is in `grant-matrix.json`. `migrations/0010_audit_append_grant.sql` grants `EXECUTE` on `audit.append` to `web`, `indexer` and `admin`.
