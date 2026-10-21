---
title: review
weight: 6
---

Package `@unset/interfaces-review`. `UNSET_SERVICE` is `review`.

Route table: [Endpoints](/endpoints/).

## Owns

A health-only server. `compose.ts` builds a logger and `createServer` with `routes: []` and `policies: {}`. There is no `limits.ts`. The kit adds `GET /health` (`shared/http/server.ts`). This folder does not parse an upload and does not open a network client.

## May import

The [`interface` row](../). No extra render row. `no-interface-to-interface` applies.

Declared in `interfaces/review/package.json`: `@unset/shared-config`, `@unset/shared-http`, `@unset/shared-log`, all workspace.

## Entry points

| Role | Path |
| --- | --- |
| Process | `interfaces/review/main.ts` |
| Composition root | `interfaces/review/compose.ts` |
| Config | `interfaces/review/config.ts` (`httpKitConfig` only) |
| Manifest | `interfaces/review/routes.manifest.json` |

No Dockerfile `ENTRYPOINT` and no Compose service names this process. `npm run dev:up` starts service `web` only.

## Data

`compose.ts` does not open a pool.

| Role | `connectionLimit` | `statement_timeout` | `passwordFrom` | Grants in `grant-matrix.json` |
| --- | --- | --- | --- | --- |
| `review` | 4 | `10s` | null | `CONNECT` only |
| `review_egress` | 2 | `5s` | null | `CONNECT` only |

Both rows are class `service` and login, in `infrastructure/postgres/roles.json`. `passwordFrom` null means `infrastructure/postgres/roles.ts` does not sync a password. `migrations/0010_audit_append_grant.sql` grants `EXECUTE` on `audit.append` to `web`, `indexer` and `admin`. It does not grant `review` or `review_egress`.
