---
id: postgres-tests-need-docker
type: pitfall
status: current
areas: ["[[tests]]", "[[postgres]]"]
summary: "Postgres tests start the pinned image with docker run and fail, never skip, where Docker is missing."
code: [tests/support/postgres.ts, tests/integration/setup/pg.setup.ts]
sources: [unset-plan/book-edits/2026-10-06-p111g-postgres-test-mechanism.md]
importance: high
related: ["[[tests]]", "[[postgres]]"]
replaced_by: null
tags: [pitfall, tests, postgres]
checked: 2026-10-19
---
# Postgres tests need Docker and never skip

**What goes wrong.** `npm run check` runs the integration tests, and they start Postgres with `docker run` from the
test process (`tests/support/postgres.ts`, which reads the image from the lock's `postgres` entry). On a machine or
agent container without Docker, the run fails. It does not skip, by design: the test runner fails on any discovered
test that did not run, and a skip would hide a broken gate.

**Why one mechanism.** The bootstrap test must start a fresh cluster with `deployment/postgres/init/00-bootstrap.sh`
mounted, which only runs at initdb, and the local gate must run exactly what CI runs. So there is no CI service
container and no second way (ruling 2026-10-06, P1.11g).

**The rule.** Do not add a skip, a tag or a second start path to get green locally. Without Docker, run typecheck,
lint, guards and the unit tests you touched, say in the PR that the Postgres tests ran only in CI, and let CI's
`check` job prove them. Any second mechanism stops and asks.

**Hung daemon.** Every docker call the helper makes is killed at 60 s (`tests/support/docker.ts`, P1.27k), so a
stuck daemon fails the test with a message naming the call instead of blocking until `scripts/test/run.ts` kills
the whole run at 600 s. Hooks that end in `stopAllPostgres` take `STOP_ALL_MS` (P1.27g), and that hook fails
naming the container when its `docker rm` is killed, so a leaked container is reported, not hidden (P1.27i). When the
shared setup (`tests/integration/setup/pg.setup.ts`) fails and its cleanup is killed too, both errors are reported,
the setup's first (P1.11c). The setup starts Postgres inside that same `try`, since a failed globalSetup gets no
teardown; a start that fails removes its own container and secrets folder and reports a killed removal with its
failure; and a hook that closes pools first uses `stopAllPostgresAfter(close)`, so a rejected close still stops
the containers (P1.11f).

Re-checked at P1.01a: `pg.setup.ts` imports `@unset/infrastructure-postgres` by package name; the Docker start
path, fail-not-skip rule, and cleanup helpers are unchanged.

**Repair.** Nothing to repair; it is a property of the environment.

Re-checked at P2.08g: the opt-in auditor login (`asAuditor`) adds a role password in the same setup, not a second
start path.
