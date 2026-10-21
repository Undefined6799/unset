---
title: What unset is
weight: 1
---

unset.sh is an identity and profile app for the [AT Protocol](https://atproto.com). The short description is the [README](https://github.com/Undefined6799/unset/blob/main/README.md). The profile record type is `sh.unset.profile` (`shared/lexicons/schemas/sh.unset.profile.json`): one per account, described there as the public page at `unset.sh/@handle`. Nothing on this tree writes that record or serves `/@handle`. What is built is [Status](../status/).

The same README calls the repository a rebuild of the 0x40 prototype around a small core. Decisions that are expensive to reverse are ADRs. The index is [`docs/human/decisions/README.md`](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/README.md). Public names are [ADR 0025](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0025-public-domains.md). The licence split is [ADR 0012](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0012-licence.md).

| File | `license` |
| --- | --- |
| root `package.json` | `AGPL-3.0-only` |
| each `package.json` under `shared/` | `MIT` |

`LICENSE` is the AGPL text. `LICENSE-MIT` is the MIT text.

## Who it is for

| Source | Statement |
| --- | --- |
| [README](https://github.com/Undefined6799/unset/blob/main/README.md) Status | Not usable yet. No public launch, invite-only included, until all six phases are done. |
| `apps/web/src/screens/welcome/messages.ts` | `termsLead` is "unset.sh is invite-only." |
| [PLAN.md](https://github.com/Undefined6799/unset/blob/main/docs/ai/PLAN.md) §8 | A closed test track from the end of Phase 2. The plan says it is not a launch. |

`GET /legal/terms`, `GET /legal/privacy` and `GET /legal/domains` render the English files under the banner in `LEGAL.banner` (`apps/web/src/shell/messages.ts`), shown by `apps/web/src/screens/Legal.tsx`: "This page is a placeholder. It has not been reviewed by a lawyer, and it is not legal advice." The files are `apps/web/legal/terms.en.md`, `apps/web/legal/privacy.en.md` and `apps/web/legal/domains.en.md`, inlined by `apps/web/src/legal/documents.ts`. That file says French files land in the i18n slice. There is no `shared/i18n`. (planned, P1.19; [PLAN.md](https://github.com/Undefined6799/unset/blob/main/docs/ai/PLAN.md) §8)

## What the http app is

| Piece | Where |
| --- | --- |
| Node | `.nvmrc` is `26.12.0`. Root `package.json` `engines.node` is `>=26.0.0`. |
| Server | Hono `4.13.13` and `@hono/node-server` `2.1.5` in `shared/http/package.json`. `shared/http/server.ts` imports `Hono`. |
| Screens | React `19.3.0` in `apps/web/package.json`. Package `@unset/apps-web`. [web](../../areas/apps/web/) |
| Shell | `apps/web/src/shell/AppShell.tsx`. The human note is [`docs/human/features/core-shell.md`](https://github.com/Undefined6799/unset/blob/main/docs/human/features/core-shell.md). |
| OAuth client | `@atproto/oauth-client-node` `0.5.9` in `infrastructure/pds/package.json`. |
| Framework decision | [ADR 0015](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0015-web-framework-glue.md) |

`interfaces/http/package.json` depends on `@unset/apps-web`, `@unset/domains-identity`, `@unset/infrastructure-pds`, `@unset/infrastructure-postgres`, `@unset/infrastructure-seal`, `@unset/infrastructure-session`, `@unset/infrastructure-net-guard` and `@unset/infrastructure-audit`.

## What a browser can open

Routes are `interfaces/http/routes.manifest.json`.

| Route | What the handler renders |
| --- | --- |
| `GET /` | Landing placeholder. `apps/web/src/screens/Home.tsx` renders a visually hidden heading. |
| `GET /legal/terms`, `/legal/privacy`, `/legal/domains` | English document plus the placeholder banner. `interfaces/http/routes/legal.ts` |
| `GET /login`, `POST /login`, `GET /login/continue` | Sign-in form, then the handoff. `interfaces/http/routes/login.ts` |
| `GET /oauth/callback` | Return from the authorization server. `interfaces/http/routes/oauth-callback.ts` |
| `POST /logout`, `GET /signed-out` | Sign-out routes. `interfaces/http/routes/logout.ts` |
| `GET /verify-email`, `POST /verify-email/reconsent` | Confirmed-email page. `interfaces/http/routes/verify-email.ts` takes `sessionInfo` and has no mail sender in its dependencies. |
| `GET /welcome`, `GET` and `POST /welcome/age`, `/welcome/terms`, `/welcome/chat`, `GET /welcome/blocked` | Onboarding. `interfaces/http/routes/welcome.ts`. Screens are `apps/web/src/screens/welcome/`. `ChatLater.tsx` says chat is not open. |
| `GET /did`, `GET /me` | `303` to `/<DID>` of the session. `interfaces/http/routes/me.ts` |
| `GET /:did` | The caller's own account page: handle, DID, a PDS link when the recorded issuer can be read, and sign out. Another DID is `http.not_found`. The file says this is not a public profile. |
| `GET /settings/profile` | The heading `Profile`. `apps/web/src/screens/SettingsProfile.tsx` says the body is a placeholder. |
| `POST /prefs/theme` | Theme form. `interfaces/http/routes/prefs.ts` |
| `GET /health`, `GET /assets/:file`, `GET /oauth-client-metadata.json`, `GET /oauth/jwks.json`, `GET /.well-known/security.txt` | Listed in the manifest. `security.txt` is built in `interfaces/http/security-txt.ts`. |

Sign-in on this tree is one PDS issuer. `pdsIssuerOf` in `interfaces/http/config.ts` builds it as `http` or `https` plus `PDS_HOSTNAME`, from `OAUTH_ALLOW_HTTP`. `authorize` in `infrastructure/pds/oauth/sign-in.ts` refuses an `http:` or `https:` input that is not exactly that issuer. `didResolverForOAuth` in `infrastructure/pds/oauth/identity-resolvers.ts` throws `AccountElsewhereError` when the resolved PDS origin is not that issuer. `completeAuthorization` revokes the grant and refuses when `session.serverMetadata.issuer` is not that issuer. [ADR 0025](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0025-public-domains.md) names P1.33p as the later opening. The book steps are `P1.36v` and `P1.33p` in `docs/ai/book/phase-1.md`.

The account page shows `displayHandle` from `domains/identity/verify-handle.ts`. `createHandleVerifier` returns `verifyHandle`. `check` keeps a handle when the DID document claims it and `resolveHandle` (`domains/identity/resolve-handle.ts`) returns that same DID.
