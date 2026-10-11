# AGENTS.md

All agents (Claude, Cursor, others) follow [`CLAUDE.md`](CLAUDE.md): the security rules,
the protocol-first rule and the branch rules apply to every tool, not only Claude.

## Cursor Cloud specific instructions

- Use Node 26.10.0 from `/usr/local/bin` (`.nvmrc`). `npm ci` is `engine-strict`.
- `npm run check` is the local gate: typecheck, lint, guards and tests. Postgres tests
  start the pinned image with `docker run`. The environment start script launches
  `dockerd` (`fuse-overlayfs`, iptables-legacy) before the web server.
- Guard fixtures create throwaway commits in parallel. With `commit.gpgsign` left on,
  the signing helper holds those commits past Vitest's default 5 second `testTimeout`
  (Vitest 5.0.3 sets `testTimeout ??= 5e3`; no config here overrides it), measured on
  2026-10-11: eight parallel signed commits took about 17 seconds; unsigned took about
  30 milliseconds. The environment sets `git config --global commit.gpgsign false` so
  `npm run check` finishes, until P1.23g (#582) isolates fixture repositories from the
  global config.
- The web process is `node interfaces/http/main.ts` after `npm run build -w @unset/apps-web`.
  Dev values: `UNSET_ENV=dev`, `UNSET_SERVICE=http`, `UNSET_COMMIT` forty zeros,
  `LISTEN_PORT=8080`, `PUBLIC_ORIGIN=http://unset.test:8080`, `HTTP_ALLOWED_HOSTS=unset.test`,
  `TRUSTED_PROXY_MODE=socket`, `MEDIA_ORIGIN=http://media.other.test:8080`.
  `GET /health` is the readiness probe. `POST /prefs/theme` passes the CSRF gate
  (`shared/http/csrf/gate.ts`) on `Sec-Fetch-Site: same-origin`, else on an `Origin`
  exactly equal to `PUBLIC_ORIGIN`, else on a `Referer` with exactly that origin.
