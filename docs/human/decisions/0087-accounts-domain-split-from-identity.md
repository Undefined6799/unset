---
status: Proposed
date: "2026-11-21"
step: P2.00
---
# 0087 — Membership rules move from `domains/identity` to a new `domains/accounts`

Alex agreed with the split on 2026-11-21 at 02:46Z ("I think I agree with the split"), after the folder-structure
review of `origin/main` at 4abcada found `domains/identity` holding two concerns that change for different reasons.
This record is the ADR that review said the split needs (CLAUDE.md D8: a new domain boundary).

## Context

`domains/identity` began as plan §2 rules 1 and 13: who an account is. That means DID and handle syntax, resolving a
DID document and a handle, and verifying handle↔DID in both directions (P2.01, P2.02; ADR 0013 for the network port).
That is security-critical code, and the plan wants it small enough to audit.

Phase 2 then put the rules for being a member of unset.sh in the same folder:

| File | Concern |
| --- | --- |
| `syntax.ts`, `did-doc.ts`, `resolve-did.ts`, `resolve-handle.ts`, `verify-handle.ts`, `in-flight.ts`, `contract.ts` | Identity: who a DID or handle is, on the network |
| `profile-path.ts` | Identity: the one way a path segment becomes an actor (DID or verified handle) |
| `account.ts` | Membership: the account record contract (`AccountRepository`, P2.12) |
| `auth/age.ts` | Membership: the age screen's date (P2.12) |
| `auth/gates.ts` | Membership: the confirmed-email gate (P2.11) and the onboarding steps (P2.12) |
| `legal/versions.ts` | Membership: the terms and privacy versions an account accepts (P2.15) |
| `invites.ts` | Membership: member invites (P2.10, ADR 0060) |
| `invite-requests.ts` | Membership: invite requests from visitors (P2.10r, ADR 0080) |

The two halves change for different reasons. Identity changes when atproto's specs or our verification rules change.
Membership changes with product policy: onboarding steps, legal versions, invite rules, and soon the chat step (P6.05)
and account lifecycle (ADR 0067). Today a membership change touches the same package, index and review surface as the
handle verifier. The second half also depends on the first (it needs `Did`), and the first never needs the second.

## Decision

1. **A new domain, `domains/accounts`** (package `@unset/domains-accounts`), owns the rules for membership of
   unset.sh: the account record contract, onboarding (age, terms, chat step, under-age block), the email gate, the
   legal versions, member invites and invite requests. These files move from `domains/identity` with their tests,
   unchanged except for import paths: `account.ts`, `auth/age.ts`, `auth/gates.ts`, `legal/versions.ts`, `invites.ts`,
   `invite-requests.ts`.
2. **`domains/identity` keeps identity only:** `syntax.ts`, `did-doc.ts`, `resolve-did.ts`, `resolve-handle.ts`,
   `verify-handle.ts`, `in-flight.ts`, `contract.ts` and `profile-path.ts`. Its `./syntax` export stays.
3. **Direction.** `accounts` may import `identity`'s `index.ts` (for `Did` and its parser), as the domain row of
   `scripts/lint/.dependency-cruiser.cjs` already allows. `identity` never imports `accounts`. A dependency-cruiser rule
   names this edge, so a cycle or a reverse import fails CI.
4. **How it lands.** Refactoring only, no behaviour change: no route, response, log line, table, migration or grant
   changes. The move is split into PRs under the D3 size limit: first the package and `account.ts` with `auth/`, then
   `legal/`, then the invite files. Each one updates its importers in `interfaces/`, `infrastructure/` and `tests/`.
   `domains/identity/index.ts` does not re-export the moved names, so no second path to them remains.
5. **Docs.** CLAUDE.md's "Where does this go" table and the guideline's §1 tree list `accounts`. The table also gets
   the domains it is missing today (`profile`, ADR 0037; `notifications`, ADR 0079). The feature docs
   `docs/human/features/sign-in-and-onboarding.md` and the invite sections point at the new paths.

## Alternatives

- **Keep one `identity` domain.** No churn. But the handle verifier keeps sharing a package with policy that changes
  every few steps, and chat onboarding (P6.05) and the account lifecycle (ADR 0067) would grow it further.
- **Name it `membership` or `onboarding`.** `onboarding` is too narrow: invites and the email gate are not onboarding
  steps. `membership` reads well but does not match the code's existing nouns (`AccountRepository`, `app.account`,
  `accountStore.ts`). `accounts` does, and fits the plural names of the planned domains.
- **Split invites into a third domain.** Invites and invite requests are small (about 170 lines) and share the
  sign-up concern with onboarding. A third package adds a boundary with no change to isolate yet. It can split later
  if invites grow.

## Consequences

- `domains/identity` shrinks to the code a security reviewer must read for identity: about 400 of its 1,080 source
  lines move out.
- About 30 files change an import path (18 in `interfaces/web`, 2 each in `infrastructure/pds` and
  `infrastructure/postgres`, and 9 tests). This is mechanical, but it touches many files, so it lands
  in the small PRs of point 4 and not in one.
- Workspace and TypeScript project references gain one package; `npm ci` and the lockfile change by one entry.
- Open PRs that import the moved names from `@unset/domains-identity` (P6.05's chat step, for example) need a rebase
  edit once the move merges.

## Compliance

- dependency-cruiser: the domain row already limits `accounts` to its own folder, other domains' `index.ts`,
  `shared/errors`, `shared/lexicons` and `shared/config` types. A new rule forbids `domains/identity/` importing
  `domains/accounts/`.
- The moved unit tests run unchanged in their new folder, and `npm test` fails if any discovered test did not run.
- `npm run check` (typecheck, lint, guards, tests) is green on each move PR, with no test changed except its imports.
