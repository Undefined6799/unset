---
id: tests
type: area
status: current
areas: ["[[tests]]"]
summary: "Hub for tests/: integration tests against real Postgres, and the one helper that starts it."
code: [tests/support/postgres.ts, tests/integration/setup/pg.setup.ts]
sources: []
importance: normal
related: ["[[postgres]]", "[[postgres-tests-need-docker]]", "[[git-hooks-export-git-dir]]"]
replaced_by: null
tags: [area, tests]
checked: 2026-10-06
---
# tests

**What it owns.** Integration tests (`tests/integration/`) and, later, end-to-end tests (`tests/e2e/`, Playwright).
Unit tests sit beside the file they test, not here.

**Files.**
- `support/postgres.ts`: the one way tests run Postgres, the pinned production image started with `docker run`.
- `integration/setup/pg.setup.ts`: one container per run, real migrations once, one cloned database per test file.
  Tests connect as the real process roles, never as migrator or the superuser (TE-2).
- `integration/postgres/`: migrations, grants, pool, role passwords, schemas, DID columns.
- `integration/query-budget.test.ts`: every route in every `routes.manifest.json` needs a fixture in
  `query-budget/fixtures/<interface>.json`, and stays under the statement budget.

**Rules worth knowing.** No module mocks; only unmanaged dependencies get doubles (TE-1). Vitest fails if a
discovered test did not run.

**Links.** [[postgres]].
