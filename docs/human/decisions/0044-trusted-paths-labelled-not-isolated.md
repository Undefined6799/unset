# 0044 — A trusted-path change is labelled and needs Alex's line; it is no longer isolated

Status: Proposed (awaiting Alex). Alex approved building this on 2026-11-15 23:11:42Z ("yes 1 3 5", item 3 of the
whole-project review's scope calls); that is not acceptance. Until this record is accepted and merged, rule SE-6 as
it stood binds every thread.

It amends engineering rule SE-6 and rule DL-3 (ADR 0002 adopted both). It supersedes one clause of ADR 0019: "the
verifier's adversarial review is the SE-6 security review, replacing Alex's diff read", for the paths in
CODEOWNERS' trusted-base section. No earlier record is edited.

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
     the pull request changes, so the reviewer and Alex see what is being asked;
   - says under "Security review" in its body which trusted paths change and why;
   - merges only after Alex's own line for it: his own message, typed in this project, that names the pull request
     and the head the reviewer checked ("merge #1234 at abc1234"), or his reply to a post that asked for exactly
     that line. A card tap is not a line. A push after the line voids it. The reviewer's comment on the pull
     request quotes the line and its time.
   The label is a declaration an agent applies; it is not the control. The control is Alex's line, and the failing
   job is what stops a trusted change from reaching him unnamed.
4. **Migrations are trusted as whole files.** Nothing classifies SQL statements any more. The `# trusted
   functions:` line stays in CODEOWNERS as the reviewer's list of what to look for in a migration.
5. **Renovate** pull requests need no label: Renovate cannot label by path, and Alex merges each one himself
   (ADR 0019), which is his line.
6. **The template has five headings:** Step, What, How to test, Security review, What I am unsure about. Each is a
   heading of the old template. A migration that adds a `-- why: speed` index still needs a `## Performance
   evidence` heading with p50, p95 and p99 (PF-1).
7. **Unchanged:** the size limit (400 warns, 800 fails without `large-pr` and a reason), the commit and title
   rules, the required checks, the three-PR queue, CODEOWNERS as routing and record, docs-only auto-merge
   (ADR 0034; its paths and the trusted list do not overlap), and everything else in ADR 0019: who merges, the
   conditions read at merge time, and what stays with Alex.

### Pull requests already open
The new rules apply to a pull request from the first `pr-shape` run after this record merges; `pr-shape` runs the
merged copy of the guard, so no rebase is needed.
- An open pull request that changes a trusted path gets the `security-review` label from its own thread, through
  the API. Adding a label re-runs `pr-shape` and changes no commit, so a review of that head still stands.
- It then needs Alex's line like any other. A line he already typed for that head counts.
- A body written against the sixteen headings still passes: the five kept headings are among them.
- Work already split in two under the old rule stays split. Nothing has to be recombined.
- A pull request that changes no trusted path is not affected.

## Alternatives
- **Keep the split.** Rejected: the friction above, for a property (a small security diff) the size limit already
  gives in a weaker form, and guard code larger than most of what it guards.
- **Label and line, but keep the SQL classifier** so that only grants on existing objects need a line and a
  migration that creates new tables does not. Not chosen: it keeps about 770 lines of hand-written SQL parsing to
  save a line on feature migrations, and one of the last 50 merges on `main` touched a migration.
- **Have a machine check Alex's line** (a required review, or a comment read by CI). Not possible today: agent
  pull requests carry Alex's identity, so GitHub cannot tell his approval from an agent's (ADR 0008).
- **Label only, no line.** Rejected: the label is self-applied, so on its own it is a note, not a control.

## Consequences
- This is a loosening. A security change can now sit in the same diff as product lines, and a check can change in
  the same pull request as the code it judges. What answers that: the size limit, the label, the printed list of
  trusted paths, a reviewer who reads the whole diff, and Alex's line.
- It is also a tightening. Under ADR 0019 a trusted-base pull request that loosened nothing merged without Alex.
  Now every one needs his line. Of the last 50 merges on `main`, 16 changed a trusted path (9 a security path, 8 a
  check path, 3 of them Renovate's). That is about one line from him for every four agent pull requests, in
  exchange for fewer pull requests overall.
- Every migration now needs his line, including one that only creates new tables.
- Alex's line is not machine-checked. A session that merged without it would break this record, not a check.
- `pr-shape` no longer prints which statements of a migration touch existing grants. The reviewer reads the
  migration and the grant-matrix diff; the grant test on real Postgres still fails on any difference between them.
- Retired: `lockfile-scope.ts`, `grant-parse.ts`, `grant-sql.ts`, `grant-json.ts`, most of `trusted-base.ts`, and
  their tests.
- The step book's P0.09c pages describe the retired checks as they were built. They are history, not the rule.

## Compliance
`scripts/guards/change-shape.test.ts`: `trusted_path_needs_label`, `renovate_needs_no_label`,
`trusted_paths_named`, `list_is_union_of_base_and_head`, `trusted_base_list_from_codeowners`,
`checks_list_complete`. `scripts/guards/change-shape-wiring.test.ts`: `job_reads_git_safely` runs the job on a
real repository, with and without the label. `scripts/docs/docs.test.ts`: `pr_template_headings`. Alex's line is
review-only: the reviewer quotes it in the pull request comment before any merge.
