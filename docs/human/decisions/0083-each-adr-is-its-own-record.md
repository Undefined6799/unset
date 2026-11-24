---
status: Accepted
date: "2026-11-21"
step: P1.38y
supersedes:
  - adr: "0002"
    part: D8's ADR 0001 log clause
amends:
  - adr: "0001"
    part: the decisions log (closed)
accepted:
  at: "2026-11-21T05:34:55Z"
  head: "1986712"
  line: "Merge 1889 at 1986712"
  merged: "00d82b6217ed91f9e8028b73e52052a79b1806bb"
---
# 0083 — Each ADR file is its own record; the index is generated and the 0001 log is closed

Alex chose this on 2026-11-21 at 04:04Z ("go") on the proposal in the project's
`plans/adr-collisions/proposal.md`, after asking that adding one thing should not mean editing shared places.

## Context

A pull request that adds or accepts an ADR edited three files besides its own: the index table in
`docs/human/decisions/README.md`, the log at the end of ADR 0001 (decision 35 D8, ADR 0002), and a hand copy of
the index on the docs site. All ADR pull requests wrote the same last lines of the first two, so any two of them
conflicted. A conflicted merge needs a new review, and after Alex's line a new line (ADR 0059). This happened three
times on 2026-11-21 (#1868, #1873, #1876). The docs site copy was checked by nothing and had fallen behind: 47 rows
against 79.

## Decision

1. **Front matter.** Every ADR from 0083 on starts with a YAML front matter block, in this format and no other:
   `status` (Proposed, Accepted or Rejected), `date` (YYYY-MM-DD), `step` (a step id, optional), `supersedes` and
   `amends` (lists of `adr`, a number, and `part`, which `amends` always needs), and, exactly when the status is
   Accepted, `accepted` with `at` (UTC time), `head` (the commit Alex's line named), `line` (his line) and
   optionally `merged`. The file then has no `Status:` line: the front matter is the one place for it. The title is
   the `# NNNN — ` heading. `scripts/docs/adrs.ts` parses it, and the docs test refuses any other key or value.
2. **The index is generated, not committed.** `npm run adr:index` prints it from the files, and the docs site's
   Decisions page builds the same table at each Hugo build (shortcode `adr-index`, reading the folder through two
   mounts in `docs/site/hugo.yaml`), so publishing it needs no new step. `README.md` keeps the process text only and
   stops changing per ADR.
3. **The ADRs before 0083 keep one frozen row each.** Their index rows, statuses and notes, as they stood when this
   landed, are in `legacy-index.yaml`. That file never changes again, and the check refuses any edit to it. An older
   ADR still Proposed is accepted by adding front matter to its own file, whose status then wins over its row; the
   row's decision text stays.
4. **Supersession is written once, in the later ADR.** Once an ADR with `supersedes` or `amends` is accepted, the
   index shows it on the rows it names. The older file is not edited. The one-line "Status: Superseded by NNNN."
   edit of an older accepted ADR stays allowed as before, and the index shows it in place of the frozen status; an
   accepted or rejected ADR with front matter never changes at all.
5. **The 0001 log is closed.** Its last entry says so. From the commit where `legacy-index.yaml` first exists, the
   check refuses any change to ADR 0001.
6. **Acceptance records touch one file.** The pull request after Alex's line fills in the `accepted` block of that
   one ADR. Nothing else changes for the typed line: a new ADR still needs Alex's line naming the reviewed head.

## Alternatives

- Keep the files and let git merge rows (`merge=union` in `.gitattributes`). GitHub does not run custom merge
  drivers on pull requests; it is an open feature request (github.com/orgs/community/discussions/9288, read
  2026-11-21; not tested here). It would also keep three hand copies.
- One small fragment file per ADR for its index row and log line (the changelog-fragment pattern). This avoids
  conflicts too, but adds a second file per ADR that must agree with the first.
- Commit the generated index and regenerate it on conflict. Every pair of ADR pull requests would still conflict,
  so every one would still need a new review.
- A bot regenerates the index on main after each merge. This needs a workflow that writes to main, against ADR
  0019 and the ruleset.

## Consequences

- Two ADR pull requests share no file, so a clean merge of main keeps its review.
- The index is read on docs.unset.sh or with the command, no longer as a table on GitHub; the folder listing still
  shows every ADR by number and title.
- Two readers build the table: `adrIndex` in TypeScript (tested) and the Hugo shortcode. They read the same files
  and apply the same rules; a change to one is made in the other in the same pull request.
- A pull request that still edits the README table or appends to 0001 after this lands fails the docs test. Its
  author moves the row into the ADR's front matter instead.
- The decision history that the 0001 log held is now kept in each ADR's own front matter.

## Compliance

`scripts/docs/adrs.test.ts` and `scripts/docs/docs.test.ts`: the front matter format and each refused value
(`front_matter_refused`); a new ADR without front matter (`adr_set_refused`); the derived supersession
(`adr_index_derives_supersession`); an accepted front matter ADR, the frozen rows and the closed log
(`front_matter_adr_fixed_once_accepted`, `legacy_index_frozen`, `log_closed_once_legacy_index_exists`); and the
real folder (`adr_index_complete`, `adr_index_covers_the_repository`, `adr_immutable`).
