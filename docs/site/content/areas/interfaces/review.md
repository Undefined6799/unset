---
title: review
weight: 5
---

Decodes a member's picture in child processes and returns the versions to web. Package `@unset/interfaces-review`. [ADR 0070](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0070-shared-image-foundation.md) is the decision (Accepted by Alex, 2026-11-20). The upload size in that record is superseded in part by [ADR 0076](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0076-image-uploads-up-to-64-mib.md) (Accepted by Alex, 2026-11-20). The plan is [`docs/ai/PLAN.md`](https://github.com/Undefined6799/unset/blob/main/docs/ai/PLAN.md).

## Owns

`interfaces/review/main.ts` loads settings with `bootOrExit` and exits 78 when they are invalid, then listens. `interfaces/review/compose.ts` is the composition root. It builds `createImagePool` and `reviewListener` from `@unset/infrastructure-image`, and nothing else: no secret, no pool, no outbound client.

The door is `reviewListener` in `infrastructure/image/serve.ts`.

| Request | Answer |
| --- | --- |
| `GET /health` | 200 `{ healthy: true }` |
| `POST /v1/process` (`PROCESS_PATH` in `infrastructure/image/wire.ts`) | The job header and the body checks in `serve.ts`, then `processor.process` |
| Any other method or path | 404 |

`main.ts` logs `review.job` with the outcome and, when a job ran, `ms`. It logs `review.pool` with the event name. A pool event `down` is `log.error`; the others are `log.info`.

| Path | What it holds |
| --- | --- |
| `interfaces/review/main.ts` | Process start. Request timeout is `REVIEW_TIMEOUT_MS * 2`. Header timeout is the minimum of 10000 and that. `maxHeaderSize` 16384. |
| `interfaces/review/compose.ts` | Composition root. |
| `interfaces/review/config.ts` | `schema`. Every field is a number. |

Schema defaults in `config.ts`: `REVIEW_CHILDREN` 2 (1 to 8), `REVIEW_QUEUE` 2 (0 to 16), `REVIEW_TIMEOUT_MS` 20000 (1000 to 25000), `REVIEW_ADDRESS_SPACE_MB` 8192 (2048 to 16384).

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
| Start | `interfaces/review/main.ts` |
| Composition root | `interfaces/review/compose.ts` |
| Image | `ENTRYPOINT ["node", "interfaces/review/main.ts"]` in `deployment/images/review.Dockerfile`. `EXPOSE 8082`. The `HEALTHCHECK` fetches `LISTEN_PORT`, or 8082 when that variable is unset. |
| Listen | `server.listen(config.LISTEN_PORT)`. `LISTEN_PORT` is a required key of `defineEntrypointConfig` (`shared/config/schema.ts`) and has no default. |

## Data

`compose.ts` opens no database pool and constructs no store client. `config.ts` has no Postgres fields and no secret field.

`roles.json` has `review` (`connectionLimit` 4, `passwordFrom` null) and `review_egress` (`connectionLimit` 2, `passwordFrom` null). This process does not connect as either role. `infrastructure/postgres/roles.ts` syncs a password only when `passwordFrom` is not null.

The bytes in and the versions out are the body of `POST /v1/process`. `serve.ts` reads at most the declared `content-length`, and refuses a length above the job's `maxBytes` or `JOB_CEILING.maxBytes`.

## How it runs

Service `review`. The service table is on [Compose](../../deployment/compose/).

| Fact | Where |
| --- | --- |
| `deployment/compose.dev.source.yaml` | Defines service `review`. |
| `deployment/compose.local.yaml` | Defines service `review`. |
| `deployment/compose.dev.yaml` | No `review` service. |
| `SOURCE_ONLY_SERVICES` | `deployment/preflight/local-only.ts` includes `review`. |
| Networks on the service | `review_web` |
| `npm run dev:source:up` | `deployment/compose.dev.source.yaml` |
| `npm run local:up` | `deployment/compose.local.yaml` |
| `npm run dev:up` | `deployment/compose.dev.yaml` |

Both files that define the service set `UNSET_SERVICE` to `review` and `LISTEN_PORT` to `8082`. They set no `REVIEW_*` variable, so the schema defaults apply. The service has no `secrets:` key. `deployment/networks.dev.json` marks `review_web` internal, members `web` and `review`.
