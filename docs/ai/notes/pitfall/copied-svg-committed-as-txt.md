---
id: copied-svg-committed-as-txt
type: pitfall
status: current
areas: ["[[ui]]", "[[ci]]"]
summary: "Biome 2.5.15 lints .svg files as HTML, so copied third-party SVGs and sheet files are committed with a .txt suffix."
code: [shared/ui/icons/svg, shared/ui/scripts/icons.ts]
sources: [docs/ai/book/phase-1.md]
importance: normal
related: ["[[ui]]"]
replaced_by: null
tags: [pitfall, ui, ci]
checked: 2026-10-06
---
# Copied SVGs are committed as .svg.txt

**What goes wrong.** Biome 2.5.15 (pinned in `package.json`) lints `.svg` files as HTML. Iconoir's own SVG files
then fail `npm run lint` on style rules we cannot fix without changing the bytes, and changing the bytes breaks the
"copied byte for byte" promise of decision 33 (book P1.24i, `docs/ai/book/phase-1.md`).

**The rule.** Third-party data we copy and must keep byte-identical goes in with a `.txt` suffix:
`shared/ui/icons/svg/<name>.svg.txt`, and the design sheet's `bundle.js.txt` and `*.d.ts.txt`. These files are
provenance only: never served by the assets route and never imported. `shared/ui/scripts/icons.ts` reads them, checks
them against the sheet's ICONS data, and generates `icons.json`, which is what the Icon component uses.

**Do not** fix it by excluding the folder in `biome.json`: that is a check-path change and weakens lint for any real
SVG added later.

**Repair.** Renaming later is cheap; only the generator and its test name the paths.
