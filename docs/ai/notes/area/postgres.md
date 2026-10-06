---
id: postgres
type: area
status: current
areas: ["[[postgres]]"]
summary: "Hub for infrastructure/postgres: migrations, roles and grants, the pool and transactions."
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

**Rules worth knowing.**
- Each process connects as its own role (web, api, indexer, retention and others), never as a superuser.
- SQL is parameterised only and carries a tenant or DID predicate.
- No network I/O inside a transaction (DA-4).
- Most of this folder is trusted base (CODEOWNERS); check before mixing it with other files in a PR.

**Links.** [[tests]], [[deployment]].
