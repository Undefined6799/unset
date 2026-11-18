# AGENTS.md

All agents (Claude, Cursor, others) follow [`CLAUDE.md`](CLAUDE.md): the security rules,
the protocol-first rule and the branch rules apply to every tool, not only Claude.

## Cursor Cloud specific instructions

- Use the Node version in `.nvmrc`. `npm ci` is `engine-strict`.
- `npm run check` is the local gate: typecheck, lint, guards and tests. Postgres tests
  start the pinned image with `docker run`. The environment start script launches
  `dockerd` (`fuse-overlayfs`, iptables-legacy) before the web server.
- Guard tests' throwaway repositories use `fixtureGitEnv()` (`scripts/guards/git-env.ts`,
  P1.23g, #589), which reads no global or system git config, so a global `commit.gpgsign`
  no longer reaches them. Before that, eight parallel signed fixture commits took about
  17 seconds against about 30 milliseconds unsigned (measured 2026-10-11), past Vitest
  5.0.3's default 5 second `testTimeout` (`testTimeout ??= 5e3`; no config here overrides
  it). `scripts/ci/secrets-fixtures.ts` still commits with the caller's config, but it
  runs only in CI's `secrets` job (`.github/workflows/ci.yml:136-137`), and P1.23h (#596)
  moves it to `fixtureGitEnv()` too.
- The web process is `node interfaces/web/server.ts` after `npm run build -w @unset/interfaces-web`
  (SvelteKit with adapter-node; ADR 0054). It boots through `bootOrExit(schema)` with
  `interfaces/web/src/lib/server/config.ts`, which requires Postgres (`PG_HOST`,
  `PG_DATABASE`, `PG_USER`, `PG_PASSWORD` as a secret file, `PG_SSLMODE`, `PG_POOL_MAX`),
  the seal keyring (`SEAL_KEYRING`, a secret file), the OAuth client keys
  (`OAUTH_CLIENT_KEYS` as a secret file, `OAUTH_ACTIVE_KID`), `PLC_URL`, `PDS_HOSTNAME`,
  `HANDLE_SUFFIX` and the legal keys, none with a default. The dev stack
  (`npm run dev:up`) is the full environment; tests build one in
  `tests/integration/web/built-server.ts`. Never paste secret values.
  `GET /health` is the readiness probe. Every non-GET passes SvelteKit's Origin check for
  form bodies and the gate in `interfaces/web/src/hooks.server.ts`, which refuses any other
  body type with 415 (`FORM_TYPES`).
