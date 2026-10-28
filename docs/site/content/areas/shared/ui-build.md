---
title: ui-build
weight: 9
---

Pure functions that build [ui](../ui/)'s generated files. Package `@unset/shared-ui-build`. The Node entries that bind `node:fs` live in `scripts/ui/`. Architecture record `2026-10-07-p125-ui-build-workspace.md`.

## Owns

| Runner | Writes, under `shared/ui/` | Entry |
| --- | --- | --- |
| `runTokens` | `src/tokens.css` | `node scripts/ui/tokens.ts` |
| `runIcons` | `icons/icons.json`, `icons/drawings/` | `node scripts/ui/icons.ts` |
| `buildFontMetrics` | `tokens/font-metrics.json` | `node scripts/ui/font-metrics.ts` |

Each entry takes `--check`. `--check` writes nothing and exits 1 when the committed file differs. Freshness tests in this package: `tokens_generate_matches_committed`, `icon_allowlist_matches_sheet`, `font_metrics_current`. `scripts/ui/entries.test.ts` (`ui_build_entries_run_in_node`) runs each entry with `--check`.

`buildIcons` (`shared/ui-build/icons.ts`) reads the sheet's 36-name list and `shared/ui/icons/svg/*.svg.txt`. When `inventory.json`'s Icon entry has `extensions`, the value must be `[{ path: "approved-extensions.json", sha256 }]` and the hash must match the file. The file's sha256 must equal the constant `APPROVED_EXTENSION_SHA256` in that module; any byte change fails with `icons.registration`, naming the file and the expected and actual hash, until a reviewed change bumps the constant. The build then checks the fields it reads: each icon's `iconoirName`, `sourceSha256` and drawings (the same element and attribute allowlist as the sheet), and the base-sheet pins against the actual sheet. The record's `icons` object adds `devices` (Iconoir `computer`), `apps` (Iconoir `view-grid`), `bulb-off` (Iconoir `light-bulb`), `bulb-on` (Iconoir `light-bulb-on`) and `tv` (Iconoir `modern-tv`). Each added `icons/svg/<name>.svg.txt` must match the source sha256 in `approved-extensions.json`. `parseSvg` then checks the drawing. The written `icons.json` keeps `sheetVersion` and adds `extensionProvenance` (`path`, `sha256`, `designApproval`, `registeredOn`, `iconoirCommit`). With no `extensions` field, `icons.json` has 36 names and omits `extensionProvenance` (`icon_absent_extension_preserves_every_output_byte`). The committed file has 41 names and the field (`icon_allowlist_matches_sheet` expects 41 names; `icon_approved_extension_generates_only_the_41_registered_icons` checks the 41 names and the field).

`shared/ui-build/contrast.ts` is the contrast check `runTokens` uses. `shared/ui-build/jsx-free.test.ts` refuses a `.tsx` file, a `react` import, and any `shared/ui` import that is not `import type { … } from "@unset/shared-ui"`.

From the repository root:

```sh
node scripts/ui/tokens.ts
node scripts/ui/tokens.ts --check
node scripts/ui/icons.ts
node scripts/ui/icons.ts --check
node scripts/ui/font-metrics.ts
node scripts/ui/font-metrics.ts --check
```

## May import

Row `shared-ui-build`: its own folder, npm, and `shared/ui/index.ts` as types only. No Node built-in. IO is an argument the `scripts/ui/` entry passes in.

Declared in `shared/ui-build/package.json`:

| Dependency | Version | Kind |
| --- | --- | --- |
| `@unset/shared-ui` | workspace | devDependency |

Who may import it: the tooling row. On this tree the importers are `scripts/ui/tokens.ts`, `scripts/ui/icons.ts` and `scripts/ui/font-metrics.ts`. `shared/ui` does not import this package.

## Entry points

| Export | Path |
| --- | --- |
| Package export `.` | `shared/ui-build/index.ts` |
| `runTokens` | `shared/ui-build/tokens.ts` |
| `runIcons` | `shared/ui-build/icons.ts` |
| `buildFontMetrics` | `shared/ui-build/font-metrics.ts` |

Nothing under `apps/` or `interfaces/` imports this package.

## Data

No schema, role or table. Input is `shared/ui/sheet/`, `shared/ui/fonts/`, `shared/ui/icons/svg/`, `shared/ui/inventory.json`, and `shared/ui/approved-extensions.json` when the Icon row points at it. Output is the files in the table above. The `FontMetrics` type stays in [ui](../ui/).
