# Architecture decision records

One file per decision that is expensive to reverse: Context, Decision, Alternatives (at least two), Consequences,
Compliance (engineering rule DO-1). Number them in order and never rewrite an accepted one; a later ADR supersedes it
instead (DO-2).

**Each ADR file is its own record (ADR 0083).** A pull request that adds or accepts an ADR edits that one file and
nothing shared, so two ADR pull requests never conflict.

- **A new ADR** starts with front matter, and has no `Status:` line:

  ```yaml
  ---
  status: Proposed            # Proposed, Accepted or Rejected
  date: "2026-11-21"
  step: P1.38y                # optional
  supersedes:                 # optional; the ADRs or parts this replaces
    - adr: "0002"
      part: D8's ADR 0001 log clause   # optional for supersedes, required for amends
  amends:                     # optional, same shape
    - adr: "0001"
      part: the decisions log
  ---
  # 0083 — Title
  ```

- **Accepting it** is the pull request after Alex's line: set `status: Accepted` and add
  `accepted: { at: "2026-11-21T05:00Z", head: <the head his line named>, line: "<his line>", merged: <commit> }`.
  `merged` is optional. Once accepted or rejected, the file never changes again.
- **Superseding** is written in the new ADR only (`supersedes`, `amends`). The index shows it on the older rows once
  the new ADR is accepted; the older file is not edited.
- **The index** is generated: it is the Decisions page on docs.unset.sh, built at each publish, and
  `npm run adr:index` prints the same table. The ADRs from before 0083 keep their rows, as they stood at the
  cut-over, in [`legacy-index.yaml`](legacy-index.yaml), which never changes. An older ADR still Proposed is accepted
  by giving its own file front matter; its row keeps the decision text.
- **ADR 0001** collected decisions 1 to 34 and then, from decision 35 (D8), logged every later decision. The log closed
  with ADR 0083 and the file no longer changes.

`scripts/docs/adrs.ts` reads the format; the docs test (`npm test`) refuses any other key or value.
