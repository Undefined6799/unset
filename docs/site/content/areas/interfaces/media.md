---
title: media
weight: 3
---

Serves a signed draft link from the object store. Package `@unset/interfaces-media`. [ADR 0070](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0070-shared-image-foundation.md) is the decision (Accepted by Alex, 2026-11-20). Point 3's size is amended by [ADR 0088](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0088-picture-main-version-webp-5mb.md) (Proposed). The plan is [`docs/ai/PLAN.md`](https://github.com/Undefined6799/unset/blob/main/docs/ai/PLAN.md).

## Owns

`interfaces/media/main.ts` loads settings with `bootOrExit` and exits 78 when they are invalid, then listens. `interfaces/media/compose.ts` is the composition root: a net-guard, an object-store read with a 5000 ms timeout, and `mediaListener`. It builds nothing else.

`interfaces/media/serve.ts` is the door.

| Request | Answer |
| --- | --- |
| `GET /health` | 200, body `{"healthy":true}` |
| `GET` or `HEAD` whose path `verifyDraftPath` accepts | 200 with the object bytes, 404 when the read is ok and the bytes are missing or longer than `MAX_BYTES` (`5 * 1024 * 1024`), 503 when the read is not ok |
| `GET` or `HEAD` that `verifyDraftPath` refuses | 404 |
| Any other method | 405, header `allow: GET, HEAD` |
| A thrown read | 503 |

`verifyDraftPath` is `domains/content/images/draft-url.ts`. Its one purpose on this tree is `draft-preview`. The object key that purpose accepts is under `drafts/`.

Every answer from `serve.ts` sets `content-security-policy` to `default-src 'none'; sandbox`, `x-content-type-options` to `nosniff`, `referrer-policy` to `no-referrer` and `cross-origin-resource-policy` to `cross-origin`. A 200 also sets `content-type` from the key's extension (`avif`, `webp`, `jpeg`), `content-disposition: inline` and `cache-control: private, max-age=…` (at most 300 seconds, and not past the link's `exp`). Any other status sets `cache-control: no-store` and `content-length: 0`. The file does not read or write a cookie header.

`main.ts` logs `media.request` with the route template and the status. A path under `/o/` is logged as `/o/:purpose/*`.

| Path | What it holds |
| --- | --- |
| `interfaces/media/main.ts` | Process start. `requestTimeout` 15000, `headersTimeout` 10000, `maxHeaderSize` 16384. |
| `interfaces/media/compose.ts` | Composition root. `objectStoreFetch` from `@unset/infrastructure-net-guard`. |
| `interfaces/media/serve.ts` | `mediaListener`. |
| `interfaces/media/config.ts` | `schema`: net-guard fields, `DRAFT_URL_KEYRING`, and the object-store origin, bucket, access id and secret file. |

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
| Start | `interfaces/media/main.ts` |
| Composition root | `interfaces/media/compose.ts` |
| Listen | `server.listen(config.LISTEN_PORT)`. `LISTEN_PORT` is a required key of `defineEntrypointConfig` (`shared/config/schema.ts`) and has no default. |

No Dockerfile under `deployment/images/` names this process. No `package.json` script starts it.

## Data

The process reads one object per accepted link, through `store.get` (`infrastructure/storage`). It writes no object and no row.

`config.ts` has no Postgres fields. `roles.json` still has a `media` role (`connectionLimit` 10, `passwordFrom` null). This process does not open a pool. `infrastructure/postgres/roles.ts` syncs a password only when `passwordFrom` is not null.

The link keys are `DRAFT_URL_KEYRING` (`keyringFile` from `@unset/infrastructure-seal`). The store secret is `OBJECT_STORE_SECRET`, a secret file of at least 32 bytes.

## How it runs

No Compose service is named `media`.

| File | `media` service |
| --- | --- |
| `deployment/compose.dev.yaml` | absent |
| `deployment/compose.dev.source.yaml` | absent |
| `deployment/compose.local.yaml` | absent |

`SOURCE_ONLY_SERVICES` in `deployment/preflight/local-only.ts` is `pds-admin`, `indexer` and `review`. `npm run dev:up`, `npm run dev:source:up` and `npm run local:up` start those files and do not start this process. The service table is on [Compose](../../deployment/compose/).
