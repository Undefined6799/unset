# 0014 — node-postgres as the Postgres driver

Status: Proposed (awaiting Alex in the P1.11 pull request; architecture ruling 2026-10-06 01:25Z)

## Context
P1.11 adds the first code that talks to Postgres: the migration runner. P1.11p adds the per-role pools. The book has
named `pg` (node-postgres) since the plan (§5.2), and the driver is a runtime dependency every database process
loads, so it is expensive to reverse (D8).

## Decision
1. `pg` 8.23.0, pinned exactly in `infrastructure/postgres/package.json`. 8.23.1 (2026-09-30) is held back by the
   7-day `min-release-age`; Renovate proposes it later.
2. Pure JavaScript only: `pg-native` (an optional peer dependency) is never installed, so no native build or libpq
   enters the image.
3. Only `infrastructure/postgres/` imports `pg` (dependency-cruiser `SDK_ADAPTERS`). Only `pool.ts` (P1.11p) calls
   `pool.connect` or `pool.query` (Semgrep `pool-access-single-file`), and only `tx.ts` opens a transaction (Semgrep
   `transactions-only-in-tx`).
4. Migrations run over the simple query protocol, so a file may hold several statements; application queries use
   parameters (`$1`), never string building.

## Alternatives
- `postgres` (porsager/postgres): rejected; its tagged-template API makes parameterisation implicit and harder to
  check with a scan, and it is a smaller project.
- `node-pg-migrate` 9.0.0 on top of `pg` (review 02 SERIOUS-5): rejected for the runner; our runner is about 150
  lines and keeps the checksum, gap and "database ahead" rules exact. It stays an option if the runner grows.
- An ORM or query builder (Drizzle, Kysely): rejected; plain parameterised SQL keeps grants, `statement_timeout` and
  the query budget visible.

## Consequences
node-postgres waits forever for a free pool client by default; P1.11p sets `connectionTimeoutMillis` from
`PG_CONNECT_TIMEOUT_MS` and maps the timeout to `db.busy`. Driver errors carry row values in `message` and `detail`,
so code logs only the SQLSTATE (`migrate.failed`, P1.11e). The dependency audit, licence check and SBOM cover `pg`
and its closure (`pg-pool`, `pg-protocol`, `pg-types`, `pg-connection-string`, `pgpass`, `pg-int8`, and the optional
`pg-cloudflare`, which loads only on Cloudflare Workers).

## Compliance
dependency-cruiser's SDK rule keeps `pg` in one folder; the two Semgrep rules hold pool access and transactions; the
dependency guard checks the exact pin. Reviewed if `pg` 9 changes the client API or if a pool feature we need is
missing.
