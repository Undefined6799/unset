# 0002 — Engineering rules from the reading list

Status: accepted (Alex, 2026-10-04 12:56Z, "Adopt all" on the architecture handoff card). Decision 35 in the plan.

## Context
Alex posted a software engineering and architecture bibliography (about 40 books) and asked the
architecture thread to research it completely and return a set of rules that set the project up
for success, each rule citing its book and chapter. The research produced 90 draft rules, an
adversarial review cut them to 48 with a Top 15 for the first slice, 78 of 90 sources were checked
online, and nine choices were left to Alex. The four existing guidelines in
[`docs/human/engineering/`](../engineering/) say how the code is structured and how work flows;
none of them records the design, data, reliability, testing and delivery rules the books supply,
and some of our habits contradicted them (decisions 28 to 33 were recorded by editing ADR 0001;
the step book capped functions at about 40 lines; no commit convention or PR size rule existed).

## Decision
[`engineering-rules.md`](../engineering/engineering-rules.md) is the fifth engineering guideline.
Each rule names its source, how it is enforced (a CI tool, a guard, the PR template, or review-only
with a reason) and when it lands (P1 now; P2 at a named trigger). Security checks run from the
first commit; every other guard lands at its trigger, never earlier. CLAUDE.md imports the Top 15
page only ([`engineering-rules-top-15.md`](../engineering/engineering-rules-top-15.md)). Where a
rule and the plan disagree, the plan wins; where a rule and the Architecture and Development
Guideline disagree on structure, that guideline wins. The nine open choices, each taken as
recommended:

- **D1 Function size.** One job at one level of abstraction, usually fitting on a screen; never
  split to meet a line count. A Biome cognitive-complexity warning replaces the 40-line rule.
- **D2 Commits.** Chris Beams' rules with the step id in front
  (`P1.07 Enforce exact Origin match in CSRF gate`); no Conventional Commits prefix; the kind of
  change is a PR label; squash-only merges with the PR title as subject and the commit messages
  as body; one pure `checkCommitMessage()` in `scripts/guards/commit-msg.ts`, run by an opt-in
  `.githooks/commit-msg` and in CI on the PR title (read from an environment variable) and each
  commit.
- **D3 PR size.** Warn above about 400 changed source lines; fail above 800 unless the PR has a
  `large-pr` label and a reason. Tests, lockfile, generated code and lexicon JSON are excluded.
- **D4 Review queue.** At most three agent PRs wait for Alex at once; severity-1 and -2 fixes are
  exempt. A CLAUDE.md instruction, not a tool.
- **D5 Deploy.** The minimal digest-verified deploy (verify, pull by digest, preflight, migrate,
  smoke check, rollback) lands at the end of Phase 2 for the closed-test host, so the test host
  deploys the way production will; P5.03 grows it.
- **D6 Mutation testing.** Stryker is deferred; reconsidered for the Phase 5 security tests.
- **D7 Private profiles.** A private profile answers like a missing one: `ProfilePrivate` folds
  into `AccountUnavailable` for everyone but the owner (plan §5.4, §11 Q2b).
- **D8 ADRs.** ADR 0001 becomes an append-only decisions log; every decision from here gets its
  own ADR; an accepted ADR changes only to be marked superseded.
- **D9 Health signals.** Per-service operational health signals (golden signals plus saturation)
  are allowed beside `metrics_daily`, never per user, with retention in the retention table and
  the RoPA. Decision 17 is about product measurement and is clarified, not changed.

## Alternatives
- **Keep the bibliography as a reading list** and rely on the four guidelines. Rejected by Alex
  (2026-10-04 04:45Z): he asked for a complete research and a cited rule set instead.
- **Adopt the rules one by one** (the card's second option): nine more cards before any rule
  applies; Alex chose to adopt all with the recommendations.
- **Hold the rules as a draft** until read in full; rejected for the same reason.
- Within the rules, the options not taken for D1 to D9 and the ideas rejected from the books
  (small-function caps, Conventional Commits, microservices, event sourcing, CQRS, mock-heavy
  testing, Kubernetes and the rest) are listed with reasons in
  `unset-plan/architecture-handoff/engineering-rules-rationale.md`.

## Consequences
- The step book changes: P0.04 and P0.05 gain the Biome, Semgrep and dependency-cruiser checks the
  P1 rules name; P0.09 gains the PR template fields, the commit-message check and the PR size
  guard; a minimal deploy step joins the end of Phase 2 (F-11); phase-3 `ProfilePrivate` becomes
  `AccountUnavailable` for non-owners; README rule 3 is reworded (F-35); F-19 and F-23 are
  unblocked.
- The plan changes in §5.4, §6 (decision 17), §7, §8 (Phase 0 CI, Phase 2, Phase 5), §9 and §11.
- CLAUDE.md imports the Top 15 page and carries the delivery rules (commits, PR size, review
  queue, ADRs, function size).
- From now on a decision is a new numbered file here; this ADR is the first under that rule. The
  step book's planned `0002-bootstrap-reconciliation.md` takes the next free number.

## Compliance
The rules never weaken a security or privacy decision in the plan (the rules file says so and the
review checked it). SE-1 to SE-7 add per-slice threat models, denial tests, view types, token
binding, a trusted-base list and a logging field allowlist, all of which support the ASVS 5.0 L2
and OWASP Top 10:2025 rows in plan §6.1. D7 reduces what a private account leaks (API3,
Anderson ch. 11). D9 adds no personal data: the signals are per service and carry no DID, IP or
handle, and their retention is listed in the retention table and the RoPA.
