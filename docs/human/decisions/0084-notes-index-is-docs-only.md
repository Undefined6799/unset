---
status: Proposed
date: "2026-11-21"
step: P1.38z
amends:
  - adr: "0034"
    part: point 1, the allowlist
---
# 0084 — The notes index counts as a docs-only path

## Context

The notes guard (`scripts/guards/notes.ts`) writes `docs/ai/INDEX.md` from the notes under `docs/ai/notes/`, and
fails when the committed file differs from what it would write. So every pull request that adds or changes a note
also changes `INDEX.md`. ADR 0034 point 1 lists the docs-only paths, and `docs/ai/INDEX.md` is not one of them, so
no notes pull request can ever pass the `docs-only` check or auto-merge: #1875 and #1896 both failed it on that one
path. The allowlist is read from the default branch, so a notes pull request cannot fix this itself.

## Decision

1. `scripts/guards/docs-only-paths.ts` also allows `docs/ai/INDEX.md`, by that exact, case-sensitive path. No
   other file under `docs/ai/` outside `docs/ai/notes/` is allowed, and the rest of ADR 0034 point 1 is unchanged.
2. Everything else in ADR 0034 holds: the read-only check, the auto-merge job run from the default branch, its
   re-listing of files, `kind/docs`, and the required checks.

## Alternatives

- **Leave it.** Every notes pull request then goes through the verifier like code, which ADR 0034 meant to avoid.
- **Allow `docs/ai/**`.** That would let the plan, the step book and handoffs auto-merge; ADR 0034 keeps those out on
  purpose.
- **Stop committing `INDEX.md` and generate it on demand.** Agents and GitHub read the committed file, so this
  changes how the notes are found and is a larger change than this one path.

## Consequences

- A notes-only pull request with `kind/docs` and green required checks can auto-merge once ADR 0034's mechanism is
  live.
- What could reach main without a review grows by one file. Its content can only be the index of the notes, which
  are already allowed: the required `check` job runs the notes guard, which fails on a stale or hand-edited
  `INDEX.md`, so the file cannot say anything the notes do not.
- Agents read `INDEX.md` to find notes; a note is already auto-mergeable text, so this adds no new place to write
  instructions an agent would read.

## Compliance

`scripts/guards/docs-only-paths.test.ts`, `notes_index_is_allowed_by_its_exact_path`: the exact path is allowed, its
look-alikes (`docs/ai/index.md`, `docs/ai/INDEX.MD`, `docs/ai/INDEX.md.bak`, `docs/ai/x/INDEX.md`) are refused, and
a rename from a refused path is refused. `scripts/guards/notes.test.ts`: `notes_index_stale_fails` shows a stale
index fails the guard, and `notes_good_vault` runs the guard on the real tree in the required `check` job.
