---
title: api
weight: 3
---

Package `@unset/interfaces-api`. `UNSET_SERVICE` is `api`.

Route table: [Endpoints](/endpoints/).

## Owns

`interfaces/api/main.ts` reads config, composes and listens. `interfaces/api/compose.ts` builds a logger and `createServer`. The routes argument is `[]`. The kit adds `GET /health` (`shared/http/server.ts`). This folder does not call a domain and does not write a table.

`interfaces/api/limits.ts` defines policies `default` and `search`. No route in this process names them. Health is `rateLimit: exempt` in `interfaces/api/routes.manifest.json`.

## May import

The [`interface` row](../). No extra render row. `no-interface-to-interface` applies.

Declared in `interfaces/api/package.json`: `@unset/shared-config`, `@unset/shared-http`, `@unset/shared-log`, all workspace.

## Entry points

| Role | Path |
| --- | --- |
| Process | `interfaces/api/main.ts` |
| Composition root | `interfaces/api/compose.ts` |
| Config | `interfaces/api/config.ts` (`httpKitConfig` only) |
| Policies | `interfaces/api/limits.ts` |
| Manifest | `interfaces/api/routes.manifest.json` |

No Dockerfile `ENTRYPOINT` and no Compose service names this process. `npm run dev:up` starts service `web` only.

## Data

`compose.ts` does not open a pool.

Role `api` in `infrastructure/postgres/roles.json`: class `service`, login, `connectionLimit` 20, `statement_timeout` `2s`, `passwordFrom` `pg_api_password`.

Grants in `infrastructure/postgres/grant-matrix.json`:

| Object | Privilege |
| --- | --- |
| database | `CONNECT` |
| schema `idx`, `types` | `USAGE` |

No table privilege for `api` is in `grant-matrix.json`. No `CREATE TABLE` in schema `idx` is in `infrastructure/postgres/migrations/`.
