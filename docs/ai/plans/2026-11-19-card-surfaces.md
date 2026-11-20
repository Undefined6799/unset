# Card surfaces

The approved design adds Filled, Outlined and Plain to each existing card's editor. Filled keeps today's
appearance. Outlined has a transparent background, a fine border and no shadow. Plain has no outer fill,
border or shadow. Card content, spacing, widths and editing controls keep working in every surface.

Ownership: apps/web → interfaces/web → domains/profile → shared/lexicons and the existing PDS writer.
No new card kind, dependency, permission or database storage. The public contract is recorded in ADR 0068.

## Task 1: Persist the optional surface

Add regression tests first for stored defaults, strict input, all surface transitions and preservation of
unknown fields. Run them and observe the missing behavior. Add the optional knownValues string to the
section schema, regenerate code, and carry it through the domain, form adapter and create/save actions.
Missing input from an older editor preserves an existing surface; a new card without it is Filled.
Explicit Filled removes the stored field. Missing or unknown schema-valid stored strings render Filled.

Expected: focused domain, form and writer tests pass; schema generation and breaking checks pass.

## Task 2: Expose and render the choice

Carry the surface through the view projection. Reuse the editor's native Choice radios for Surface.
Keep no-script and refused-save values. Apply the outer treatment to all four card kinds; preserve
inner tiles, dividers and buttons. Contact's decorative edge belongs only to its Filled treatment.
Keep current spacing, controls and drag/focus indicators. Add a browser regression exercising save,
reload, returning to Filled, both themes and narrow screens.

Expected: browser assertions observe backgrounds, borders and shadows, and editor selections persist.

## Task 3: Verify and review

Run typecheck, lint, guards and tests plus the focused browser checks. Inspect the rendered change.
Use one independent final code review, address material findings, and prepare the branch for handoff.
The queue currently has three non-doc-labelled agent PRs; implement the explicit user request locally
and recheck capacity before opening another PR. Do not merge.

Review focus: missing versus explicit Filled input, stale stored surfaces, future values, form field
limits, no-script saves, nested Contact styling and keyboard access on Plain cards.

## Verification and handoff (2026-11-19)

Implemented on `claude/card-surfaces`, based on c567d705. The independent review found no remaining product
issues. Its browser-shadow assertion finding was reproduced against pinned Tailwind and corrected.

- 322 affected domain, view, form, writer, lexicon and documentation tests pass.
- TypeScript build, Biome, dependency boundaries and all 282 guard tests pass.
- apps/web Svelte check: zero errors and warnings.
- Chromium: four browser checks pass, including all four kinds and no-script saves. A later screenshot run of
  the surface test also passes. WebKit: the same four checks pass. Desktop light/dark and 320px screenshots
  were inspected; owner controls and plain surfaces remain visible and aligned.
- Firefox cannot start locally: its process reports that it cannot find its temporary profile directory.
- The full `npm run check` run reached 3,617 passing tests but was not green. The two new documentation failures
  were fixed and covered by the passing affected run. Other failures include macOS /bin/bash 3.2 rejecting
  negative array indices in Linux fixtures, GNU cp flags, /proc assumptions, Docker socket ownership checks,
  and storage/network/port-race cases that still need diagnosis or Linux CI. Do not treat the branch as fully
  verified for merge. The additional interfaces/web Svelte check reports two ReadableStream.from type errors
  in untouched infrastructure/seal/sealStream.ts.

Local browser/test commands need Node 26.12.0, Homebrew OpenSSL 3 ahead of system LibreSSL on PATH, and a
TMPDIR outside Git but inside Colima's /Users/alex mount. This run used /Users/alex/.cache/unset-card-surfaces-tmp.
No daemon settings, TLS policy or project test mechanisms were changed to make the checks run.

No PR was opened: the D4 queue is still occupied by #1814, #1808 and #1489 (the latter is not labelled kind/docs).
The worktree is preserved for review and later PR creation. Nothing was deployed or merged.
