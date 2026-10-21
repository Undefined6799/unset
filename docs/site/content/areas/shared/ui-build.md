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

No schema, role or table. Input is `shared/ui/sheet/`, `shared/ui/fonts/` and `shared/ui/icons/svg/`. Output is the files in the table above. The `FontMetrics` type stays in [ui](../ui/).
