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
checked: 2026-10-06
---
# Postgres tests need Docker and never skip

**What goes wrong.** `npm run check` runs the integration tests, and they start Postgres with `docker run` from the
test process (`tests/support/postgres.ts`). On a machine or agent container without Docker, the run fails. It does
not skip, by design: the test runner fails on any discovered test that did not run, and a skip would hide a broken
gate.

**Why one mechanism.** The bootstrap test must start a fresh cluster with `deployment/postgres/init/00-bootstrap.sh`
mounted, which only runs at initdb, and the local gate must run exactly what CI runs. So there is no CI service
container and no second way (ruling 2026-10-06, P1.11g).

**The rule.** Do not add a skip, a tag or a second start path to get green locally. Without Docker, run typecheck,
lint, guards and the unit tests you touched, say in the PR that the Postgres tests ran only in CI, and let CI's
`check` job prove them. Any second mechanism stops and asks.

**Repair.** Nothing to repair; it is a property of the environment.
