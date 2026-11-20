---
title: web
weight: 2
---

Screens for unset.sh. Package `@unset/apps-web`. UI only: no product rules and no database access. [ADR 0055](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0055-shadcn-svelte-and-one-theme-file.md) is the UI decision. [ADR 0056](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0056-web-boundary-by-file-kind.md) says what the web process may import from here.

## Owns

| Path | What it holds |
| --- | --- |
| `apps/web/lib/components/ui/` | Stock shadcn-svelte. `apps/web/lib/components/inventory.json` lists each file. |
| `apps/web/lib/components/profile/` | Profile and card screens. |
| `apps/web/lib/components/settings/` | Settings screens. |
| `apps/web/lib/components/icon/` | The Svelte Icon. It reads `shared/ui/icons/icons.json`. |
| `apps/web/lib/profile/` | Parse, view and messages. `parse.ts`, `view.ts`, `readme-scan.ts`. |
| `apps/web/lib/settings/` | Settings copy and the profile-form shape. |
| `apps/web/app.css` | Tailwind entry. |
| `apps/web/legal/` | `terms.en.md`, `privacy.en.md` and `domains.en.md`, read as `?raw` by the legal routes. |

The theme is `shared/ui/theme.css`. Links go through `shared/safe-href`.

`interfaces/web` may import `apps/web/lib/`, `apps/web/app.css` and the markdown files directly in `apps/web/legal/` (`interface-web-components`, `web-components-only`). It imports nothing else here. This package does not import `interfaces/`.

Routes are on [Endpoints](/endpoints/web/). The process is [web](../../interfaces/web/).
