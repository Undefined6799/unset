---
title: ui
weight: 8
---

Generic UI: the design sheet copy, tokens, icons, kit components and `safeHref`. Package `@unset/shared-ui`. The design source is [ADR 0016](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0016-design-source.md). Iconoir is decision 33, recorded in [ADR 0001](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0001-phase-0-defaults.md). The island runtime is [islands](../islands/).

## Owns

`shared/ui/sheet/` is a pinned copy of the unset.sh design sheet. `sheet/source.json` records version `1792621080-00d4`, copied 2026-10-21, and a sha256 per file. Tokens change on the sheet. The copy is updated in a PR that updates `source.json` and the generated CSS together (ADR 0016).

Generated styles, which `apps/web/src/styles.ts` globs:

| File |
| --- |
| `shared/ui/src/layers.css` |
| `shared/ui/src/tokens.css` |
| `shared/ui/src/base.css` |
| `shared/ui/components/**/*.module.css` |

`shared/ui/tokens/font-metrics.ts` is the type of `tokens/font-metrics.json`. The build that writes the JSON is [ui-build](../ui-build/).

Icons are Iconoir 7.12.1, copied as `shared/ui/icons/svg/*.svg.txt`. The sheet list is 36 names. `shared/ui/approved-extensions.json` adds `devices` (Iconoir `computer`) and `apps` (Iconoir `view-grid`). `icons/svg/` and `icons/drawings/` each hold 38 files. `icons/icons.json` records `iconoirVersion` `7.12.1`, sheet version `1792621080-00d4`, and `extensionProvenance` (`path`, `sha256`, `designApproval`, `registeredOn`, `iconoirCommit`). `components/Icon/Icon.tsx` draws from `icons.json` on the server. Islands use `IconDrawing` and the one drawing module they import. There is no icon npm package. `Icon`, `IconName` and `IconProps` are exports of `./presentation` (`shared/ui/presentation.ts`). Kit components under `shared/ui/components/` import `Icon` by relative path.

`shared/ui/inventory.json` registers the sheet components. Every entry's `status` is `built`. The Icon, Header, Button and Navigation entries each set `extensions` to `[{ path: "approved-extensions.json", sha256 }]`. A new component is registered on the sheet first.

`shared/ui/approved-extensions.json` is that registration: Navigation, Header, Button, and the two icons. [ui-build](../ui-build/) checks it when writing `icons.json`.

`shared/ui/safe-href.ts`: `safeHref(raw, allow)` returns a `SafeHref` or `null`. `HrefScheme` is `http:`, `https:`, `mailto:` or `path`. The file header says `javascript:`, `data:`, `vbscript:` and protocol-relative links cannot reach the page. Button and Link take `SafeHref`. The cases are `safe-href.test.ts`.

Kit islands on the tree (`shared/ui/islands/`):

| File |
| --- |
| `copy.island.tsx` |
| `header-menu.island.tsx` |
| `modal.island.tsx` |
| `search.island.tsx` |
| `select.island.tsx` |
| `tabs.island.tsx` |
| `toast.island.tsx` |

`index.ts` exports these names. Each component also exports its props type (`ButtonProps`, and the same `Props` suffix on the others):

| Export |
| --- |
| `Button`, `Callout`, `Checkbox`, `DescriptionList`, `Footer`, `BrandHeader`, `Header`, `Input`, `Link`, `Navigation`, `RadioGroup`, `SkipLink`, `Switch` |
| `DescriptionItem`, `NavigationAnchorProps`, `NavigationLinkRenderer` |
| `safeHref`, `SafeHref`, `HrefScheme` |
| `FallbackFace`, `FontMetrics` (types) |

`Header`'s `brandOnly` branch returns `BrandHeader` (`shared/ui/components/Header/Header.tsx`).

`presentation.ts` is the `./presentation` export. The file comment calls it a browser presentation entry: no full Header, island runtime or app imports.

| Export |
| --- |
| `Avatar`, `AvatarProps`, `AvatarSize`, `Button`, `ButtonProps`, `Checkbox`, `CheckboxProps` |
| `Icon`, `IconName`, `IconProps`, `Input`, `InputProps`, `Link`, `LinkProps`, `Mark`, `MarkProps` |
| `Navigation`, `NavigationAnchorProps`, `NavigationLinkRenderer`, `NavigationProps`, `Progress`, `ProgressProps` |
| `safeHref`, `SafeHref`, `HrefScheme` |

## May import

Rows `shared-ui-lexicons` and `shared-ui-islands`: its own folder, npm, and `shared/islands/index.ts`. No Node built-in.

`island-import-boundary` applies to each `*.island.tsx`.

Declared in `shared/ui/package.json`:

| Dependency | Version | Kind |
| --- | --- | --- |
| `@unset/shared-islands` | workspace | dependency |
| `react` | 19.3.0 | dependency |
| `@types/react` | 19.3.0 | devDependency |
| `@types/react-dom` | 19.3.0 | devDependency |
| `react-dom` | 19.3.0 | devDependency |

Who may import the index is the [shared](../) table. [ui-build](../ui-build/) may import it as types only. From outside this package, `infra-shared-via-index` reaches `index.ts`. A `.css` file is the exception, which is how `apps/web/src/styles.ts` reaches the styles.

On this tree, product importers of `@unset/shared-ui` are `apps/web` and `interfaces/http` (`routes/login.ts`, `routes/verify-email.ts`). `scripts/ui/font-metrics.ts` imports the `FontMetrics` type. That folder is tooling. `shared/ui/components/Header/BrandHeader.test.tsx` imports `@unset/shared-ui/presentation` and `@unset/shared-ui/brand-header`.

## Entry points

| Role | Path |
| --- | --- |
| Package export `.` | `shared/ui/index.ts` |
| Package export `./presentation` | `shared/ui/presentation.ts` |
| Package export `./brand-header` | `shared/ui/components/Header/BrandHeader.tsx` |
| Link validator | `shared/ui/safe-href.ts` |
| Browser islands | `shared/ui/islands/*.island.tsx` |
| Styles | the CSS paths above. `apps/web` globs them. This package has no styles entry of its own. |

Rebuild of generated files is [ui-build](../ui-build/).

## Data

No schema, role or table. The sheet copy, `inventory.json`, `approved-extensions.json`, `icons/icons.json`, `tokens/font-metrics.json` and the generated CSS are the package's data.
