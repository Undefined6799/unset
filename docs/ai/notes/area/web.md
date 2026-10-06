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
checked: 2026-10-06
---
# web

**What it owns.** The screens of unset.sh: the page shell (`src/document.tsx`), and the islands runtime under
`src/islands/runtime/`. UI only: no product rules, no database, no config or file reads.

**Entry points.**
- `render.tsx` is the one module `interfaces/http` imports. The interface passes preferences and the parsed build
  manifest in as props.
- `src/islands/runtime/bootstrap.ts` is the one browser entry, loaded only on pages that have an island.
- `vite.config.ts` builds the browser side; each `*.island.tsx` becomes its own lazy chunk.

**How data flows.** Request → `interfaces/http` → `render.tsx` props → server-rendered HTML. An island's props
travel as a JSON script (`shared/ui/islands/props.ts`) and are checked again in the browser before hydration. A
failed island stays as its server markup and only logs to the console.

**Rules worth knowing.**
- Islands may import only `shared/ui` and `react/jsx-runtime` (P1.23q's island-import-boundary).
- Island budgets: 15 KB each and 75 KB in total, gzipped (P1.23q).
- No inline script or style on any page (CSP).

**Links.** ADR 0015 (web framework glue), ADR 0016 (design source), [[ui]], [[http]].
