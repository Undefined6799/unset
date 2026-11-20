---
title: Data flow
weight: 3
---

`GET /[did]` is the signed-in member's own page (`interfaces/web/src/routes/[did=did]/+page.server.ts`). A path that is not that member's DID is missing. `GET /@[actor]` is a public profile, read from the index, not from a PDS on the request. `GET /` is a public page.

## Path

1. **Edge.** Dev forwards to the edge, which proxies to `web:8080`. The address the process sees depends on `TRUSTED_PROXY_MODE` (`shared/http/trustedProxy.ts`). The dev stack sets `socket` (`deployment/compose.dev.yaml`). Networks are on [Processes](../processes/).
2. **`interfaces/web/server.ts`.** Host check, security headers and one log line, for every response, files included.
3. **Hook** (`interfaces/web/src/hooks.server.ts`). The order of checks is on [Security model](../security-model/). This route's policy is `writes` (`interfaces/web/src/routes/[did=did]/policy.ts`): a visitor is sent to sign-in, and a POST needs a session. `interfaces/web/src/lib/server/app-gate.ts` then checks onboarding and the email cache. The cookie is `__Host-sid` (`interfaces/web/src/lib/server/session.ts`).
4. **Page.** The path DID must be the session DID. Profile and cards are read from that member's PDS (`own-profile.server.ts`). A handle is shown only when `domains/identity/verify-handle.ts` resolves it back to the same DID. The issuer link is `Session.issuerOrigin` ([ADR 0048](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0048-session-issuer-origin.md)).
5. **Render.** `apps/web/lib/components/profile/` draws the page. The group's CSP is set on the way out.

`GET /me` (`interfaces/web/src/routes/me/+server.ts`) redirects to `/${did}`.

## Postgres and the PDS

Our Postgres holds the app's rows. The account's repo stays on its PDS. This request uses schema `app` (`infrastructure/postgres/migrations/0002_schemas.sql`).

| In Postgres, role `web` | On the account's PDS |
| --- | --- |
| `app.session`: cookie hash, DID, timestamps, the email-confirmation cache, `issuer_origin`. The raw cookie is not stored. | The account repo. This page reads the profile and card records. |
| `app.oauth_session`: a session counts only while a token set for that DID remains. | Sign-in and the OAuth grant. |
| `app.account`: onboarding. The birth date is not a column. | |

`web` reaches Postgres on the `db` network and the public network through `infrastructure/net-guard`. `interfaces/web/src/lib/server/compose.ts` passes `libraryFetch(guard)` to the OAuth client.
