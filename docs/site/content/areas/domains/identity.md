---
title: identity
weight: 1
---

Who an account is: DID and handle syntax, resolution, the two-way handle check, and the onboarding and email decisions. Package `@unset/domains-identity`. The network port is [ADR 0013](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0013-identity-network-port.md).

## Owns

Product rules for identity. The folder does not open a socket. Callers pass an `IdentityNetwork` (`domains/identity/contract.ts`): `get(url, request)` and `txt(name)`. `infrastructure/pds/identity-network.ts` implements that type.

| Module | What it holds |
| --- | --- |
| `domains/identity/index.ts` | Package root. Re-exports the rows below. |
| `domains/identity/syntax.ts` | `parseDid`, `parseHandle`, and the branded `Did` and `Handle` types. |
| `domains/identity/contract.ts` | `IdentityNetwork` and its outcome types. |
| `domains/identity/did-doc.ts` | `parseDidDoc`. Not a package export. `resolve-did.ts` is the caller. |
| `domains/identity/resolve-did.ts` | `createDidResolver`, `IdentityError`. |
| `domains/identity/resolve-handle.ts` | `resolveHandle`. |
| `domains/identity/verify-handle.ts` | `createHandleVerifier`, `displayHandle`. Trusted base in `.github/CODEOWNERS` (`# trusted base (SE-6)`). |
| `domains/identity/in-flight.ts` | One shared lookup per DID. Not a package export. |
| `domains/identity/auth/age.ts` | `parseBirthDate`, `ageInYears`. |
| `domains/identity/auth/gates.ts` | `emailGate`, `verifiedAfterRefresh`, `onboardingStep`, `requireOnboarded`. |
| `domains/identity/legal/versions.ts` | `TERMS_VERSION`, `PRIVACY_VERSION`. |

`parseDid` accepts `did:plc` (24 base32 characters) or `did:web` plus a hostname `isResolvableHostname` accepts. It does not lowercase. `parseHandle` trims, drops one leading `@`, and lowercases. It returns null unless that result is a hostname `isResolvableHostname` accepts. The lists and the spec cites are in `syntax.ts`.

`resolveHandle` tries a `_atproto` TXT record, then `https://<handle>/.well-known/atproto-did`. Statuses: `found`, `not_found`, `unavailable`. `unavailable` is returned when neither method found a DID and at least one could not tell (`resolve-handle.ts`).

`createHandleVerifier` returns `verifyHandle` and `invalidateHandle`. `verifyHandle` returns `verified` when the DID document's first syntactically valid `at://` handle resolves back to that DID. `displayHandle` returns that handle, or the string `handle.invalid`. The other verdicts are `invalid` and `unavailable` (`verify-handle.ts`).

`emailGate` reads a cache the caller passes. It does not take a handle or an environment.

| `EmailCache` and `recheckS` | `EmailGate` |
| --- | --- |
| `confirmed` is not `true` | `verify` |
| `checkedAt` is null | `refresh` |
| the check age is from 0 through `recheckS` seconds | `pass` |
| anything else | `refresh` |

`verifiedAfterRefresh` maps the caller's `EmailRefresh`: `transient` and `confirmed` to `pass`, `unconfirmed` to `verify`, `ended` to `ended`.

`onboardingStep` is the first unfinished step. A null account is `age`. `done` stays `done` only when `termsVersion` equals the current terms version; a terms mismatch returns `terms`. `blocked_underage` returns `blocked`.

`requireOnboarded` turns that step into a decision:

| Step | Outcome |
| --- | --- |
| `done` | `pass`. `privacyNotice` is true when `privacyVersion` differs from the current privacy version. |
| `terms` | `terms` |
| `blocked` | `blocked` |
| `age`, `chat` | `welcome` |

`interfaces/http/app-gate.ts` turns the decision into a redirect. This folder does not.

`parseBirthDate` returns a calendar date or null. `ageInYears` counts full UTC years. Neither function stores the date.

## May import

The [Domains](../) `domain` row, and the narrowing rules on that page.

Product files under `domains/identity` import only other files in that folder. `domains/identity/package.json` declares no dependencies.

## Entry points

| Role | Path |
| --- | --- |
| Package export `.` | `domains/identity/index.ts` |
| Package export `./syntax` | `domains/identity/syntax.ts` |
| Composition root | `interfaces/http/compose.ts` calls `createDidResolver`, `createHandleVerifier`, `resolveHandle`, and reads `TERMS_VERSION` and `PRIVACY_VERSION` |
| Port implementation | `infrastructure/pds/identity-network.ts` |
| OAuth resolvers | `infrastructure/pds/oauth/identity-resolvers.ts` imports `parseDid`, `parseHandle`, `resolveHandle` and `IdentityError` |
| Syntax-only caller | `infrastructure/audit/append.ts` imports `parseDid` from `@unset/domains-identity/syntax` |

`./syntax` is the subpath in `package.json` `exports`. `domains/identity/syntax-export.test.ts` checks that it resolves to `syntax.ts`. There is no `main.ts`.

Re-exports from `index.ts`:

| From | Names |
| --- | --- |
| `auth/age.ts` | `ageInYears`, `parseBirthDate`, `BirthDate` |
| `auth/gates.ts` | `emailGate`, `verifiedAfterRefresh`, `onboardingStep`, `requireOnboarded`, and the types `EmailCache`, `EmailGate`, `EmailRefresh`, `Onboarding`, `OnboardingAccount`, `OnboardingDecision`, `OnboardingStep`, `OnboardingVersions` |
| `contract.ts` | `FetchRequest`, `FetchTarget`, `HttpOutcome`, `IdentityNetwork`, `TxtOutcome` |
| `did-doc.ts` | `ResolvedDid` |
| `legal/versions.ts` | `PRIVACY_VERSION`, `TERMS_VERSION` |
| `resolve-did.ts` | `createDidResolver`, `IdentityError`, `Consistency`, `DidResolverOptions`, `IdentityErrorKind` |
| `resolve-handle.ts` | `resolveHandle`, `HandleResolution` |
| `syntax.ts` | `parseDid`, `parseHandle`, `Did`, `Handle` |
| `verify-handle.ts` | `createHandleVerifier`, `displayHandle`, `HandleVerdict`, `HandleVerifierOptions` |

## Data

No schema, role, table or event type. The resolver and the verifier each keep an in-memory map keyed by DID (`resolve-did.ts`, `verify-handle.ts`). `invalidateHandle` deletes one verifier entry. Nothing here writes Postgres.

Values the gates read, stored by the caller:

| Shape | Fields | Stored by |
| --- | --- | --- |
| `OnboardingAccount` | `onboarding`, `termsVersion`, `privacyVersion` | `interfaces/http/account.ts` reads `onboarding`, `terms_version`, `privacy_version` from `app.account` |
| `EmailCache` | `confirmed`, `checkedAt` | `interfaces/http/compose.ts` reads `email_confirmed`, `email_checked_at` from `app.session` |

`app.account` is created in `infrastructure/postgres/migrations/0015_app_account.sql`. It has `age_confirmed_at` and no birth-date column. `TERMS_VERSION` and `PRIVACY_VERSION` are the constants in `legal/versions.ts`. `interfaces/http/routes/legal.test.ts` (`legal.versions_exported`) checks them against the `version` in `apps/web/legal/terms.en.md` and `apps/web/legal/privacy.en.md`.
