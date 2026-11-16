---
title: audit
weight: 1
---

The TypeScript side of the append-only audit store. Package `@unset/infrastructure-audit`. The SQL is in `infrastructure/postgres/migrations/0008_audit.sql`, `0009_audit_tables.sql`, `0010_audit_append_grant.sql`, `0016_audit_actor.sql` and `0017_audit_retention.sql`.

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
| `audit.segment`, `audit.redaction_log` | `0017_audit_retention.sql` |

`0008_audit.sql` runs `SET ROLE audit_owner` before the functions. `0009_audit_tables.sql` and `0017_audit_retention.sql` create their tables as `audit_owner`. Nothing writes `audit.segment` or `audit.redaction_log`.

`audit.segment` is one segment per lane and calendar month (UTC), numbered YYYYMM. `prev_hash` is the hash before `first_seq` and `head_hash` the `row_hash` of `last_seq`. No personal data.

`audit.redaction_log` is why a body row is missing: the lane, the seq, the part (`redact`, `erase` or `drop`) and the login role. It keeps the month only, never the instant. No personal data.

Grants recorded in `infrastructure/postgres/grant-matrix.json`:

| Object | Grant |
| --- | --- |
| `audit.append` | `EXECUTE` for `web`, `indexer`, `admin` |
| `audit.chain` | `SELECT` for `auditor`, `wholeTable: true` |
| `audit.segment` | `SELECT` for `auditor`, `wholeTable: true` |
| `audit.redaction_log` | `SELECT` for `auditor`, `wholeTable: true` |

`grant-matrix.json` has no `audit.event_body` entry. `0010_audit_append_grant.sql` grants `EXECUTE` on `audit.append` to `web`, `indexer` and `admin`. Schema `USAGE` on `audit` is on the [postgres](../postgres/) page.

`infrastructure/postgres/erasure-registry.json` has `audit.event_body.subject` and `audit.event_body.actor`, both with strategy `audit_redact`. `0016_audit_actor.sql` adds the `actor` column and replaces `audit.append` to fill it (ADR 0043).
