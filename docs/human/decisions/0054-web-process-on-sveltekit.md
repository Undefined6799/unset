# 0054 — The web process runs on SvelteKit with Svelte 5 screens; Hono is removed

Status: Accepted by Alex, 2026-11-18 00:19:20Z, against 23b09e6 (his line "I accept the three ADRs, ADR 54, 55, and 56", typed in the project chat after the coordinator had reviewed that head and asked for one line per ADR at 23b09e6). The only changes since that head are the status paragraphs, the index rows, the ADR 0001 entry, the superseded marks on 0015 and 0016, and one sentence in decision 3 (settings come from shared-config, not SvelteKit's `src/env.ts`), changed after 23b09e6 and confirmed by Alex at 8504fd2, 2026-11-18 00:22:56Z (his line "Confirm ADR 0054."). Supersedes ADR 0015.

## Context
ADR 0015 chose Hono with server-rendered React and islands, with no inline script or style anywhere, and failed Astro
because it needs an inline script. On 2026-11-17 Alex chose Svelte 5 with shadcn-svelte for the web UI, then asked
whether SvelteKit could replace Hono for the web process, and to do it "the Svelte way": reach the same outcomes with
SvelteKit's own mechanisms, not a port. He also questioned the no-inline-script rule: a script allowed by its exact
hash is as safe as an external one.

A proof kept outside this repository (a git bundle of commit 52304fe on the branch `claude/project-thread-hz9zrn`;
SvelteKit 3.2.0, adapter-node 6.0.2, Svelte 5.57.3) checked 35 outcomes on the built SvelteKit server: only our hosts
are served, files included; a cross-site write is refused; only form bodies, GET, HEAD and POST are accepted, with
body limits; the session cookie is host-only and hidden from script; signed-in pages need a session for reads and
writes; rate limits by client address and by account; the client address comes only from the edge; every response,
files and refusals included, carries the security headers and the group's CSP; errors show a code, never a message;
every request has a deadline; logs carry no address, account or message; every route has a policy row; the process
drains on shutdown. A browser also signed in through a real PDS and saved a form, with the session and token set in
Postgres. P1.20b brings these checks into the repository as tests.

Hono is imported in one file, `shared/http/server.ts`, and the web process is its only user; no other process exists
yet.

## Decision
1. The web process (unset.sh) is a SvelteKit app built with adapter-node and started by our own custom server around
   the built handler (`server.ts`, ADR 0056). When the move is complete, Hono, React and the islands runtime are
   removed. Processes added later choose their own server when they are built; SvelteKit is not a default for them.
2. Only what runs today is ported: the 39 routes in `interfaces/http/routes.manifest.json`. No screen or route for a
   feature that does not exist yet.
3. SvelteKit's own mechanism is used where it has one: the Origin check on form posts, form actions with
   `use:enhance`, the cookies API, the server-only module guard, the body cap. Settings come from shared-config like
   every other process, loaded by `server.ts` before the handler, because SvelteKit's `src/env.ts` cannot express
   cross-field rules or our exit code. Writes are form actions, so the card writes that take JSON today become forms. Remote functions stay off
   (SvelteKit's default).
4. CSP for the app group (a loosening). Today (`shared/http/csp/policies.ts`, production snapshot):
   `default-src 'none'; script-src https://unset.sh/assets/; style-src https://unset.sh/assets/; img-src 'self'
   <media>; font-src https://unset.sh/assets/; connect-src 'self'; form-action 'self'; base-uri 'none';
   frame-ancestors 'none'; object-src 'none'; manifest-src 'self'; require-trusted-types-for 'script';
   trusted-types 'none'`.
   New (measured on the proof's built server, plus the media origin):
   `default-src 'none'; connect-src 'self'; font-src https://unset.sh/fonts/; img-src 'self' <media>;
   manifest-src 'self'; object-src 'none'; script-src https://unset.sh/_app/ 'sha256-<startup script>';
   style-src https://unset.sh/_app/; style-src-attr 'unsafe-hashes'
   'sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo=' 'sha256-VLgFcXpEe+O6FcWgF9ZsmG0zmp66HOx0AKvg+TMAbTo=';
   base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script';
   trusted-types svelte-trusted-html sveltekit-trusted-url`.
   File sources stay limited to the paths files are served from, as today: SvelteKit's build files under `/_app/`,
   our fonts under `/fonts/`. SvelteKit's policy config is fixed at build time and names `'self'`, while the origin
   is runtime config, so the hook replaces `'self'` in those three directives with the path sources from `ORIGIN`
   on the built server (checked in a browser on the proof: styled, hydrated, enhanced form saved, no CSP report).
   What loosens: SvelteKit's inline startup script runs, allowed by its hash, which SvelteKit computes at each build;
   two fixed style attributes run, allowed by exact hash (SvelteKit's route announcer, Bits UI's hidden input); two
   named Trusted Types policies exist instead of none, because Svelte 5 and SvelteKit create them when they load.
   What holds: no `'unsafe-inline'`, no eval, no other inline script or style, file sources limited by path. The
   public and profile groups keep their policies and send no script (`csr = false`).
5. Under `vite dev` SvelteKit adds `'unsafe-inline'` to the style directives so it can inject styles
   (kit `src/runtime/server/page/csp.js`), and the hook leaves `'self'` in place because Vite serves files from other
   paths; the built server never does either, and every security test runs on the build.

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
