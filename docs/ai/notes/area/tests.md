---
id: tests
type: area
status: current
areas: ["[[tests]]"]
summary: "Hub for tests/: Postgres integration tests and the browser accessibility harness."
code: [tests/support/postgres.ts, tests/support/docker.ts, tests/support/image-build.ts, tests/integration/setup/pg.setup.ts, tests/e2e, scripts/assert-tests-ran.ts, .github/workflows/e2e.yml]
sources: []
importance: normal
related: ["[[postgres]]", "[[postgres-tests-need-docker]]", "[[git-hooks-export-git-dir]]"]
replaced_by: null
tags: [area, tests]
checked: 2026-10-17
---
# tests

**What it owns.** Integration tests (`tests/integration/`) and the browser harness (`tests/e2e/`, Playwright).
Unit tests sit beside the file they test, not here.

**Browser harness (P1.26).** Two processes serve the production web build: the real server, and a fixture
server whose pages are not in the route manifest. The kit showcase is not in that build (Node cannot load
its TSX), so the fixture server loads it with Vite's `ssrLoadModule` and the production stylesheet.
`scripts/assert-tests-ran.ts` reads Playwright's JSON report. pa11y-ci 5.0.0 and `@lhci/cli` 0.15.1 are
installed in the `e2e` job only; their trees fail `npm audit --audit-level=high`, so they are not in the
lockfile. Lighthouse's upload target is `filesystem`.

**Files.**
- `support/postgres.ts`: the one way tests run Postgres, started with `docker run`: the upstream image the lock's
  `postgres` entry pins, the base of our gosu-free image (P1.29d), run as upstream ships it (root, then gosu).
- `support/docker.ts`: every synchronous docker call in tests goes through `docker(args, { timeoutMs })`, which kills
  the call with SIGKILL at its timeout and throws a message naming it (P1.27k). A blocked `spawnSync` cannot be
  interrupted by vitest's test timeout, so without this a hung daemon held the event loop until `scripts/test/run.ts`
  killed the whole run at 600 s, naming nothing. `killBefore(budget)` sets a call's timeout 5 s under the test's
  budget. A call's `env`, when set, is the child's whole environment (P1.29h pins the daemon with it);
  `withCleanup(body, cleanup)` keeps the body's failure when a removal is killed too (P1.27g) and refuses
  an async body (P1.27i). An async setup uses `failAfterCleanup(error, cleanup)` from its catch, and a hook with
  several cleanups uses `cleanUpAll`, so a killed removal never hides the setup error or skips a folder (P1.11c).
  Both refuse a cleanup that returns a promise, and their combined message never throws on an odd thrown value
  (P1.11f). A hook that closes pools before stopping uses `stopAllPostgresAfter(close)` (P1.11f).
  Hooks that end in `stopAllPostgres` take `STOP_ALL_MS`, never vitest's 10 s default; a killed `docker rm` there
  now fails the hook, naming the container, instead of passing silently (P1.27i).
- `support/image-build.ts`: image tests build with `buildTestImage`, which tags each build `unset-test-<hex>`, and
  clean up with `removeTestImage`, which removes only that tag, never with `-f` or by id (P1.27x). Two builds of one
  Dockerfile and context share an image id on CI's classic image store, so `rmi -f <id>` removed it under another
  test. A failed build's message keeps BuildKit's summary of the failing step (plain progress, not `-q`).
  Every test image carries `sh.unset.test-owner=<pid>`, the test containers' label, so a leaked tag can be found with
  a label filter (P1.11i).
- `integration/setup/pg.setup.ts`: one container per run, real migrations once, one cloned database per test file.
  Tests connect as the real process roles, never as migrator or the superuser (TE-2).
- `integration/postgres/`: migrations, grants, pool, role passwords, schemas, DID columns.
- `integration/query-budget.test.ts`: every route in every `routes.manifest.json` needs a fixture in
  `query-budget/fixtures/<interface>.json`, and stays under the statement budget.

**Rules worth knowing.** No module mocks; only unmanaged dependencies get doubles (TE-1). Vitest fails if a
discovered test did not run.

**Links.** [[postgres]].
