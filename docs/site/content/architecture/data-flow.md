---
title: Data flow
weight: 3
---

`GET /:did` is the signed-in account page (`interfaces/http/routes/me.ts`). Public pages such as `GET /` use the same kit and do not call `openApp`.

## One request

| Step | Code | What happens |
| --- | --- | --- |
| 1 | `deployment/compose.dev.yaml`, `deployment/edge/snippets/upstream.caddy` | The edge reverse-proxies to `web:8080` (`APP_UPSTREAM`). The upstream snippet removes `X-Forwarded-For`, `X-Real-IP` and `Forwarded`. Dev publishes no host port; Newt is on `newt_edge`. Local publishes `127.0.0.1:443`. |
| 2 | `shared/http/server.ts` `handle` | Request id, host check against `HTTP_ALLOWED_HOSTS` (skipped for `/health`), trusted proxy, method check. This GET then takes the IP bucket of policy `default`. |
| 3 | `interfaces/http/app-gate.ts` `openApp` | Session, then onboarding, then the email gate. A missing session is a 303 to `/login`. |
| 4 | `infrastructure/session/store.ts` | Reads `app.session` by the sha256 of cookie `__Host-sid`, on the `web` pool. A bad cookie, expiry, or no row in `app.oauth_session` for that DID clears the cookie. |
| 5 | `interfaces/http/account.ts`, `domains/identity` `requireOnboarded` | Reads `app.account`. The domain returns pass, welcome, terms or blocked. |
| 6 | `interfaces/http/email-refresh.ts` | When the cached confirmation is stale, asks the PDS through `createPdsCall` and writes `email_confirmed` on the session row. |
| 7 | `domains/identity/verify-handle.ts` | Handle check for the session DID. Lookups use `IdentityNetwork`, implemented in `infrastructure/pds/identity-network.ts` on net-guard. |
| 8 | `apps/web` screen `me` | The http process renders the page. `secured` in `shared/http/server.ts` sets the group's security headers on the way out. |

A session read that fails throws `service.unavailable` (`store.ts` `unavailable`). That code is HTTP 503 (`shared/errors/catalog.ts`). The cookie stays.

The account link on the page is the `iss` stored on the OAuth token set (`issuerOf` in `interfaces/http/compose.ts`). It is the value recorded at sign-in.

## Kit order

`middlewareOf` in `shared/http/server.ts` records the checks. Security headers are applied to the finished response, after the handler.

| Order | Check | When |
| --- | --- | --- |
| 1 | `requestId` | every route |
| 2 | `hostCheck`, `trustedProxy` | every route except `/health` |
| 3 | `methodCheck` | every route |
| 4 | `contentTypeCheck`, `bodyLimit` | `POST` |
| 5 | `rateLimitIp` | policy other than `exempt` |
| 6 | `csrf` | `POST` |
| 7 | `session`, `rateLimitDid` | `session: "required"` only |
| 8 | handler | |
| 9 | security headers | every response, including errors |

Every route in `interfaces/http/routes.manifest.json` (30 rows) omits `requiresSession`. Each `defineRoute` in `interfaces/http/routes/` sets `session: "none"`, and the handler calls `openApp` where a session is required. The kit slot in row 7 is unused on this process.

## Postgres and the PDS

Postgres database `unset`, role `web`. Grants are `infrastructure/postgres/grant-matrix.json`. The PDS is the user's account server (the dev stack runs Bluesky's image). Our PDS issuer is `https://${PDS_HOSTNAME}` unless `OAUTH_ALLOW_HTTP` is set (`pdsIssuerOf` in `interfaces/http/config.ts`).

| In Postgres | On the PDS |
| --- | --- |
| `app.session`: id hash, DID, timestamps, email-confirmation cache | The account, its repo, and the email-confirmation answer the cache copies |
| `app.oauth_state.sealed` and `app.oauth_session.sealed`, sealed per row (`infrastructure/postgres/oauthStores.ts`, `infrastructure/seal`) | The OAuth grant the token set refers to |
| `app.account`: onboarding, terms and privacy versions, age confirmation | Records and blobs |

`did:plc` documents use net-guard policy `plc`, fixed host `plc.directory` (`infrastructure/net-guard/src/policies.ts`). Other AT Protocol HTTPS calls use policy `atproto`. Both Compose files set `PLC_URL` to `https://plc.directory`. Web and the PDS container share no network on the dev stack ([Processes](processes.md)). The dev path is [ADR 0031](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0031-public-staging-pds.md).
