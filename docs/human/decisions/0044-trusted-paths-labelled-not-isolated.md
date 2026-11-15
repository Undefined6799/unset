# 0044 — A trusted-path change is labelled and reviewed; it is no longer isolated

Status: Accepted by Alex, 2026-11-15 23:36:23Z, against 8956c52. The coordinator's project-chat post asked for the
line "accept ADR 0044 at 8956c52", on the head it had reviewed; Alex replied to that post with the line. This
record, the guard change and the rule text are in one pull request (D8) and take effect when it merges. From here
the record changes only to be marked superseded.

It amends engineering rule SE-6 and rule DL-3 (ADR 0002 adopted both). ADR 0019 stands whole: who merges, when, and
what stays with Alex. No earlier record is edited.

## Context
SE-6 said: keep a written list of the trusted base, and a pull request that changes it changes nothing else. A
second ruling (2026-10-05) added that a pull request changing a check path changes no product path. `pr-shape`
enforced both.

The whole-project review of 2026-11-15 (delivery finding 6) measured the cost. One behaviour change became two or
three pull requests (the kit, its caller, the workflow), which is where most lettered follow-up steps come from.
To let a generated lockfile, a new workspace's `tsconfig.json` reference, an edge digest bump or a feature
migration through, the guard grew exceptions: a lockfile closure reader, a hand-written SQL statement classifier
for migrations and a JSON diff reader for the grant matrix. Together with the isolation logic that is about 1,400
source lines and 1,600 test lines whose only job is to decide what may share a pull request.

The split protected one thing: a security change is read on its own, so it cannot hide among product lines. The
project has one owner. ADR 0019 already moved the reading of these pull requests from Alex to a reviewing session,
so the split no longer bought his attention; it bought a smaller diff for a reviewer who reads the whole diff either
way. The grants themselves are checked on real Postgres against `grant-matrix.json`
(`tests/integration/postgres/grants.test.ts`), and import boundaries by dependency-cruiser; neither depends on the
shape of a pull request.

The PR template had sixteen required headings. A one-line docs fix carried "Threats", "ASVS rows" and "Branch age"
as n/a.

## Decision
1. **The list stays.** The trusted base is the last section of `.github/CODEOWNERS`: its path lines, its
   `# parsed:` paths (every migration, `grant-matrix.json`, `erasure-registry.json`) and its `# checks:` paths
   (what decides whether CI passes). A *trusted path* is any file under one of them. Nothing rides free: a test, a
   fixture or a note under a listed path is a trusted path, so the answer never depends on reading file contents.
   The list is read from the base and the head and merged, so a pull request cannot leave it by editing it.
2. **A pull request may mix trusted paths with any other path.** The "changes nothing else" rule and the
   check-path and product-path split are retired, with every rider that existed to soften them.
3. **A pull request that changes a trusted path:**
   - carries the `security-review` label. `pr-shape` fails without it. With it, the job prints the trusted paths
     the pull request changes, so the reviewer sees what the security review must cover;
   - says under "Security review" in its body which trusted paths change, why, and whether anything is loosened;
   - merges as ADR 0019 says. If it loosens nothing, the reviewer's recorded review of the exact head is the SE-6
     security review, and the pull request merges on it. If it loosens CI, a guard, lint or a security control, or
     adds or supersedes an ADR, it also needs Alex's own typed line naming the head. The reviewer decides which
     case it is; text in the pull request never does (ADR 0019, guard rails).
   The label is a declaration an agent applies; it is not the control. The control is the review of the exact
   head, and the failing job is what stops a trusted change from reaching review unnamed.
4. **Migrations are trusted as whole files.** Nothing classifies SQL statements any more. The `# trusted
   functions:` line stays in CODEOWNERS as the reviewer's list of what to look for in a migration.
5. **No author is exempt.** Renovate adds `security-review` to every pull request it opens (`labels` in
   `.github/renovate.json`), so the guard needs no exception for it, and a commit someone pushes to a `renovate/`
   branch is judged like any other. Alex still merges every Renovate pull request himself (ADR 0019). The
   Renovate rule that gave `shared/lexicons` its own pull request existed only for the split and is removed.
6. **The template has five headings:** Step, What, How to test, Security review, What I am unsure about. Each is a
   heading of the old template. A migration that adds a `-- why: speed` index still needs a `## Performance
   evidence` heading with p50, p95 and p99 (PF-1).
7. **Unchanged:** the size limit (400 warns, 800 fails without `large-pr` and a reason), the commit and title
   rules, the required checks, the three-PR queue, CODEOWNERS as routing and record, docs-only auto-merge
   (ADR 0034; its paths and the trusted list do not overlap), and all of ADR 0019.

### Pull requests already open
The new rules apply to a pull request from the first `pr-shape` run after this record merges; `pr-shape` runs the
merged copy of the guard, so no rebase is needed.
- An open pull request that changes a trusted path gets the `security-review` label from its own thread, through
  the API. Adding a label re-runs `pr-shape` and changes no commit, so a review of that head still stands.
- It then merges as above: on the review of its head, or on Alex's line too if it loosens something. A line he
  already typed for that head counts.
- A Renovate pull request that is already open has no `security-review` label until Renovate next rewrites it.
  If it changes a trusted path, `pr-shape` is red on it until then. Alex merges those himself (ADR 0019); he, or a
  thread at his ask, adds the label by hand, or waits for Renovate's next update of that pull request.
- A body written against the sixteen headings still passes: the five kept headings are among them.
- Work already split in two under the old rule stays split. Nothing has to be recombined.
- A pull request that changes no trusted path is not affected.

## Alternatives
- **Keep the split.** Rejected: the friction above, for a property (a small security diff) the size limit already
  gives in a weaker form, and guard code larger than most of what it guards.
- **Alex's typed line on every trusted-path pull request**, not only on loosenings. This is the stricter rule and
  it is his to choose instead. For it: these are the files where a mistake costs most, and a mixed diff is
  harder to read than an isolated one, so a second pair of eyes is worth more than before. Against it: of the
  last 50 merges on `main`, 17 changed a trusted path, so he would type a line for about one agent pull request in
  three, and on 2026-11-15 he asked for the opposite ("merge autonomously" after review, his line for loosenings
  and ADRs). Not chosen as the default for that reason. Choosing it later is a tightening and needs no new ADR.
- **Label, but keep the SQL classifier** so that the label is asked only for grants on existing objects and not
  for a migration that creates new tables. Not chosen: it keeps about 770 lines of hand-written SQL parsing to
  save a label, and none of the last 50 merges on `main` touched a migration.
- **Exempt Renovate in the guard.** Rejected: anyone with write access can push to a `renovate/` branch, and a
  narrower exemption by path cannot tell a digest bump from an edited workflow without reading file contents.
- **A machine-checked approval** (a required review, or a comment read by CI). Not possible today: agent pull
  requests carry Alex's identity, so GitHub cannot tell his approval from an agent's (ADR 0008).

## Consequences
- This is a loosening. A security change can now sit in the same diff as product lines, and a check can change in
  the same pull request as the code it judges. What answers that: the size limit, the label, the printed list of
  trusted paths, a reviewer who reads the whole diff of the exact head, and Alex's line on anything that loosens.
- The label will be common. Of the 50 first-parent merges on `main` ending at 5336865, 17 changed a trusted path:
  8 a security path, 9 a check path, none both, none a migration; one was Renovate's. Every migration is on the
  list from now on, including one that only creates new tables.
- The lockfile closure check is gone with no replacement. It only ever applied when `package-lock.json` rode with
  a trusted package's dependency change; in any other pull request the lockfile was already unchecked by it.
  `package-lock.json` is not on the trusted list and this record does not add it. What still judges a lockfile
  change: the dependencies guard, `npm audit`, the 7-day release-age rule, the SBOM, and CODEOWNERS' supply-chain
  line as routing.
- `pr-shape` no longer prints which statements of a migration touch existing grants. The reviewer reads the
  migration and the grant-matrix diff; the grant test on real Postgres still fails on any difference between them.
- Every Renovate pull request carries `security-review`, whether or not it changes a trusted path. On those the
  label says less; the printed list of trusted paths is what tells them apart.
- Neither the review nor Alex's line is machine-checked. A session that merged without them would break ADR 0019,
  not a check.
- Retired: `lockfile-scope.ts`, `grant-parse.ts`, `grant-sql.ts`, `grant-json.ts`, most of `trusted-base.ts`, and
  their tests.
- The step book's P0.09c pages describe the retired checks as they were built. They are history, not the rule.

## Compliance
`scripts/guards/change-shape.test.ts`: `trusted_path_needs_label`, `renovate_needs_label_too`,
`trusted_paths_named`, `list_is_union_of_base_and_head`, `trusted_base_list_from_codeowners`,
`checks_list_complete`. `scripts/guards/change-shape-wiring.test.ts`: `job_reads_git_safely` runs the job on a
real repository, with and without the label. `scripts/docs/docs.test.ts`: `pr_template_headings`. The review and
Alex's line are review-only: the reviewer's comment on the pull request names the head, and quotes his line when
one was needed.
