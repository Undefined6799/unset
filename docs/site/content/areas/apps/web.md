---
title: web
weight: 2
---

The public site: screens, the page shell, and the island runtime. Package `@unset/apps-web`. Framework glue is [ADR 0015](https://github.com/Undefined6799/unset/blob/main/docs/human/decisions/0015-web-framework-glue.md).

## Owns

UI for the http process. Product source under `apps/web` does not read the filesystem or `process.env`. The server passes props into `renderPage` (`apps/web/render.tsx`).

The server reaches screens through the `screens` object in `apps/web/render.tsx`. `interfaces/http/web/render-entry.ts` lists the same keys in `SCREEN_NAMES`.

| `screens` key | Module |
| --- | --- |
| `home` | `apps/web/src/screens/Home.tsx` |
| `login` | `apps/web/src/screens/Login.tsx` |
| `loginContinue` | `apps/web/src/screens/LoginContinue.tsx` |
| `signedOut` | `apps/web/src/screens/SignedOut.tsx` |
| `verifyEmail` | `apps/web/src/screens/VerifyEmail.tsx` |
| `welcomeAge` | `apps/web/src/screens/welcome/Age.tsx` |
| `welcomeTerms` | `apps/web/src/screens/welcome/Terms.tsx` |
| `welcomeChat` | `apps/web/src/screens/welcome/ChatLater.tsx` |
| `welcomeBlocked` | `apps/web/src/screens/welcome/UnderAge.tsx` |
| `me` | `apps/web/src/screens/Me.tsx` |
| `settingsProfile` | `apps/web/src/screens/SettingsProfile.tsx` |
| `legal` | `apps/web/src/screens/Legal.tsx` |
| `errorPage` | `apps/web/src/errors/ErrorPage.tsx` |

Modules a screen renders that are not themselves a `screens` key:

| Module | Rendered by |
| --- | --- |
| `apps/web/src/screens/PdsAccountLink.tsx` | `Me`, `SignedOut`, `VerifyEmail` |
| `apps/web/src/screens/welcome/PrivacyNotice.tsx` | `Me`, `SettingsProfile` |

The rest of the package:

| Piece | Path |
| --- | --- |
| Document | `apps/web/src/document.tsx` |
| Shell | `apps/web/src/shell/AppShell.tsx` |
| Head | `apps/web/src/shell/head.tsx` |
| Theme form | `apps/web/src/shell/PrefsForms.tsx` |
| Copy | `apps/web/src/shell/messages.ts`, `apps/web/src/screens/messages.ts`, `apps/web/src/screens/welcome/messages.ts` |
| Island runtime | `apps/web/src/islands/runtime/` |
| Legal parser | `apps/web/src/legal/` |
| Styles | `apps/web/src/styles.ts`, `apps/web/src/screens/CoreShell.module.css` |

There is no `*.island.tsx` under `apps/web`. `render.tsx` and `apps/web/src/islands/runtime/bootstrap.ts` glob `apps/web/src/islands/*.island.tsx` and `shared/ui/islands/*.island.tsx`. The island components on the tree are under `shared/ui/islands/`.

## May import

The [apps](../) boundary's `app` row, plus the narrowing rules on that page. Source files import `@unset/shared-errors`, `@unset/shared-islands`, and `@unset/shared-ui`.

Declared in `apps/web/package.json`:

| Dependency | Version |
| --- | --- |
| `@unset/shared-errors` | workspace |
| `@unset/shared-islands` | workspace |
| `@unset/shared-ui` | workspace |
| `react` | 19.3.0 |
| `react-dom` | 19.3.0 |

`apps/web/vite.config.ts` imports `scripts/ui/css-scope.ts`. `apps/web/src/styles.ts` globs CSS under `shared/ui/` (`layers.css`, `tokens.css`, `base.css`, and `shared/ui/components/**/*.module.css`). `web-not-admin` refuses a path that is `admin/…` or contains `/admin/`.

## Entry points

| Role | Path |
| --- | --- |
| Render module | `apps/web/render.tsx` |
| Package export `.` | `./render.tsx` (`apps/web/package.json`) |
| Package export `./server`, types | `./render.tsx` |
| Package export `./server`, default | `./dist/server/render.js` after the build below. `dist/` is gitignored. |
| Loader | `interfaces/http/web/render-entry.ts` imports `@unset/apps-web/server` and requires `renderPage`, `islandName`, `screens`, and `safeHref` |
| Browser entry | `apps/web/src/islands/runtime/bootstrap.ts` (Vite input `boot`) |
| Styles entry | `apps/web/src/styles.ts` (Vite input `styles`) |
| Build config | `apps/web/vite.config.ts`. Nothing imports it. |

`render.tsx` re-exports `safeHref` from `@unset/shared-ui`. The loader requires that export. What `safeHref` accepts is the kit's behaviour.

Build, from `apps/web/package.json`:

```sh
npm run build -w @unset/apps-web
```

That runs `vite build --config vite.config.ts` (output `dist/client`) and `vite build --config vite.config.ts --ssr render.tsx` (output `dist/server`).

## Data

No schema, role, or table. The Postgres role `web` is the http process's login; see [Apps](../).

Icons the styles entry exports (`?url&no-inline` in `apps/web/src/styles.ts`): `apps/web/src/shell/icons/unset-favicon-32.png`, `apps/web/src/shell/icons/unset-apple-touch-icon.png`.

English legal markdown, inlined at build by `apps/web/src/legal/documents.ts` (`?raw`):

| File | Key |
| --- | --- |
| `apps/web/legal/terms.en.md` | `terms` |
| `apps/web/legal/privacy.en.md` | `privacy` |
| `apps/web/legal/domains.en.md` | `domains` |

French legal files are (planned). `documents.ts` says they land in the i18n slice. They are not on the tree.
