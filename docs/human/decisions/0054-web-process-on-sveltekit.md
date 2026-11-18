# 0054 — The web process runs on SvelteKit with Svelte 5 screens; Hono is removed

Status: Proposed. Acceptance needs Alex's typed line, because decision 4 loosens the CSP. Supersedes ADR 0015.

## Context
ADR 0015 chose Hono with server-rendered React and islands, with no inline script or style anywhere, and failed Astro
because it needs an inline script. On 2026-11-17 Alex chose Svelte 5 with shadcn-svelte for the web UI, then asked
whether SvelteKit could replace Hono for the web process, and to do it "the Svelte way": reach the same outcomes with
SvelteKit's own mechanisms, not a port. He also questioned the no-inline-script rule: a script allowed by its exact
hash is as safe as an external one.

A proof on the branch `claude/project-thread-hz9zrn` (SvelteKit 3.2.0, adapter-node 6.0.2, Svelte 5.57.3; kept as
`/mnt/project-files/svelte-plan/sveltekit-proof-52304fe.bundle`, report in `svelte-plan/sveltekit-parity.md`)
showed that every outcome the Hono web server keeps true also holds on the built SvelteKit server (35 checks), and
that the real sign-in against a PDS and the Postgres session store work when called from SvelteKit files.

Hono is imported in one file, `shared/http/server.ts`, and the web process is its only user; no other process exists
yet.

## Decision
1. The web process (unset.sh) is a SvelteKit app built with adapter-node and started by our own custom server around
   the built handler (`server.ts`, ADR 0056). When the move is complete, Hono, React and the islands runtime are
   removed. Processes added later choose their own server when they are built; SvelteKit is not a default for them.
2. Only what runs today is ported: the 39 routes in `interfaces/http/routes.manifest.json`. No screen or route for a
   feature that does not exist yet.
3. SvelteKit's own mechanism is used where it has one: the Origin check on form posts, form actions with
   `use:enhance`, the cookies API, `src/env.ts` settings checked at start, the server-only module guard, the body cap.
   Writes are form actions, so the card writes that take JSON today become forms. Remote functions stay off
   (SvelteKit's default).
4. CSP for the app group (a loosening). Today (`shared/http/csp/policies.ts`, production snapshot):
   `default-src 'none'; script-src https://unset.sh/assets/; style-src https://unset.sh/assets/; img-src 'self'
   <media>; font-src https://unset.sh/assets/; connect-src 'self'; form-action 'self'; base-uri 'none';
   frame-ancestors 'none'; object-src 'none'; manifest-src 'self'; require-trusted-types-for 'script';
   trusted-types 'none'`.
   New (measured on the proof's built server, plus the media origin):
   `default-src 'none'; connect-src 'self'; font-src 'self'; img-src 'self' <media>; manifest-src 'self';
   object-src 'none'; script-src 'self' 'sha256-<startup script>'; style-src 'self'; style-src-attr
   'unsafe-hashes' 'sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo='
   'sha256-VLgFcXpEe+O6FcWgF9ZsmG0zmp66HOx0AKvg+TMAbTo='; base-uri 'none'; form-action 'self';
   frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types svelte-trusted-html
   sveltekit-trusted-url`.
   What loosens: SvelteKit's inline startup script runs, allowed by its hash, which SvelteKit computes at each build;
   two fixed style attributes run, allowed by exact hash (SvelteKit's route announcer, Bits UI's hidden input); two
   named Trusted Types policies exist instead of none, because Svelte 5 and SvelteKit create them when they load.
   What holds: no `'unsafe-inline'`, no eval, no other inline script or style. The public and profile groups keep
   their policies and send no script (`csr = false`).
5. Under `vite dev` SvelteKit adds `'unsafe-inline'` to the style directives so it can inject styles
   (kit `src/runtime/server/page/csp.js`); the built server never does, and every security test runs on the build.

## Alternatives
- **Svelte drawn by Hono.** Keeps one server we know, but we would rebuild routing, forms, client navigation and
  hydration that SvelteKit gives us.
- **SvelteKit in front of Hono.** Two servers per request and a second boundary to secure, for no outcome the single
  process lacks.
- **Stay on React.** Keeps working code; Alex chose shadcn-svelte components over our hand-built ones.
- **Another runtime (Bun).** Asked on 2026-11-18; kept on Node for this move so a failure is attributable to one
  change. A later trial runs the test suite under Bun before any ADR.

## Consequences
- svelte-check needs TypeScript 6 beside the repo's 7; Biome does not lint `.svelte` files.
- The web tests are ported slice by slice and run against the built server.
- The move lands as a series of pull requests, one route group at a time; the switch-over and the deletion of the
  React UI, `interfaces/http` and Hono come last.

## Compliance
The parity tests that P1.20b ports from the proof run against the built server in CI and check each outcome,
including the exact app-group header above. The CSP snapshot test pins the header; a change to it fails the test.
