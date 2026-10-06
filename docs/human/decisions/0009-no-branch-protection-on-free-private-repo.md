# 0009 — No branch protection while the repository is private on the free plan

Status: Superseded by 0017.

## Context
Decision 40 (ADR 0008) set the `main` ruleset to PR required, checks required, no force-push, no
deletion, applying to administrators, with zero required approvals. Applying it through Alex's own
`gh` CLI returned 403: "Upgrade to GitHub Pro or make this repository public to enable this
feature." On the free plan a private repository gets neither rulesets nor classic branch
protection. The card offered GitHub Pro (about 4 dollars a month, recommended), making the
repository public, or going without.

## Decision
Go without. `main` carries no ruleset and no branch protection while the repository is private on
the free plan. CI is therefore advisory: a green check is required by rule, not by GitHub. PR-only,
squash-only, agents never merge, and nobody pushes to `main` directly are written rules
(`CLAUDE.md`, Delivery), and anyone holding Alex's credentials, agents included, can break them.
The decision 40 ruleset remains the target and is applied, unchanged, the day protection becomes
available (GitHub Pro, a public repository, or an organisation plan).

## Alternatives
- GitHub Pro: restores rulesets for about 4 dollars a month. Declined by Alex.
- Make the repository public: restores rulesets at no cost, but the source becomes public before
  the AGPL release is intended and before the security review. Declined by Alex.

## Consequences
Compensating controls already in place: the Actions workflow token is read-only and Actions cannot
approve pull requests; every pull request still runs the required checks; GitHub's push and merge
log is the record of what reached `main`. Plan §8 Phase 0 no longer lists a protected `main` in its
exit, and §8's "small PRs to a protected `main`" reads "protected by written rule". The step book's
P0.03 records the refusal and keeps the ruleset as a one-command step for later. Revisit before the
repository goes public or before the first production account, whichever comes first; at that
point the decision 40 ruleset is applied and this record is superseded.

## Compliance
Removes the technical change-management control that OWASP SAMM and SOC 2 expect on the main
branch; recorded as an accepted risk for a one-person team with the compensating controls above.
Must be closed before production (plan §8 Phase 5 and the launch gate, decision 2).
