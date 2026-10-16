---
id: web
type: area
status: current
areas: ["[[web]]"]
summary: "Hub for apps/web: the public site's pages, page shell and island runtime, rendered by interfaces/http."
code: [apps/web/render.tsx]
sources: []
importance: normal
related: ["[[http]]", "[[ui]]"]
replaced_by: null
tags: [area, web]
checked: 2026-10-16
---
# web

**What it owns.** The screens of unset.sh: the page shell (`src/document.tsx`), the screens under `src/screens/`
(P2.05: `Login`, `LoginContinue`), and the islands runtime under `src/islands/runtime/`. UI only: no product rules, no database, no config or file reads.

**Entry points.**
- `render.tsx` is the one module `interfaces/http` imports. The interface passes preferences and the parsed build
  manifest in as props. Screens leave through its `screens` object (`screens.login(props)`), never by file, so
  production gets them from the server build like `renderPage`; the render loader refuses a build without it.
  It also re-exports the kit's `safeHref` for the server (P2.05): plain Node cannot load `@unset/shared-ui`, whose
  index reaches the `.tsx` components, so `interfaces/http` imports the kit only as types (`prod_entry_reaches_no_tsx`).
- `src/islands/runtime/bootstrap.ts` is the one browser entry, loaded only on pages that have an island.
- `vite.config.ts` builds twice (P1.23c). The browser build writes `dist/client` (each `*.island.tsx` its own lazy
  chunk, plus the `src/styles.ts` entry that gathers every CSS Module into the stylesheets each page links). The
  `--ssr render.tsx` build writes `dist/server/render.js`, which production runs. Both, and Vitest, name classes
  with `scripts/ui/css-scope.ts`, so server markup matches the client selectors.

**How data flows.** Request → `interfaces/http` → `render.tsx` props → server-rendered HTML. An island's props
travel as a JSON script (`shared/ui/islands/props.ts`) and are checked again in the browser before hydration. A
failed island stays as its server markup and only logs to the console.

**Rules worth knowing.**
- Islands may import only `shared/ui` and `react/jsx-runtime` (P1.23q's island-import-boundary).
- Island budgets: 15 KB each and 75 KB in total, gzipped (P1.23q).
- Every `*.island.tsx` under `src/islands/` or `shared/ui/islands/` must keep its own lazy chunk: a dynamic entry
  that no entry reaches through static `imports`. `scripts/budgets/island.ts` refuses otherwise before the size gate,
  so an island inlined into boot can no longer drop out of the count unseen (P1.25l).
- No inline script or style on any page (CSP).

**Links.** ADR 0015 (web framework glue), ADR 0016 (design source), [[ui]], [[http]].
