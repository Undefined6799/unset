# AGENTS.md

All agents (Claude, Cursor, others) follow [`CLAUDE.md`](CLAUDE.md): the security rules,
the protocol-first rule and the branch rules apply to every tool, not only Claude.

## Cursor Cloud specific instructions

- Use Node 26.10.0 from `/usr/local/bin` (`.nvmrc`). `npm ci` is `engine-strict`.
- `npm run check` is the local gate: typecheck, lint, guards and tests. Postgres tests
  start the pinned image with `docker run`. The environment start script launches
  `dockerd` (`fuse-overlayfs`, iptables-legacy) before the web server.
- Guard tests' throwaway repositories use `fixtureGitEnv()` (`scripts/guards/git-env.ts`,
  P1.23g, #589), which reads no global or system git config, so a global `commit.gpgsign`
  no longer reaches them. Before that, eight parallel signed fixture commits took about
  17 seconds against about 30 milliseconds unsigned (measured 2026-10-11), past Vitest
  5.0.3's default 5 second `testTimeout` (`testTimeout ??= 5e3`; no config here overrides
  it). `scripts/ci/secrets-fixtures.ts` still commits with the caller's config, but it
  runs only in CI's `secrets` job (`.github/workflows/ci.yml:130-132`), and P1.23h (#596)
  moves it to `fixtureGitEnv()` too.
- The web process is `node interfaces/http/main.ts` after `npm run build -w @unset/apps-web`.
  Dev values: `UNSET_ENV=dev`, `UNSET_SERVICE=http`, `UNSET_COMMIT` forty zeros,
  `LISTEN_PORT=8080`, `PUBLIC_ORIGIN=http://unset.test:8080`, `HTTP_ALLOWED_HOSTS=unset.test`,
  `TRUSTED_PROXY_MODE=socket`, `MEDIA_ORIGIN=http://media.other.test:8080`.
  `GET /health` is the readiness probe. `POST /prefs/theme` passes the CSRF gate
  (`shared/http/csrf/gate.ts:19-45`) on `Sec-Fetch-Site: same-origin`; `cross-site` or
  `same-site` is denied outright. Otherwise an `Origin`, when sent, is lower-cased and
  must equal `PUBLIC_ORIGIN`'s origin exactly (`:31`, `:53`) or the request is denied;
  only with no `Origin` is the `Referer`'s origin compared the same way. A request with
  none of the three headers is denied (`:44-45`).
