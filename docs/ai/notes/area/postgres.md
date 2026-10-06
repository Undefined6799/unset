---
id: postgres
type: area
status: current
areas: ["[[postgres]]"]
summary: "Hub for infrastructure/postgres: migrations, roles, grants, pool, transactions, single-use store, advisory lock."
code: [infrastructure/postgres/index.ts]
sources: []
importance: normal
related: ["[[tests]]", "[[deployment]]", "[[postgres-tests-need-docker]]"]
replaced_by: null
tags: [area, postgres]
checked: 2026-10-06
---
# postgres

**What it owns.** The database behind small contracts. Driver: node-postgres 8.23.0, pinned exactly (ADR 0014).

**Files.**
- `migrations/`: numbered SQL files; `migrate.ts` applies them once, in order, as `migrator`, under an advisory lock,
  with checksums. The runner refuses gaps. `sqlLint.ts` refuses unsafe constructs.
- `roles.json`: every process role with its limits and timeouts; `roles.ts` syncs passwords as SCRAM verifiers.
- `grant-matrix.json`: every grant, checked against the live catalog by `tests/integration/postgres/grants.test.ts`.
- `erasure-registry.json` and `didColumns.ts`: every DID-bearing column, found from the catalog.
- `pool.ts`: the only place a pooled client is taken. `tx.ts`: the only place a transaction opens.
- `singleUse/store.ts`: the single-use token store (P1.16, migration 0006). Consuming a token is one UPDATE whose row
  lock lets exactly one caller through; only a SHA-256 of the token is stored, and the retention role sweeps expired rows.
- `lock.ts`: the per-key advisory lock (P1.17) on its own small pool (`LOCK_POOL_MAX`). A transaction-level lock in the
  two-int4 key space (`LockNamespace`, `hashtext(key)`), apart from the migration runner's bigint lock. The wait raises
  the role's 2 s `statement_timeout` for itself, or Postgres cancels it first with 57014. Never log the key: it is
  usually a DID. A new use adds a `LockNamespace` line with a new number.

**Rules worth knowing.**
- Each process connects as its own role (web, api, indexer, retention and others), never as a superuser.
- SQL is parameterised only and carries a tenant or DID predicate.
- No network I/O inside a transaction (DA-4).
- Most of this folder is trusted base (CODEOWNERS); check before mixing it with other files in a PR.

**Links.** [[tests]], [[deployment]].
