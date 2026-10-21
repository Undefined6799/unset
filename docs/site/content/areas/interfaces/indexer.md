---
title: indexer
weight: 4
---

The indexer. Package `@unset/interfaces-indexer`. `UNSET_SERVICE` is `indexer`.

Route table: [Endpoints](/endpoints/).

## Owns

A health-only server. `compose.ts` builds a logger and `createServer` with `routes: []` and `policies: {}`. There is no `limits.ts`. The kit adds `GET /health` (`shared/http/server.ts`). No Tap client is imported.

## May import

The [`interface` row](../). No extra render row. `no-interface-to-interface` applies. No Tap SDK is in `SDK_ADAPTERS`.

Declared in `interfaces/indexer/package.json`: `@unset/shared-config`, `@unset/shared-http`, `@unset/shared-log`, all workspace.

## Entry points

| Role | Path |
| --- | --- |
| Process | `interfaces/indexer/main.ts` |
| Composition root | `interfaces/indexer/compose.ts` |
| Config | `interfaces/indexer/config.ts` (`httpKitConfig` only) |
| Manifest | `interfaces/indexer/routes.manifest.json` |

No Dockerfile `ENTRYPOINT` and no Compose service names this process. `npm run dev:up` starts service `web` only.

## Data

`compose.ts` does not open a pool.

Role `indexer` in `infrastructure/postgres/roles.json`: class `service`, login, `connectionLimit` 10, `statement_timeout` `10s`, `passwordFrom` `pg_indexer_password`. `grantsBy` includes "each idx table's step". No idx table exists yet.

Grants in `infrastructure/postgres/grant-matrix.json`:

| Object | Privilege |
| --- | --- |
| database | `CONNECT` |
| schema `audit`, `idx`, `types` | `USAGE` |
| `audit.append` | `EXECUTE` |

No table privilege for `indexer` is in `grant-matrix.json`. `migrations/0010_audit_append_grant.sql` grants `EXECUTE` on `audit.append` to `web`, `indexer` and `admin`.
