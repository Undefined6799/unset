---
title: audit
weight: 1
---

The TypeScript side of the append-only audit store. Package `@unset/infrastructure-audit`. The SQL is in `infrastructure/postgres/migrations/0008_audit.sql` through `0010_audit_append_grant.sql`.

## Owns

Closed lists, the one write function, the row hash and the chain walk.

| Module | What it holds |
| --- | --- |
| `infrastructure/audit/actions.ts` | `AUDIT_ACTIONS` (action to lane `mod` or `sec`), `AUDIT_REASONS`, `AUDIT_OUTCOMES`. The file says the lists mirror the seeds in `0009_audit_tables.sql`. |
| `infrastructure/audit/append.ts` | `appendAudit`. Checks the event, then `SELECT ... FROM audit.append($1, ...)`. |
| `infrastructure/audit/db.ts` | `AuditDb`: one `query` method. A caller-held client satisfies it. |
| `infrastructure/audit/rowHash.ts` | `rowHash` and `toMicros`. The file says the bytes match `audit.row_hash` in `0008_audit.sql`. |
| `infrastructure/audit/verify.ts` | `verifyChain`. `links` reads `audit.chain`. `full` also reads `audit.event_body`. |
| `infrastructure/audit/error.ts` | `AuditError`. Codes `audit.bad_input` and `audit.bad_timestamp`. |

`appendAudit` is called from `interfaces/http/account.ts`. This package opens no pool.

## May import

The [`infrastructure` row](../). This package reaches neither `net-guard` nor `seal` nor `postgres`.

Declared in `infrastructure/audit/package.json`: `@unset/domains-identity`, workspace. `append.ts` imports `parseDid` from `@unset/domains-identity/syntax`.

## Entry points

| Role | Path |
| --- | --- |
| Package export `.` | `infrastructure/audit/index.ts` |
| Write | `appendAudit` |
| Check | `verifyChain` |

No `main.ts`, no CLI, no Compose service.

## Data

Statements name `audit.append`, `audit.chain` and `audit.event_body`. The caller supplies the client.

Objects created for this store:

| Object | Migration |
| --- | --- |
| `audit.lp`, `audit.row_hash`, `audit.append`, `audit.refuse_change` | `0008_audit.sql` |
| `audit.retention_classes`, `audit.actions`, `audit.reasons`, `audit.chain`, `audit.event_body` | `0009_audit_tables.sql` |

`0008_audit.sql` runs `SET ROLE audit_owner` before the functions. `0009_audit_tables.sql` creates the tables as `audit_owner`.

Grants recorded in `infrastructure/postgres/grant-matrix.json`:

| Object | Grant |
| --- | --- |
| `audit.append` | `EXECUTE` for `web`, `indexer`, `admin` |
| `audit.chain` | `SELECT` for `auditor`, `wholeTable: true` |

`grant-matrix.json` has no `audit.event_body` entry. `0010_audit_append_grant.sql` grants `EXECUTE` on `audit.append` to `web`, `indexer` and `admin`. Schema `USAGE` on `audit` is on the [postgres](../postgres/) page.

`infrastructure/postgres/erasure-registry.json` has `audit.event_body.subject` with strategy `audit_redact`.
