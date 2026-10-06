# 0017 — Main ruleset applied

Status: accepted (Alex applied the ruleset, 2026-10-06, read back 22:35Z). Supersedes ADR 0009 (decision 41); ADR 0008
(decision 40) stands unchanged.

## Context
ADR 0009 went without branch protection because GitHub refused rulesets on a free private
repository, and said the decision 40 ruleset is applied, unchanged, the day protection becomes
available. Two things made it available on 2026-10-06: Alex upgraded the account to GitHub Pro
(12:44Z), and Alex made the repository public (22:06Z). Rulesets are available in public
repositories on every plan and in private repositories with GitHub Pro (GitHub docs, About
rulesets, read 2026-10-06). Architecture's ruling 2026-10-06 13:05Z (record github-pro-protection)
set the tick list Alex followed.

## Decision
`main` carries one active branch ruleset, "main", targeting the default branch, with an empty
bypass list:
- restrict deletions and block force pushes;
- require a pull request before merging, zero required approvals, no code-owner review, no
  last-push approval, squash merging only;
- require the status checks in `.github/required-checks.json` (check, audit, secrets, actionlint,
  semgrep, pr-shape), each from GitHub Actions, without "require branches to be up to date";
- require linear history; signed commits not required (agent commits are unsigned).

The repository allows squash merging only. The written rules stay: agents open pull requests and
never merge them, Alex alone merges, and a skipped required job is not green (GitHub counts a
skipped required job as passing, so that rule is still checked by hand at hand-off).

## Alternatives
- Keep going without protection (ADR 0009). Rejected: its premise is gone, and its own text says
  the ruleset is applied once available.
- Add code-owner review or required approvals now. Rejected while ADR 0008 holds: every agent pull
  request is authored as Alex, and authors cannot approve their own pull requests, so nothing could
  merge. Enforcing owner review still needs a machine account or a second person.
- Require branches to be up to date. Rejected by architecture's ruling: it costs a merge-main
  round and its Actions minutes on every pull request, and the agents already merge main before
  hand-off.

## Consequences
A red or missing required check now blocks the merge button, and nobody, Alex included, can push
to `main` or force-push or delete it; disabling a rule leaves a trace in the ruleset history.
`pr-shape` becomes an enforced check, so the check-path and trusted-base separation (rule SE-6) is
enforced by GitHub. Plan §8 reads "protected" again. Step P0.03's ruleset steps, the P0.07 and
P0.09c required-check tails, and the P0.14 protection read-backs are done (evidence:
`docs/human/evidence/0017-main-ruleset/read-back.md`). L.04 `main_protection_enforced` stays the
final re-check before production. CODEOWNERS stays routing and record (ADR 0008). Because the
repository is public, environment required reviewers are available too: the `signing` environment
(P1.27s) gains Alex as a required reviewer, on top of its main-only branch rule, `GATE_IF` and the
fail-closed key check (architecture Amendment 22:20Z).

## Compliance
Restores the main-branch change-management control that OWASP SAMM and SOC 2 expect, closing the
accepted risk ADR 0009 recorded (threat row E in step P0.03 moves to "closed by the ruleset"). Code
owner review remains unenforced, an accepted risk under ADR 0008 for a one-person team.
