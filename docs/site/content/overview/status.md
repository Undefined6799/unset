---
title: Status
weight: 2
---

Not usable yet. The phase line is the [README](https://github.com/Undefined6799/unset/blob/main/README.md) Status table. The phase text is [PLAN.md](https://github.com/Undefined6799/unset/blob/main/docs/ai/PLAN.md) §8. The last column is this tree. An empty README cell is empty there.

The local gate, from the root `package.json`:

```sh
npm run check
```

That runs `typecheck`, `lint`, `guards` and `test`. The README says the Postgres tests need Docker.

## Phases

| Phase | README: what it delivers | README | On this tree |
| --- | --- | --- | --- |
| 0 | Repository, CI and guard rails | done | `.github/workflows/ci.yml`, `scripts/guards`, and `npm run check` |
| 1 | Platform and the first slice: sign in with an atproto account and see your own profile | in progress | Sign-in and the account page, in [What unset is](../what-is-unset/). `docs/human/features/sign-in.md` is not on the tree. Book step `P2.13a` (`docs/ai/book/phase-2.md`) is the slice exit and is tagged `[STOP]`. |
| 2 | Sign-up, sessions and the profile editor | in progress | `infrastructure/session`. Table `app.session` in `infrastructure/postgres/migrations/0011_app_session.sql`. OAuth rows `app.oauth_state` and `app.oauth_session` in `infrastructure/postgres/migrations/0013_app_oauth.sql`. Onboarding routes exist. No `/join` route. `/settings/profile` is a heading. |
| 3 | Indexer, public profiles, directory and moderation | | `interfaces/indexer/routes.manifest.json` is `GET /health` only. No `/@handle` route. No `eraseDid` function and no SQL `erase_did`. `infrastructure/postgres/didColumns.ts` names it as P3.07. |
| 4 | Social: short video, follows and likes | | Schemas `sh.unset.profile`, `sh.unset.section` and `sh.unset.follow` in `shared/lexicons/schemas/`. No `domains/social` or `domains/feed`. |
| 5 | Production hosting, backups and the production PDS | | No backup files under `deployment/`. No `infrastructure/arachnid`. Dev Compose is `deployment/compose.dev.yaml` and `deployment/compose.local.yaml`. |
| 6 | Chat, on Matrix | | No `apps/chat`. No `infrastructure/matrix`. `apps/web/src/screens/welcome/ChatLater.tsx` says chat is not open. |

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

`interfaces/pds-admin` and `interfaces/chat-admin` are names in `ENTRYPOINTS` in `scripts/docs/docs.ts`. Neither folder is on the tree. PLAN §8 puts a minimal `pds-admin` in Phase 2 (planned, Phase 2) and `chat-admin` in Phase 6 (planned, Phase 6).

## Folders

Decision 34 is [ADR 0001](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0001-phase-0-defaults.md). Folder rules are [guideline §1](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/architecture-and-development-guideline.md). `admin` and `chat` are on the [Apps](../../areas/apps/) page.

| Boundary | On this tree | Not on this tree |
| --- | --- | --- |
| `apps/` | `web` | `admin` (planned). `chat` (planned, Phase 6). |
| `domains/` | `identity` | `social`, `feed` (planned, Phase 4). `moderation` (planned, Phase 3). `messaging` (planned, Phase 6). `content`, `privacy` (planned). |
| `infrastructure/` | `audit`, `net-guard`, `pds`, `postgres`, `seal`, `session` | `tap` (planned, Phase 3). `matrix` (planned, Phase 6). `arachnid` (planned, Phase 5). `storage`, `email` (planned). |
| `shared/` | `config`, `errors`, `host-pin`, `http`, `islands`, `lexicons`, `log`, `ui`, `ui-build` | `i18n` (planned, P1.19). |

## Planned product work

| Work | Mark |
| --- | --- |
| Sign-up at `/join` | (planned, Phase 2). No such route in `interfaces/http/routes.manifest.json`. Book step `P2.10` in `docs/ai/book/phase-2.md`. |
| Profile editor, drafts, publish | (planned, Phase 2). `/settings/profile` renders a heading. |
| Public profile, directory, indexer beyond `/health` | (planned, Phase 3) |
| Short video, follows, likes | (planned, Phase 4). The follow schema is on the tree. No follow route. |
| Production hosting, backups, production PDS, Ozone | (planned, Phase 5) |
| Chat | (planned, Phase 6) |
| French copy | (planned, P1.19). `apps/web/src/legal/documents.ts` |
