# 0047 — A lock bump the publish run opened merges itself once `lock` is required and green

Status: Accepted by Alex, 2026-11-16 00:03:50Z, against 1b12ea7 (his line "accept ADR 0047 at 1b12ea7", typed in the
project chat in answer to the coordinator's request after its review of that head). The one change since that head
is the last two sentences of Decision 3, added from a review finding on the pull request. From here the record
changes only to be marked superseded.

## Context
The 2026-11-15 whole-project review (delivery finding 8) found that every release took four hand steps: merge, approve
the signing run, write a lock-bump pull request by hand, pull on the host. Alex chose "All four steps" on the card
"Choose how far to automate image publishing and the lock bump" (2026-11-15): a path filter for the signing runs
(P2.26k), a check on every bump (P2.26j), a bump that opens itself (P2.26l, P2.26m), and this record, a bump that
merges itself.

ADR 0019 leaves every merge with a verifier session or with Alex; ADR 0034 is the one exception so far, for docs-only
pull requests. A bump that merges with no verifier is a second exception and needs its own record.

What a bump pull request is, after P2.26m: one commit made by `publish-images.yml`'s `bump` job, whose parent is the
commit that was just published and whose tree differs from it in `deployment/images.lock.json` and
`deployment/compose.dev.yaml` only, with the digests the `publish` job pushed, signed and verified in the same run.
`lock.yml`'s `lock` check then verifies every lock entry again on the pull request (exact workflow identity, provenance
naming the entry's commit, the committed trusted root; ADR 0033) and refuses an entry that moves back to an older
commit or to one that is not on main.

Main's ruleset, read on 2026-11-15 (`GET /repos/Undefined6799/unset/rules/branches/main`), requires `check`, `audit`,
`secrets`, `actionlint`, `semgrep` and `pr-shape`, no approving review, and allows only squash. `lock` is not required
today.

## Decision
1. **Who turns it on.** `scripts/ci/lock-bump-pr.ts`, the one script the `bump` job runs, turns on GitHub's squash
   auto-merge for the pull request it has just opened, with `expectedHeadOid` set to the commit it has just made. No
   other pull request is touched, and no other workflow or script gains a merge call. The job's permissions do not
   change (`contents: write`, `pull-requests: write`; pinned line for line by `scripts/guards/workflows.ts`).
2. **Only behind a required `lock` check.** Before turning it on, the script reads main's active rules. If `lock` is
   not among the required status checks, or the rules cannot be read, it turns nothing on and the pull request waits
   for a person, as under P2.26m. Auto-merge waits only for required checks, so without that requirement a bump
   could merge before its signatures were checked.
3. **Alex adds `lock` to the ruleset's required checks.** That is the switch for this record: until he does, nothing
   merges itself. `lock.yml` has no path filter and passes at once when the lock did not change, so requiring it does
   not block other pull requests. Removing it from the ruleset stops auto-merge for bumps opened afterwards. A bump
   pull request that is already open keeps the auto-merge it was given, and would then merge without waiting for
   `lock`: disable auto-merge on it, or close it, before removing the check.
4. **What merges it.** GitHub, once every required check has passed on the pull request. The checks do not start by
   themselves on a pull request opened with `GITHUB_TOKEN`: Alex starts them with "Approve workflows to run" on the
   pull request (GitHub docs, `GITHUB_TOKEN` concept page, read 2026-11-15). So a release is two clicks, the signing
   approval and that one, and no typed digests.
5. **What stays.** The signing approval (ADR 0033), the verifier rule for every other pull request (ADR 0019), and the
   deploy preflight's own verification of the lock on the host. Nothing here deploys: the host still pulls by hand.
6. **The D4 queue.** A bump pull request does not count toward the three waiting agent pull requests.

## Alternatives
- **Leave the merge with the verifier (P2.26m as it is).** No new exception. Rejected by Alex's card answer; the
  verifier would re-read digests a required check has already verified against their signatures.
- **A `workflow_run` workflow that judges the pull request from main and then merges, as ADR 0034 does.** It could
  re-check that the pull request still holds only the two files after a later push. Not chosen: it adds a second
  privileged workflow and a second exception to the `workflow_run` ban, and it guards against a pusher who already
  has write access. Main requires no approving review, so anyone who can push to the `lock-bump/` branch can already
  open and merge a pull request of their own once the required checks pass; auto-merge gives them nothing new.
  "Auto-merge is disabled if someone without write permissions pushes new changes to the head branch" (GitHub docs,
  "Automatically merging a pull request").
- **Merge directly from the script.** It would merge before the required checks ran, or need a bypass actor.
  Rejected.
- **Turn it on whether or not `lock` is required.** Rejected: see Decision 2.

## Consequences
- With `lock` required, a bump lands on main with no human or verifier reading it. What stands in for that reading:
  the digests come from the signed run, `lock` verifies them from the pull request's checkout (main's scripts plus the
  two data files), and `pr-shape` and the other required checks run as for any pull request.
- Someone with write access can push more commits to a `lock-bump/` branch while auto-merge is on, and they would
  merge once the required checks pass. That is the same reach they have today on any branch (see Alternatives). The
  rule that agents merge only after the coordinator's review is a process rule, here as elsewhere.
- A merge made by `GITHUB_TOKEN` starts no workflow on main (GitHub docs, same page). The two files are ignored by
  the publish trigger anyway; `ci.yml`'s push run on main does not happen for a bump commit.
- An older bump pull request left open fails `lock` once a newer one has merged ("older than the locked"), so it
  cannot move the lock back; Alex closes it.
- If "Allow auto-merge" were off, the enable call fails, the job goes red and the pull request stays open.
- Unverified until the first run on main: that the `bump` job's token may call `enablePullRequestAutoMerge` on a pull
  request it opened, and that approving the runs is all the checks need.

## Compliance
`scripts/ci/lock-bump-pr.test.ts`: `auto_merge_is_pinned_to_the_commit_it_made`,
`no_auto_merge_unless_the_lock_check_is_required`, `auto_merge_failures_fail_the_job_and_never_retry_open`,
`required_checks_are_read_from_the_branch_rules`. `scripts/guards/workflow-pins.test.ts` keeps the job to its one
script and two scopes. Acceptance is Alex's line on the pull request that adds this record; ADR 0001 notes the
proposal at its end.
