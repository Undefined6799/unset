---
id: http
type: area
status: current
areas: ["[[http]]"]
summary: "Hub for the web server process (interfaces/http) and the server kit in shared/http that every server uses."
code: [interfaces/http/compose.ts, shared/http/index.ts]
sources: []
importance: normal
related: ["[[web]]", "[[config]]", "[[errors]]", "[[case-insensitive-path-collision]]"]
replaced_by: null
tags: [area, http]
checked: 2026-10-17
---
# http

Two folders share this hub: `interfaces/http`, the web server for unset.sh, and `shared/http`, the server kit that
all six servers are built from.

**interfaces/http owns** the public site's routes: `routes/assets.ts` (apps/web's built files, by exact name from
the manifest), `routes/home.ts` and `routes/legal.ts` (P1.25 slots; P2.15 fills `/legal/terms`, `/legal/privacy`
and `/legal/domains`, group `public` so the shell's styles load, zero JS, `noindex` with `X-Robots-Tag`) and
`routes/security-txt.ts` (`/.well-known/security.txt`, group `static`), `routes/prefs.ts` (the theme form), `prefs/theme.ts` (theme
cookie, applied on the server) and `web/` (reads Vite's manifest once at startup and renders pages through apps/web).
Route files are `.ts`, not `.tsx`: plain Node runs this server and cannot read JSX, so pages come from `screens`.
`web/page.ts` also builds the kit's `errorPage` hook (P1.25): apps/web's error page in the shell, public prefs, no
script; compose passes it to `createServer`. A route that fails throws `AppError` so its page goes through the hook. `limits.ts` holds its
rate-limit policies; a feature step adds its policy in the same PR as its route.

**The OAuth client (P2.04c).** `compose.ts` builds `web`'s Postgres pool and lock pool, the sealer, net-guard, the
identity network and DID resolver, and the one OAuth client over them, and returns it as `oauth` for the sign-in
routes; building opens no connection. `boot()` checks the connection budget and `main.ts` runs it before `listen`;
the pools close in the drain hooks. `routes/oauth-metadata.ts` serves `/oauth-client-metadata.json` (the
`client_id`) and `/oauth/jwks.json`. A test that composes the server takes its env from `interfaces/http/test-env.ts`,
which writes the secrets to files; the runtime image copies each package the server imports, and
`web_image_boots_to_config_check` fails when one is missing.

**Signing in (P2.05).** `routes/login.ts`: GET /login renders the form; POST /login (rate limit `login`, CSRF gate)
resolves the handle, issues a P1.16 `login.nonce`, calls `authorize` (infrastructure/pds) with the nonce, expected DID
and return path in the sealed appState, then sets `__Host-oauth_nonce` (Lax, 600 s) and `__Host-login_target`
(Strict, 120 s, the authorization URL in base64url) and answers 303 to GET /login/continue, which renders a meta
refresh to that cookie's URL. Every failure goes back to `/login?error=<code>`. The target never rides in a query, and
there is no table for it: the cookie can only send a browser where its own POST pointed it.
`routes/sign-in-state.ts` holds both halves of the binding: the appState shape and the nonce cookie.

**The callback (P2.06).** `routes/oauth-callback.ts`, the one GET that mutates (P1.07's GET_MUTATION_EXCEPTIONS):
completeAuthorization, then in order the appState shape, the nonce cookie against the appState (constant time; a
mismatch keeps the cookie, another tab may own it), the P1.16 consume, the expected DID, `grantCovers` (an
insufficient grant is revoked), then a P2.03 session in its own transaction, rotating the request's old `__Host-sid`.
It redirects to the stored `next` or `/me`. Logs carry counts only (`auth.login_succeeded`, `auth.login_denied
{code}`), never a DID. The callback still does not write `app.account`: P2.12 inserts that row on the first
welcome step. Not yet: the email read, `invalidateHandle` (later steps).

**Signing out (P2.08, remainder P2.08a).** `routes/logout.ts`: POST /logout (CSRF gate) destroys this browser's
session, clears `__Host-sid` and sets `__Host-signed_out`, which makes the next POST /login send `prompt=login`. When
that was the last session, it revokes the grant (`OAuthClient.revoke`, 10s) and deletes the stored set if revoke
throws. POST /logout/everywhere requires `confirm=yes`, revokes first, then `destroyAllForDid`. The count is
`logout-sessions.ts` (the book's SELECT, same transaction as the delete). `infrastructure/session` stays untouched:
it is trusted base, so a store method cannot share this PR. GET /signed-out points at the PDS account page.

**Email confirmation (P2.11).** `routes/verify-email.ts` reads `emailConfirmed` through `pdsSessionInfo` and never
sends mail. A missing email field or `scope_missing` shows the re-consent form (`prompt=consent`, same DID). The
pass/refresh/verify decision for other pages is `emailGate` in the identity domain. P2.12 wires it, after
onboarding, on `/me` and `/settings/profile`. `/verify-email` checks onboarding and then is the email page itself.

**Onboarding (P2.12).** `routes/welcome.ts`: age, then terms, then a chat placeholder, then `/me` or `/verify-email`.
An under-age answer sets `blocked_underage`, writes `age_gate.blocked`, revokes the grant and ends sessions. The
birth date is not stored or logged. `/legal/*`, `/logout*`, `/welcome*` and `/signed-out` skip `requireOnboarded`.
`GET /settings/profile` is a placeholder page so the gate has an app route to refuse.

**The signed-in home (P2.13).** `routes/me.ts`: GET /me reads the session (none → `/login?next=/me`), shows the handle
only when P2.02's `verifyHandle` (wired in compose with HANDLE_* config, sharing the DID resolver's cache) confirms it,
else `handle.invalid`, plus the DID, the PDS account link and the sign-out form. GET /login sends a signed-in visitor
to /me. P2.12's `openApp` refuses `/me` and `/settings/profile` until onboarding is done and the email is
confirmed. Not yet: the app shell around these screens (P1.25j), the profile, privacy and invite blocks.

**Watch out (P1.23c).** Production renders with apps/web's server build, `apps/web/dist/server/render.js`, loaded
once from that fixed path by `web/render-entry.ts`; no config key moves it. `compose(cfg, web?)` takes a render only
from tests, which pass `import * as web from "@unset/apps-web"`; a new test that composes the server must pass it too,
or startup fails on the missing build. `main.test.ts` fails if `main.ts` statically reaches anything under apps/.

**shared/http owns** what every request passes through. `server.ts` fixes the middleware order: requestId,
hostCheck, trustedProxy, securityHeaders, methodCheck, contentTypeCheck, bodyLimit, rateLimitIp, csrf. Also:
- `routes.ts`: `defineRoute`, the only way to register a route; it refuses a route without limits or a deadline.
- `csrf/gate.ts`: the one CSRF gate (Sec-Fetch-Site, then exact Origin, then exact Referer, else deny).
- `csp/`: the Content-Security-Policy per route group. `public` (P1.25k) is for our own zero-JS pages (`/`, `/terms`,
  `/privacy`): no script-src, images from the assets path only, and no cookie read (any group but `app`).
- `trustedProxy.ts` and `clientIp.ts`: the client address, which prints as `[ip]` and only leaves as a rate key.
- `returnPath.ts`: the one redirect-target validator.
- `health.ts`: `/health`, which reveals only status and commit.
- `errors.ts`: every error response by code and group. An interface may pass `errorPage` (P1.25k) for the page
  groups' body only: it gets the shown code, the group and, for `internal.error`, the kit's request id, never request
  data. On a throw, a non-string or a body over 256 KiB the kit uses its fixed page; the status and headers stay the kit's.
  The fixed page shows the request id on `internal.error` (UUID shape only). The exported `errorResponse` takes no
  page; only `fail()` renders pages, through `kitErrorResponse`, which the index does not export (P1.25b).

**Watch out.** `shared/http` is trusted base (CODEOWNERS); its PRs carry only trusted files and their tests.

**Links.** [[web]], [[config]], [[errors]].
