---
title: review
weight: 6
---

The upload review service. Package `@unset/interfaces-review`. `UNSET_SERVICE` is `review`.

Route table: [Endpoints](/endpoints/).

## Owns

A health-only server until its checks land. That sentence is the comment in `interfaces/review/main.ts`, `compose.ts` and `config.ts`. `compose.ts` builds a logger and `createServer` with `routes: []` and `policies: {}`. There is no `limits.ts`. The kit adds `GET /health` (`shared/http/server.ts`).

This folder does not parse an upload and does not open a network client. A split into no-network compute and a review-egress process is not two folders on the tree **(planned)**.

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

Both rows are class `service` and login, in `infrastructure/postgres/roles.json`. `passwordFrom` null means `infrastructure/postgres/roles.ts` does not sync a password. There is no `interfaces/review-egress/` folder **(planned)**. `migrations/0010_audit_append_grant.sql` says `review` and `review_egress` get `EXECUTE` on `audit.append` with their phase. That grant is not in the file.
