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

Sign-in, onboarding and the account page are in [What unset is](../what-is-unset/). `infrastructure/session` stores the browser session. Table `app.session` is `infrastructure/postgres/migrations/0011_app_session.sql`. OAuth rows `app.oauth_state` and `app.oauth_session` are `infrastructure/postgres/migrations/0013_app_oauth.sql`.

## Processes

Every manifest except `interfaces/http/routes.manifest.json` lists one route.

| Folder | Manifest routes |
| --- | --- |
| `interfaces/http` | [What unset is](../what-is-unset/) |
| `interfaces/admin` | `GET /health` |
| `interfaces/api` | `GET /health` |
| `interfaces/indexer` | `GET /health` |
| `interfaces/media` | `GET /health` |
| `interfaces/review` | `GET /health` |

## Folders

Decision 34 is [ADR 0001](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0001-phase-0-defaults.md). Folder rules are [guideline §1](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/architecture-and-development-guideline.md).

| Boundary | On this tree |
| --- | --- |
| `apps/` | `web` |
| `interfaces/` | `http`, `admin`, `api`, `indexer`, `media`, `review` |
| `domains/` | `identity` |
| `infrastructure/` | `audit`, `net-guard`, `pds`, `postgres`, `seal`, `session` |
| `shared/` | `config`, `errors`, `host-pin`, `http`, `islands`, `lexicons`, `log`, `ui`, `ui-build` |
| `deployment/` | `edge`, `images`, `postgres`, `preflight`, `env`, `compose.dev.yaml`, `compose.dev.source.yaml`, `compose.local.yaml` |
