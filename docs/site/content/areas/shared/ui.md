---
title: ui
weight: 8
---

Design data the apps share. Package `@unset/shared-ui`, MIT. The React kit that lived here was deleted in P1.20k. [ADR 0055](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0055-shadcn-svelte-and-one-theme-file.md) is the UI decision. Iconoir is decision 33. The design source is [ADR 0016](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0016-design-source.md).

## Owns

| Path | What it holds |
| --- | --- |
| `shared/ui/theme.css` | The theme. Screens are themed only by this file. |
| `shared/ui/tokens/` | Token source. `shared/ui/src/tokens.css` is generated from it. |
| `shared/ui/sheet/` | Pinned copy of the design sheet. |
| `shared/ui/fonts/` | `SpaceGrotesk-Variable.woff2` and `JetBrainsMono-Variable.woff2`. |
| `shared/ui/icons/` | The Iconoir copy and `icons.json`. |
| `shared/ui/approved-extensions.json` | Icons added beyond the sheet list. |
| `shared/ui/inventory.json` | Sheet components and their status. |
| `shared/ui/components/Navigation/README.md` | The sheet note for Navigation. No component code. |
| `shared/ui/index.ts` | Font-metric types for `shared/ui-build`. Nothing else. |

Package exports (`shared/ui/package.json`): `.`, `./icons.json`, `./fonts/*.woff2`, `./theme.css`.

`safeHref` is [`shared/safe-href/`](https://github.com/Undefined6799/unset/blob/main/shared/safe-href/safe-href.ts). The Svelte screens are [web](../../apps/web/). `LEAF_SHARED` includes this folder. Row `shared-ui-safe-href` reaches `shared/safe-href/index.ts`. The Svelte Icon and the font route are the only product readers of `icons.json` and the two font files (`svelte-no-react-ui`).
