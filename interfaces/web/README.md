# interfaces/web

The web process (unset.sh) on SvelteKit 3 with adapter-node (ADR 0054, ADR 0056). It replaces interfaces/http one
route group at a time (step book P1.20b to P1.20k); until the switch-over (P1.20j) nothing deploys it.

## How a request is checked

1. `server.ts`, our custom server around adapter-node's handler, runs for every response, files included: the host
   check (400 or 421), the base security headers, the one log line, listen and drain. It loads the settings
   (`src/lib/server/config.ts`, shared-config, exit 78) and shares them through `src/lib/server/note.ts`.
2. SvelteKit refuses a cross-site form post (403) before the hook.
3. `src/hooks.server.ts`, in order: the route's policy (no policy is a 500), test routes, GET/HEAD/POST only, form
   bodies only, the body size, the client address and its rate limit, the session (read only), the per-member limit,
   then the route under its deadline, and last the page group's CSP.

## How a lane adds a page

1. Make the route folder under `src/routes/`, one folder per page, as SvelteKit names it.
2. Put a `policy.ts` beside the `+page` or `+server` file:
   `export const policy = definePolicy({ group: "app", limit: "default" });`, imported by relative path from
   `src/lib/server/policy.ts` (no `$lib` or `#lib` alias: the repo allows only relative and package specifiers).
   - `group`: `app`, `public` or `static` (JSON, files). Every page says in its own `+page.ts` whether it runs
     SvelteKit's client, `export const csr = true;` or `export const csr = false;`: an `app` page as a rule does, a
     `public` page only when its policy also says `client: true`. Then name the route in
     `tests/integration/web/every-answer.test.ts`, which pins what every route answers and fails on one it does not
     name.
   - `limit`: a name from `src/lib/server/limits.ts`. A page that needs a new policy adds one there, copied from
     `interfaces/http/limits.ts`.
   - `session: "required"` for a signed-in page: a visitor goes to /login?next=<the page> (an enhanced
     form action gets the same redirect as JSON).
     A page whose route id has a parameter names where sign-in returns: `returnTo: "/me"`; without it the gate
     refuses (500), never guessing from the request.
   - `session: "writes"` for a page anyone reads and only members write (the cards on /[did]): GET and HEAD pass,
     a POST without a session goes to sign-in, so no action runs without `locals.did`.
   - `writeLimit`: the policy a POST counts against instead of `limit`, per address and per member.
   - `maxBody`: the largest form body in bytes; without it the route takes no POST.
   A route with no `policy.ts` is refused, and `tests/integration/web/gate.test.ts` fails.
3. Server code (`+page.server.ts`, `+server.ts`, `src/lib/server/`) may import domains and infrastructure; a `.svelte`
   file or a universal `+page.ts` may not (dependency-cruiser `svelte-screens-no-core`). A route never imports
   `infrastructure/postgres`; it calls an operation in `src/lib/server/` (`web-routes-no-postgres`). Services come
   from `services()` in `src/lib/server/compose.ts` (built once by the `init` hook, before the server listens): `log`,
   `pool`, `sessions`, `oauth` (`client`, `signInScope`, `lockDid`), `issuerOf`, `handles`, `pds`, `pdsIssuer`,
   `network`, `nonces`. A new one is built there.
4. Read `locals.did` (the signed-in DID or undefined), `locals.issuerOrigin` (see `src/lib/server/locals.d.ts`),
   `locals.deadline` (pass it to every call), `locals.deadlineAt` and `locals.reqId`. An `app` page and its data are sent `private, no-store` with
   `Vary: Cookie` by the gate; a page sets no cache header itself.
5. Writes are form actions (`+page.server.ts` `actions`), enhanced with `use:enhance`. No JSON bodies, no remote
   functions, no prerendering (`scripts/guards/web-prerender.ts`).
6. Tests: one file per page group in `tests/integration/web/`, on the built server through `built-server.ts`, with
   Postgres as `web`. Port the outcomes the matching `tests/integration/http` or `interfaces/http` tests check.

Shared files a lane may touch: `src/lib/server/limits.ts` (to add a policy), `src/lib/server/compose.ts` (to wire a
service), `package.json` and the lockfile. Anything else under `src/lib/server/` or the two gate files goes through
the integration branch's owner.

## Commands

    npm run build -w @unset/interfaces-web    # the build the tests run on
    npm run check -w @unset/interfaces-web    # svelte-check (TypeScript 6); tests/integration/web/svelte-check.test.ts runs it in CI
    npx vitest run --project tests/integration tests/integration/web
