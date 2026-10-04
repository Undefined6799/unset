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
| `.npmrc` | `engine-strict`, `save-exact`, no `ignore-scripts` | `ignore-scripts`, `@unset` scope blocked | plan §6.1 | P0.04 |
| Module boundaries | none | dependency-cruiser on the swc parser | plan §7, decision 34, rule AB-1 | P0.05 |
| CSS lint | none | Biome CSS rules | plan §7 | P0.05, P1.21 |
| Repo guards | plain scripts tested with `node:test` | Vitest tests with planted failing fixtures | plan §8 Phase 0 | P0.06 |
| CI jobs | `check`, `secrets` (gitleaks-action) | add `audit`, `actionlint`, Semgrep CE, SBOM, duplicates report; gitleaks as a pinned CLI image | plan §8 Phase 0 | P0.07 |
| Dependency bot | Dependabot | Renovate, exact pins | plan §6.1 | P0.08 |
| CODEOWNERS | `* @Undefined6799` | security-review sections and the `# trusted base (SE-6)` list | plan §9, rule SE-6 | P0.03 |
| README layout | decision-34 folders | no change: PR #1 already lists them | plan §7, decision 34 | P0.02 (done) |
| README "Requires Node 24" | Node 24 | Node 26 | decision 16 | P0.04 |

Deferred plan items:

| Plan item | Plan says | Now | Why |
| --- | --- | --- | --- |
| Image scan, hadolint, cosign, SLSA attestations | from commit 1 (plan §8 Phase 0) | from the first container image (P1.27) | no image exists before then (step book Phase 0, plan issue PI-5) |
| graphify graphs in CI | plan §7, §9 | no step yet; routed to the plan thread | step book Phase 0, plan issue PI-2 |

Bundle facts as they reached `main`: PR #1 from `claude/project-thread-t0o2p9`, tip `e1d7bcd`
(49 commits, root `9f4fa58`), merged on 2026-10-04 at 18:42Z as merge commit `6e9a02b` on top
of GitHub's own `Initial commit` `3edd0de`. `main` has 51 commits and two roots.

## Alternatives
- Push the bundle tip to an empty `main`, as P0.02 planned. Not possible any more: the
  repository was created with an initial commit and the bootstrap landed through PR #1. The
  history is kept as it is; nothing is rewritten on `main`.
- Fix each bootstrap value in this pull request. Declined: each change needs its own step's
  tests (rule DL-1, one step per PR), and the owning steps already carry them.

## Consequences
The step book's recorded expectation (root `baa2768`, 41 commits) no longer matches: the bundle
history was rewritten before PR #1 (its root is now `9f4fa58`). The two roots and the merge
commit stay on `main`; from P0.03 on, every change lands as a squash merge. Dependabot's open
pull requests (TypeScript 7, `@types/node` 26, gitleaks-action 3) are superseded by P0.04, P0.07
and P0.08 and are not merged on their own.

## Compliance
Documentation only. No code, data, personal data or security control changes.
