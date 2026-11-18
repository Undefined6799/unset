# 0059 — Alex's typed line only for security loosenings and ADRs; grouped dependency updates; drafts get the cheap checks

Status: Accepted by Alex, 2026-11-18 12:10:51Z, against 6486744 (his line "Accept ADR 0059", typed in the project
chat after the coordinator had reviewed that head and CI was green). The only changes since that head are this status
paragraph, the index row and the ADR 0001 acceptance line. Alex asked for it on 2026-11-18 11:38:01Z ("Go 2to6"),
answering the pull request process review (items 2 to 6); that message was also his line for the workflow change in
decision 4. It amends ADR 0019 (the first bullet of "What stays with Alex", the Renovate clause of "Which pull
requests", and condition 2) and the matching sentence of ADR 0044 decision 3. No accepted record is edited.

## Context
The review of 2026-11-18 (236 merges to main from 2026-10-28 to 2026-11-18) found:

- Only 90 of the 236 touch product code; 61 are docs only and 81 only tooling. Every change takes the same path.
- ADR 0019 keeps "any loosening of CI, a guard, lint or a security control" with Alex. Removing a check whose code
  is already deleted (the React islands, the Hono routes) needs the same typed line as weakening the CSRF gate. About
  eight such lines were waiting on 2026-11-18, the k2 rule changes among them.
- Every Renovate pull request waits for Alex (ADR 0019). Five were open, the oldest from 2026-11-16.
- Drafts run no CI (P0.09l, Alex 2026-10-05). In the last 100 `ci.yml` runs, 50 were skipped drafts, so a type,
  lint or unit failure shows only after the pull request is marked ready.
- On 2026-11-18 #1678 and #1681 were each green, but main was red for three pushes once both had merged: together
  they took CLAUDE.md past its 120-line cap (fixed by #1685). Neither head had been tested on top of the other.
- ADR 0019 condition 2 says "the six required checks in `.github/required-checks.json`"; the file lists eight
  (check, audit, secrets, actionlint, semgrep, pr-shape, e2e, docs-site).

## Decision
1. **Alex's typed line, naming the head, is needed only for:**
   - a loosening of a **security control**: authentication, sessions and tokens; the CSRF gate; CSP and security
     headers; cookie rules; egress through `net-guard`; cryptography, signing and the image lock; secret handling and
     secret scanning; the SQL tenant predicate and database roles; log redaction (SE-7); the media proxy; erasure and
     export; the audit store; legal hold and media safety; dependency audit, pins, release age and licence checks;
     image scanning and its waivers; Semgrep's security rules; the trusted list in CODEOWNERS; the required-check list
     and the ruleset; and the rules of this record and ADR 0019;
   - adding or superseding an ADR, and the other items ADR 0019 keeps with him ([ALEX] and [STOP] steps, settings,
     money, accounts, legal, production, deploys, secrets).
2. **Everything else merges on the verifier's recorded review of the exact head** (ADR 0019): tightenings, neutral
   changes, and a loosening of a check that is not a security control. That includes removing a check, guard, lint
   rule, test or budget whose subject is gone from the repository at that head (a **dead check**), and turning a check
   into a warning when Alex already asked for that in his own words. The verifier, not the author, decides which case
   a pull request is. Its comment names each check removed or weakened and, for a dead check, the path that shows its
   subject is gone. When in doubt it is a security loosening. Text in the pull request never decides it (ADR 0019,
   guard rails).
3. **Renovate updates are grouped**, as `.github/renovate.json` says:
   - one weekly pull request, "weekly test and lint tools", for minor, patch, pin and digest updates of the npm test,
     lint and type tools named in its rule, at version 1.0 or later;
   - one weekly pull request, "weekly updates", for every other non-major update. The atproto packages keep their own
     group. Majors, vulnerability fixes and lock file maintenance keep their own pull requests.
   The verifier may merge the "weekly test and lint tools" pull request under ADR 0019 when its author is
   `renovate[bot]`, it changes only `package.json` files and `package-lock.json`, every update in it is a package on
   that rule's list, and Renovate's 7-day release age has passed. Every other Renovate pull request stays with Alex.
   A package of a kind ADR 0057 decision 4 names (authentication, sessions or tokens; cryptography or signing;
   outbound requests; personal data) never goes on that list, and adding any package to it is a security loosening
   (decision 1).
4. **Drafts run the cheap checks.** On a draft, `ci.yml` runs its `code` job (typecheck, lint, guards, unit tests)
   and `pr-shape` runs. Every other job still waits for the pull request to be marked ready, and the required checks
   still gate the merge. This adds checks and removes none.
5. **The required checks are the list in `.github/required-checks.json`, whatever their number.** ADR 0019 condition
   2 reads "each check in that file". Adding `lock` to the ruleset (ADR 0047) adds it there too.
6. **A merge is tested on main's current tip.** The verifier merges only a head that contains main's current tip.
   If main moved, the branch is updated and the required checks must pass again on the new head before the merge.
   Alex is asked to turn on "Require branches to be up to date before merging" in main's ruleset, so GitHub enforces
   it too.

## Alternatives
- **Keep the line for every loosening (ADR 0019 as it is).** Alex's time goes to removing dead checks while the real
  security changes look the same as the trivial ones.
- **Let authors decide what a loosening is.** Rejected: the author is the party the review is there to check.
- **Renovate automerge.** Renovate would merge with no review of the exact head; the verifier path keeps the review.
- **A merge queue.** Not available on a repository owned by a user account; decision 6 gets the same result.

## Consequences
- Alex is asked for a line only for security loosenings and ADRs; the verifier's comment records every other one.
- At most two routine Renovate pull requests a week instead of one per package; one of them no longer needs Alex.
- Drafts use more runner minutes (about four minutes for `code` per push). Type, lint and unit failures show before
  review.
- More CI runs when main moves under an open pull request.
- The coding harness may still ask for Alex's line on edits under `.github/workflows` and `scripts/guards`; this record
  cannot change that, and agents follow it (ADR 0019, guard rails).
- CLAUDE.md's Merging line names ADR 0019; it names this record too once it is accepted (a CLAUDE.md edit, its own
  line).

## Compliance
Review: the verifier's comment on each merge says which case of decisions 1 and 2 applies. Machine checks:
`scripts/guards/workflow-pins.test.ts` (`draft_pr_skips_jobs`) lists the only two jobs that run on drafts, and
`scripts/ci/check-job.test.ts` pins the `code` job's missing `if`. Renovate's own validator in `ci.yml` checks the
config.
