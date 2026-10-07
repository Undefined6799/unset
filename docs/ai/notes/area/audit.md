---
id: audit
type: area
status: current
areas: ["[[audit]]"]
summary: "Hub for infrastructure/audit: the TS side of the append-only audit store (appendAudit, rowHash, verifyChain)."
code: [infrastructure/audit/index.ts, infrastructure/audit/rowHash.ts, infrastructure/audit/verify.ts]
sources: []
importance: normal
related: ["[[postgres]]"]
replaced_by: null
tags: [area, audit]
checked: 2026-10-07
---
# audit

**What it owns.** The TS side of the audit store whose SQL lives in `infrastructure/postgres/migrations/0008` to
`0010` (see [[postgres]]):
- the closed lists (`actions.ts`), mirroring the `audit.actions` and `audit.reasons` seeds;
- `appendAudit`, the only TS way in, which re-checks every field before calling `audit.append`;
- `rowHash` (`rowHash.ts`) and `verifyChain` (`verify.ts`).

**Database access.** It reaches Postgres only through `AuditDb` (`db.ts`), one `query` method that a caller-held
pg client satisfies. So the workspace imports neither `pg` nor `infrastructure/postgres`, and the dependency matrix
needs no edge for it. An append runs in the caller's transaction, and any refusal must roll it back.

**Pinned encoding.** `rowHash` and SQL `audit.row_hash` are both checked against
`tests/integration/postgres/audit-row-hash.vector.json`, computed independently with Python. Never regenerate it to
make a test pass. Chain tests against real Postgres are in `tests/integration/audit/chain.test.ts`.

**Pitfalls.**
- **Timestamps are microseconds.** Postgres stores `ts` to the microsecond, and the hash covers all six digits. A JS
  `Date` keeps three, so the verifier reads `(EXTRACT(epoch FROM ts) * 1000000)::bigint` as text. `toMicros` parses
  ISO text to a `bigint`.
- **SQL `RETURN` bodies.** `audit.lp` and `audit.row_hash` are `LANGUAGE sql` with `RETURN` bodies, which Postgres
  resolves at CREATE time. That is why they name no audit table. Functions that touch tables are plpgsql.
- **`SET ROLE audit_owner`.** Audit migrations create objects as `audit_owner` and end with `RESET ROLE`, so the owner
  is never a login role. The triggers refuse UPDATE, DELETE and TRUNCATE even for the owner, and `auditor` reads the
  chain only, never a body row.
- **The owner can still switch the triggers off.** It owns the tables, so `ALTER TABLE ... DISABLE TRIGGER` around an
  edit works; only the chain hash and the body MAC reveal it (`tamper_as_owner_disable_trigger_detected`). The weekly
  verifier logs in as a `NOINHERIT` member (`WITH INHERIT FALSE, SET TRUE`) and must `SET ROLE audit_owner` first;
  without it every audit read is denied (`verifier_without_set_role_is_denied`).

**Links.** [[postgres]].
