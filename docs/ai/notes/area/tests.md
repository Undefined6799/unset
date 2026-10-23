---
id: tests
type: area
status: current
areas: ["[[tests]]"]
summary: "Hub for tests/: Postgres integration tests and the browser accessibility harness."
code: [tests/support/postgres.ts, tests/support/docker.ts, tests/support/image-build.ts, tests/support/local-stack.ts, tests/integration/setup/pg.setup.ts, tests/e2e, scripts/test/assert-tests-ran.ts, .github/workflows/e2e.yml]
sources: []
importance: normal
related: ["[[postgres]]", "[[postgres-tests-need-docker]]", "[[git-hooks-export-git-dir]]", "[[alice-bob-pds-password]]"]
replaced_by: null
tags: [area, tests]
checked: 2026-10-23
---
# tests

**What it owns.** Integration tests (`tests/integration/`) and the browser harness (`tests/e2e/`, Playwright).
Unit tests sit beside the file they test, not here.

**Browser harness (P1.26).** Two processes serve the production web build: the real server, and a fixture
server whose pages are not in the route manifest. The real server's `PUBLIC_ORIGIN` is
`https://unset.test:8080` because `@atproto/oauth-client` 0.8.9 rejects an `http` or IP client id; browsers
still open `http://127.0.0.1:8080`, and `ASSETS_BASE` stays on that listener. The kit showcase is not in
that build (Node cannot load its TSX), so the fixture server loads it with Vite's `ssrLoadModule` and the
production stylesheet. The toast fixture's `Island` is the production server build, the same module the
render loader imports, so it shares that build's `IslandRunContext`.
The welcome screens that need a session at their real paths (age, terms, chat) are fixture pages too,
`/fixture/welcome-*`, rendered from the server build's `screens` as the welcome routes render them; `welcome.axe`
in `a11y.spec.ts` runs axe on them in the four theme cells (P2.12a). P2.13c adds `/fixture/account` and
`/fixture/settings-*` the same way, so the account page and both settings pages are in the axe matrix. `nojs.spec.ts` also drives both menus at a
375 px viewport with script off (the menu drawer from the floating bar on `/`, which hides the bar while open, and the Header `<details>` on `/signed-out`, since P2.05m draws `/login` as the sign-in box with no shell), the drawer from the header's menu button on desktop (P2.13e); P2.05n's `login_close_returns_to_the_page_before` clicks the footer's Sign in on `/legal/terms` so the browser sends its own Referer; P2.05p's `sign_in_opens_over_the_page` opens the Header's in-place box there and closes it three ways and the footer
theme form on `/signed-out`; WebKit keeps no `__Host-` cookie on http, so it expects the system theme (P1.25f). A local run needs Playwright pointed at
`/opt/pw-browsers/chromium` (`launchOptions.executablePath`), since the pinned 1.64.0 wants a newer headless shell.
`scripts/test/assert-tests-ran.ts` reads Playwright's JSON reports (the checks list already
covers `scripts/test/`). Since P0.07b, `e2e.yml` runs one `browser` job per Playwright project and an `a11y` job
(pa11y and Lighthouse) in parallel; the `e2e` gate job takes all three browser reports, so a spec counts as run when
any browser ran it, and a browser report with no specs fails.
Since P0.07f, each `playwright install --with-deps` runs under `timeout 240s` and once more if that attempt
fails, in a step capped at 9 minutes: on 2026-10-22 the WebKit install hung to the 30-minute job timeout in 3
of about 20 runs (#1264, #1274), while it usually takes under a minute.
Since P0.07g, apt drops a stalled mirror connection after 20 s and retries each file 3 times, and the retry
first stops the orphaned apt-get: the job log showed azure.archive.ubuntu.com crawling and the P0.07f retry
failing on the dpkg lock that apt-get still held.
Since P0.07h, both install jobs cache the browser and the packages apt fetched (actions/cache v6.1.0, keyed on
the runner image, Playwright version and browser), because the mirror still crawled at about 50 KB/s. apt does
not hash-check a file already in its archive directory, so a cached package reaches apt only when its SHA256
matches the signed index.
Its three jobs pin `actions/setup-node` v7.1.0 (P0.08). pa11y-ci 5.0.0 and `@lhci/cli` 0.15.1 are installed in
the `a11y` job only; their trees fail `npm audit --audit-level=high`, so they are not in the lockfile. pa11y
caps axe "needs review" to a warning and ignores two HTML_CodeSniffer false positives: the
mark link, whose name is an SVG `aria-label`, and contrast on a button whose fill is
`::before`. Lighthouse's upload target is `filesystem`. P2.13 put `/login` and
`/signed-out` in the app shell, so those two load the header island. `/welcome/blocked`
renders with no session and no island (P2.12). `/welcome`, `/welcome/age`,
`/welcome/terms`, `/welcome/chat` and `/settings/profile` redirect to sign-in.
`/legal/domains` is a public document. `/.well-known/security.txt` is text, not a page.
Lighthouse launches Chrome with `--no-sandbox` (`collect.settings.chromeFlags` in
`@lhci/cli` 0.15.1):
ubuntu-24.04's AppArmor refuses the browser's user namespace. P1.37j also turns off `SpareRendererForSitePerProcess`:
with it on, Lighthouse stopped with NO_NAVSTART in 16 of 277 local runs; with it off, 0 of 182. Why a spare renderer
loses the trace's `navigationStart` is inferred, not proven. Chrome keeps only the last `--disable-features`, so the
flag repeats chrome-launcher 1.2.2's default list; `lighthouserc.test.ts` pins it, and fails if
`chromeIgnoreDefaultFlags` is set.

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
- `support/local-stack.ts` (P1.29t): judgements for the running local stack. Probes run only under local. Device
  rows must show the edge's inspect address, never the client's. Client metadata is judged with
  `@atproto/oauth-client` 0.8.9 `clientMetadataSchema` (same import as `tests/e2e/oauth-origin.test.ts`). The live
  client_id GET and OAuth as Alice or Bob are P1.33z.
- `integration/setup/pg.setup.ts`: one container per run, real migrations once, one cloned database per test file.
  Tests connect as the real process roles, never as migrator or the superuser (TE-2). One opt-in exception
  (architecture 2026-10-19 04:51Z): `asAuditor()` from `setup/pg.setup.ts` logs in as the real auditor role,
  provided under its own key `postgresAuditor`, so a test can count `audit.chain`; it is never handed to a server
  under test.
- `integration/postgres/`: migrations, grants, pool, role passwords, schemas, DID columns.
- `integration/query-budget.test.ts`: every route in every `routes.manifest.json` needs a fixture in
  `query-budget/fixtures/<interface>.json`, and stays under the statement budget. Keep `path` equal to the manifest
  template; set `requestPath` to exercise concrete parameters (for example a valid DID for `/:did`).

**Rules worth knowing.** No module mocks; only unmanaged dependencies get doubles (TE-1). Vitest fails if a
discovered test did not run. Re-checked at P1.01a: integration tests import postgres and audit by package name;
the Docker start path is unchanged.

**Links.** [[postgres]].
