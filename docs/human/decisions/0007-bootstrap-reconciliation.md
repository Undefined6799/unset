# 0007 — Bootstrap reconciliation: which Phase 0 step changes each bootstrap file

Status: proposed (awaiting Alex). Step P0.02 of the step book.

## Context
The bootstrap (plan, ADRs 0001 to 0006, engineering guidelines, CLAUDE.md, a first CI and two
guards) reached `main` through PR #1. It was written before the plan settled the toolchain,
the CI gate set and the dependency bot, so several bootstrap files hold values a later Phase 0
step replaces. This record lists each of those files once, with the step that owns the change,
so no step changes a file another step owns and nothing is changed twice.

ADR 0001 already records plan gap 9 (TypeScript 7, Node 26, Vitest, the full CI list) as
adopted, so this record lists only file-level changes.

## Decision
Each row below is changed by its owning step and by no other.

| Item | Bootstrap value | New value | Why | Owning step |
| --- | --- | --- | --- | --- |
| Node | `.nvmrc` `24`, `engines` `>=24.0.0` | exact `26.x.y` | decision 16 | P0.04 |
| TypeScript | `typescript` `6.0.3` | `7.0.x`, exact pin | decision 16 | P0.04 |
| Test runner | `node:test` via `scripts/guards/run-tests.ts` | Vitest only, discovered equals executed | decision 16, rule TE-4 | P0.04 |
| `.npmrc` | `engine-strict`, `save-exact`, `fund=false`, `audit-level=high`, no `ignore-scripts` | `ignore-scripts`, `@unset` scope blocked | plan §6.1 | P0.04 |
| Module boundaries | none | dependency-cruiser on the swc parser | plan §7, decision 34, rule AB-1 | P0.05 |
| CSS lint | none | Biome CSS rules | plan §7 | P0.05, P1.21 |
| Repo guards | plain scripts tested with `node:test` | Vitest tests with planted failing fixtures | plan §8 Phase 0 | P0.06 |
| CI jobs | `check` (runs `npm audit` as a step), `secrets` (gitleaks-action 3.0.0) | `audit` as its own job; add `actionlint`, Semgrep CE, SBOM, duplicates report; gitleaks as a pinned CLI image | plan §8 Phase 0 | P0.07 |
| Dependency bot | Dependabot | Renovate, exact pins | plan §6.1 | P0.08 |
| CODEOWNERS | `* @Undefined6799` | security-review sections and the `# trusted base (SE-6)` list | plan §9, rule SE-6 | P0.03 |
| README layout | decision-34 folders, `chat-admin` not marked Phase 6 | `chat-admin` marked Phase 6 (this PR) | plan §7, decision 34 | P0.02 |
| README "Requires Node 24" | Node 24 | Node 26 | decision 16 | P0.04 |
| `@types/node` | `26.6.3` (Dependabot PR #4) with Node 24 | matches the exact Node 26 pin | decision 16 | P0.04 |

Deferred plan items:

| Plan item | Plan says | Now | Why |
| --- | --- | --- | --- |
| Image scan, hadolint, cosign, SLSA attestations | from commit 1 (plan §8 Phase 0) | from the first container image (P1.27) | no image exists before then (step book Phase 0, plan issue PI-5) |
| graphify graphs in CI | plan §7, §9 | no step yet; routed to the plan thread | step book Phase 0, plan issue PI-2 |

Bundle facts. The bundle file in the planning folder has `HEAD` on
`refs/heads/claude/project-thread-t0o2p9`, tip `24470d58e1971b8ddc30dda852e82d720673d4e4`
(2026-10-03 12:04Z), 51 commits, root `3edd0ded0eab96727e1ecd5f18fd9c2328cbd9fd` (GitHub's
`Initial commit`); its own `main` ref is the old root `baa2768`. That tip is an ancestor of what
PR #1 merged: tip `e1d7bcdceb10177a38e16dcadbccb544569930cf` (2026-10-04 17:41Z), 80 commits,
same root, merged by Alex on 2026-10-04 at 18:42Z as `6e9a02b`. `main` has one root.

## Alternatives
- Push the bundle tip to an empty `main`, as P0.02 planned. Not possible any more: GitHub created
  the repository with an initial commit, the bootstrap was rebased onto it, and Alex merged it
  through PR #1. P0.02 steps 3 to 6 are therefore replaced by Alex's merge; nothing on `main` is
  rewritten.
- Fix each bootstrap value in this pull request. Declined: each change needs its own step's
  tests (rule DL-1, one step per PR), and the owning steps already carry them.

## Consequences
The step book's recorded expectation (root `baa2768`, tip `ed1dd81`, 41 commits) no longer
matches: the bootstrap history was rebased onto GitHub's initial commit before PR #1, so the
bundle root differs. The step-book owner updates its header from the facts above. From P0.03
on, every change lands as a squash merge. Dependabot PRs #2 (gitleaks-action 3.0.0) and #4
(`@types/node` 26.6.3) were merged on 2026-10-04 before P0.07 and P0.08; their values are the
bootstrap values above. PR #3 (TypeScript 7) is superseded by P0.04, which pins TypeScript with
Node and Vitest in one step.

## Compliance
Documentation only. No code, data, personal data or security control changes.
