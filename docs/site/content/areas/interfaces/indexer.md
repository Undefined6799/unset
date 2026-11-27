---
title: indexer
weight: 2
---

Reads our PDS into `idx`. Package `@unset/interfaces-indexer`. [ADR 0052](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0052-ingest-our-pds-with-atproto-sync.md) is the decision (Accepted by Alex, 2026-11-17). The plan is [`docs/ai/PLAN.md`](https://github.com/Undefined6799/unset/blob/main/docs/ai/PLAN.md).

## Owns

`interfaces/indexer/main.ts` loads settings with `bootOrExit` and exits 78 when they are invalid. `INDEXER_ENABLED` defaults to false. Off, `compose` builds nothing: health only, no pool. On, `interfaces/indexer/compose.ts` is the only file here that builds adapters.

`run.ts` starts the stream, then runs `track`, `backfill`, `confirm` and `handles`. SIGTERM aborts that work. `shutdown.ts` waits for the loop, the pool and the health server for `INDEXER_SHUTDOWN_GRACE_MS` (at most 9000).

| Path | What it holds |
| --- | --- |
| `interfaces/indexer/main.ts` | Process start, the health server, the signal stop. |
| `interfaces/indexer/compose.ts` | Composition root. |
| `interfaces/indexer/config.ts` | `schema`. A rule refuses any `PG_USER` other than `indexer`. |
| `interfaces/indexer/run.ts` | The stream and the four passes. |
| `interfaces/indexer/consumer.ts` | Stream frames into the index store. |
| `interfaces/indexer/track.ts` | `trackPass`, `backfillPass`. |
| `interfaces/indexer/account-jobs.ts` | `confirmPass`. |
| `interfaces/indexer/handles.ts` | `handlePass`. |
| `interfaces/indexer/health.ts` | `GET /health`. |
| `interfaces/indexer/shutdown.ts` | `stopWithin`. |
| `interfaces/indexer/stream-watch.ts` | Whether the stream counts as healthy. |

## May import

The [`interface` row](../) in `scripts/lint/.dependency-cruiser.cjs`. This folder is not a path `ADMIN_SERVICES` names, so `admin-service` does not apply. dependency-cruiser 18.7.0 is pinned in `package.json`.

| Rule | Effect |
| --- | --- |
| `interface` | Own folder, `domains/`, `infrastructure/`, `shared/`, Node built-ins (`dependencyTypes: core`), and npm types `npm`, `npm-dev`, `npm-optional`, `npm-peer`, `npm-bundled`. |
| `no-interface-to-interface` | No other `interfaces/` folder. |
| `app-render-entry-only` | No `apps/`. |
| `infra-shared-via-index` | `infrastructure/` and `shared/` through `index.ts`. A `*.fake.ts` and a `.css` file are the exceptions that rule allows. |
| `domain-via-exports` | A domain through its `index.ts` or a file its `package.json` exports. |
| `fake-only-in-composition-root` | A `*.fake.ts` only from tests or `interfaces/<name>/compose.ts`. From `compose.ts`, only a dynamic `import()` (`dynamic: false` is forbidden). |
| `no-product-imports-tooling` | No `scripts/` or `tests/`. |
| `vendor-sdk-one-adapter` | The SDKs that rule names stay in their adapter folders. |

## Entry points

| Role | Path |
| --- | --- |
| Start | `interfaces/indexer/main.ts` |
| Composition root | `interfaces/indexer/compose.ts` |
| Image | `ENTRYPOINT ["node", "interfaces/indexer/main.ts"]` in `deployment/images/indexer.Dockerfile`. `EXPOSE 8081`. The `HEALTHCHECK` fetches `HEALTH_PORT`, or 8081 when that variable is unset. |
| Listen | `server.listen(config.HEALTH_PORT)` in `main.ts`. `HEALTH_PORT` defaults to 8081 in `config.ts`. |
| `LISTEN_PORT` | Required by `defineEntrypointConfig` in `shared/config/schema.ts`, with no default. No file under `interfaces/indexer/` reads it. `config.test.ts` sets it so the schema loads. |

## Data

Off, the health body is `{ healthy: true, enabled: false }` and `createPool` is not called (`compose.ts`).

On, the pool is role `indexer` (`infrastructure/postgres/roles.json`: `connectionLimit` 10, `statement_timeout` `10s`, `passwordFrom` `pg_indexer_password`). `checkConnectionBudget` runs before the readers start. Grants for role `indexer` are in `infrastructure/postgres/grant-matrix.json`.

| Call | Where it goes |
| --- | --- |
| `readFirehose` | `infrastructure/firehose/reader.ts`. `Subscription` for `com.atproto.sync.subscribeRepos` on `INDEXER_PDS_URL`. That constructor is not passed the net-guard. |
| `createRepoReader`, `createRepoStatusReader`, `createHandleOnPdsReader` | The same origin, through the net-guard `compose.ts` builds. |
| `createIdentityNetwork` | `PLC_URL`, DID documents and handle checks, through that net-guard. |

| Store | Relations its SQL names |
| --- | --- |
| `createIndexStore` | `idx.relay_cursor`, `idx.account`, `idx.account_job`, `idx.dead_letter`, `idx.ingest_stat`, `idx.profile`, `idx.page`, `idx.section`, `idx.record_blob`, `idx.is_erased` |
| `createTrackStore` | `idx.track_request`, `idx.account`, `idx.section`, `idx.account_job`, `idx.dead_letter` |
| `createAccountStore` | `idx.account`, `idx.account_job`, `idx.dead_letter`, `idx.erase_deleted_account` |
| `createHandleStore` | `idx.account`, `idx.account_job` |

`GET /health` (`health.ts`): 200 when `healthy` is true, 503 with that JSON when it is false, 503 with an empty body when the read throws, 404 otherwise. `sharedRead` reuses one read for `HEALTH_CACHE_MS` (5000). An enabled read is unhealthy when `stream-watch` says so or `loop.overdue` is not empty (`compose.ts`).

## How it runs

Service `indexer`. The service table is on [Compose](../../deployment/compose/).

| Fact | Where |
| --- | --- |
| `deployment/compose.dev.source.yaml` | Defines service `indexer`. |
| `deployment/compose.local.yaml` | Defines service `indexer`. |
| `deployment/compose.dev.yaml` | No `indexer` service. |
| `SOURCE_ONLY_SERVICES` | `deployment/preflight/local-only.ts` includes `indexer`. |
| Networks on the service | `db`, `indexer_pds`, `indexer_egress` |
| `npm run dev:source:up` | `deployment/compose.dev.source.yaml` |
| `npm run local:up` | `deployment/compose.local.yaml` |
| `npm run dev:up` | `deployment/compose.dev.yaml` |

Both files that define the service set `INDEXER_ENABLED` to `true`, `PG_USER` to `indexer`, `INDEXER_PDS_URL` to `http://pds:3000` and `LISTEN_PORT` to `8081`. They do not set `HEALTH_PORT`. The image `HEALTHCHECK` then uses 8081, which is also the schema default.
