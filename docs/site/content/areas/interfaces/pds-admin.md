---
title: pds-admin
weight: 4
---

Issues a member invite when web asks, and holds the PDS admin password for that call. Package `@unset/interfaces-pds-admin`. [ADR 0060](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0060-pds-admin-issues-member-invites.md) is the decision (Proposed, awaiting Alex). The plan is [`docs/ai/PLAN.md`](https://github.com/Undefined6799/unset/blob/main/docs/ai/PLAN.md).

## Owns

`interfaces/pds-admin/main.ts` reads config, composes, and listens. A boot failure writes one line naming the setting, never a value, and exits 1. This process does not use `bootOrExit`.

`interfaces/pds-admin/server.ts` answers two routes. Anything else is 404.

| Request | What the handler does |
| --- | --- |
| `GET /health` | 200, `{ ok: true, commit }` |
| `POST /v1/invite.issue` | The checks in `server.ts`, then `issueInvite` |
| Any other method or path | 404 `{ error: "not_found" }` |

`POST` refuses before the body when `ready()` is false (503, log reason `password_unproven`). A body that is not `application/json`, or is over 4096 bytes, or is not the envelope shape, is 400. `envelope.ts` then checks the key, the verb, the signature and the claims. `jti.ts` records the `jti` before `issueInvite`. `issue.ts` checks sign-ups, the inviter's account and subject status, and both quotas, then `pds.createInviteCode`. Outcomes and status codes are the `answerFor` switch in `server.ts`.

| Path | What it holds |
| --- | --- |
| `interfaces/pds-admin/main.ts` | Process start. `requestTimeout` 15000, `headersTimeout` 10000. |
| `interfaces/pds-admin/compose.ts` | Composition root. |
| `interfaces/pds-admin/config.ts` | `readConfig`. Secrets are files under `PDS_ADMIN_SECRETS_DIR` (default `/run/secrets`). |
| `interfaces/pds-admin/server.ts` | The HTTP handler. |
| `interfaces/pds-admin/envelope.ts` | Envelope shape, key, signature, claims. |
| `interfaces/pds-admin/jti.ts` | Replay file. |
| `interfaces/pds-admin/issue.ts` | Standing, quotas, the create call. |
| `interfaces/pds-admin/quota.ts` | The two caps. |
| `interfaces/pds-admin/pds.ts` | The only file here that calls `request` from `node:http`. `createPds` puts the password in a Basic header, user `admin`. |
| `interfaces/pds-admin/log.ts` | The request log and `verifyLog`. |
| `interfaces/pds-admin/cli.ts` | `verify-log` and `check-reserved`. Not the image entrypoint. |
| `interfaces/pds-admin/reserved-labels.json` | Labels `check-reserved` asks the PDS about. |

`config.ts` accepts one key, issuer `web`, one verb `invite.issue`, Ed25519. `PDS_INTERNAL_URL` must be an `http` origin.

## May import

`ADMIN_SERVICES` in `scripts/lint/.dependency-cruiser.cjs` is `^interfaces/(pds-admin|chat-admin)/`. The `interface` row's `pathNot` is that pattern, so this folder is not on the `interface` row. dependency-cruiser 18.7.0 is pinned in `package.json`. `ZERO_DEP_ALLOWLIST` is `shared/admin-envelope/`.

| Rule | Effect |
| --- | --- |
| `admin-service` | Own folder, `ZERO_DEP_ALLOWLIST`, and Node built-ins (`dependencyTypes: core`). The row has no npm entry. |
| `admin-services-zero-deps` | The same bound, as a forbidden rule. |
| `allowlist-zero-deps` | A `ZERO_DEP_ALLOWLIST` folder imports only `node:*` and its own files. |
| `no-interface-to-interface` | No other `interfaces/` folder. |
| `no-product-imports-tooling` | No `scripts/` or `tests/`. |
| `app-render-entry-only` | No `apps/`. |

`interfaces/pds-admin/package.json` depends on `@unset/shared-admin-envelope` and names no other package.

## Entry points

| Role | Path |
| --- | --- |
| Start | `interfaces/pds-admin/main.ts` |
| Composition root | `interfaces/pds-admin/compose.ts` |
| Image | `ENTRYPOINT ["node", "interfaces/pds-admin/main.ts"]` in `deployment/images/pds-admin.Dockerfile` |
| Operator commands | `node cli.ts verify-log <file>` and `node cli.ts check-reserved` (`PDS_INTERNAL_URL`, `HANDLE_DOMAIN`) in `interfaces/pds-admin/cli.ts` |
| Listen | `config.port`, from `PORT`, default 8080 (`config.ts`) |

## Data

No Postgres pool and no row in `roles.json` for this process.

| Store | Path | What it holds |
| --- | --- | --- |
| Replay file | `STATE_DIR/jti.log` | `jti` and `exp`, written by `jti.burn` before the invite call. `compact` drops a `jti` 120 seconds after `exp`. `main.ts` calls `compactDaily` on a 86400000 ms timer. |
| Request log | `STATE_DIR/log.jsonl` | One JSON line per outcome. `actorDid`, `targetDid` and `code` are stored as HMAC-SHA256 under `pds_admin_log_key` (`log.ts`). `verifyLog` checks `seq`, `prev` and `hash`. |

`pds.ts` calls `getAccountInfo`, `getSubjectStatus`, `createInviteCode` and `resolveHandle` on `PDS_INTERNAL_URL`. `resolveHandle` is the `check-reserved` command. Each lookup refuses a public address (`allInternal` in `pds.ts`). At boot, `resolvesInternal` returning `public` throws, and `probePassword` returning `refused` throws. An unresolved name does not throw: `ready()` stays false until a later probe is `accepted` (`compose.ts`).

Secret files, read by `config.ts`: `pds_admin_password`, `pds_admin_log_key` (32 bytes of base64), `pds_admin_keys`.

## How it runs

Service `pds-admin`. The service table is on [Compose](../../deployment/compose/).

| Fact | Where |
| --- | --- |
| `deployment/compose.dev.source.yaml` | Defines service `pds-admin`. |
| `deployment/compose.local.yaml` | Defines service `pds-admin`. |
| `deployment/compose.dev.yaml` | No `pds-admin` service. |
| `SOURCE_ONLY_SERVICES` | `deployment/preflight/local-only.ts` includes `pds-admin`. |
| Networks on the service | `pds_admin`, `pds_admin_pds` |
| Volume | `pdsadmindata` at `/app/state` (`STATE_DIR`). The image creates that directory mode `0700`. |
| Secrets on the service | `pds_admin_password`, `pds_admin_keys`, `pds_admin_log_key` |
| `npm run dev:source:up` | `deployment/compose.dev.source.yaml` |
| `npm run local:up` | `deployment/compose.local.yaml` |
| `npm run dev:up` | `deployment/compose.dev.yaml` |

Both files that define the service set `PDS_ADMIN_ENV` to `dev`, `PDS_INTERNAL_URL` to `http://pds:3000`, `SIGNUPS_OPEN` to `true`, `STATE_DIR` to `/app/state` and `PORT` to `8080`.
