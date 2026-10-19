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
checked: 2026-10-19
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
The home, account and Settings routes pass `shell.navigation` through `PageSpec`: active destination and, on
`/<DID>`, the verified handle for an avatar initial. Session-backed pages also pass their DID `accountPath`;
public home remains anonymous and uses the `/did` self-profile shortcut. These are display props only.
`web/page.ts` also builds the kit's `errorPage` hook (P1.25): apps/web's error page in the shell, public prefs, no
script; compose passes it to `createServer`. A route that fails throws `AppError` so its page goes through the hook.
`routes/test-routes.ts` (P1.25c) holds the test-only pages under `/test-routes/` (a 500, a 503 with `Retry-After: 30`
and an app-group page); compose mounts them only when `TEST_ROUTES` is on, and the config allows that only when `UNSET_ENV` is `test` (dev,
which staging runs as, refuses it); with the key off the prefix answers like any unknown path. The
book's `/__test/` paths fail the kit's path template, which refuses a leading underscore. `limits.ts` holds its
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
It redirects to the stored `next` or `/did`. Logs carry counts only (`auth.login_succeeded`, `auth.login_denied
{code}`), never a DID. The callback still does not write `app.account`: P2.12 inserts that row on the first
welcome step. Not yet: the email read, `invalidateHandle` (later steps).

**Signing out (P2.08, remainder P2.08a).** `routes/logout.ts`: POST /logout (CSRF gate) destroys this browser's
session, clears `__Host-sid` and sets `__Host-signed_out`, which makes the next POST /login send `prompt=login`. When
that was the last session, it revokes the grant (`OAuthClient.revoke`, 10s) and deletes the stored set if revoke
throws. "Sign out everywhere" was removed (P2.08d; Alex, 2026-10-19), so POST /logout/everywhere is an unknown route;
`destroyAllForDid` stays for the age gate and auth_dead. The count is `logout-sessions.ts` (same transaction as the
delete). It counts only live rows (P2.08c): not past the absolute or idle limit, and only while the DID has a token
set, repeating the store's `lookup` conditions, because no sweep runs before the jobs process and a stale row would
keep the grant. `infrastructure/session` stays untouched:
it is trusted base, so a store method cannot share this PR. GET /signed-out points at the PDS account page.

**Email confirmation (P2.11).** `routes/verify-email.ts` reads `emailConfirmed` through `pdsSessionInfo` and never
sends mail. A missing email field or `scope_missing` shows the re-consent form (`prompt=consent`, same DID). The
pass/refresh/verify decision for other pages is `emailGate` in the identity domain. P2.12 wires it, after
onboarding, on `/<DID>`, its `/did` and `/me` shortcuts, and `/settings/profile`. `/verify-email` checks onboarding
and then is the email page itself.

**A grant revoked at the PDS (P2.11a, security note).** The stale-cache refresh (`email-refresh.ts`) goes through
`pdsSessionInfo`; on `auth_dead`, pdsCall's `authDead` has already ended every session of the DID and its token set,
so `refreshEmail` answers `ended` and `openApp` sends 303 to `/login?error=login.session_ended` with the cookie
cleared. `scope_missing` and `rejected` still go to `/verify-email`; a transient answer passes on the cached `true`
and ends nothing. **The bound:** on our own PDS, a revoked grant ends every session of the account at the next
successful email recheck (`EMAIL_RECHECK_S`, at most 900 s) or at the next PDS call, whichever comes first. While
the PDS can't be reached, the cached result is kept, and the bound extends until a recheck succeeds. Once P1.36v
lands, accounts on other PDSes are refused at sign-in until P1.33p, which must first force a token refresh at each
recheck; before P1.36v they can sign in, and this bound does not hold for them (P2.11c). A shorter window would need
a PDS call per request. Pinned by `tests/integration/http/email-recheck.test.ts` and `config.test.ts#email_recheck_capped_at_900`. There is no audit
row: `end_sessions_for_did` writes none and the audit lanes hold no sign-in action.

**Onboarding (P2.12).** `routes/welcome.ts`: age, then terms, then a chat placeholder, then `/did` or `/verify-email`.
An under-age answer sets `blocked_underage`, writes `age_gate.blocked`, revokes the grant and ends sessions. The
birth date is not stored or logged. `/legal/*`, `/logout*`, `/welcome*` and `/signed-out` skip `requireOnboarded`.
`GET /settings/profile` is a placeholder page so the gate has an app route to refuse.

**The signed-in account (P2.13).** `routes/me.ts`: GET `/did` and legacy `/me` open the existing app gate, then 303
to the session's `/<DID>` (private/no-store, Vary Cookie). GET `/:did` validates with identity's `parseDid`, opens
the gate with that canonical return path, then compares it with the session DID before resolving or rendering.
Foreign DIDs return 404. Owner pages show the handle only when P2.02's `verifyHandle` confirms it, else
`handle.invalid`, plus the DID, PDS account link and sign-out form. They are private/no-store, cookie-varying,
unindexed and zero JS. GET /login sends a signed-in visitor to `/did`. P2.12's `openApp` still requires onboarding
and email confirmation. Public profile content, editing and invite blocks remain separate work.

Keep `meRoutes` last in composition so the one-segment DID parameter cannot shadow explicit GET routes. Invalid
DID segments return 404 before any gate or lookup. The shared router's existing candidate matching means GET
`/logout` now returns 404 and an unsupported POST to a one-segment path returns 405; trusted routing is unchanged.

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
