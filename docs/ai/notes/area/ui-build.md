---
id: ui-build
type: area
status: current
areas: ["[[ui]]"]
summary: "Hub for shared/ui-build: the pure token, contrast, font-metrics and icon builds that scripts/ui runs under Node."
code: [shared/ui-build/index.ts]
sources: [docs/ai/book/phase-1.md]
importance: normal
related: ["[[ui]]", "[[copied-svg-committed-as-txt]]"]
replaced_by: null
tags: [area, ui]
checked: 2026-10-23
---
# ui-build

**What it owns.** The code that builds shared/ui's generated files, MIT-licensed (P1.25h). The data stays in
shared/ui: the runners read and write its `sheet/`, `fonts/`, `tokens/`, `src/tokens.css` and `icons/` through an
injected `io`, and the Node entries in `scripts/ui/` bind `node:fs` and sha256 to it.

**Files.**
- `build-tokens.ts` and `contrast.ts`: the sheet's `tokens.json` to `tokens.css`, and the WCAG contrast check.
- `tokens.ts`: the token run (`runTokens`), with `--check`.
- `font-metrics.ts`: the metric-adjusted fallback faces (`buildFontMetrics`).
- `icons.ts`: the icon run (`runIcons`), which writes `icons.json` and the per-icon `drawings/` modules.
- Each has its test beside it; the freshness tests (`tokens_generate_matches_committed`,
  `icon_allowlist_matches_sheet`, `font_metrics_current`) read shared/ui's committed files.

**Rules worth knowing.** Everything `index.ts` reaches loads under plain Node 26, which refuses `.tsx`: no `.tsx`
file, no `react` or `react-dom` import, and shared/ui only through a whole-statement `import type { ... } from
"@unset/shared-ui"` (`ui_build_is_jsx_free`; `@unset/shared-ui` is a devDependency). The check parses each file
(oxc through vite's `parseSync`; TypeScript 7 has no in-process parser), so a comment cannot hide an import. No string
may contain the kit's name except that specifier, with named imports only; `require`, `createRequire`, `eval`,
`Function`, `vm` and `import()` of a non-literal are refused; and a relative import must resolve, through symlinks,
inside this workspace and outside its node_modules (P1.25d, P1.25r, P1.25s). Each check has a fixture only it catches
(`ui_build_jsx_free_check_pins_each_check`). shared/ui owns the `FontMetrics` and `FallbackFace` shapes and takes no
dependency on this workspace. `ui_build_entries_run_in_node` runs the entries.

**Registered icons (P2.24f).** The optional singleton `inventory.Icon.extensions` pin may name only
`approved-extensions.json`. `APPROVED_EXTENSION_SHA256` in `shared/ui-build/icons.ts` pins that file's exact bytes
(ADR 0027's dated approval, base-sheet pins, Iconoir commit, Figma nodes, aliases, drawings and component prose
alike); any byte change, prose or key order included, fails with `icons.registration` naming the file and both
hashes, and needs a reviewed bump of the constant (`icon_one_byte_change_to_the_approved_record_fails_closed`).
After the pin, the build still checks the fields it reads (icon aliases, source hashes, the drawing allowlist) and
that the base-sheet pins match the actual sheet. The record's `icons` object joins the
36 imported icons as five names: `devices` → `computer`, `apps` → `view-grid`, `bulb-off` → `light-bulb`,
`bulb-on` → `light-bulb-on` and `tv` → `modern-tv`. Source bytes are hash-checked before the unchanged SVG parser
compares drawings. `icons/svg`, `icons/drawings` and `icons.json` each hold those 41 names.
`icon_approved_extension_generates_only_the_41_registered_icons` checks that generation. Outputs retain the original
`sheetVersion` and separately record `extensionProvenance` with the registration hash and approval. Without the
pointer every committed output stays byte-identical.

**Links.** Architecture record `2026-10-07-p125-ui-build-workspace.md`, [[ui]].
