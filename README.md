# unset.sh

An AT Protocol-native identity and profile app: a portable profile that lives in your own
repository, edited and rendered in the app, with hosted accounts on our own PDS.

This is a rebuild of the 0x40 prototype with a deliberately small, auditable core. The plan,
including what is in and out of the core and why, is [`docs/ai/PLAN.md`](docs/ai/PLAN.md).

## Status

Phase 0: repository, CI and guard rails only. No application code yet.

## Layout (as it fills in)

| Path | What |
| --- | --- |
| `apps/` | User-facing UI only: `web`, `admin`, `chat` (Phase 6) |
| `interfaces/` | Entry points, one process and container each: `http`, `api`, `indexer`, `media`, `review`, `pds-admin`, `chat-admin` (Phase 6) |
| `domains/` | Product rules: `identity`, `content`, `social`, `feed`, `messaging`, `moderation`, `privacy` |
| `infrastructure/` | External systems behind small contracts, `net-guard`, `seal`, `audit` |
| `shared/` | Generic code with no product meaning (MIT): `lexicons`, `ui`, `config`, `errors`, `i18n` |
| `deployment/`, `tests/` | Compose, edge, backup, preflight; integration and e2e tests |
| `docs/` | `human/` (guides, decisions, the five engineering guidelines) and `ai/` (plan, step book, handoffs) |
| `scripts/guards/` | Repository guards run in CI |

## Development

Requires Node 26 (see `.nvmrc`).

```sh
npm ci
git config core.hooksPath .githooks   # secret scan + guards before each commit
npm run check                         # typecheck, lint, guards, tests
```

## License

Licence: AGPL-3.0-only, with `shared/` under MIT as set out below; P0.13 confirms it, and the repository stays private until then.

Everything is [AGPL-3.0-only](LICENSE) except `shared/` (the `sh.unset.*` lexicons, the UI kit and the generic helpers), which is [MIT](LICENSE-MIT) so other atproto apps can reuse the record types and helpers freely (Alex, 2026-10-03; folder set by decision 34, 2026-10-04).
