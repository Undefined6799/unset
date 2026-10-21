---
title: ui
weight: 8
---

Generic UI: the design sheet copy, tokens, icons, kit components and `safeHref`. Package `@unset/shared-ui`. The design source is [ADR 0016](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0016-design-source.md). Iconoir is decision 33, recorded in [ADR 0001](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0001-phase-0-defaults.md). The island runtime is [islands](../islands/).

## Owns

`shared/ui/sheet/` is a pinned copy of the unset.sh design sheet. `sheet/source.json` records version `1791232530-a028`, copied 2026-10-06, and a sha256 per file. Tokens change on the sheet. The copy is updated in a PR that updates `source.json` and the generated CSS together (ADR 0016).

Generated styles, which `apps/web/src/styles.ts` globs:

| File |
| --- |
| `shared/ui/src/layers.css` |
| `shared/ui/src/tokens.css` |
| `shared/ui/src/base.css` |
| `shared/ui/components/**/*.module.css` |

`shared/ui/tokens/font-metrics.ts` is the type of `tokens/font-metrics.json`. The build that writes the JSON is [ui-build](../ui-build/).

Icons are Iconoir 7.12.1, 36 names, copied as `shared/ui/icons/svg/*.svg.txt`. `icons/icons.json` records `iconoirVersion` `7.12.1` and the sheet version. `icons/drawings/<name>.generated.ts` is one module per icon (36). `components/Icon/Icon.tsx` draws from `icons.json` on the server. Islands use `IconDrawing` and the one drawing module they import. There is no icon npm package. `Icon` is not a package export. Kit components under `shared/ui/components/` import it.

`shared/ui/inventory.json` registers the sheet components. Every entry's `status` is `built`. A new component is registered on the sheet first.

`shared/ui/safe-href.ts`: `safeHref(raw, allow)` returns a `SafeHref` or `null`. `HrefScheme` is `http:`, `https:`, `mailto:` or `path`. The file header says `javascript:`, `data:`, `vbscript:` and protocol-relative links cannot reach the page. Button and Link take `SafeHref`. The cases are `safe-href.test.ts`.

Kit islands on the tree (`shared/ui/islands/`):

| File |
| --- |
| `copy.island.tsx` |
| `header-menu.island.tsx` |
| `modal.island.tsx` |
| `select.island.tsx` |
| `tabs.island.tsx` |
| `toast.island.tsx` |

`index.ts` exports the components the screens import, not every folder under `components/`:

| Export |
| --- |
| `Button`, `Callout`, `Checkbox`, `Footer`, `Header`, `Input`, `Link`, `Navigation`, `RadioGroup`, `SkipLink` |
| `safeHref`, `SafeHref`, `HrefScheme` |
| `FallbackFace`, `FontMetrics` (types) |

## May import

Rows `shared-ui-lexicons` and `shared-ui-islands`: its own folder, npm, and `shared/islands/index.ts`. No Node built-in.

`island-import-boundary` applies to each `*.island.tsx`.

Declared in `shared/ui/package.json`:

| Dependency | Version |
| --- | --- |
| `@unset/shared-islands` | workspace |
| `react` | 19.3.0 |

`react-dom` is a devDependency, 19.3.0.

Who may import the index is the [shared](../) table. [ui-build](../ui-build/) may import it as types only. CSS files are the `infra-shared-via-index` exception, which is how `apps/web/src/styles.ts` reaches them.

On this tree, product importers of the package are `apps/web` and `interfaces/http` (`routes/login.ts`, `routes/verify-email.ts`). `scripts/ui/` imports the type for the font-metrics entry. That folder is tooling.

## Entry points

| Role | Path |
| --- | --- |
| Package export `.` | `shared/ui/index.ts` |
| Link validator | `shared/ui/safe-href.ts` |
| Browser islands | `shared/ui/islands/*.island.tsx` |
| Styles | the CSS paths above. `apps/web` globs them. This package has no styles entry of its own. |

Rebuild of generated files is [ui-build](../ui-build/).

## Data

No schema, role or table. The sheet copy, `inventory.json`, `icons/icons.json`, `tokens/font-metrics.json` and the generated CSS are the package's data.
