---
title: Commits and pull requests
weight: 3
---

One step per pull request. Subjects are checked by [`scripts/guards/commit-msg.ts`](https://github.com/Undefined6799/unset/blob/main/scripts/guards/commit-msg.ts). The pull-request job is [`.github/workflows/pr-shape.yml`](https://github.com/Undefined6799/unset/blob/main/.github/workflows/pr-shape.yml), which runs [`scripts/guards/change-shape.ts`](https://github.com/Undefined6799/unset/blob/main/scripts/guards/change-shape.ts).

## Subject

A subject is a step id, a space, and a summary.

| Rule | Check |
| --- | --- |
| Step id | `P0`–`P6` or `L`, a dot, two digits, then one optional lowercase letter. `P1.07`, `P0.09c`, `L.02` |
| Summary | Starts with a capital letter. At most 50 characters. No trailing period |
| Whole subject | At most 72 characters |
| Prefix | A Conventional Commits prefix (`type:`, `type(scope):`, `type!:`) fails |
| Body | A blank line, then lines of at most 72 characters. A line that is only an `http` or `https` URL may be longer |

The hook's own example is `P1.07 Enforce exact Origin match in CSRF gate`. [DL-6](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/engineering-rules.md) asks for an imperative summary that completes "if applied, this commit will …". Mood is review. The checker requires the capital letter. Delivery in [CLAUDE.md](https://github.com/Undefined6799/unset/blob/main/CLAUDE.md) states the same shape.

The pull request title uses the subject rules. A squash merge puts that title on `main`.

[`scripts/githooks/commit-msg`](https://github.com/Undefined6799/unset/blob/main/scripts/githooks/commit-msg) runs the same check. The hook accepts the merge subjects git writes (`Merge branch`, `Merge remote-tracking branch`, `Merge pull request #N from`, `Merge commit`). The pull-request job reads `git log --no-merges`, so each remaining commit is held to the subject rules.

## Labels

The kind of change is a label in [`.github/labels.json`](https://github.com/Undefined6799/unset/blob/main/.github/labels.json). `pr-shape` warns when the count of `kind/*` labels is anything other than one. The warning leaves the job green.

| Label | `labels.json` |
| --- | --- |
| `kind/feature` | New behaviour |
| `kind/fix` | Corrects behaviour that was wrong |
| `kind/refactor` | New structure, same behaviour |
| `kind/docs` | Documentation only |
| `kind/build` | CI, tooling, guards or dependencies |

`large-pr` is the size override below.

## Size and shape

[`scripts/guards/pr-size.ts`](https://github.com/Undefined6799/unset/blob/main/scripts/guards/pr-size.ts) sums added and deleted lines. It leaves out `*.test.*`, `*.spec.*`, `tests/`, `fixtures/`, `package-lock.json`, `*.generated.*` and `shared/lexicons/**/*.json`. Over 400 changed source lines warns. Over 800 fails unless the pull request has `large-pr` and a `Large PR:` line in the body.

[DL-1](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/engineering-rules.md) is one step and one ownership path, with refactoring and a behaviour change in separate commits.

[D4](https://github.com/Undefined6799/unset/blob/main/docs/human/engineering/engineering-rules.md) in that file, and the queue line in [CLAUDE.md](https://github.com/Undefined6799/unset/blob/main/CLAUDE.md), cap waiting agent pull requests at three. Severity 1 and severity 2 fixes sit outside the cap. No guard counts open pull requests.

## Template

[`.github/pull_request_template.md`](https://github.com/Undefined6799/unset/blob/main/.github/pull_request_template.md) is the field list. [`scripts/guards/pr-template.ts`](https://github.com/Undefined6799/unset/blob/main/scripts/guards/pr-template.ts) requires every `## ` heading in the body. A heading may say n/a. An author whose login is `renovate[bot]` and whose type is `Bot` skips the heading check. The other `pr-shape` checks still run.

| Heading |
| --- |
| Step |
| What |
| Why |
| How to test |
| Security review |
| Ownership path |
| Threats |
| ASVS rows |
| Red evidence |
| Behaviour change |
| Performance evidence |
| Migration or rollback |
| Why this works (source read) |
| Needs an ADR? |
| Branch age |
| What I am unsure about |

The template then has the line `AI notes: updated / none needed / which`. Keep one of the three. [`scripts/docs/docs.ts`](https://github.com/Undefined6799/unset/blob/main/scripts/docs/docs.ts) checks that the template file still carries these headings, in this order, and that line after them.

## pr-shape

The workflow runs on a pull request that is not a draft. `runChangeShape` reports:

| Check | When it fires |
| --- | --- |
| Title and each commit | Error on a subject or body rule above |
| Size | Warning over 400 source lines. Error over 800 without `large-pr` and a `Large PR:` reason |
| Template headings | Error when one is missing. Renovate is the exception above |
| `kind/*` | Warning unless there is exactly one |
| Check path and product path together | Error, tagged `[SE-6]` |
| Trusted-base files mixed with other paths | Error, tagged `[SE-6]` |
| A `-- why: speed` index | Error, tagged `[PF-1]`, when Performance evidence lacks p50, p95 and p99 before and after |

The trusted-base list is the `# checks:` and trusted-base sections of `.github/CODEOWNERS`, read by `scripts/guards/trusted-base.ts`.

## Docs-only allowlist

[`scripts/guards/docs-only-paths.ts`](https://github.com/Undefined6799/unset/blob/main/scripts/guards/docs-only-paths.ts) decides the allowlist. Every changed path must be allowed, including a rename's old path and a deletion. An empty list fails closed.

| Path | Allowed |
| --- | --- |
| `README.md` | yes |
| `docs/site/**/*.md` | yes |
| `docs/ai/notes/**/*.md` | yes |
| `docs/human/**/*.md` other than the four folders below | yes |
| `docs/human/decisions/**`, `docs/human/engineering/**`, `docs/human/runbooks/**`, `docs/human/legal/**` | no |
| any file that is not `.md`, such as site config, `go.mod`, `go.sum`, vendored scripts, data files and images | no |
| `CLAUDE.md`, `AGENTS.md`, `docs/ai/PLAN.md`, the step book, `.github/**`, `scripts/**`, a manifest, a lockfile | no |

The four `docs/human` folders are matched without regard to case. `CLAUDE.md` imports `docs/human/engineering`, so a change there changes every agent's rules and is reviewed like code.

[`.github/workflows/docs-only.yml`](https://github.com/Undefined6799/unset/blob/main/.github/workflows/docs-only.yml) runs `scripts/guards/docs-only.ts` when the pull request is not a draft and has `kind/docs`. [`.github/workflows/docs-auto-merge.yml`](https://github.com/Undefined6799/unset/blob/main/.github/workflows/docs-auto-merge.yml) runs [`scripts/guards/docs-auto-merge.ts`](https://github.com/Undefined6799/unset/blob/main/scripts/guards/docs-auto-merge.ts) from the default branch. `decide` enables squash auto-merge when the head repository is this one, the pull request is not a draft, the file list is allowed, `kind/docs` is present, and GitHub Actions reports the `docs-only` check as success. A failed gate disables an auto-merge that is already on. A closed pull request, or a head that has moved, is left as it is. The record is [ADR 0034](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0034-docs-only-auto-merge.md). Its status line says Proposed (awaiting Alex).

## Who may merge

[ADR 0019](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0019-verified-agent-merges.md) is accepted. A verifier session other than the author thread may merge when every condition in that record holds. The author thread leaves its own pull request unmerged. The merge is squash, with the title as the subject.

The same record keeps these with Alex:

| Stays with Alex |
| --- |
| A loosening of CI, a guard, lint or a security control |
| A new ADR, or one that supersedes another |
| An `[ALEX]` or `[STOP]` step |
| Ruleset and repository settings |
| Money, accounts, legal, production, deploys and secrets |
