# CLAUDE.md — unset.sh

Auto-loaded for every agent in this repo. Keep it short; load only what the next actions need.

## Project
AT Protocol-native identity and profile app with a small, auditable core. The plan is
[`docs/ai/PLAN.md`](docs/ai/PLAN.md). Decisions live in [`docs/human/decisions/`](docs/human/decisions/);
what the architecture optimises for, in order, and which rules a machine checks are in
[`docs/human/architecture.md`](docs/human/architecture.md).
Read the plan section for the area you touch before changing it.
Before touching an area, read its `importance: high` notes in `docs/ai` (see
[`docs/ai/README.md`](docs/ai/README.md)); capture durable learnings there when done.

## Engineering principles (Alex, 2026-10-03/04; read before designing or changing code)
@docs/human/engineering/architecture-instructions.md
@docs/human/engineering/engineering-practices-addendum.md
@docs/human/engineering/engineering-workflow-and-change-management.md
@docs/human/engineering/architecture-and-development-guideline.md
@docs/human/engineering/engineering-rules-top-15.md

The Top 15 above is an excerpt; all 48 rules with their sources, checks and triggers are in
[`docs/human/engineering/engineering-rules.md`](docs/human/engineering/engineering-rules.md)
(decision 35). Read the rule for the area you touch. Where a rule and the plan disagree, the plan
wins; on structure, the architecture guideline wins.

## Where does this go (decision 34; folders appear with their first code)
| Kind of code | Folder |
| --- | --- |
| Screens, islands, styles | `apps/{web,admin,chat}`: UI only, no product rules, no DB |
| Entry points, auth, CSRF gate, limits | `interfaces/{http,api,indexer,media,review,pds-admin,chat-admin}`: one process each |
| Product rules | `domains/{identity,content,social,feed,messaging,moderation,privacy}` |
| External systems behind contracts | `infrastructure/{postgres,pds,tap,matrix,storage,arachnid,email,net-guard,seal,audit}` |
| Generic, no product meaning (MIT) | `shared/{lexicons,ui,config,errors,i18n}` |
| Compose, edge, backup, preflight | `deployment/` |
| Integration and e2e tests | `tests/`; unit tests sit beside their file |

Boundaries (dependency-cruiser): domains never import infrastructure, interfaces or apps; apps
never import each other or infrastructure; `pds-admin` and `chat-admin` import only themselves and
Node built-ins. No `plugins/`, Redis or queue until a real need exists.

## Non-negotiable: no security shortcuts
Security and correct protocol design beat shipping speed. Never paper over an auth,
permission or membership gap with an admin bypass, a forged membership, acting as another
user, or a "lock down later" path. If the right fix needs a design choice, **stop and ask**.
Fail closed.

Every change:
- **AuthZ fail-closed.** Verified session plus the one CSRF gate on every non-GET. Scope every
  resource id to the caller.
- **Identity.** Verify handle↔DID in both directions through `verifyHandle`; never trust
  self-asserted DID-doc fields. Validate OAuth state/nonce/PKCE.
- **SQL.** Parameterised only, with a tenant/DID predicate.
- **Egress.** Caller-influenced URLs go through `infrastructure/net-guard` (a CI guard enforces it).
- **Cookies.** Host-only `__Host-` cookies, never a `Domain` attribute (a CI guard enforces it).
- **Secrets and PII.** Never in code, logs or responses. Never print resolved config or env.
- **Output.** Escape all user data; `safeHref` for links; keep CSP and security headers intact.
- **Blobs.** Never send raw `getBlob` URLs to browsers; use the media proxy.
- **GDPR.** New personal data needs a purpose, a lawful basis, erasure (`eraseDid`) and export.
- **Ship it.** Typecheck, lint, guards and tests green. Land via PR; Alex approves every PR.

## UI
- All UI follows the unset.sh design sheet (plan §11 Q11): its `tokens.json` is the token source
  for the CSS Modules; new components only when registered on the sheet with Alex's approval.
- The 0x40 "v2e" visual direction (vault note `v2e-visual-direction-locked`) is **superseded** by the
  design sheet; follow nothing from it.
- **Icons: Iconoir 7.12.1** (decision 33), scoped to the design sheet's Icon list and rendered by the
  `shared/ui` `Icon` component from the copied, pinned SVG data. No icon npm package
  (`iconoir-react` or any other), nothing fetched at runtime, never emoji or one-off SVG.

## Protocol work: read the source of truth first
- AT Protocol: the specs at atproto.com/specs and the `@atproto/*` source for the pinned
  version. Pin `@atproto/*` exactly and cite the spec URL in code that depends on it.
- Matrix (chat module): read how Element (`apps/web/src`), cinny or hydrogen does it, confirm
  in spec.matrix.org, read the pinned `matrix-js-sdk` source, then implement our way. Cite
  client file:line and spec URL in the comment and the commit.

## Delivery (decision 35: rules DL-1, DL-2, DL-6, DO-1, DO-2, DC-1)
- **D2 Commits:** subject = step id + capitalised imperative summary, no trailing period, under
  about 50 characters after the id, completing "if applied, this commit will ..."
  (`P1.07 Enforce exact Origin match in CSRF gate`); blank line; body wrapped at 72 saying what
  and why. No Conventional Commits prefix; the kind of change is a PR label. Merges are squash
  only (title = PR title, body = the commit messages).
- **D3 PRs:** one step and one ownership path per PR, under about 400 changed source lines (tests,
  lockfile, generated code and lexicon JSON excluded); CI fails above 800 without a `large-pr`
  label and a reason. Refactoring and behaviour change go in separate commits. Fill the one PR
  template and self-review against it before asking Alex.
- **D4 Queue:** at most three agent PRs may wait for Alex at once (severity-1 and -2 fixes
  excepted). Run `gh pr list --state open` before starting a step; if three are waiting, pick up
  review feedback instead.
- **D8 Decisions:** anything expensive to reverse (data model, external or lexicon contract,
  process, role or network boundary, runtime dependency, new pattern or top-level folder,
  security mechanism) gets its own ADR in `docs/human/decisions/`, in the first PR that depends
  on it. Never edit an accepted ADR except to mark it superseded; ADR 0001 is an append-only
  log. A change that would contradict an accepted ADR: stop and ask.
- **Merging (decisions 40, 41; ADR 0009):** agents open PRs, **never merge them and never push to
  `main`**; Alex alone merges. The free private plan cannot enforce it, so this rule is the gate.
- **D1 Functions:** one job at one level of abstraction, usually fitting on a screen; never split
  to meet a line count. Security code reads as an ordered sequence of checks.

## Building from the book
The step book is [`docs/ai/book/`](docs/ai/book/). The next step is the lowest-numbered one whose
dependencies are merged and that has no open PR. Stop at `[ALEX]`, `[STOP]` and `[SPIKE]` exits as the
book says. One PR per step, titled as in Delivery.

## Parallel agents and branches
Several agents may work here at once.
- Never commit on `main`, a shared branch or a detached HEAD. `git branch --show-current`
  must print a branch that is yours (`claude/<task>`, `cursor/<task>`).
- Branch from a freshly fetched `origin/main`, in your own worktree:
  `git fetch origin main && git worktree add .worktrees/<task> -b claude/<task> origin/main`.
- Never checkout, reset, rebase or force-push a branch you did not create.
- Land via PR only (see Delivery). Deploy only CI-built images of merged commits.

## Commands
```sh
npm ci
npm run check        # typecheck + lint + guards + tests
npm test             # fails if any discovered *.test.ts did not run
```
