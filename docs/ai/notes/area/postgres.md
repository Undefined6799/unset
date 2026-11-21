---
id: postgres
type: area
status: current
areas: ["[[postgres]]"]
summary: "Hub for infrastructure/postgres: migrations, roles, grants, pool, transactions, single-use, locks, sealed columns."
code: [infrastructure/postgres/index.ts]
sources: []
importance: normal
related: ["[[tests]]", "[[deployment]]", "[[postgres-tests-need-docker]]", "[[seal]]"]
replaced_by: null
tags: [area, postgres]
checked: 2026-11-16
---
# postgres

**What it owns.** The database behind small contracts. Driver: node-postgres (`pg`) 8.23.1, pinned exactly (ADR 0014 chose the driver at 8.23.0).

**Files.**
- `migrations/`: numbered SQL files; `migrate.ts` applies them once, in order, as `migrator`, under an advisory lock,
  with checksums. The runner refuses gaps. `sqlLint.ts` refuses unsafe constructs.
- `roles.json`: every process role with its limits and timeouts; `roles.ts` syncs passwords as SCRAM verifiers.
  `unset-migrate` (`migrate-cli.ts`, the migrate image from P1.29k) runs `migrateThenSyncPasswords`: migrations first, then
  each roster role's password from its file under the fixed `/run/secrets`; no password changes when a migration fails.
- `grant-matrix.json`: every grant, checked against the live catalog by `tests/integration/postgres/grants.test.ts`.
- `erasure-registry.json` and `didColumns.ts`: every DID-bearing column, found from the catalog.
- `pool.ts`: the only place a pooled client is taken. `Pool` is the driver's `pg.Pool`; a pooled session runs with
  its role's own timeouts from `roles.json` (migration 0003), and the pool sends only `application_name`, so no
  caller holds a copy of them (P1.11a). `readUntilAbort` ends a client whose query outlives its signal, and `ping`
  is the readiness probe built on it (P1.04x). `tx.ts`: the only place a transaction opens.
- `singleUse/store.ts`: the single-use token store (P1.16, migration 0006). Consuming a token is one UPDATE whose row
  lock lets exactly one caller through; only a SHA-256 of the token is stored, and `app.sweep_single_use()`
  (P1.16w, migration 0023; EXECUTE for `web` and `retention`) removes rows a day past expiry; web runs it hourly.
- `migrations/0021_erase_audit_grants.sql`, `0022_erase_did.sql` (P3.07g, P3.07k, brought forward 2026-11-15):
  `core.erase_did(did, why)` deletes every row naming a DID, one hand-written statement per erasure-registry row, calls
  `audit.erase_subject` and appends `account.erased` with no DID. No role is granted it; an owner runs it as migrator
  (`docs/human/runbooks/erasure.md`). Tombstone, outbox, holds and callers' grants stay with P3.07, P4.07h, P3.20a,
  P5.08b. `tests/integration/postgres/erase-did.test.ts` reads `didColumns` and fails on an unseeded or surviving column.
- `migrations/0015_app_account.sql`: `app.account` (P2.12). The birth date is not a column; an adult confirmation
  stores `age_confirmed_at` only. Column-list grants for `web`, and `app.account.did` is in the erasure registry.
- `migrations/0016_audit_actor.sql`: `audit.event_body.actor` (P1.15k, ADR 0043) and `audit.append` replaced to
  fill it; the column is in the erasure registry. See [[audit]].
- `accountRepository.ts`: `app.account` behind identity's `AccountRepository` contract (P2.12g; it
  began in the deleted Hono server's `account.ts`). The under-age block's audit row is written by a function the composition root
  passes in, on the block's transaction, because this folder may not import `infrastructure/audit`.
- `oauthStores.ts`: the OAuth client's state and token-set stores (P2.04, migration 0013), each value sealed with
  its own row's context; a value that does not open is deleted and reads as missing (`oauth.unseal_failed`). The
  delete names the ciphertext it read, so a value another replica stored meanwhile stays. Expired states leave
  through the state store's `sweep()`, run hourly beside the session sweep, never on a login write.
- `lock.ts`: the per-key advisory lock (P1.17) on its own small pool (`LOCK_POOL_MAX`). A transaction-level lock in the
  two-int4 key space (`LockNamespace`, `hashtext(key)`), apart from the migration runner's bigint lock. The wait raises
  the role's 2 s `statement_timeout` for itself, or Postgres cancels it first with 57014. Never log the key: it is
  usually a DID. A new use adds a `LockNamespace` line with a new number.
- `sealed-columns.json` and `sealedColumns.ts`: every `types.sealed` column (migration 0007) with the row key its
  seal context binds ([[seal]]); `sealedContext` is the only way to get a context for a stored value, and only this package uses it
  (not exported from the index since the P0.05 cleanup). `rewrapAll.ts` and
  `unset-rewrap` move stored values to a new seal key; `--check <kid>` says when the old key may go (P1.14d).
- The browser session store is not here: it is its own trusted workspace, `infrastructure/session/` (P2.03),
  like `infrastructure/audit/`. It never imports this folder; each interface passes it a `withDb` built from
  `withClient`. Only a SHA-256 of the session id is stored; its real-Postgres tests are `tests/integration/session/`.
  A session lasts only while its DID has a row in `app.oauth_session` (P2.04s). Migration 0014's definer
  `app.end_sessions_for_did` is the one SQL that deletes a DID's sessions; the store's `destroyAllForDid` calls it.
  Migration 0024 (P2.03t, ADR 0049) makes the first rule the database's: `app.session.did` references
  `app.oauth_session(did)` with ON DELETE CASCADE, so deleting a token set deletes that DID's sessions in the same
  statement and a session cannot be inserted before its token set. Test helpers must store the token set first.
  Migration 0011's comment still names the old `infrastructure/postgres/session/`; applied migrations are
  checksum-locked, so it stays as written.

**Rules worth knowing.**
- Each process connects as its own role (web, api, indexer, retention and others), never as a superuser.
- SQL is parameterised only and carries a tenant or DID predicate.
- No network I/O inside a transaction (DA-4).
- Most of this folder is trusted base (CODEOWNERS), every migration included; a PR that changes it carries the
  `security-review` label (ADR 0044).

**Links.** [[tests]], [[deployment]], [[seal]].
