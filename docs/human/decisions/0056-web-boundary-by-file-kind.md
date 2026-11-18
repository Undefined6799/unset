# 0056 — In the web process, the UI/server boundary is by file kind, checked

Status: Accepted by Alex, 2026-11-18 00:19:20Z, against 23b09e6 (his line "I accept the three ADRs, ADR 54, 55, and 56", typed in the project chat after the coordinator had reviewed that head and asked for one line per ADR at 23b09e6). The only changes since that head are the status paragraphs, the index rows, the ADR 0001 entry and the superseded marks on 0015 and 0016. Amends decision 34's folder split for the web process only.

## Context
Decision 34 puts screens in `apps/web` and the server in `interfaces/http`. SvelteKit keeps a page's screen
(`+page.svelte`) beside its server code (`+page.server.ts`) in one route folder, so that split cannot hold by folder.

## Decision
1. The SvelteKit project lives in `interfaces/web`; shared components and the theme live in `apps/web`.
2. The boundary is by file kind. Only `*.server.ts`, `hooks.server.ts`, `server.ts` and `lib/server/` may import
   domains or infrastructure. A screen (`.svelte`) or universal load (`+page.ts`, `+layout.ts`) never does.
3. Nothing outside the web process imports Svelte, SvelteKit, `$app` or `$env`; domains, infrastructure and shared
   stay framework-free.
4. Both rules are dependency-cruiser rules (`svelte-screens-no-core`, `sveltekit-web-only`), next to SvelteKit's own
   guard that refuses server-only modules in browser code.
5. The request gate is two files, and only these two. `server.ts`, adapter-node's custom server around the built
   handler, owns what every response needs whatever produced it (built files, `static/`, SvelteKit's own early
   refusals included): the host check, the base security headers, the one log line, listen and drain. `hooks.server.ts`
   owns the per-route checks: form-only bodies, body size, client address, rate limits, session, deadline and the page
   group's CSP. Every route has a row in the route table or is refused; a test checks the routes folder against it.
6. No page is prerendered, because adapter-node serves a prerendered page before the hook. A guard in
   `scripts/guards/` fails the build if the output contains a prerendered `.html` file or if a proof-only route
   (`echo`, `slow`, `proof/`) exists.
7. Rate limits, the request deadline and log redaction stay in the app, not at the edge (decided by Alex
   2026-11-17 23:26Z). The edge may add its own per-address limits, but the app never relies on them, so a
   self-hosted copy behind any proxy keeps them. Per-account limits and our own log lines cannot move anyway.
8. The web folder's tsconfig turns off `exactOptionalPropertyTypes`, because two stock shadcn-svelte components
   fail it. Risk accepted by Alex 2026-11-17 23:25Z: a field set to `undefined` by mistake may pass the type check
   in that folder only. Every other folder keeps the setting.

## Alternatives
- **Keep the folder split** with screens in `apps/web` and server files in `interfaces/web`, using SvelteKit's
  configurable routes folder. It fights SvelteKit's route folders, where a page's screen and server file belong
  together, and the file-kind rule checks the same thing.
- **Screens in a separate SvelteKit app that calls a Hono API.** Two servers and a second boundary to secure for
  every request.

## Consequences
- `interfaces/web` gets its own dependency-matrix row (aliases, Node built-ins in server files).

## Compliance
dependency-cruiser rules `svelte-screens-no-core` and `sveltekit-web-only` (both caught a planted import in the
proof), SvelteKit's server-only module guard, the guard against prerendered pages and proof-only routes, and the
route-table test, all added in P1.20b.
