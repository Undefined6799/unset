# 0008 — Main-branch ruleset without required approvals

Status: accepted (Alex, 2026-10-04 20:09Z, "No approvals" on the plan thread's card, against the recommendation). Decision 40 in the plan.

## Context
Pull requests the agents open land under Alex's own GitHub identity, and GitHub never lets an
author approve their own pull request (requesting Alex's review on draft PR 5 failed with "Review
cannot be requested from pull request author"). Step P0.03 step 4b planned a ruleset with one
required approval, code-owner review, approval of the last push and an empty bypass list; under it
no agent PR could ever merge. Checks made before the card: GitHub's terms allow one free personal
account per person plus one free machine account used only for automated work, so a second account
for Alex to approve from is out while a machine account for the agents is allowed; this environment
pushes over HTTPS and reaches the GitHub API, so agents could push and open PRs with a
machine-account token stored as a cloud-environment secret; the Claude GitHub App authors as
itself only when run from GitHub Actions.

## Decision
The ruleset on `main` requires a pull request and green required checks, forbids force-push and
branch deletion, applies to administrators, and requires zero approvals with no enforced code-owner
review. Alex is the only person who merges, by rule rather than by GitHub: `CLAUDE.md` says agents
open pull requests and never merge them, and that rule is the review gate. CODEOWNERS stays in the
repository as the routing and the record of the security-review paths, and the security review of
engineering rule SE-6 is Alex's reading of the diff before he merges.

## Alternatives
- Machine account (recommended): agents push and open PRs as a machine account Alex owns, Alex
  approves and merges as himself under the full ruleset. Declined by Alex: one more token readable
  by every agent session, rotated every 90 days, and a cloud environment to create for the project.
- A second account for Alex to approve from. Not offered: GitHub's terms allow one free personal
  account per person.

## Consequences
Nothing technical stops an agent acting as Alex from merging a pull request; the protection is the
written rule and Alex's habit of being the only one who presses Merge. The step book's threat row E
records this as an accepted risk. P0.03 step 4b and assumption P0-A1 are restated. Required checks
(typecheck, tests, guards, PR shape) remain enforced, so a merge still needs green CI. The decision
can be revisited if a second human joins or a machine account becomes acceptable; it supersedes
nothing in ADR 0001 to 0007.

## Compliance
Weakens the four-eyes control that OWASP SAMM and SOC 2 change management expect; recorded as an
accepted risk for a one-person team, with compensating controls: required checks, append-only
audit of merges in GitHub's log, no force-push, and the written rule. Revisit before the first
production account (plan §8 Phase 5).
