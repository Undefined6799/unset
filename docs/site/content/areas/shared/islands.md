---
title: islands
weight: 5
---

The island runtime. Package `@unset/shared-islands`. `safeHref` stays in [ui](../ui/). Framework glue is [ADR 0015](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0015-web-framework-glue.md).

## Owns

An island is a component plus a props check. Both run on the server before render and in the browser before hydration (`shared/islands/define.ts`).

| File | Role |
| --- | --- |
| `shared/islands/define.ts` | `defineIsland`. `ISLAND_MAX_PROPS_BYTES` is 15360. A smaller `maxPropsBytes` is allowed; a larger one throws. |
| `shared/islands/props.ts` | `serializeProps`, `renderPropsTag` |
| `shared/islands/readProps.ts` | `readProps` in the browser. Imports `./props.ts`. |
| `shared/islands/slot.ts` | `IslandSlot`, the server placeholder |

The island components on the tree are under `shared/ui/islands/`, not in this package. `apps/web` has no `*.island.tsx`.

## May import

Row `shared-islands`: its own folder and npm. No Node built-in. It does not import [ui](../ui/).

Declared in `shared/islands/package.json`, as peer dependencies: the package runs inside its host's one React copy, and the hosts (`apps/web`, `shared/ui`) pin the exact version.

| Peer dependency | Range |
| --- | --- |
| `react` | ^19.3.0 |
| `react-dom` | ^19.3.0, optional (only `slot.test.tsx` uses it) |

The React types come from the root devDependencies.

Who may import `shared/islands/index.ts` is the [shared](../) table, plus row `shared-ui-islands` (the only `shared/ui` edge into this package) and `island-import-boundary`.

On this tree: `apps/web` (`render.tsx`, `src/document.tsx`, `src/islands/runtime/`), `interfaces/http/web/page.ts`, and the kit islands under `shared/ui/`.

## Entry points

| Export | Path |
| --- | --- |
| Package export `.` | `shared/islands/index.ts` |
| `defineIsland`, `ISLAND_MAX_PROPS_BYTES` | `shared/islands/define.ts` |
| `serializeProps`, `renderPropsTag` | `shared/islands/props.ts` |
| `readProps` | `shared/islands/readProps.ts` |
| `IslandSlot` | `shared/islands/slot.ts` |

`apps/web/src/islands/runtime/bootstrap.ts` is the browser entry. It imports this package and calls `closePopoversOnPageHide` (`apps/web/src/islands/runtime/popovers.ts`). It is not a file of this package.

## Data

No schema, role or table. Props are JSON. The byte cap is `ISLAND_MAX_PROPS_BYTES`.
