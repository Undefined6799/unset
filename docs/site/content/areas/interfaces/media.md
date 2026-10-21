---
title: media
weight: 5
---

The media proxy. Package `@unset/interfaces-media`. `UNSET_SERVICE` is `media`.

Route table: [Endpoints](/endpoints/).

## Owns

The process entry for the media proxy. `interfaces/media/main.ts` reads config, composes and listens. `interfaces/media/compose.ts` builds a logger and `createServer` with `routes: []`. The kit adds `GET /health` (`shared/http/server.ts`). The comment in `compose.ts` says later steps add adapters here. This folder does not fetch a blob and does not call net-guard.

`interfaces/media/limits.ts` defines one policy, `default`. No route in this process names it. Health is `rateLimit: exempt` in `interfaces/media/routes.manifest.json`.

## May import

The [`interface` row](../). No extra render row. `no-interface-to-interface` applies.

Declared in `interfaces/media/package.json`: `@unset/shared-config`, `@unset/shared-http`, `@unset/shared-log`, all workspace.

## Entry points

| Role | Path |
| --- | --- |
| Process | `interfaces/media/main.ts` |
| Composition root | `interfaces/media/compose.ts` |
| Config | `interfaces/media/config.ts` (`httpKitConfig` only) |
| Policies | `interfaces/media/limits.ts` |
| Manifest | `interfaces/media/routes.manifest.json` |

No Dockerfile `ENTRYPOINT` and no Compose service names this process. `npm run dev:up` starts service `web` only. Compose service `web` sets `MEDIA_ORIGIN` (`deployment/compose.dev.yaml`). That variable is the http process's config, not a media process.

## Data

`compose.ts` does not open a pool.

Role `media` in `infrastructure/postgres/roles.json`: class `service`, login, `connectionLimit` 10, `statement_timeout` `2s`, `passwordFrom` null. `infrastructure/postgres/roles.ts` skips password sync when `passwordFrom` is null.

Grants in `infrastructure/postgres/grant-matrix.json`: `CONNECT` on the database. No schema `USAGE` and no table privilege.
