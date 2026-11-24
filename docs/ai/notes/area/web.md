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
checked: 2026-11-24
---
# web

**What it owns (P1.20k, 2026-11-18).** The screens of unset.sh, in Svelte 5 (ADRs 0054 to 0056). The React
screens, `render.tsx`, the island runtime and Hono are deleted; nothing in the repository imports React any more
(the PDS sign-in screens stay upstream React by design, ADR 0027, built in `deployment/pds`).

- `apps/web/lib/components/`: stock shadcn-svelte in `ui/` (themed only by `shared/ui/theme.css`), our `icon/`,
  `profile/` and `settings/` components beside it; `inventory.json` lists them all. `app.css` is the Tailwind entry.
- `apps/web/lib/profile/`: the card views and the Markdown reader (`parse.ts`). The views run on the server only
  (the member page's load); the components render what they return, every link already through `safeHref`.
- `apps/web/legal/`: the three legal texts, read as `?raw` by the legal pages.
- `interfaces/web/`: the SvelteKit server. `server.ts` (adapter-node custom server: host check, base headers, the
  log line, listen and drain; the base headers are `STATIC_CSP` from `src/lib/server/csp.ts`, web's only CSP source,
  and shared/http's `SECURITY_HEADERS`) and `src/hooks.server.ts` (per-route policy, session, limits, deadline, CSP) are the
  request gate; `src/lib/server/` holds the server modules and the composition root (`compose.ts`); each route has a
  `policy.ts`. The shell is the root `+layout.svelte`, fed by a page's `shell` (`src/lib/shell.ts`).

**How data flows.** Request → `server.ts` → `hooks.server.ts` gate → a `+page.server.ts` load or form action, which
calls a domain (and infrastructure through `lib/server`) → a plain view object → the Svelte page. Every page
says in its own `+page.ts` whether it runs SvelteKit's client, `csr = true` or `csr = false` (P1.22j); the root
layout's `csr = true` decides the error page alone (ADR 0116, P1.22k), so every error page runs the client: an
unmatched address, and a failed load on any route (kit takes `csr` from the layouts alone there, 3.2.0
`page/index.js:272-291`, `respond_with_error.js:44-46`). A page that says false also says `client: false` in its
`policy.ts`, and `gate.test.ts` names each with its reason (since P1.22l: three routes nobody reads,
`/login/continue`, `/prefs/theme` and `/privacy-notice/seen`; every page a person reads runs the client). The hook
sends SvelteKit's own CSP, narrowed, only when
two things hold: kit's header names a start-up script hash, and the document may run it (the route's own page
unless `client: false`, or the error page, which the hook knows from `handleError` having run: `locals.erred`).
That kit sent a header says nothing: it sends one on every page it draws. Refusals, redirects, data addresses and
files keep the fixed policy. An `app` page without the client (the sign-in hop, `/login/continue`) gets the public
group's fixed policy since P1.22l: styles and fonts, no `script-src`. Before, it kept kit's hashless policy.
SvelteKit writes a server load's result into the start-up script it hashes, so on a page that runs the client a
value the request chose is returned only in its parsed shape (`/login`: `next` and `close` as `safeReturnPath`;
`/join`: the invite as `joinCode`), and `sign-in.test.ts` and `invite.test.ts` read the script with hostile values.
A route whose load always redirects needs no `+page.svelte` and then says nothing of `csr` (`/welcome`).
The error page's start-up script holds nothing from the request (ADR 0116 point 6): the root server load returns
the theme and no path; `+layout.ts` works out the Sign in link's and the theme form's way back from `url`
(`lib/return-paths.ts`, unchecked there by design: `/login`, `/prefs/theme` and `/privacy-notice/seen` check them
on use). The server load still reads `url.pathname` so that it reruns on every navigation.
The bell (P1.22g, ADR 0116 points 8 and 9): the server draws a link to `/notifications` on every page and never the
panel; `+layout.svelte` turns it into the panel's button once mounted (`clientReady`), so a press before the client
is ready, or with no script, follows the link. The root server load sends the entries only where the route's page
runs the client (`runsClient(policyOf(route.id))`, one rule shared with the hook, policy.ts), else the count alone.
A page that reads the query and runs the client returns it as a parsed flag or reads it in the universal load, so
no query text is in the hashed start-up script (`/request-invite` `?sent`, `?error=`; tests hold the bytes).
`every-answer.test.ts` (P1.22j) names every route of the built server and what its GET and data address answer for a
visitor and a member, plus the answers no route gives (unmatched, refusals, redirects, build files, a 304), and pins
each CSP header by value: a new route, or a page with no `csr` line, fails it until it has a row.
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

**Reading Markdown (P1.21k, 2026-11-23).** `parse.ts` reads a Text card with micromark 4.0.3 (CommonMark, the GFM
table, strikethrough, task and autolink extensions; no footnote, no math), the reader Milkdown uses, and narrows the
tree to the card's `Block` types. micromark is not bounded: its readme's Security section says a small text can crash
it, and at 20,000 characters `_*` repeated takes about 5 s and `+ ` repeated about 10 s before the stack runs out. So
no server code calls `parseReadme` bare: a page load takes `services().textReads.forPage(deadlineAt)`
(`lib/server/text-reader.ts`), which stops each read with node:vm's `timeout` at `TEXT_READ_LIMITS` (limits.ts), shares
one budget across the page's cards and shows a stopped card with `plainText`. The process keeps what each read gave
for ten minutes, by a hash of the text, a stop included, so a text is parsed once in that time however often its
page is loaded (review of #2013: uncached, a stalling page cost 300 ms on every load). The process's 10 s timer (compose.ts) sweeps out what is past its ten minutes, so a changed or deleted text does not stay in memory. `topBlocks` gives the top-level blocks and their lines, the count ADR 0110
places looks by; `parse.blocks.test.ts` is its corpus. In the browser the reader runs only in the card dialog's
Preview, loaded when Preview opens, on the owner's own text; the Preview's code colouring (`colourBlocks`, with CodeMirror's language list) is loaded there too, never by a static import in a component: one in `card-editor.svelte` put 90 KiB gzip on the owner's first load (257.8 against 167.7, measured at the merge of #2008). The reader's blocks are kept and frozen (text-reader.ts), so `colourBlocks` builds new code blocks and changes none. Vite's alias for `decode-named-character-reference`
(`vite.config.ts`) must stay: the package's browser file writes to `innerHTML`, which Trusted Types refuses, and
without it neither the Preview nor Milkdown reads a text holding `&amp;`.

**Math (P1.21v, 2026-11-24).** The page's own parse also reads micromark-extension-math 3.1.0 (`$…$`, `$$…$$`) and
draws a ```` ```math ```` block as a formula; `topBlocks` reads without it, so looks are still placed on CommonMark's
blocks (ADR 0110 decision 5). `math.ts` draws a formula with KaTeX 0.16.47 (`output: "mathml"`, `trust: false`,
`maxExpand` 100, `maxSize` 10), reads KaTeX's string back with parse5 8.0.1 and keeps only allowlisted MathML
elements and attributes with plain values (no colour, style, link or picture); `readme.svelte` draws the tree with
`svelte:element` and an `xmlns`, which svelte 5.57.3 takes as the element's namespace. A string from KaTeX never
reaches the page. A formula KaTeX cannot read, longer than 2,000 characters, or past the card's 200 formulas or
20,000 elements is its source. The math runs inside the same read (and deadline) as the Markdown; in the browser it
is in the Preview's chunk only (about 119 KiB gzip with the reader), never on a first load. Between single dollars the page keeps
Pandoc's rule, as Crepe 7.23.0 does (`remarkInlineMathGuardPlugin`), so "$5 and $10" stays words; the editor must too.

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
