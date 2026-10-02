# unset.sh — rebuild plan

Prepared 2026-10-02 for Alex. **Planning only: nothing is built and no repository has been created yet.**

How this plan was made:
- Eight reviewers worked in parallel, each on one area of the 0x40 prototype at commit `054ab0f`:
  1. identity and auth
  2. chat
  3. social and appview
  4. infrastructure
  5. the plugin seam
  6. AT Protocol changes since the prototype
  7. recorded decisions and lessons
  8. UI
- graphify code graphs were rebuilt for all ten packages and used to trace callers and coupling.
- Two adversarial critics, one for architecture and one for security and privacy, then attacked the first draft. Their 30 findings are folded in; Appendix A lists what changed.
- Full reviewer reports with file:line evidence are in [`reviews/`](reviews/).

Earlier decisions (vault, `PLAN.md`, design locks) are treated as background, as you asked. Only two decisions bind this plan:
- The profile is rendered in the app, and the static renderer goes away.
- CRM, accounting and billing stay out of the core and become plugins later.

Everything else is a recommendation, and §11 collects the questions that need your answer.

---

## 1. The short version

- **The prototype is about 90k lines of TypeScript** (about 60k source and 29k tests), plus 7.2k lines of CSS and about 5.7k lines of deploy config, across 10 packages and about 18 containers.
- **The core in this plan is about 12–13k lines of TS source.** That figure excludes CSS, i18n catalogs, lexicon JSON, generated code, about 1.3k lines of deploy config, and tests.
- Most of the cut is not lost features:
  - CRM, accounting and billing alone are about 29k lines.
  - The renderer, relay, Jetstream, account-manager and the PDS patches are duplicated or obsolete machinery.
  - Chat moves behind a seam; it is not deleted.
- **AT Protocol changes remove whole subsystems** (§3):
  - The PDS now ships its own account pages (email, password, 2FA, handle, devices, apps, delete).
  - Permission sets give one readable consent screen.
  - **Tap** replaces our relay, Jetstream and hand-written consumer.
  - `@atproto/lex` replaces `lex-cli`.
- **Three structural changes do most of the shrinking:**
  1. Merge the appview into the app codebase: one database, plus an indexer fed by Tap.
  2. Stop patching the PDS image.
  3. Leave Next.js for a server-rendered app with one CSRF gate and per-route CSP (open question Q3).
- **Chat (Matrix) leaves the core** and becomes the first module after the core ships, on its own origin. There is still no stable atproto end-to-end-encrypted messaging, so Matrix stays the engine.
- **Some choices are permanent once the first account exists:** domains and reserved handle names, the lexicon namespace and authority, the PDS recovery key, whether the PDS federates to the Bluesky relay, and the Matrix server name. Phase 0 settles them before code.

## 2. What the prototype taught us (rules, enforced by tests or lint)

The rebuild keeps the prototype's *lessons* and rewrites most of its *code*.

**Identity and auth**
1. Verify handle↔DID in both directions everywhere. One `verifyHandle(did)`; nothing else reads `alsoKnownAs`. Handles arriving from Tap events are hints only.
2. The OAuth `state` must equal a per-browser `__Host-` nonce cookie.
3. A DPoP-nonce 401 or a transient 5xx never logs a user out. Check the *granted* scope, not the requested one.
4. No state change on a GET. Email verification counts as successful only when the PDS reports `emailConfirmed`, never because of a query parameter.
5. Return paths reject control characters, `//`, `\` and schemes. One implementation, fuzz-tested.
6. Every nonce and ticket is single-use in a durable store. OAuth state and sessions are durable from day one.
7. Session lifecycle:
   - a fresh 256-bit session id at every login, with any previous one destroyed;
   - idle and absolute timeouts, checked on the server;
   - a takedown, suspension, deactivation or deletion (`#account active=false`) destroys the account's sessions in the same transaction.

**Data and protocol**
8. Validate every record against its lexicon before writing. The UI limits, the write path and the indexer use one lexicon-derived validator.
9. Never send raw `getBlob` URLs to browsers. One media proxy with `default-src 'none'; sandbox` and `nosniff`; a takedown stops the bytes. The prototype still breaks this for avatars on `/me`, `/settings` and `/people`.
10. Re-encode images and strip metadata, with pixel limits and decode in a bounded worker. Neutralise MP4 metadata without shifting offsets. Original bytes are never stored.
11. Indexer invariants are written as tests first:
    - monotonic upserts;
    - identity events never change account state;
    - erasure covers every table with a DID column;
    - queries are bounded;
    - the cursor is held on transient failure.
12. The owner's own data is read from the PDS or from the app's draft store (read-after-write); everyone else's from the index.

**Web security**
13. One egress module (`net-guard`: resolve, vet, pin, no redirects, size and time caps). A lint rule bans bare `fetch` with a non-constant URL anywhere else.
14. One CSRF gate, our own middleware, applied to every non-GET whatever its content type:
    - `Sec-Fetch-Site: same-origin`, otherwise an **exact** Origin match, otherwise an exact Referer match, otherwise deny;
    - never compared by suffix or by site, because `chat.` shares a site with the app;
    - a static test proves no route skips it.

    The prototype had two CSRF models: only 7 of its 81 server actions checked Origin explicitly.
15. CSP is built from one typed allowlist with a snapshot test. Each route group gets only what it needs. `nosniff` goes on every response. `dangerouslySetInnerHTML` is lint-banned except in the profile markdown renderer. Error codes go in URLs, never free text.
16. Request limits:
    - a global body limit;
    - per-IP and per-DID rate limits on login, search, report, follow, like and upload;
    - the client IP read only from the one configured trusted-proxy header.

**Matrix (chat module)**
17. Set `history_visibility` at room creation, through one `createRoom` wrapper.
18. Use `setupNewSecretStorage: true` when creating a recovery key.
19. Authorise on a stored DID↔account mapping, never on a handle-derived Matrix id. The login callback checks that it got the expected account.
20. Refuse attachments to unencrypted rooms.
21. Pin `m.room.join_rules` to power level 100. Never "public" on a federating server.

**Operations**
22. `PDS_RECOVERY_DID_KEY` is set before the first account; the deploy preflight refuses otherwise. Rotation and recovery keys are kept offline, separate from data backups.
23. Pin images by multi-arch *index* digest. Build them in CI and sign them; the deploy verifies the signature. Never build on the server (two disk-full outages came from that).
24. No secret is ever optional. Agents never print the resolved config.
25. Backups run in the stack, report freshness and raise an alert, with a scheduled restore drill. The prototype's backups failed silently for 18 days.
26. Every compose overlay pins `name:`.
27. CI checks that the number of discovered test files equals the number executed. 20 of 47 UI test files were silently not running.

**Prototype defects that must not be ported:**
- A post edit wipes its likes and comments, because they are keyed on CID.
- A comment's root is always set to its parent.
- Bluesky likes share our like collection, so the like toggle throws after 5,000.
- Chat authorisation rebuilds the Matrix id from the current handle, and the chat login callback doesn't check whose account it got.
- Space join links make a Space public to the federation.
- Dead chat provisioning adds up to 2.5 s to every login.
- An "unpublished" profile, including any shown email, is a public repo record.
- The PDS prefs patch lets any OAuth client read and write preferences.
- `account-manager` mounts every signing key to read one table.
- `com.atproto.admin.*` is publicly routed.
- `rss-worker` compares its secret in non-constant time and reads request bodies with no size limit.
- Post reports end up in logs, not in a moderation queue.

## 3. What changed in AT Protocol, and what it changes here

Source: [`reviews/06-atproto.md`](reviews/06-atproto.md), with a URL and confidence rating for each claim.

| Change | Status | Effect on unset.sh |
|---|---|---|
| **PDS account UI** at `https://<pds>/account`: devices, connected apps, password, email verify/change, handle change, deactivate/delete, email 2FA (0.5.36) | shipped | Build none of these screens; deep-link to it. `account-manager` (~2k LOC) and `pds-gatekeeper` are dropped **if** the Phase 2 go/no-go checks in §5.3 pass. |
| **PDS branding env** (`PDS_SERVICE_NAME`, `PDS_LOGO_URL`, `PDS_PRIMARY_COLOR`…; 0.5.26 removed the old colour vars) | shipped | Ship the PDS unpatched. One loss: the prototype's theme patch also auto-filled the invite code and chosen handle on the PDS signup form. Unpatched, invitees paste the code themselves (the `/join` page offers copy-to-clipboard) unless upstream supports a prefill parameter, which is checked in Phase 2. |
| **Granular permissions + permission sets** (`include:<nsid>`), stable | stable | Publish one set covering our `sh.unset.*` collections. A set can't contain foreign NSIDs, `blob`, `account` or `identity`, so those stay separate scopes. Requested scope: `atproto include:sh.unset.<set> repo:app.bsky.feed.like?action=create&action=delete blob:image/* blob:video/* account:email?action=read`. An unresolvable set fails the login, so the set becomes **login-critical infrastructure** (§5.3). Never request `transition:*`. |
| **OAuth sign-up `prompt=create`** | shipped | The prototype already used it. Keep it: the app never touches `createAccount`, passwords or reset. |
| **`@atproto/lex` + `lex-server`** (stable preview) | preview | Types and validators come from `lex build`, with generated code checked in. `lex install` vendors `app.bsky.feed.like`. Versions pinned exactly. |
| **oauth-client-node 0.5.x** (breaking hook renames), ESM-only, Node ≥22 | shipped | Start on ≥0.5.8 with `onSessionUpdated`/`onSessionDeleted`, Node 24 LTS. |
| **Tap**, the Sync 1.1 reference consumer (verified backfill + live, resync, acked delivery) | shipped | Replaces our relay, Jetstream v1, consumer and backfill. Configuration and trust rules are in §5.2; a spike opens Phase 3. |
| **Jetstream v2** | shipped | Not used: it doesn't verify. (The "repeated `wantedCollections`" pitfall was a v1 quirk.) |
| **PLC read replicas** (lag) | shipped | Never read a DID doc from a replica right after our own PLC operation. |
| **Atproto Spaces** (permissioned data, *not* E2EE) | alpha | Don't ship on it. Private profile data is shaped so it can move there later. |
| **Messaging**: `chat.bsky` is centralised; atproto E2EE messaging is still a draft | — | The chat module keeps Matrix. |
| **Relay archives** (Jetstream v2 replay, Hubble mirror) | shipped | Anything published from a federating PDS is copied permanently by third parties. That drives the drafts design (§5.4) and question Q2b. |
| **Standard.site** publishing lexicons | community | Possible alternative for posts (Q9). |

## 4. Scope of the core

| Area | What it does | Est. TS LOC |
|---|---|---|
| Platform | typed config, HTTP server, CSRF gate, CSP builder, body and rate limits, trusted proxy, DB + migrations + roles, audit (append-only), i18n runtime, `net-guard`, envelope encryption, errors | ~1,600 |
| Auth | confidential OAuth client, sealed token stores, sessions with lifecycle, verify-email gate, login, signup redirect, logout and revoke, return paths | ~700 |
| Identity | `verifyHandle`, PDS trust pinning, well-known policy, invites via `pds-admin`, **module identity seam** (signed single-use assertion, `did↔module account` table) | ~500 |
| Profile | lexicons, records, sections, privacy, publish/unpublish, draft store, image pipeline, editor UI, `ProfileView`, public routes (`/@handle`, `/@handle/p/{rkey}`), OG meta, receipt, state pages | ~2,800 |
| Indexer + read | Tap consumer, versioned upserts, account-state machine, `eraseDid`, views, directory/search, media proxy | ~1,300 |
| Social | posts (image and video privacy), follows, home timeline, likes, comments, people directory UI | ~1,700 |
| Moderation | delist, suspend via `pds-admin` (signed assertions), report queue, moderator allowlist | ~500 |
| Shell + UI kit | tokens → CSS, ~20 shared components, app shell, home and onboarding, `/me`, `/join`, `/login-failed`, legal pages, theme/locale (no-JS) | ~2,000 |
| Plugin seam | `plugin-api` contract, registry, route mounting, tenants (minimal), boundary lint, fixture plugin | ~500 |
| `pds-admin` service | invites, takedown, reaping, DNS-TXT handle record at mint (optional) | ~300 |
| **Total** | | **≈12–13k** |

**Deferred until the first plugin needs them:** mail transport, the generic notification inbox, cron hooks and per-plugin DB roles. Their *interfaces* are written down in `plugin-api`; they are not built.

**Out of core:**
- **Chat module** (phase 6).
- **RSS module.** Prefs go to an app-DB table; no PDS patch.
- **MCP read server.**
- **Plugins:** CRM, accounting, billing.
- **Dropped:**
  - the renderer (its views move in-app)
  - relay, Jetstream and `relay-keeper`
  - `account-manager` and the PDS patches (subject to the §5.3 checks)
  - `reaper`, which moves into `pds-admin`
  - `deploy/matrix-spike`
  - the ledger
  - per-post ZIP export, replaced by CAR export plus an app-data JSON export
  - `/record.json`, superseded by the CAR export
  - the dead chat provisioning
  - the cross-host logout ticket (§5.3)

## 5. Architecture

### 5.1 Web stack (recommendation; Q3)

**Recommended: a plain Node server (Hono) rendering React on the server, with small hydrated islands, all built with Vite.**

- **Pages** are server-rendered React.
- **Forms** are real `POST` routes with redirect-after-POST.
- **Islands** handle the interactive parts:
  - settings drafts and preview;
  - like and follow buttons;
  - people search.
- Each island is a hashed static file. Its props go in `<script type="application/json">`, written by one serialiser that escapes `<`, `>`, `&` and U+2028/2029, with a fuzz test.

**Script and CSP rules:**
- `script-src` is the path-scoped `'self'/assets/` with no nonces. The theme is applied by the server from a cookie, so no inline pre-paint script is needed.
- `require-trusted-types-for 'script'`.
- The CSRF gate is §2 rule 14. Hono's built-in `csrf` middleware is **not** used, because it ignores JSON requests.

Why this over Next.js:
- **One explicit CSRF gate.**
- **Cacheable pages.** Next's nonce CSP made every page dynamic and once silently broke hydration.
- **No RSC wire format to audit.**
- **No build workarounds.** No forced webpack, no postinstall rewriting `node_modules`.

Honest cost:
- Markup and CSS port; the data and interaction layer is rewritten. 105 of 169 components are client components, and 81 server actions become POST routes.
- If the island helper grows past ~150 lines in Phase 1, switch to React Router v7 before Phase 2.

History check: the abandoned "Hono SPA" was client-rendered with browser-side OAuth. This design is the opposite.

**Tailwind is dropped:** about 29 utility classes were in use.

**Chat is not part of this app.** It is a separate bundle served only from `chat.<app domain>`. The app origin never loads matrix-js-sdk or WASM, and never needs homeserver `connect-src`.

### 5.2 Domains, processes and data

**Domains (Q1).** Three registrable domains:

| Domain | Hosts | Cookies |
|---|---|---|
| **App**, `unset.sh` | `unset.sh` (app); `account.unset.sh` (account app, §5.3); `chat.unset.sh` (chat module, later) | the app's `__Host-` cookies, never `Domain=` (enforced by test) |
| **Handles**, `0x40.me` (Alex, 2026-10-02), separate, like bsky.social vs bsky.app | `*.<handle domain>`: `.well-known/atproto-did`, plus a 301 to `/@handle` | none |
| **PDS**, `0x40.space` (Alex, 2026-10-02) | the PDS (sign-in, consent, its `/account` UI); `media.<pds domain>` (media proxy) | the PDS's own only; no app cookies |

Why a separate handle domain:
- No same-site relationship between user-named hosts and the app's cookies.
- No user can claim an infrastructure host name.
- The wildcard certificate's DNS credential cannot touch the app zone or `_lexicon`.

Rules for the handle domain:
- A reserved-label list (`www`, `api`, `admin`, `account`, `mail`, `mta-sts`, `autoconfig`, `status`, `_*`) is still enforced by the PDS, with a test.
- TLS via DNS-01 through a delegated `_acme-challenge` zone, or on-demand TLS with an `ask` endpoint.
- CAA, DNSSEC and HSTS `includeSubDomains` on all three domains.

```
                 edge (Caddy, or cloudflared+traefik) — denies all admin-auth XRPC
      ┌────────────────────────────────────────────────────────────────────┐
      │ web (app origin) ──► Postgres ◄── indexer ◄─ack WS── tap ◄── PDS     │
      │                          ▲  (roles: web, indexer, tap, plugin_*)     │
      │ media proxy (pds domain)─┘                                           │
      │ pds-admin (internal net only) ──► PDS admin API                      │
      └────────────────────────────────────────────────────────────────────┘
```

**Processes:** one codebase with entrypoints `web`, `account`, `indexer` and `media`, plus the tiny dependency-free `pds-admin` and the Tap binary. `web` runs as a single replica in v1, because the OAuth client's lock is process-local; a Postgres advisory lock comes later if scaling needs it.

**Database: Postgres (Q6).**
- App and index live in separate schemas with **separate roles**:
  - `web`: read/write on app tables, read-only on the index, INSERT-only on audit;
  - `indexer`: read/write on the index, plus the `eraseDid` function;
  - `tap`: its own schema;
  - later, one role per plugin.
- Audit rows are append-only.
- One database makes moderation and erasure single transactions.

**Indexer and Tap trust rules:**
- Tap's upstream is a **setting** (provisional, Alex to review). v1: **our PDS's `subscribeRepos` only**. Later, network data comes from pointing Tap at a public relay with collection filters; the indexer does not change. No own relay or full-network index. Repos are added explicitly at first login or signup, or through our PDS's `listRepos`, never by network-wide discovery. The spike confirms which mode works against a single PDS.
- The indexer opens an **acked WebSocket to Tap on an internal network**, so nothing listens for inbound webhooks. Tap's admin API is never exposed, and its builds come from a pinned commit in CI.
- The indexer drops any DID whose PDS (confirmed through `getRepoStatus` on our PDS) isn't ours.
- Handles in events are hints only; display handles come from `verifyHandle`.
- Ingest does four things: validate against the lexicon, upsert with a monotonic `rev` guard, promote filter columns, and drop likes whose subject isn't our post NSID.
- `#account active=false` hides records and blobs and ends sessions (§2 rule 7). `#account deleted` runs `eraseDid`.

**Media proxy:**
- Serves only blobs referenced by an indexed record of an active, non-delisted account.
- Sends a sandbox CSP and `nosniff`, has a size cap, uses `max-age` (not immutable), and is purged on takedown.

**`pds-admin`:**
- Holds invites, takedown and reaping, on the internal network only. Its environment carries only the admin password.
- Destructive calls (takedown, delete) require a short-lived, single-use assertion signed by `web`, carrying moderator DID, target, action and `jti`. `pds-admin` re-checks the moderator against `MODERATOR_DIDS` (empty means deny) and writes its own audit row.
- The reaper deletes only when the PDS definitively reports "unverified and older than the TTL"; any error skips the account.
- The edge denies every admin-auth XRPC (`com.atproto.admin.*`, `server.createInviteCode*`, `temp.*`, any Basic-auth XRPC).

### 5.3 Auth, sessions and account management

**OAuth client:**
- Confidential, `private_key_jwt` ES256, DPoP.
- Token sets and DPoP keys are **sealed** (AES-256-GCM, KEK from the secret store, key id kept for rotation) in Postgres, because a database dump must not let anyone impersonate users.
- Known library constraints:
  - Token sets are stored per DID, so all of a person's browsers share them, and revoking signs every browser out.
  - A re-login orphans the previous refresh token, which then lingers under the PDS's connected apps.

  Both are documented and accepted for v1.

**Sessions:**
- `__Host-sid`, httpOnly, Secure, Lax; only `sha256(sid)` is stored.
- Lifecycle per §2 rule 7: idle 7 days, absolute 30 days. Moderator pages need a session less than 12 hours old.
- `getSession` is memoised per request.

**Login and signup:**
- Login is handle-first, or straight to the PDS chooser.
- Signup redirects with `prompt=create`. Invite codes are issued through `pds-admin`, and `/join?invite=` explains them and offers copy-to-clipboard.

**Logout:**
- "Sign out" ends this browser's session.
- "Sign out everywhere" revokes the OAuth grant and deletes all of the DID's sessions. PDS browser sessions are ended by the user at `https://<pds>/account`, which the page links to.
- The next login after a logout sends `prompt=login`.
- No cross-host ticket: the prototype's ticket was only accepted by `account-manager`, which is going away.

**Email-verify gate:**
- Reads `emailConfirmed` fresh on the gate page and links to `https://<pds>/account` to verify. It never trusts a query parameter.
- Only a PDS-verified email can be shown publicly.

**Permission set custody:**
- The lexicon authority is a dedicated `did:plc` on our PDS: not a user account, no app passwords, its recovery key offline.
- Schemas and the set are published with `goat` from an operator machine through a runbook, never from CI or agents.
- The client's `scope` also declares the explicit fallback scopes. A CI test logs in with the set unresolvable and checks that the fallback is no broader than the set.
- The TXT record and the schema CID are monitored.

**Account app (Alex, 2026-10-02).** Account management looks like ours and sits beside the PDS, not inside the main app, mirroring how Bluesky keeps sign-in on its own PDS host:
- A small separate app on `account.unset.sh` (Alex, 2026-10-02): its own origin, separate from both the PDS host (where passwords are typed) and the main app. Like Bluesky (sign-in on `bsky.social`, settings under `bsky.app`), users type passwords on `0x40.space` and manage settings under the `unset.sh` brand.
- Same-site with the main app, so: host-only `__Host-` cookies on both (already enforced), and the CSRF gate accepts `Sec-Fetch-Site: same-origin` or an exact Origin only, never `same-site`, so a bug in one app cannot post to the other with its cookies. A test covers a cross-subdomain POST being refused. The account app shares no code path, session table or secret with `web` beyond the shared packages.
- It is an ordinary OAuth client of our PDS with the matching `account:`/`identity:` scopes, and uses public XRPC only: no PDS patch, no PDS database access, no response rewriting, no routes injected into the PDS host. That is the difference from the prototype's `account-manager`.
- It owns: email change and confirmation, handle change, password reset by email, deactivate and delete.
- The PDS keeps: OAuth sign-in and consent, always. Email 2FA, devices and connected apps stay on the PDS's `/account` unless a Phase 2 spike finds public APIs for them.
- The PDS's built-in pages stay on and are branded; there is no setting to switch them off, and blocking them at the proxy would recreate the fragile hacks. Our app and emails link to the account app for what it covers.
- Difference from Bluesky: Bluesky runs an entryway (`bsky.social`) in front of many PDS hosts and puts account settings in its client; we run one PDS, so the PDS is our sign-in host, and settings live in the account app, not the main app (Alex's choice).

**Phase 2 go/no-go before dropping `account-manager` and `pds-gatekeeper`:**
- [ ] `/account` lets a user enable email 2FA.
- [ ] OAuth sign-in actually challenges for it on the pinned PDS. (The prototype hit `email-2fa-not-enforced-by-oauth-provider` on 0.5.9.)
- [ ] Password reset is reachable from the OAuth sign-in page.
- [ ] Captcha is unnecessary while invite-only, or the PDS's own hCaptcha env is used.
- [ ] **Branding (Alex, 2026-10-02):** the PDS sign-in, sign-up and `/account` pages, plus its emails, are set up with our name, logo, primary and status colours, light/dark backgrounds and ToS/privacy/support links, and Alex accepts screenshots of each in both themes. The PDS has no setting for fonts, custom CSS or layout, so these pages will look like ours but not identical to the app. If that isn't enough: build thin account pages in the app for what the PDS APIs allow over OAuth (email, handle, deactivate and delete), linking out for password and 2FA. The sign-in page itself always stays the PDS's. Patching the PDS is not the fallback.
- [ ] The confirm-email link points at the PDS's own `/account` page and not at bsky.app. The deploy preflight fails if it doesn't, and the fallback is an upstream fix, not a patch.

### 5.4 Profile in the app (the binding decision)

- **One pure `ProfileView`** serves both the public page and the editor preview. The renderer's tested `escape`, `safeHref` and markdown code is ported. The 311-line duplicate React preview is deleted.
- **Public routes on the app origin (Q5):**
  - `/@alice`, `/@alice/p/{rkey}`;
  - private, not-found and unavailable state pages;
  - OG meta;
  - the "signed · DID · export" receipt;
  - the latest posts.

  Data comes from the index, so published, delist and suspend states and the media proxy all apply.
- **This route group:**
  - Zero JavaScript.
  - Its own CSP: `default-src 'none'`, images only from the media origin, `form-action 'self'`, `frame-ancestors 'none'`, `base-uri 'none'`.
  - `Referrer-Policy: same-origin`, so Follow POSTs carry an Origin header.
  - Every response in the group, including 404, 503 and error pages, uses this CSP. A test requests `/@<script>` and checks it.
- **Follow** is a plain form POST that never redirects off-origin. A signed-out viewer gets the page back with a sign-in link.
- **Caching:**
  - anonymous 200: `public, max-age=60`, no stale-while-revalidate, with a strong ETag over profile CID, section CIDs, latest post CID and moderation version;
  - signed-in responses: `private, no-store`, `Vary: Cookie`;
  - 404/503: `no-cache`, and an outage is a 503, never a cached 404;
  - delist or suspend purges the edge cache.
- Review 08 argued for serving the profile on the handle host to separate user content from editor cookies. This plan keeps it on the app origin because:
  - the page runs no script under a strict CSP;
  - the app already shows user content elsewhere (directory, timeline);
  - Follow then works without a cross-site hop.

  Q5 keeps the alternative open.
- **Handle hosts:** `alice.<handle domain>/` returns a 301 to `/@alice`. `/.well-known/atproto-did` is routed to the PDS, which serves it for its own handle domains, keeping the "503 on outage, never a cached 404" rule. If the pinned PDS doesn't do this correctly, it becomes a 20-line `web` route. `pds-admin` may also write a DNS TXT `_atproto` record at mint, so resolution doesn't depend on one HTTP path; see the open note in review 07.
- **Drafts are private, and publishing is explained:**
  - Edits are saved as **drafts in the app DB**. Draft images are re-encoded and stored privately with a 30-day TTL, and uploaded with `uploadBlob` only on Publish.
  - **Publish** writes `sh.unset.profile` and the sections with one `applyWrites`.
  - **Unpublish** deletes them with one `applyWrites` and keeps the content as a draft.
  - The first publish shows a one-time notice: published fields are public and, if the PDS federates (Q2b), may be copied by third-party relays and archives beyond our reach.
  - Show-email defaults to off and repeats that notice when switched on.
  - "Discoverable" is labelled "listed in the unset.sh directory".
  - Section deletes and renumbering are atomic.
- Records: `sh.unset.profile` (`self`) and `sh.unset.section` (tid, position).

### 5.5 Plugin seam (in the core; no plugin shipped)

- **What a plugin is:** a first-party, in-process package registered at build time.
- **The boundary is enforced by lint:**
  - plugins import only `@unset/plugin-api` and `@unset/ui`;
  - the core imports only the generated registry.
- **Manifest:**
  - `id`, version;
  - declared capabilities: `db`, `mail`, `storage`, `egress:<hosts>`, `notify`, `secrets`, `pds:write:<nsid>`, `public-routes`;
  - nav slots;
  - routes at `/p/<id>/…`;
  - migrations;
  - account-erase and export hooks;
  - cron jobs.
- **The core runs session → CSRF → tenant → plugin-enabled checks before any plugin handler** and passes a context containing only the services the plugin declared. This fixes the prototype's gaps: no CRM/accounting action had an explicit Origin check, no plugin wrote to the audit log, and erasure skipped plugin data.
- **Data:**
  - Postgres schema `plugin_<id>` with its own role and a pinned `search_path`.
  - Cross-plugin access only through declared ports (the `CrmCustomerPort` pattern).
- **Tenancy in the core, kept minimal:** `tenants`, `tenant_members(role)`, `tenant_plugins`, and a personal tenant per user. Without it, the first plugin would own tenancy, which is how accounting came to depend on CRM.
- **Mail, the notification inbox and cron** have interfaces in `plugin-api` and are built with the first plugin that needs them.
- A fixture plugin in the test suite proves the seam.

### 5.6 Chat module (phase 6, outside the core)

- **Engine:**
  - Synapse + MAS + a `chat-auth` bridge (atproto identity → OIDC, `sub` = DID).
  - Federation off until decided.
  - Served only from `chat.<app domain>`.
- **What the core provides:**
  - the identity seam from §4 (signed, single-use, audience-bound assertion; `did↔account` table);
  - handle resolution;
  - a "Message" link on the profile.
- **The app shell shows no chat badge in the MVP**, because chat state lives on the chat origin.
- **MVP slice:**
  - 1:1 encrypted DMs between members;
  - recovery key;
  - own-device verification and the device list;
  - full logout and revoke;
  - attachments with the safety gates;
  - an unread badge inside chat.
- **Later slices:** Spaces with a redesigned join model (knock, or an invite bot), then voice.
- **Before GA:** decide the device-trust posture and how to invite someone who has never opened chat.
- `matrix-js-sdk` is pinned exactly.

## 6. Privacy and compliance deliverables

These are deliverables, not intentions:

- **`eraseDid(did)`** covers the index, the app schemas and plugin hooks. It is triggered by `#account deleted` and by a moderator action. A test enumerates every table with a DID column.
- **Export** at `/settings/export`: the CAR link plus a JSON dump of every app-DB row for the DID.
- **Retention:**
  - audit logs (DID, IP, UA only): 90 days;
  - reports: 1 year;
  - abandoned drafts: 30 days;
  - backups: N days, so erasure reaches the backups within N.
- **Reports** go into the moderation queue, never into logs.
- **RoPA rewritten** for the reduced scope: drafts, reports, audit, OAuth tokens and the federation decision, with a lawful basis for each purpose.
- **Privacy notice** published, and linked from both the app and the PDS (`PDS_PRIVACY_POLICY_URL`).
- **Federation decision recorded** (Q2b): whether `PDS_CRAWLERS` points at the Bluesky relay.

## 7. Repository layout

```
unset.sh/
  apps/
    web/          # Hono server: routes/, screens/, islands/, profile/ (pure view)
    indexer/      # Tap consumer
    media/        # media proxy
    pds-admin/    # zero-dep internal service
  packages/
    core/         # auth, identity, profile, social, moderation, db, audit, csp, csrf, config, i18n, seal
    lexicons/     # sh.unset.* JSON + permission set; @atproto/lex generated code (checked in)
    net-guard/    # the single egress classifier (ported with its 23 tests)
    ui/           # tokens.json → tokens.css, shared components, icon wrapper
    plugin-api/   # the contract
  modules/        # chat/ (phase 6), rss/ (later): same boundary rules as plugins
  plugins/        # empty in v1, except the test fixture
  deploy/         # one compose.yaml with profiles, edge config, backup, preflight, tap build
  docs/           # short ADRs, runbooks (keys, lexicon publishing, rotation, restore), compliance
```

Tooling:
- One workspace and one lockfile; TypeScript project references.
- Biome for lint and format, dependency-cruiser for boundaries.
- Vitest for tests, Playwright smoke tests against a production build.
- Per-package line budgets as CI warnings.
- graphify graphs regenerated in CI.

## 8. Phases

Small PRs to a protected `main`; each phase ends at a demonstrable exit. No real users before Phase 5.

**Phase 0 — Decisions and bootstrap**
- Answer §11.
- Create the GitHub repo:
  - branch protection that applies to admins too, with PR + CI + **Alex as required human approver** (agents open PRs, never approve);
  - real CODEOWNERS, LICENSE, SECURITY.md;
  - Renovate, secret scanning and push protection.
- CI from commit 1, every action pinned by SHA:
  - typecheck, test (discovered = executed), lint, `npm audit`, gitleaks;
  - SBOM, image scan, hadolint, actionlint;
  - images signed with cosign plus SLSA provenance.
- Slim `CLAUDE.md`/`AGENTS.md`. Carry over the vault notes from review 07 §6 and archive the rest.
- Register the domains; set DNSSEC, CAA and HSTS; reserve labels.
- Generate the PDS rotation and recovery keys offline.
- **Exit:** CI passes on an empty repo and blocks a planted secret, a planted bare `fetch` and a planted `Domain=` cookie.

**Phase 1 — Platform, local stack, lexicon authority**
- Typed config, Hono server, CSRF gate, CSP, limits, trusted proxy.
- Postgres with migrations and roles; sealed storage; audit.
- i18n catalogs (EN/FR; these replace 1,076 inline `choose()` calls); `net-guard`; error pages.
- Token pipeline and UI kit; server-applied theme. Base styles for native elements (forms, type) so plain HTML looks right without classes. Styling is plain CSS: design tokens as custom properties, one CSS Module per shared component (Vite built-in, no extra dependency), and screens compose components and add no global CSS. No CSS framework (Alex, 2026-10-02). CI enforces it: Stylelint bans raw colours, radii, spacing and font sizes outside tokens; a guard rejects global CSS outside the base and token files; a size budget fails the build if the total shipped CSS grows past its limit (start near 40 KB unminified, raised only in a reviewed PR).
- `compose.dev.yaml` with a real PDS, Tap and seeded accounts, so signed-in flows are testable locally.
- Stand up the **production PDS** with no users: recovery key set, invite-only, admin XRPC denied. Then create the lexicon authority, publish the schemas and permission set, and set `_lexicon`.
- **Exit:** Playwright smoke passes on the shell in both themes and both languages, and the permission set resolves from outside.

**Phase 2 — Identity, auth, profile writing**
- OAuth with the set plus fallback, login, signup, logout and revoke, sessions with lifecycle, verify-email gate, invites, `/join`, `/me`, onboarding, the module identity seam.
- Profile editor: drafts, sections, privacy, publish/unpublish, image pipeline, preview through `ProfileView`.
- Run the §5.3 go/no-go list.
- **Exit:** a new user signs up on the PDS, edits drafts, publishes and unpublishes; the repo contains records only while published.

**Phase 3 — Indexer, public profile, directory, moderation**
- Tap spike first: mode, ack WebSocket, trust rules.
- Then the indexer, `eraseDid`, the media proxy, the public `/@handle` routes, the handle-host redirects and well-known, the directory and search, and moderation (delist, suspend via signed assertion, report queue).
- Port the appview tests (ingest 33, db 25, verify 18, xrpc 24, media 7).
- **Exit:**
  - `/@handle` renders with zero JS, and its images come only from the media origin.
  - An external resolver confirms handle↔DID.
  - A suspend stops the page, the bytes and the sessions.
  - Deletion leaves no rows.

**Phase 4 — Social**
- Posts with image and video privacy, follows, home timeline, likes and comments: counts survive edits, the reply root is correct, foreign likes are ignored.
- Export page.
- **Exit:** parity with the prototype's non-chat, non-RSS social features, plus a regression test for each defect in §2.

**Phase 5 — Production**
- One compose file with profiles; per-container egress networks (indexer, Tap and `pds-admin` reach only the PDS and PLC); deploy by verified digest; `/health` reports the commit.
- Backups:
  - in-stack, age-encrypted, off-box, with a freshness alert;
  - covering Postgres and the PDS SQLite files;
  - R2 versioning or a blob mirror;
  - restore drill.
- Secret inventory and rotation runbook.
- The RoPA and privacy notice from §6.
- **Exit:**
  - a restore drill on a fresh host passes;
  - the edge rate-limit and spoofed-header tests pass;
  - invite-only launch.

**Phase 6 — Chat module** (MVP from §5.6).

**Phase 7+ — Later modules:**
- chat Spaces;
- voice;
- RSS;
- MCP;
- the first plugin (CRM), with an ETL from the old `crm-postgres` if its data matters.

## 9. How we keep it small and auditable

- **Measured:** line budgets per package; graphify graphs diffed in PRs, so "who calls this" is a command, not a guess.
- **One way to do each thing:** one config, CSRF gate, CSP builder, egress, validator, serialiser, `createRoom` and `profileHref`. A lint or static test enforces each.
- **Small files:** a file-size cap as a lint warning; one feature per folder.
- **No patched upstreams and no postinstall rewrites.** A gap gets an upstream issue, or code built outside the upstream.
- **Exact pins** for `@atproto/*`, `matrix-js-sdk` and Tap. Renovate opens a PR per bump, and its changelog is read.
- **Security review** is required for changes to auth, identity, crypto, egress and PII (CODEOWNERS path rule).
- **Multi-agent review per phase:** area reviewers plus adversarial critics, as was done for this plan.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Permission set unresolvable, so nobody can log in | Fallback scopes are declared and tested in CI. Monitoring on the TXT record and schema CID. The PDS (≥0.5.35) resolves sets it hosts itself locally. |
| Tap doesn't fit a single self-hosted PDS | Phase 3 spike. The fallback is consuming `subscribeRepos` with `@atproto/sync`; the verify tests port either way. |
| `@atproto/lex` changes under us | Exact pin; generated code checked in, so changes show up as diffs. |
| Leaving Next.js costs more than estimated | Phase 1 measures it; switch to React Router v7 before Phase 2 if the island helper exceeds ~150 lines. |
| PDS `/account` falls short (2FA, confirm-email link) | The §5.3 go/no-go list. The fallback is an upstream fix or a small app screen with the matching scope, never a patch. |
| Domain, namespace or federation chosen wrongly | Decided in Phase 0, before any account exists. |
| Chat arrives later than wanted | The identity seam ships in Phase 2, so chat plugs in without core changes. |

## 11. Questions for you (recommendation first)

**Q1. Domains.** Recommended: unset.sh replaces the 0x40 name.
- App at `unset.sh`, with chat later at `chat.unset.sh`.
- Handles on a **separate** registrable domain, the way Bluesky uses bsky.social for handles and bsky.app for the app.
- The PDS and media on a third domain. Reusing `0x40.space` for the PDS works if you're keeping it.
- Lexicons become `sh.unset.*`.
- **Decided by Alex (2026-10-02):** app `unset.sh` (account app `account.unset.sh`), PDS `0x40.space`, handles `<user>.0x40.me`.
- Setup this needs: `PDS_SERVICE_HANDLE_DOMAINS=.0x40.me`; wildcard DNS `*.0x40.me` to the edge; `/.well-known/atproto-did` on `*.0x40.me` routed to the PDS, everything else a 301 to `unset.sh/@<user>`; wildcard TLS via a delegated `_acme-challenge` zone; the reserved-label list on `0x40.me`; CAA, DNSSEC and HSTS on all three domains.
- **PDS on an unset.sh subdomain was considered and rejected (2026-10-02).** The atproto going-to-production guidance says to use separate domains for the PDS and the app, because OAuth pages and blobs on the app's site are a credential-theft risk. A subdomain like `login.unset.sh` is same-site with the app: the PDS serves raw `getBlob` user bytes on its own host whatever our proxy does, and same-site requests weaken the SameSite protection on its sign-in session. An entryway on `login.unset.sh` would avoid that but means building our own authorization server, since the PDS disables its own when behind one (`@atproto/pds` 0.5.36 `config.js`). So sign-in shows `0x40.space`, branded as unset.sh.
- `0x40.me` was the prototype's handle domain, so existing `*.0x40.me` handles collide with new accounts unless Q2a retires or migrates them first.

**Q2a. Existing accounts and data. Provisional, Alex (2026-10-02): start fresh; Alex will revisit before the first production account.** The prototype's own plan called its accounts disposable.
- Old accounts are retired on the old PDS (deactivated, then deleted) before the new PDS takes `0x40.space`, so their DIDs no longer point at a live server and their `*.0x40.me` handles are free. Old handles re-registered by new accounts get new DIDs; bidirectional handle verification keeps other apps from linking them to the old ones.
- Archive the encrypted backups.
- Migrate CRM data only when the CRM plugin exists, and only if its row counts justify it.
- Rotate every 0x40 secret either way: one leaked into an agent transcript.

**Q2b. Federation. Answered by Alex (2026-10-02): yes, per user and opt-in.** The PDS federates, but each user is private to the network by default and chooses whether to be listed in other atproto apps.
- On atproto, everything in a repo on a federating PDS is public and copied by relays; crawling is per server, not per account. So a user's published content is kept in the app database and served by `/@handle` from there, and records are written to their repo only when they opt in ("Show my profile in other apps").
- Opting out later deletes the records from the repo. The deletion propagates and well-behaved apps drop the data, but copies already taken by third parties can't be recalled. The opt-in screen says so.
- An account's DID and handle are public either way (PLC directory, identity events); only its content can be held back.
- Showing up in Bluesky's own app also needs an `app.bsky.actor.profile` record, written on opt-in. Bluesky ignores `sh.unset.*` records.
- **No false sense of privacy (Alex, 2026-10-02):** anything in the repo is public, so anything published to the repo is also public on `/@handle`. There is no "public on unset.sh but hidden from the network" tier; content is either private (app DB, visible only to its owner) or public (in the repo, everywhere).
- **The publish step must say plainly** where the content will appear (unset.sh, Bluesky and other atproto apps), that it becomes public, and that copies are hard or impossible to take back. Same wording when switching a category on.
- **Separate categories (provisional, Alex to review, 2026-10-02):** two switches, "Profile" and "Posts and follows", each private or public. They are separate record collections, so this is clean on atproto. Posts public with the profile private shows posts under a bare handle in other apps. Profile public with posts private keeps posts and follows visible only to their owner, since a follow or post is either in the repo or not.

**Q3. Web stack.**
- **Hono + server-rendered React + islands (recommended).**
- React Router v7.
- Next.js limited to route handlers.

**Q4. Chat timing.**
- **Phase 6 module, DMs first (recommended).**
- In the core from day one.
- Drop Matrix and wait for atproto messaging.

**Q5. Public profile location.**
- **`unset.sh/@alice`, with handle hosts redirecting (recommended).**
- Serve it on the handle host for stricter origin isolation. Follow then needs a cross-site hop.

**Q6. Database.**
- **Postgres with per-role separation (recommended).**
- SQLite for the core, revisiting when plugins arrive.

**Q7. Drafts.**
- **Drafts in the app DB; only Publish writes to the repo (recommended).**
- Keep the prototype's behaviour with honest labels.

**Q8. Social features in the core:** posts, follows, timeline, likes, comments, directory.
- **Yes (recommended)**, with RSS and MCP as later modules.

**Q9. Posts lexicon.**
- **Our own `sh.unset.post` (recommended)**, with a Phase 4 spike on Standard.site.
- Adopt Standard.site now.

**Q10. Hosting.**
- **A small VPS for production, homelab for dev (recommended).**
- Keep the homelab with the Cloudflare Tunnel.

**Q11. Design.**
- **Keep the token pipeline, colour roles, Iconoir and mono identifiers; re-decide the look in Phase 1 before building screens (recommended).**
- Keep v2e exactly as locked.

**Q12. License.**
- **AGPL-3.0 (recommended).**
- MIT or Apache-2.0.

---

## Appendix A — What the adversarial review changed

**Blockers fixed:**
- **The like scope was missing.** A permission set can't contain `app.bsky.*`.
- **"Sign out everywhere" relied on a ticket only `account-manager` accepted.**
- **Handles were on the app's own domain.** The plan now uses a separate handle domain, reserved labels, delegated ACME, CAA, DNSSEC and HSTS.
- **"Unpublish" and federation were undefined.** The plan now has publish/unpublish semantics, federation as question Q2b, and a publish notice.

**Major findings addressed:**
- The theme patch's invite and handle autofill loss is acknowledged.
- The verify-email gate works with the read-only scope, and the confirm-link check is a go/no-go item.
- The lexicon authority is set up in Phase 1, with documented custody.
- The public profile moved to Phase 3, after the indexer and media proxy exist.
- Chat's origin contradiction is resolved, and the identity seam is now budgeted.
- Cache rules for personalised pages are fixed.
- LOC estimates are restated and their exclusions spelled out.
- Forgotten features (permalinks, OG, receipt, state pages, `/me`, onboarding, `/join`, legal pages, DNS-TXT handles) are listed.
- Tap's trust boundary is defined.
- `pds-admin` requires signed moderator assertions.
- OAuth tokens are sealed, and DB roles are separated.
- The session lifecycle is specified.
- Rate, body and image-bomb limits and the trusted-proxy rule are added.
- GDPR export, erasure, retention and the RoPA are deliverables.
- CSP is defined without nonces and with safe island props, and `hono/csrf` is avoided.
- Supply chain and human approval rules are added.

**Minor findings addressed:**
- The `account-manager`/gatekeeper go/no-go list.
- The Tap mode for a single PDS.
- The OAuth library constraints (orphaned refresh tokens, single replica).
- A server-applied theme replaces the inline script.
