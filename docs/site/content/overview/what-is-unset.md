---
title: What unset is
weight: 1
---

unset.sh is an identity and profile app for the [AT Protocol](https://atproto.com). The short description is the [README](https://github.com/Undefined6799/unset/blob/main/README.md). The profile record is `sh.unset.profile` (`shared/lexicons/schemas/sh.unset.profile.json`): one per account, described there as the side column of the page at `unset.sh/@handle`. `GET /@[actor]` serves a public profile from the index (`interfaces/web/src/routes/@[actor]/`). `POST /profile` writes the signed-in member's record to their own PDS (`interfaces/web/src/routes/profile/`, `infrastructure/pds/profile-record.ts`). What is built is [Status](../status/).

The same README calls the repository a rebuild of the 0x40 prototype around a small core. Decisions that are expensive to reverse are ADRs. The index is [`docs/human/decisions/README.md`](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/README.md). Public names are [ADR 0025](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0025-public-domains.md). The licence split is [ADR 0012](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0012-licence.md).

| File | `license` |
| --- | --- |
| root `package.json` | `AGPL-3.0-only` |
| each `package.json` under `shared/` | `MIT` |

`LICENSE` is the AGPL text. `LICENSE-MIT` is the MIT text.

## Who it is for

The README Status line says not usable yet. `interfaces/web/src/routes/welcome/messages.ts` sets `termsLead` to "unset.sh is invite-only. The terms and the privacy notice say what joining means."

`GET /legal/terms`, `/legal/privacy` and `/legal/domains` render `apps/web/legal/terms.en.md`, `privacy.en.md` and `domains.en.md`. The page shows the banner in `interfaces/web/src/routes/legal/[document=legal]/+page.svelte`: "This page is a placeholder. It has not been reviewed by a lawyer, and it is not legal advice."

## What the web app is

| Piece | Where |
| --- | --- |
| Node | `.nvmrc` is `26.12.0`. Root `package.json` `engines.node` is `>=26.0.0`. |
| Server | SvelteKit `3.2.0` and adapter-node. Package `@unset/interfaces-web`. [web](../../areas/interfaces/web/). [ADR 0054](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0054-web-process-on-sveltekit.md) |
| Screens | Svelte `5.57.3`. Package `@unset/apps-web`. [web](../../areas/apps/web/). [ADR 0055](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0055-shadcn-svelte-and-one-theme-file.md) |
| Boundary | Server files may reach a domain or infrastructure. A screen may not. [ADR 0056](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0056-web-boundary-by-file-kind.md) |
| OAuth client | `@atproto/oauth-client-node` `0.5.16` in `infrastructure/pds/package.json` |

ADR 0015 recorded Hono, server-rendered React and islands. [ADR 0054](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0054-web-process-on-sveltekit.md) supersedes it.

`interfaces/web/package.json` depends on `@unset/apps-web`, `@unset/domains-identity`, `@unset/domains-profile`, the infrastructure packages it wires, and `shared/http`.

## What a browser can open

Every route, its session mode and its limit are on [Endpoints](/endpoints/web/). The own page is `GET /[did]`. The public profile is `GET /@[actor]`. Settings, welcome, sign-in and sign-out are folders under `interfaces/web/src/routes/`. Welcome's chat step says "Chat comes later" (`interfaces/web/src/routes/welcome/messages.ts`).

Sign-in on this tree is one PDS issuer. `pdsIssuerOf` in `interfaces/web/src/lib/server/config.ts` builds it as `http` or `https` plus `PDS_HOSTNAME`, from `OAUTH_ALLOW_HTTP`. `authorize` in `infrastructure/pds/oauth/sign-in.ts` refuses an `http:` or `https:` input that is not exactly that issuer. `didResolverForOAuth` throws `AccountElsewhereError` when the resolved PDS origin is not that issuer.

The account page shows a handle only when `domains/identity/verify-handle.ts` finds the DID document's claim and `resolveHandle` returns that same DID.
