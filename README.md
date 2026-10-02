# unset.sh

An AT Protocol-native identity and profile app: a portable profile that lives in your own
repository, edited and rendered in the app, with hosted accounts on our own PDS.

This is a rebuild of the 0x40 prototype with a deliberately small, auditable core. The plan,
including what is in and out of the core and why, is [`docs/PLAN.md`](docs/PLAN.md).

## Status

Phase 0: repository, CI and guard rails only. No application code yet.

## Layout (as it fills in)

| Path | What |
| --- | --- |
| `apps/` | Deployable entrypoints: `web`, `indexer`, `media`, `pds-admin` |
| `packages/` | Core libraries: `core`, `lexicons`, `net-guard`, `ui`, `plugin-api` |
| `modules/` | First-party modules outside the core (chat, rss) |
| `plugins/` | Plugins behind the `plugin-api` seam (none in v1) |
| `deploy/` | Compose stack, edge config, backups, preflight |
| `docs/` | Plan, decisions (`docs/adr/`), runbooks, compliance |
| `scripts/guards/` | Repository guards run in CI |

## Development

Requires Node 24 (see `.nvmrc`).

```sh
npm ci
git config core.hooksPath .githooks   # secret scan + guards before each commit
npm run check                         # typecheck, lint, guards, tests
```

## License

[AGPL-3.0-only](LICENSE).
