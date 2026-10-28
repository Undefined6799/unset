---
title: pds
weight: 3
---

The atproto network adapter. Package `@unset/infrastructure-pds`. Identity lookups are [ADR 0013](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0013-identity-network-port.md). The OAuth client is [ADR 0021](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0021-atproto-oauth-client.md). PDS calls are [ADR 0024](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0024-atproto-api-agent.md). Web egress is [ADR 0022](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0022-web-egress-and-shared-plc.md), decided (0001 log), acceptance pending.

## Owns

| Module | What it holds |
| --- | --- |
| `infrastructure/pds/identity-network.ts` | `createIdentityNetwork`. Implements the identity domain's `IdentityNetwork` on net-guard. |
| `infrastructure/pds/oauth/oauth-client.ts` | `createOAuthClient`, `ClientKeys`, `clientMetadata`, `publicJwks`, `oauthFields`. |
| `infrastructure/pds/oauth/identity-resolvers.ts` | Handle and DID resolvers the client library is given. Not exported from `index.ts`. |
| `infrastructure/pds/oauth/scopes.ts` | `grantCovers`, `SCOPE_METADATA`. Uses `@atproto/oauth-scopes`. |
| `infrastructure/pds/oauth/sign-in.ts` | `authorize`, `completeAuthorization`. |
| `infrastructure/pds/pds-call.ts` | `createPdsCall`. The file that calls `client.restore` and `new Agent`. |
| `infrastructure/pds/pds-errors.ts` | `isAuthFatal`, `isDpopNonceHandshake`. |

`createIdentityNetwork` throws `ConfigError` on `PLC_URL` unless the URL is `https:` and its host is in the `plc` policy's host list. `get` uses policy `plc` when the request target is `plc`, and `atproto` otherwise. A body cap in this file is 64 KiB, and the call also passes `Math.min(request.maxBytes, MAX_BYTES)`. `txt` uses `resolveTxt`. Net-guard errors map through the `FAILURE` record onto `unavailable`, `refused` and `no_such_host`. Any other thrown value is rethrown.

`createOAuthClient` builds `NodeOAuthClient` with the caller's state store, session store, `requestLock`, `fetch`, and the resolvers from `identity-resolvers.ts`. `onSessionDeleted` logs a reason word. `ownIssuerOnly` sends the library's fetch only when the URL origin equals `ownIssuer`.

`oauthFields` allows `OAUTH_ALLOW_HTTP: true` only when `UNSET_ENV` is `dev`. `deployment/preflight/checks/local-only-keys.ts` (C29) refuses that key unless the stage is `local`. `interfaces/http/compose.ts` passes `cfg.OAUTH_ALLOW_HTTP` as `allowHttp`.

`createPdsCall` takes `endSessions` and `tokenSetRemains` as arguments. The file's comment says this package does not import `infrastructure/session`. The [`infrastructure` row](../) allows `net-guard` and `seal` beside the package's own folder, not `session`.

## May import

The [`infrastructure` row](../). This package imports `net-guard` and does not import `seal` or `postgres`.

Declared in `infrastructure/pds/package.json`:

| Dependency | Version |
| --- | --- |
| `@atproto/api` | 0.27.0 |
| `@atproto/jwk-jose` | 0.2.4 |
| `@atproto/oauth-client-node` | 0.5.9 |
| `@atproto/oauth-scopes` | 0.5.13 |
| `@unset/domains-identity` | workspace |
| `@unset/infrastructure-net-guard` | workspace |
| `@unset/shared-config` | workspace |
| `@unset/shared-errors` | workspace |
| `@unset/shared-lexicons` | workspace |
| `@unset/shared-log` | workspace |

`vendor-sdk-one-adapter` confines `@atproto/oauth-client-node` and `@atproto/api` to this folder. `pds-call.guard.test.ts` walks `.ts` and `.tsx` from the repository root. It skips `node_modules`, `dist`, `.git`, `tests` and `*.test.ts`. It allows `client.restore(` or `@atproto/api` together with `new Agent(` only in `infrastructure/pds/pds-call.ts`.

## Entry points

| Role | Path |
| --- | --- |
| Package export `.` | `infrastructure/pds/index.ts` |
| Composition | `interfaces/http/compose.ts` |

No `main.ts` and no Compose service for this package. The `pds` service in `deployment/compose.dev.yaml` runs the first-party `ghcr.io/undefined6799/unset/pds` image by lock digest, built from `deployment/pds/Dockerfile` (P2.24y), not this folder. `deployment/compose.dev.source.yaml` builds `pds` from `deployment/pds/Dockerfile`.

## Data

No SQL in this package. The OAuth state and token-set stores are `infrastructure/postgres/oauthStores.ts`, passed in. Tables `app.oauth_state` and `app.oauth_session` are on the [postgres](../postgres/) page. `createPdsCall`'s `endSessions` is how a dead grant reaches `infrastructure/session` `destroyAllForDid`; the function is an argument, not an import.
