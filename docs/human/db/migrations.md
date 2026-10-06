# Migrations

Schema changes are SQL files in `infrastructure/postgres/migrations/`, applied once, in order, by `unset-migrate`
(`infrastructure/postgres/migrate-cli.ts`). It runs as the one-shot Compose `migrate` service (P1.29) with only the
`migrator` credentials; `web`, `api` and `indexer` start after it exits 0.

## Files

- Name: `NNNN_<name>.sql`, four digits, contiguous from `0001`; `<name>` is lowercase letters, digits and `_`.
- First line: `-- phase: expand` or `-- phase: contract`.
- Optional second line: `-- unset: no-transaction`, for a statement Postgres refuses inside a transaction
  (`CREATE INDEX CONCURRENTLY`). Such a file holds one statement and is idempotent (`IF NOT EXISTS`), because a
  failure can leave part of its work and the next run retries it.
- Every other file runs inside one transaction with the row that records it, so it applies whole or not at all.
- Never edit a file once it has merged: write a new one. The runner stores each file's SHA-256 and stops on a change.

## Expand, then contract

Old and new code run against the same schema during a deploy, and a rollback deploy runs old code against the newer
schema. So:

- An **expand** migration only adds: tables, nullable columns, columns with defaults, indexes (concurrently), new
  functions. The code that uses it ships in the same or a later release. The runner refuses, in an expand file,
  `DROP TABLE`, `DROP COLUMN` (with or without the keyword), `DROP SCHEMA`, `DROP INDEX` (except `DROP INDEX
  CONCURRENTLY IF EXISTS` of an index the same file creates), `RENAME`, `ALTER COLUMN … TYPE`, `ALTER COLUMN … SET NOT
  NULL` and `TRUNCATE`.
- A **contract** migration removes what the previous release stopped using, and ships at least one release after
  that code change.
- A migration that creates a table states its grants in the same file (P1.12).

The lint reads SQL as text: the same words inside a string or a function body also count. Comments do not.

## Index rule (plan §6.1, rule PF-1)

Every `CREATE [UNIQUE] INDEX`, in any file, has these two lines directly above it:

```sql
-- query: domains/identity/sessions.ts:findSession
-- why: unique
CREATE UNIQUE INDEX sessions_id_idx ON core.sessions (id);
```

`query:` names the file (optionally `file:symbol`) whose query the index serves, as a path from the repository root;
the file must exist. `why:` is `unique`, `foreign-key` or `speed`. An index added for `speed` carries before-and-after
p50, p95 and p99 for that query in the PR's Performance evidence.

## What a run does

1. Reads the files; a bad name, a duplicate version or a missing header exits 1, a gap exits 3, a lint finding exits
   1 naming the file and line. None of this needs the database.
2. Connects as `migrator`, retrying after 1, 2, 4, 8 and 16 s while Postgres starts; then exits 1. A refusal from a
   running server (a wrong password) is not retried.
3. Exits 1 unless `current_user` is `migrator`. Sets `lock_timeout` 5 s and `statement_timeout` 15 min.
4. Takes the advisory lock `0x756e7365`, waiting up to 60 s for another runner, then exits 1.
5. Creates `public.schema_migrations` if absent and compares checksums: an edited file exits 2.
6. If the database holds versions this code has no file for (a rollback deploy), logs `migrate.database_ahead` and
   exits 0 without applying anything.
7. Applies each pending file. On an error it logs `migrate.failed` with the version and the SQLSTATE, never the
   message (which can quote row values), and exits 1.
8. Logs `migrate.done` with the count and exits 0.

## Roles and grants (P1.12)

Each process connects as its own role, listed with its class, connection limit and settings in
`infrastructure/postgres/roles.json` and created by migration `0003`. A new role starts with no privilege on any table.

- A migration that creates a table, view, sequence or routine grants what each role needs in the same file, by column
  list on any table with a row in `erasure-registry.json`, and adds the object's row to
  `infrastructure/postgres/grant-matrix.json`. No default privilege grants tables, so a table that lands without its
  grants is unreachable, and a table whose grants and matrix row disagree fails `tests/integration/postgres/grants.test.ts`.
- A table-level matrix entry says `{ "privileges": [...], "wholeTable": true }`: the role is meant to hold those
  privileges on every column, including columns added later. A personal-data table may not carry the flag.
- A new role, a role attribute, a membership, a default privilege, or a grant on an object that already exists is
  trusted base: its own step and PR, ahead of the step that needs it (rule SE-6).
- The test reads the catalog and prints each difference as one line, `+` for a privilege the database holds and the
  matrix does not, `-` for the reverse: `+ api SELECT app.drafts`.

## Postgres 18 data path

The pinned image (`postgres:18.6`, digest in `tests/support/postgres.ts`) sets `PGDATA=/var/lib/postgresql/18/docker`
and declares the volume `/var/lib/postgresql` (read from `docker image inspect` on 2026-10-06). P1.29 mounts the data
volume at `/var/lib/postgresql`, not at `/var/lib/postgresql/data`.
