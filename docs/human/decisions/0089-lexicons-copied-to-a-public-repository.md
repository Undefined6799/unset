---
status: Proposed
date: "2026-11-21"
step: P1.31v
---
# 0089 — Our lexicons are copied to a public repository, by a deploy key that only main can read

Alex asked on 2026-11-21 (17:29Z to 17:41Z) for a public `lexicons` repository in the `unset-sh` organisation: "an
attempt at keeping our code organised and well separated", so that people "find lexicons easily and contribute to
them". The organisation is "the clean version of our code" and "eventually, we are going to move fully to the
organisation and it will become source of truth". The plan he was shown is the project's `plans/lexicons-repo/plan.md`.

## Context

Our lexicons live in `shared/lexicons/schemas/`, where the schema build, the breaking-change check and the
published-snapshot guard run (ADR 0086, ADR 0091). Nothing is published on the network yet. A reader who wants the
schemas has to find them inside the application repository, and has nowhere obvious to propose a change.

How others lay theirs out (read 2026-11-21): bluesky-social/atproto keeps `lexicons/<name parts as folders>.json` at
its root (commit 34063e9); `goat lex` reads `lexicons/` by default and builds each path from the NSID with its dots as
folders (bluesky-social/goat at beec4d7, `lex_lint.go`, `lex_util_files.go`); lexicon-community/lexicon uses the same
tree with a README per group, MIT (commit b4a2b19); standard.site generates its JSON from TypeScript, MIT.

Until now no workflow here holds a secret of ours: every one uses the short-lived `GITHUB_TOKEN` or OIDC. Writing to
another repository needs a credential that outlives a run.

## Decision

1. **`unset-sh/lexicons` is a copy; this repository decides.** Its whole tree is built from `shared/lexicons/` by
   `scripts/ci/lexicons-export.ts`: each schema at `lexicons/<NSID as folders>.json`, plus `README.md` and
   `CONTRIBUTING.md` from `shared/lexicons/public-repo/` and the MIT `LICENSE` of `shared/lexicons` (ADR 0012).
   Nothing is edited there by hand, and nothing is ever read back from it into this repository.
2. **One workflow copies it**, `lexicons-mirror.yml`: on a push to main that changes something the tree is built
   from, it builds the tree, replaces the public repository's files with it and pushes one commit, which links its
   source commit and carries that commit's `Co-authored-by` trailers. It does not force-push.
3. **The credential is a deploy key.** Its public half is on `unset-sh/lexicons` with write access; its private half
   is the secret `LEXICONS_DEPLOY_KEY` of a GitHub environment `lexicons-mirror` whose only deployment branch is
   `main`. Alex makes the key pair and places both halves by hand; no agent or thread ever holds the private half.
4. **The job fits the existing workflow guard unchanged** (`scripts/guards/workflows.ts`): bound to an environment,
   run only for a push to main, `contents: read`, GitHub-owned actions at a full commit, no expression in `run`. It
   uses `actions/checkout` for the key (`ssh-key`, strict host key checking) and installs no package.
5. **A contribution comes across with credit.** An issue or pull request on the public repository is discussed there.
   If accepted, the change is made here with the contributor as `Co-authored-by`, passes the checks here, and the copy
   carries that trailer into the public history; the public pull request is closed with a link, never merged there.
6. **The public README says "draft, not yet published"** for exactly as long as `published.lock.json` is empty.
7. **This is not publication.** Apps resolve a lexicon through DNS and the lexicon account's repository
   (atproto.com/specs/lexicon, "Lexicon Publication and Resolution"); that stays Alex's manual step (P1.35, plan §5.3
   "published never from CI or agents"). The GitHub repository is a reading copy and a place to talk.

## Consequences

- **A long-lived write credential now sits in this repository's Actions secrets**, the first. A deploy key has no
  expiry and no passphrase, and "deploy keys with write access can perform the same actions as an organization member
  with admin access" over git on that repository (GitHub docs, "Managing deploy keys"). If it leaked, someone could
  push anything to `unset-sh/lexicons`, a rewritten history included.
- **What bounds it.** A deploy key opens one repository only. An environment's secrets are "only available to
  workflow jobs that reference the environment", and the branch rule is matched against the run's ref (GitHub docs,
  "Deployments and environments"), so a workflow pushed to any other branch, or a fork's pull request, cannot read
  it. A change to the workflow on main is a trusted-path change (`/.github/`). The key reaches neither this
  repository, nor a server, nor an account, nor what apps resolve (decision 7). The next copy restores the right
  files, and deleting the deploy key on the public repository cuts it off at once.
- New organisations disallow deploy keys until an owner enables them (GitHub docs, "Restricting deploy keys in your
  organization"), so Alex enables them for `unset-sh`. The runbook `docs/human/runbooks/lexicons-mirror-key.md` has
  the set-up, the rotation and the cut-off.
- The public repository needs one commit before the first copy: `actions/checkout` takes the default branch from the
  remote when it is given an SSH key (`src/git-source-provider.ts` at 3d3c42e), and an empty repository has none.
- The public history starts fresh; this repository's history is not copied (Alex, 2026-11-20: no history if copied).
- **When the organisation becomes the source of truth**, the direction turns and nothing is redone: the layout, the
  history and the issue numbers stay; the workflow, the environment and the key are deleted; the checks move into
  `unset-sh/lexicons`; and this application takes the lexicons from it at a pinned commit, as `vendor/` pins
  Bluesky's today, or from the network once they are published.

## Alternatives

- **A scheduled job in the public repository that pulls from this one**, with its own `GITHUB_TOKEN` and no key.
  Rejected: "in a public repository, scheduled workflows are automatically disabled when no repository activity has
  occurred in 60 days" (GitHub docs, "Disabling and enabling a workflow"), and lexicons change rarely, so it would
  stop without anyone noticing. Its workflow would also sit outside the repository whose guards and review judge
  workflows, and `GITHUB_TOKEN` cannot update that workflow file.
- **A fine-grained personal access token.** It acts as Alex, expires and has to be renewed by hand. Rejected.
- **A GitHub App with short-lived tokens.** The strongest credential, and the most to set up and to keep, for one
  rarely used push to a reading copy. Not now; it can replace the key without changing anything else.
- **A third-party "push to another repository" action.** The workflow guard refuses any action that is not
  GitHub-owned, and it would run someone else's code beside the key. Rejected.
- **Move the lexicons to the public repository now.** The checks that hold a published lexicon steady run here, and
  the application would need a pinned copy of its own contract before anything is published. Later (see above).
- **Required reviewers on the environment**, so each copy waits for Alex. Offered to him; not the default, since the
  content is already reviewed and merged and the copy changes nothing members use.

## Compliance

`scripts/ci/lexicons-export.test.ts`: each lexicon at the path its name gives, no other file, a name that is not
an NSID refused, the README naming every lexicon and saying draft exactly while nothing is published.
`scripts/ci/lexicons-mirror.test.ts`: the trigger, the environment, the single use of the secret, no package install
and no forced push. `scripts/guards/workflow-pins.test.ts` (`workflow_rules_hold`) holds the workflow to the guard.
Acceptance is Alex's line on the pull request that adds this record.
