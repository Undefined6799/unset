---
title: audit
weight: 1
---

The TypeScript side of the append-only audit store. Package `@unset/infrastructure-audit`. The SQL is in `infrastructure/postgres/migrations/0008_audit.sql`, `0009_audit_tables.sql`, `0010_audit_append_grant.sql`, `0016_audit_actor.sql`, `0017_audit_retention.sql` and `0018_audit_retention_functions.sql`.

## Owns

Closed lists, the one write function, the row hash, the chain walk and the segment checks.

| Module | What it holds |
| --- | --- |
| `infrastructure/audit/actions.ts` | `AUDIT_ACTIONS` (action to lane `mod` or `sec`), `AUDIT_REASONS`, `AUDIT_OUTCOMES`. The file says the lists mirror the seeds in `0009_audit_tables.sql`. |
| `infrastructure/audit/append.ts` | `appendAudit`. Checks the event, then `SELECT ... FROM audit.append($1, ...)`. |
| `infrastructure/audit/db.ts` | `AuditDb`: one `query` method. A caller-held client satisfies it. |
| `infrastructure/audit/rowHash.ts` | `rowHash` and `toMicros`. The file says the bytes match `audit.row_hash` in `0008_audit.sql`. |
| `infrastructure/audit/verify.ts` | `verifyChain`. `links` reads `audit.chain`. `full` also reads `audit.event_body`. |
| `infrastructure/audit/segments.ts` | `chainStart`, `verifySegments`, `SegmentVerdict`. Both functions read `audit.segment` and `audit.chain`. |
| `infrastructure/audit/error.ts` | `AuditError`. Codes `audit.bad_input` and `audit.bad_timestamp`. |

`appendAudit` is called from `interfaces/web/src/lib/server/age-gate-audit.ts`, on the transaction the account repository (`infrastructure/postgres/accountRepository.ts`) hands it. This package opens no pool.

## May import

The [`infrastructure` row](../). This package reaches neither `net-guard` nor `seal` nor `postgres`.

Declared in `infrastructure/audit/package.json`: `@unset/domains-identity`, workspace. `append.ts` imports `parseDid` from `@unset/domains-identity/syntax`.

## Entry points

| Role | Path |
| --- | --- |
| Package export `.` | `infrastructure/audit/index.ts` |
| Write | `appendAudit` |
| Check | `verifyChain` |
| Segments | `chainStart`, `verifySegments`, `SegmentVerdict`, exported from `infrastructure/audit/index.ts` |

No `main.ts`, no CLI, no Compose service.

## Data

Statements name `audit.append`, `audit.chain`, `audit.event_body` and `audit.segment`. The caller supplies the client.

Objects created for this store:

| Object | Migration |
| --- | --- |
| `audit.lp`, `audit.row_hash`, `audit.append`, `audit.refuse_change` | `0008_audit.sql` |
| `audit.retention_classes`, `audit.actions`, `audit.reasons`, `audit.chain`, `audit.event_body` | `0009_audit_tables.sql` |
| `audit.segment`, `audit.redaction_log` | `0017_audit_retention.sql` |
| `audit.redact`, `audit.erase_subject`, `audit.seal_segment`, `audit.mark_anchored`, `audit.drop_segment`, `audit.segment_transition` | `0018_audit_retention_functions.sql` |

`0008_audit.sql` runs `SET ROLE audit_owner` before the functions. `0009_audit_tables.sql` and `0017_audit_retention.sql` create their tables as `audit_owner`.

`audit.segment` is one segment per lane and calendar month (UTC), numbered YYYYMM. `prev_hash` is the hash before `first_seq` and `head_hash` the `row_hash` of `last_seq`. No personal data.

`audit.redaction_log` is why a body row is missing: the lane, the seq, the part (`redact`, `erase` or `drop`) and the login role. It keeps the month only, never the instant. No personal data.

`0018_audit_retention_functions.sql` runs `SET ROLE audit_owner` and replaces `audit.refuse_change`. A `DELETE` passes only when `current_user` is `audit_owner` and `current_setting('audit.maintenance', true)` is `body` or `segment` on `audit.event_body`, or `segment` on `audit.chain`. `UPDATE` and `TRUNCATE` still raise `audit is append-only` (`UA005`). The file adds triggers `segment_append_only`, `segment_transitions` and `redaction_log_append_only`. `audit.segment_transition` lets an `UPDATE` of `audit.segment` set `anchored_at` or `dropped_at` once, and refuses any other change.

No role is granted the five `SECURITY DEFINER` functions. They are what can write `audit.segment` and `audit.redaction_log`. The file contains no `GRANT`. `infrastructure/postgres/grant-matrix.json` has no entry for them, or for `audit.segment_transition`. `0008_audit.sql` runs `ALTER DEFAULT PRIVILEGES FOR ROLE audit_owner REVOKE EXECUTE ON ROUTINES FROM PUBLIC` before creating audit functions. `tests/integration/audit/retention.test.ts` (`functions_only_through_owner`) expects `42501` for `retention`, `auditor`, `web`, `admin` and `indexer`. Calls in that file that succeed run after `SET ROLE audit_owner`.

| Function | What it writes |
| --- | --- |
| `audit.redact` | Deletes one `audit.event_body` row whose class is counted from the event and has run out, then inserts `audit.redaction_log` with `part` `redact`. A row that has not run out raises `audit_retention_active` (`UA006`). |
| `audit.erase_subject` | Deletes `audit.event_body` rows on lane `sec` whose `subject` or `actor` is the DID, and inserts `audit.redaction_log` with `part` `erase`. Lane `mod` is not named. |
| `audit.seal_segment` | Inserts one `audit.segment` row. |
| `audit.mark_anchored` | Sets `audit.segment.anchored_at` when the stored `head_hash` matches. |
| `audit.drop_segment` | Deletes that segment's `audit.event_body` and `audit.chain` rows, inserts `audit.redaction_log` with `part` `drop`, and sets `dropped_at`, only when the segment is the oldest not yet dropped, `anchored_at` is set, `max_class_expiry` is past, and a later chain row exists. |

Grants recorded in `infrastructure/postgres/grant-matrix.json`:

| Object | Grant |
| --- | --- |
| `audit.append` | `EXECUTE` for `web`, `indexer`, `admin` |
| `audit.chain` | `SELECT` for `auditor`, `wholeTable: true` |
| `audit.segment` | `SELECT` for `auditor`, `wholeTable: true` |
| `audit.redaction_log` | `SELECT` for `auditor`, `wholeTable: true` |

`grant-matrix.json` has no `audit.event_body` entry. `0010_audit_append_grant.sql` grants `EXECUTE` on `audit.append` to `web`, `indexer` and `admin`. Schema `USAGE` on `audit` is on the [postgres](../postgres/) page.

`infrastructure/postgres/erasure-registry.json` has `audit.event_body.subject` and `audit.event_body.actor`, both with strategy `audit_redact`. `0016_audit_actor.sql` adds the `actor` column and replaces `audit.append` to fill it (ADR 0043).
