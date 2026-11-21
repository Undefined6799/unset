# 0088 — The chat page is a static Svelte build the door serves; it redeems the ticket itself and keeps the session in memory

Status: Accepted by Alex 2026-11-21 ("yes" in the chat build thread, 04:06Z); proposed 2026-11-21 (P6.06, build
step 7 of the minimal chat build). Builds on ADRs 0081 (sign-in minted by our servers), 0083 (keys stay in the
browser) and 0055 (shadcn-svelte, one theme file).

## Context
ADR 0081 decision 6 settles how the browser reaches the homeserver: the edge routes unset.cc's `/_matrix/client/*`
to Synapse, so the page talks to its own origin and `connect-src 'self'` suffices. It leaves open what serves the
page itself and how the session gets from the door into the client. The door built in build step 6 answers redeem
from a small return page of its own (`return-page.ts`), which then navigated to the chat page: a navigation drops
the page's memory, so the session would have had to cross it through web storage, a cookie or the URL, and ADR 0083
keeps the token and lock key off disk.

The step book's P6.06 (written before ADRs 0081 and 0083) has a SvelteKit-free static bundle served by an edge rule,
an IndexedDB sync store and a session record in IndexedDB. ADR 0083 decision 4 replaces the sync store with the SDK's
in-memory one; the session record would put the token on disk.

What the pinned packages do, read 2026-11-21: matrix-js-sdk 43.0.0 `initRustCrypto({ storageKey,
cryptoDatabasePrefix })` opens `<prefix>::matrix-sdk-crypto` and `-meta` (`src/client.ts:1611-1642, 2014-2063`) and
loads its WASM on first use (`:2049-2052`); its WASM module (`@matrix-org/matrix-sdk-crypto-wasm` 18.9.2) is
fetched by `new URL(..., import.meta.url)` and compiled with `WebAssembly.instantiateStreaming`
(`index.mjs:24, 59`), which CSP3 allows only with `'wasm-unsafe-eval'`. The package's browser entry also opens a
legacy crypto store named `matrix-js-sdk:crypto` (`src/browser-index.ts:36-41`); Element imports
`matrix-js-sdk/src/matrix` instead (element-web v1.12.35 `apps/web/src/utils/createMatrixClient.ts:9-19`).

## Decision
1. **The door serves the page.** `apps/chat` is built by Vite 8.3.5 with Svelte's and Tailwind's Vite plugins into
   `apps/chat/dist/page/`: `index.html` and content-hashed files under `/assets/`. No SvelteKit: one page, no server
   rendering. The door reads the build at start (`interfaces/chat-auth/page.ts`) and will not start without it; it
   serves the document at `/` and `/sign-in/return` with `no-store` and its own CSP, and each built file by its exact
   path with `immutable` caching. Only `.js`, `.css`, `.wasm` and `.woff2` are served; any other file in the build
   stops the start. Its CSP: `default-src 'none'; script-src <origin>/assets/ 'wasm-unsafe-eval'; style-src
   <origin>/assets/; font-src <origin>/assets/; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none';
   form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types svelte-trusted-html`.
   No inline script or style, no eval.
2. **The return page is the chat page.** web sends the tab to `/sign-in/return#ticket=…` as before. The page takes the
   ticket, removes the fragment from the address bar and history before anything else runs, posts it to
   `/sign-in/redeem`, puts the door's `returnTo` in the address bar with `history.replaceState` (no load), and starts
   the client in the same JavaScript context. The token, the lock key and the ticket live only in that page's
   memory: never in web storage, a cookie, IndexedDB or the URL. A load of any other page path has no session and
   starts the hop (`/sign-in?return=<path>`). The door's own return script goes.
3. **A thin adapter, `apps/chat/matrix/`**, the only folder that imports matrix-js-sdk (dependency-cruiser already
   names it). In Element's order: `createClient({ baseUrl, accessToken, userId, deviceId, cryptoCallbacks })`,
   `initRustCrypto({ storageKey, cryptoDatabasePrefix: "unset-chat:<chat ID>" })`,
   `setDeviceIsolationMode(new OnlySignedDevicesIsolationMode())`, `startClient({ lazyLoadMembers: true })` with the
   default in-memory store, imported from `matrix-js-sdk/lib/matrix.js`. Screens see only our `ChatState`
   (`signing_in`, `locked`, `ready`, `signed_out`, `error` with a fixed code). Locked means the client runs but
   `isCrossSigningReady()` is false or this device is not cross-signed (`getDeviceVerificationStatus(...)
   .crossSigningVerified`); the check runs after the first sync and again on each trust change.
4. **Renewal is the hop again.** A minute before `expiresAt`, or when the SDK emits `HttpApiEvent.SessionLoggedOut`,
   the page navigates through the hop; the door mints for the same device and returns the same lock key (ADR 0081
   decision 1, ADR 0083 decision 4), and the new page reopens the key store. A token refused within a minute of
   sign-in shows `chat.session_refused` instead, so a revoked device cannot loop. `setAccessToken` is not used.
5. **Components.** The page uses stock shadcn-svelte components (Card, Button) and `utils.ts`, byte-identical copies
   of apps/web's registry-pinned files (apps never import each other); a test holds them identical. Its Tailwind
   entry imports `shared/ui/theme.css`, so both themes follow the system setting.

### The package (ADR 0057)
matrix-js-sdk 43.0.0 (Apache-2.0) is the plan's choice (PLAN §5.6, decision 13), pinned exactly; it brings 16
packages, among them `@matrix-org/matrix-sdk-crypto-wasm` 18.9.2 (Apache-2.0), the Rust crypto as a 7.8 MB WASM file
(2.1 MB gzipped) loaded only when the client starts. Maintained by Element and the Matrix.org Foundation; 43.0.0 was
released 2026-09-29, and 45.1.0 (2026-11-11) is current: the pin stays at 43.0.0, the version every chat spike ran,
until a bump re-runs them. `npm audit` lists nothing for the new packages.

## Alternatives
- **The edge serves the page as files** (the book's P6.06). The CSP and caching would live in Caddy config, apart from
  the door's tested headers, and `/sign-in/return` would still need the door's own page, so the session would cross
  a navigation. Declined.
- **SvelteKit with adapter-static.** Routing and a router runtime the page does not need yet; it would also add
  SvelteKit's inline start script and its Trusted Types policy (ADR 0054 decision 4). Revisit when the page has
  several routes.
- **Hand the session across a navigation** through `sessionStorage`, a cookie or the URL. Puts the token or lock key
  where an injected script or a log can read it later. Rejected (ADR 0083 decision 4's intent).
- **Renew with `setAccessToken` from a hidden frame or a fetch.** The hop needs web's `SameSite=Lax` session cookie on
  a top-level navigation, and unset.cc frames nothing; and the swap during a running sync is unverified (build plan
  item 4). Declined for the minimal version.

## Consequences
- A reload loses the session and runs the hop: a few hundred milliseconds and two redirects, no unlock.
- Renewal reloads the page; a message being typed at that moment is lost (build step 11 can warn first).
- The door's image must carry `apps/chat/dist/page/`; the door's image and Compose service are a later step.
- Pages other than `/` and `/sign-in/return` are 404 until the conversation step adds its paths.
- The two apps keep their own copies of the stock components; moving shared Svelte components to one place is a
  separate decision.

## Compliance
`interfaces/chat-auth/door.test.ts` (the document, its exact CSP, the built files, 404 and 405) and `page.test.ts`;
`apps/chat/core/sign-in.test.ts`, `apps/chat/matrix/client.test.ts`, `apps/chat/svelte-check.test.ts` and
`apps/chat/lib/components/stock.test.ts`; `tests/e2e/chat-page.chromium.spec.ts` runs the built page in
Chromium against the door, real Postgres, real chat-admin and a stand-in homeserver: hop, redeem, locked card, no
CSP violation, nothing kept in storage or the address, renewal for the same device and key, no loop, axe in both
themes. dependency-cruiser's `vendor-sdk-one-adapter` row for matrix-js-sdk.
