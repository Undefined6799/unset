---
id: web
type: area
status: current
areas: ["[[web]]"]
summary: "Hub for apps/web (Svelte components, theme, profile parsing) and the SvelteKit server in interfaces/web."
code: [apps/web/lib/profile/parse.ts, interfaces/web/server.ts, interfaces/web/src/hooks.server.ts]
sources: []
importance: normal
related: ["[[http]]", "[[ui]]", "[[islands]]"]
replaced_by: null
tags: [area, web]
checked: 2026-11-23
---
# web

**What it owns (P1.20k, 2026-11-18).** The screens of unset.sh, in Svelte 5 (ADRs 0054 to 0056). The React
screens, `render.tsx`, the island runtime and Hono are deleted; nothing in the repository imports React any more
(the PDS sign-in screens stay upstream React by design, ADR 0027, built in `deployment/pds`).

- `apps/web/lib/components/`: stock shadcn-svelte in `ui/` (themed only by `shared/ui/theme.css`), our `icon/`,
  `profile/` and `settings/` components beside it; `inventory.json` lists them all. `app.css` is the Tailwind entry.
- `apps/web/lib/profile/`: the card views and the README parser. They run on the server only (the member page's
  load); the components render what they return, every link already through `safeHref`.
- `apps/web/legal/`: the three legal texts, read as `?raw` by the legal pages.
- `interfaces/web/`: the SvelteKit server. `server.ts` (adapter-node custom server: host check, base headers, the
  log line, listen and drain; the base headers are `STATIC_CSP` from `src/lib/server/csp.ts`, web's only CSP source,
  and shared/http's `SECURITY_HEADERS`) and `src/hooks.server.ts` (per-route policy, session, limits, deadline, CSP) are the
  request gate; `src/lib/server/` holds the server modules and the composition root (`compose.ts`); each route has a
  `policy.ts`. The shell is the root `+layout.svelte`, fed by a page's `shell` (`src/lib/shell.ts`).

**How data flows.** Request → `server.ts` → `hooks.server.ts` gate → a `+page.server.ts` load or form action, which
calls a domain (and infrastructure through `lib/server`) → a plain view object → the Svelte page. Pages that need
script set `csr = true` in their `+page.ts`; the root layout sets `csr = false`, so a page ships no script unless it
asks. A public page that asks also says `client: true` in its `policy.ts` (ADR 0114, P1.22e): the hook then keeps
SvelteKit's own CSP, narrowed, on that page's 200 answer only. The public profile is the first; its 404 runs no
script (for a failed load kit takes `csr` from the layouts alone, 3.2.0 `page/index.js:276`) and keeps the fixed
policy, as do its refusals and its data address. `gate.test.ts` names the pages switched on.
A client navigation keeps the document, so the layout's `afterNavigate` applies the theme a full load of the new page
would have (system where `prefs` is absent); without it a visitor's saved theme was lost from the profile to /login.

**A page's data address (P1.22h, 2026-11-23).** SvelteKit answers `<page>/__data.json` for every page route with the
whole result of its server loads (root layout and page), whatever `csr` says (kit 3.2.0 `src/runtime/server/respond.js`
`is_data_request`, `data/index.js`). So a load on a script-free page is still sent to anyone who asks, and a page
that runs the client carries the same result in its start-up script (`data-address.ts` `startupData` reads it back
without running it): return only what the page draws for that viewer (rule SE-3), which is why the public profile
sends `shownCards`, not the card records. The gate sees the page's own route there, so policy, limit, deadline, session and the member's
`private, no-store` hold; `setHeaders` in a page load applies to the data answer too, but a universal load (`+page.ts`,
home's cache rule) and a skipped page load (`?x-sveltekit-invalidated=10`) set nothing, so `server.ts` says `noindex`
on every data address itself. A missing page is an error node under status 200. The tests are the "data address"
blocks in `tests/integration/web/public/`, read back with `tests/integration/web/data-address.ts`. A member's copy
still carries their own bell entries and a Sign in address their page does not draw (pinned there).

**Rules worth knowing.**
- Only server files (`*.server.ts`, `+server.ts`, `hooks.server.ts`, `server.ts`, `lib/server/`) reach a domain or
  infrastructure (`svelte-screens-no-core`); SvelteKit's own guard keeps `lib/server` out of browser code.
- dependency-cruiser compiles `.svelte` files with the Svelte 5 compiler, which drops `import type`, so a type-only
  import in a `.svelte` file is not seen by the boundary rules (found 2026-11-18,
  `/mnt/project-files/architecture/svelte-boundary-audit.md`).
- No page is prerendered (`scripts/guards/web-prerender.ts`). The app-page JS target is 120 KB gzip, a warning only
  (`scripts/budgets/app-js.ts`).
- No inline script or style on any page beyond SvelteKit's hashed startup script and two hashed style attributes
  (`interfaces/web/vite.config.ts`).
- Work on a member's input inside a page load is synchronous and blocks every request on the process, so it needs a
  bound a timer can enforce between small steps. Code colouring (P1.21v, review of #2004): a CodeMirror parser is
  driven by `startParse`/`advance()` to a deadline, but a stream parser's step is whole lines and Markdown's a whole
  paragraph, and some legacy modes are worse than quadratic in a line, so size and line caps bound the step and the
  deadline bounds the sum (`CODE_COLOUR_LIMITS` in `interfaces/web/src/lib/server/limits.ts`, measured in
  `apps/web/lib/editor/code-colours.ts`). Some parsers also throw.

The paragraph below describes the React shell; the Svelte shell's Sign in is a link to /login with `next` set to
the page (`signInHref`, `routes/+layout.server.ts`).

**Sign in opens in place (P2.05p).** With `PageDeps.pdsHost` set, the default shell's Header Sign in is a button
that opens `#sign-in`, a modal `<dialog>` (invoker commands, no script) holding the same `screens/SignInBox` the
/login page draws. Escape and its Close button hide it; the page behind is inert. Not a popover: its `::backdrop`
passes clicks through and Tab leaves it. `next` is the page's path only. The footer's Sign in
and protected pages' redirects still use /login.

**Card editing with script (P1.20k, 2026-11-18).** A component that behaves differently with script sets a
`hydrated` flag in its first `$effect`, so the server markup and the first client render match and the no-script path
(plain buttons, ten blank rows, the in-place panel) is the server's. bits-ui 2.20.6 menus lock page scroll by default;
a menu that opens a Dialog must pass `preventScroll={false}`, or the two locks overlap and the page jumps to the top.
A buttons row hides the other kind's fields with `group-has-[[value=link]:checked]` on native radios, so it holds
with no script.

**Split client (P1.21g, ADR 0069).** `output.bundleStrategy` is `split`. Kit then lists no stylesheet in
`manifest.client`, so `server.ts` reads the refusal page's sheet from the root layout's node 0 after the handler has
loaded (loading node 0 loads layout code, which reads the process note). The root layout's `beforeNavigate` loads a
link in full once `updated.current` is true.

**Links.** ADR 0015 (web framework glue), ADR 0016 (design source), [[ui]], [[islands]], [[http]].
