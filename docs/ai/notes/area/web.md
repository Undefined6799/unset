---
id: web
type: area
status: current
areas: ["[[web]]"]
summary: "Hub for apps/web: the public site's pages, page shell and island runtime, rendered by interfaces/http."
code: [apps/web/render.tsx]
sources: []
importance: normal
related: ["[[http]]", "[[ui]]", "[[islands]]"]
replaced_by: null
tags: [area, web]
checked: 2026-10-17
---
# web

**What it owns.** The screens of unset.sh: the document (`src/document.tsx`) with its head (`src/shell/head.tsx`),
the app shell (`src/shell/AppShell.tsx`, P1.25), the error page (`src/errors/ErrorPage.tsx`), the screens under
`src/screens/` (P1.25: `Home`, `Legal`; P2.15: `src/legal/` parses the build-inlined English markdown once;
P2.05: `Login`, `LoginContinue`; P2.08: `SignedOut`, `PdsAccountLink`;
P2.11: `VerifyEmail`; P2.12: `welcome/` (`Age`, `Terms`, `ChatLater`, `UnderAge`, `PrivacyNotice`) and a placeholder
`SettingsProfile`; P2.13: `Me`, including the confirm box for sign-out everywhere and the privacy banner), and the islands runtime under
`src/islands/runtime/`. UI only: no product rules, no database, no config or file reads.

**The shell (P1.25).** `renderPage` takes `islands: "on" | "off"` and an optional `shell`. "off" (the public pages
and every error page) gives no island run at all: no renderer, so each kit IslandSlot renders its server markup (the
Header menu stays a plain `<details>`), and no script. With `shell` the page renders inside AppShell: skip link,
Header, `<main id="main">` with a danger Callout for a checked `?error=` code, Footer. The screens built before P1.25
login, continue, signed-out, verify-email and `/me` render inside the shell (one `<main id="main">`). `feed`,
`PrefsForms` and the favicons are still P1.25j. Text is in `src/shell/messages.ts`.

**Entry points.**
- `render.tsx` is the one module `interfaces/http` imports. The interface passes preferences and the parsed build
  manifest in as props. Screens leave through its `screens` object (`screens.login(props)`), never by file, so
  production gets them from the server build like `renderPage`; the render loader refuses a build without it.
  It also re-exports the kit's `safeHref` for the server (P2.05): plain Node cannot load `@unset/shared-ui`, whose
  index reaches the `.tsx` components, so `interfaces/http` imports the kit only as types (`prod_entry_reaches_no_tsx`).
- `src/islands/runtime/bootstrap.ts` is the one browser entry, loaded only on pages that have an island.
  The runtime takes the island types (`IslandDefinition`, `IslandProps`, `IslandRenderer`), `readProps` and
  `serializeProps` from `@unset/shared-islands` ([[islands]]), through its index only; nothing comes from a subpath
  or from `@unset/shared-ui` (P1.25p).
- `vite.config.ts` builds twice (P1.23c). The browser build writes `dist/client` (each `*.island.tsx` its own lazy
  chunk, plus the `src/styles.ts` entry that gathers the global sheets and every CSS Module into the stylesheets each
  page links). Since P1.25 the global sheets (layers, tokens with the two font faces, base) are in it, as globs:
  Vite hoists an eager glob above plain `import` lines, which put the component layer first and broke layer order.
  The fonts it emits are the manifest's `fonts`, which every page preloads. The
  `--ssr render.tsx` build writes `dist/server/render.js`, which production runs. Both, and Vitest, name classes
  with `scripts/ui/css-scope.ts`, so server markup matches the client selectors.

**How data flows.** Request → `interfaces/http` → `render.tsx` props → server-rendered HTML. An island's props
travel as a JSON script from [[islands]] and are checked again in the browser before hydration. A
failed island stays as its server markup and only logs to the console.

**Rules worth knowing.**
- Islands may import `shared/ui`, `shared/islands` and `react/jsx-runtime` (island-import-boundary, P1.23q, P1.25o).
- Island budgets: 15 KB each and 75 KB in total, gzipped (P1.23q).
- Every `*.island.tsx` under `src/islands/` or `shared/ui/islands/` must keep its own lazy chunk: a dynamic entry
  that no entry reaches through static `imports`. `scripts/budgets/island.ts` refuses otherwise before the size gate,
  so an island inlined into boot can no longer drop out of the count unseen (P1.25l).
- No inline script or style on any page (CSP).
- CSS is one bundle: tokens, base and the kit. Do not trim those shared sheets to fit the 40 KiB
  unminified cap, and do not duplicate a rule the kit already provides. Alex (2026-10-17) set the cap at
  52 KiB (53,248 bytes) so the measured 50,063 fits with 3,185 bytes of headroom. `scripts/budgets/` is a
  check path, so that edit is #965 (SE-6) and is not in this pull request. The gzip cap (12 KiB;
  the shell uses 6,376) is what bounds the bytes sent.

**Links.** ADR 0015 (web framework glue), ADR 0016 (design source), [[ui]], [[islands]], [[http]].
