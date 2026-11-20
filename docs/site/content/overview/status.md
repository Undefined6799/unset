---
title: Status
weight: 2
---

Not usable yet. Roadmap: [`docs/ai/PLAN.md`](https://github.com/Undefined6799/unset/blob/main/docs/ai/PLAN.md).

The local gate, from the root `package.json`:

```sh
npm run check
```

That runs `typecheck`, `lint`, `guards` and `test`. The README says the Postgres tests need Docker.

## On this tree

Sign-in, onboarding and the account page are in [What unset is](../what-is-unset/). A signed-in member's profile fields are saved to their own PDS as `sh.unset.profile` (`POST /profile`). `infrastructure/session` stores the browser session. Table `app.session` is `infrastructure/postgres/migrations/0011_app_session.sql`. OAuth rows `app.oauth_state` and `app.oauth_session` are `infrastructure/postgres/migrations/0013_app_oauth.sql`.

## Processes

| Folder | What it does |
| --- | --- |
| `interfaces/web` | The SvelteKit web server for `apps/web`. Routes are on [Endpoints](../../endpoints/) |
| `interfaces/indexer` | Reads our PDS's stream into `idx`; off unless `INDEXER_ENABLED` |
| `interfaces/pds-admin` | Holds the PDS admin password and issues member invites for web |

## Folders

Decision 34 is [ADR 0001](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0001-phase-0-defaults.md). Folder rules are [guideline §1](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/architecture-and-development-guideline.md).

| Boundary | On this tree |
| --- | --- |
| `apps/` | `web` |
| `interfaces/` | `indexer`, `pds-admin`, `web` |
| `domains/` | `identity`, `profile` |
| `infrastructure/` | `audit`, `firehose`, `net-guard`, `pds`, `postgres`, `seal`, `session`, `storage` |
| `shared/` | `admin-envelope`, `config`, `errors`, `host-pin`, `http`, `lexicons`, `log`, `safe-href`, `ui`, `ui-build` |
| `deployment/` | `edge`, `images`, `postgres`, `preflight`, `env`, `compose.dev.yaml`, `compose.dev.source.yaml`, `compose.local.yaml` |
