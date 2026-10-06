# 0016 — The unset.sh design sheet is the design source

Status: Proposed (awaiting Alex in the P1.21 pull request)

## Context
P1.21 turns design tokens into CSS. Two visual directions exist in the history: the 0x40 "v2e" direction (amber, a
serif face, chamfers, a `UiIcon` set built on `iconoir-react`) and the unset.sh design sheet that Alex approved
for the product (plan §11 Q11; sheet v40 made `surface-card` opaque on 2026-10-04). Code that follows the wrong
one would need restyling throughout, so the source is recorded once.

## Decision
1. The design source is the unset.sh design sheet, https://claude.ai/artifact/78Sh5q9HGz74d5AQyMbQVt, version
   `1791232530-a028` as copied on 2026-10-06. `shared/ui/sheet/` holds read-only copies of its `tokens.json` and
   `components/index.d.ts` (as `components-index.d.ts.txt`, so the copy is neither compiled nor linted), and `shared/ui/fonts/` its two fonts with their SIL OFL 1.1 licences;
   `shared/ui/sheet/source.json` records the version and a sha256 for each file.
2. Tokens change on the sheet, by Alex, never in the repository copy. The token build (`shared/ui/scripts/tokens.ts`) refuses to build when a file
   no longer matches `source.json` (`tokens.source_mismatch`); a new sheet version is copied in a PR that updates
   `source.json` and the generated `shared/ui/src/tokens.css` together.
3. The 0x40 v2e direction is superseded and is followed in nothing: not its amber palette, serif face, chamfers,
   radii or `UiIcon`.
4. Icons are Iconoir 7.12.1 SVGs from the sheet's Icon list, copied and pinned (decision 33, P1.24), never the
   `iconoir-react` package.

## Alternatives
- Keep v2e: rejected; Alex replaced it with the sheet (CLAUDE.md "UI").
- Read tokens from the sheet at build time: rejected; the build would depend on the network and on an artifact
  that can change without review. A pinned, hashed copy is reviewable in a PR.

## Consequences
A sheet change reaches the product only through a PR, so it is reviewed like code. The copy and its hashes must be
refreshed together, which the `tokens_source_hash_mismatch` test enforces. The vault note
`v2e-visual-direction-locked` is to be listed as superseded in the AI notes (a Phase 0 docs item).

## Compliance
`shared/ui/scripts/tokens.test.ts` (`tokens_generate_matches_committed`, `tokens_source_hash_mismatch`) runs in
`npm test`. Reviewed when the sheet moves to a new major version or the brand changes.
