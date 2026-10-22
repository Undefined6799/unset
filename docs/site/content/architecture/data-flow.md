---
title: Data flow
weight: 3
---

`GET /:did` is the signed-in account page (`interfaces/http/routes/me.ts`). It is the request that crosses the edge, the `web` process, Postgres and the account's PDS. `GET /` does not: it renders a public page and reads no cookie (`interfaces/http/routes/home.ts`).

## Path

1. **Edge.** Under dev, Newt forwards to the edge on `newt_edge` `10.250.37.3`. `deployment/edge/dev/app.caddy` binds that address, applies the app rate-limit zone, then `import upstream` to `web:8080`. The upstream snippet drops `X-Forwarded-For`, `X-Real-IP` and `Forwarded` (`deployment/edge/snippets/upstream.caddy`). Compose sets `TRUSTED_PROXY_MODE=socket` on web, so the client address the process sees is the edge's socket (`shared/http/config.ts`).
2. **Kit, before the handler** (`shared/http/server.ts`). A request id, then the host against `HTTP_ALLOWED_HOSTS`, then method and path. Anything other than `GET`, `HEAD` or `POST` stops. This route's policy is `default` (`interfaces/http/limits.ts`): an IP bucket and a global bucket, in memory (`shared/http/limits/rateLimit.ts`). `GET` does not pass the CSRF gate. The route sets `session: "none"`, and `interfaces/http/compose.ts` does not pass a session reader, so the kit's session slot does not run. `"none"` does not mean the page is public. Both layers are on the [security model](../security-model/).
3. **Handler gate** (`interfaces/http/app-gate.ts`, `openApp`). The cookie is `__Host-sid` (`interfaces/http/session-cookie.ts`). `infrastructure/session/store.ts` looks up `sha256` of that value in `app.session`, on the `web` pool. A row counts only while `app.oauth_session` still holds a token set for the same DID. `domains/identity` then decides onboarding (`requireOnboarded`) and whether the cached email confirmation is stale (`emailGate`). A stale cache calls the PDS (`interfaces/http/email-refresh.ts`). A transient answer past 4 × `EMAIL_RECHECK_S` shows the PDS-unavailable page and keeps the session. A missing session redirects to `/login`.
4. **Ownership and handle.** The path DID must equal the session DID; otherwise the handler throws `http.not_found`. `domains/identity/verify-handle.ts` shows a handle only when the DID document's claim resolves back to the same DID. The network is the `IdentityNetwork` port (`domains/identity/contract.ts`), implemented in `infrastructure/pds` on net-guard. The account link is the issuer stored on the OAuth token set (`interfaces/http/compose.ts`, `issuerOf`), not a field from the DID document.
5. **Render.** `apps/web` renders the page. On the way out the kit sets the route group's security headers (`shared/http/server.ts`, `secured`).

`GET /did` and `GET /me` run the same gate and redirect to `/${did}`.

## Postgres and the PDS

Our Postgres holds the app's own rows. The account's repo stays on its PDS. Schemas created in `infrastructure/postgres/migrations/0002_schemas.sql`: `app`, `idx`, `audit`, `types`. This request touches `app`.

| In Postgres, role `web` | On the account's PDS |
| --- | --- |
| `app.session`: hash of the cookie id, DID, timestamps, a cache of `emailConfirmed` (migration 0011). The raw cookie is not stored. | Sign-in and the OAuth grant. `emailConfirmed` is read from the PDS when the cache is stale. |
| `app.oauth_state`, `app.oauth_session`: sealed authorization state and token set (migration 0013). A dump of the column does not open the seal (`infrastructure/seal`). | The account repo and its records. This page does not read a profile record. |
| `app.account`: onboarding state, terms and privacy versions, `age_confirmed_at` (migration 0015). The birth date is not a column. | |

`web` reaches Postgres on the `db` network. It reaches the PDS, the PLC and handle DNS on `web_egress`, through `infrastructure/net-guard` (`interfaces/http/compose.ts` passes `libraryFetch(guard)` to the OAuth client). Under dev `NETGUARD_INTERNAL_HOSTS` is absent, so the config default is an empty list and those answers have to be public addresses ([ADR 0031](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0031-public-staging-pds.md) Decision 3). The table by environment is on [Processes](../processes/). [ADR 0022](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0022-web-egress-and-shared-plc.md) (decided (0001 log), acceptance pending) and ADR 0031 do not conflict.
