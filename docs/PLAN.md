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
- **The core in this plan is about 20–24k lines of TS source, plus 5–7k for chat** (restated after the 2026-10-02 review; the first draft said 12–13k and omitted the review pipeline). That figure excludes CSS, i18n catalogs, lexicon JSON, generated code, about 1.3k lines of deploy config, and tests (expect another 12–18k).
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
- **Chat (Matrix) is a core feature** (Alex, 2026-10-02), built in Phase 6 beside the core on its own origin (§5.6). There is still no stable atproto end-to-end-encrypted messaging, so Matrix stays the engine.
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
10. Re-encode images and strip metadata, with pixel limits and decode in a bounded worker. Neutralise MP4 metadata without shifting offsets. Original bytes are never stored: the only video that reaches a repo is the re-encoded, stripped 1080p master (§5.8), because `getBlob` is unauthenticated and serves whatever is in the repo to the world (review, 2026-10-02).
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
25. Backups run in the stack, report freshness and raise an alert, with a scheduled restore drill. The prototype's backups failed silently for 18 days. An **outside dead-man's-switch heartbeat** (Alex, 2026-10-03, step-book answer 25: a hosted check that alerts when our ping stops, carrying no personal data; provider from a team shortlist before Phase 3) catches the case where the stack, and so its own alerting, is down.
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
| **PDS account UI** at `https://<pds>/account`: devices, connected apps, password, email verify/change, handle change, deactivate/delete, email 2FA (0.5.36) | shipped | Build none of these screens; deep-link to it. The PDS refuses OAuth credentials for email change, delete and reactivate by design (`requestEmailUpdate.ts`, `requestAccountDelete.ts`, `activateAccount.ts`, 0.5.36), so the account app is dropped too (Alex, 2026-10-02; §5.3). `account-manager` (~2k LOC) and `pds-gatekeeper` are dropped **if** the Phase 2 go/no-go checks in §5.3 pass. |
| **PDS branding env** (`PDS_SERVICE_NAME`, `PDS_LOGO_URL`, `PDS_PRIMARY_COLOR`…; 0.5.26 removed the old colour vars) | shipped | Ship the PDS unpatched. One loss: the prototype's theme patch also auto-filled the invite code and chosen handle on the PDS signup form. Unpatched, invitees paste the code themselves (the `/join` page offers copy-to-clipboard) unless upstream supports a prefill parameter, which is checked in Phase 2. |
| **Granular permissions + permission sets** (`include:<nsid>`), stable | stable | Publish one set covering our `sh.unset.*` collections, `sh.unset.follow` included (decision 28). A set can't contain foreign NSIDs, `blob`, `account` or `identity`, so those stay separate scopes. Requested scope: `atproto include:sh.unset.<set> repo:app.bsky.feed.like?action=create&action=delete repo:app.bsky.feed.post repo:app.bsky.graph.follow repo:app.bsky.actor.profile blob:image/* blob:video/* account:email?action=read rpc:app.bsky.feed.getFeed?aud=did:web:api.bsky.app#bsky_appview` (plus `getTimeline`, `getPosts`, `getFeedGenerators` and `getPostThread` as plain `rpc:` scopes with the same `aud`, beside the `include:`, since a set covers only our own namespace; and `rpc:com.atproto.moderation.createReport?aud=*`, so a member's own reports reach our Ozone in Phase 5 without a re-consent, its DID not existing yet (reports on Bluesky posts are forwarded by our moderation account, not by the member, per step-book answer 36, §5.8); step-book Phase 2 and 4 reviews, 2026-10-02/03). **Not requested:** `identity:handle` and `account:status` (plain `account:status` grants nothing and `account:status?action=manage` would let a compromised `web` deactivate every hosted account); handle change and deactivation happen on the PDS's `/account` page (decision 3), and an operator deactivation, such as an under-16 account, goes through `pds-admin`. Requested from day one because adding a scope later forces a re-consent for every user (review, 2026-10-02). An unresolvable set fails the login, so the set becomes **login-critical infrastructure** (§5.3); the PDS (≥0.5.35) resolves sets it hosts itself locally. **A changed set reaches existing grants:** at every token refresh the PDS rebuilds the scope from the current set (`token-manager.ts:255-260`; step-book Phase 1 review, 2026-10-03), so Phase 4 collections join the same set with no re-consent (a new set NSID would force everyone to consent again), and whoever controls the authority repo can widen every user's grant within `sh.unset.*`: an unexpected change to the set's CID is a security incident with an alert, every set change is an Alex-approved PR, and the set carries EN and FR consent text. Never request `transition:*`. |
| **OAuth sign-up `prompt=create`** | shipped | The prototype already used it. Keep it: the app never touches `createAccount`, passwords or reset. |
| **`@atproto/lex` + `lex-server`** (stable preview) | preview | Types and validators come from `lex build`, with generated code checked in. `lex install` vendors `app.bsky.feed.like`. Versions pinned exactly. |
| **oauth-client-node 0.5.x** (breaking hook renames), ESM-only, Node ≥22 | shipped | Start on ≥0.5.8 with `onSessionUpdated`/`onSessionDeleted`, Node 26 LTS (Alex, 2026-10-02; Node 24 enters maintenance on 2026-10-20). Its `requestLock` hook takes a Postgres advisory lock (§5.2). |
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
| Indexer + read | Tap consumer on the public relay, versioned upserts, account-state machine, `eraseDid`, views, directory/search, media proxy, the separate `api` entrypoint, service-auth JWT verification | ~1,900–2,300 |
| Social | short-video posts (§5.8), opt-in and standalone Bluesky posts, follows, home timeline, likes, comments, people directory UI | ~2,200–2,600 |
| Feeds (Alex, 2026-10-02) | signed-in members' Bluesky blocks (`app.bsky.graph.block`) applied to every unset.sh feed in both directions, fail closed (Alex, 2026-10-03, step-book answer 34); feed tabs: saved atproto feeds the user picks and reorders, fetched through the user's own PDS session (`getFeed` proxying, §5.8); label handling for two labelers; our own feed generators for unset.sh videos | ~1,000–1,300 |
| Video pipeline (Alex, 2026-10-02) | upload checks, quotas, transcoding worker (ffmpeg) to a 1080p master, progressive MP4 renditions, poster and caption track, storage, playback through the media proxy (§5.8) | ~1,500–2,000 |
| Review pipeline (review, 2026-10-02) | PDQ fingerprints and the Arachnid Shield check, local nudity and gore gates, frame extraction, transcript, the local text gate (decision 30), pass/fail/unsure routing, legal hold, appeals, draft expiry (§5.8) | ~1,500–2,500 |
| Moderation | delist, the public notice form and Ozone report routing in `web`; the actions themselves live in `admin` (§5.7) | ~300 |
| Shell + UI kit | tokens → CSS, ~20 shared components, app shell, home and onboarding, `/me`, `/join`, `/login-failed`, legal pages, theme/locale (no-JS) | ~2,000 |
| Plugin seam (trimmed, decision 25) | erase/export hooks, per-plugin schema-and-role rule, middleware order, explicit composition root; no registry, manifest, tenancy tables or fixture plugin until the first plugin | ~100 |
| `pds-admin` service | invites, takedown, holds, receipts, reaping, DNS-TXT handle record at mint (optional); see §5.7 | ~450 |
| Admin panel (`admin`) | internal console: lookup, actions with per-action key signatures, WebAuthn enrolment, audit, health, Matrix report intake (§5.7); CI budget 3,000 lines as a warning, incl. `pds-admin` and audit (Alex, 2026-10-02) | ~1,500–2,000 |
| Draft review queue (`admin`, Alex 2026-10-02) | the "unsure" queue for drafts submitted for publication: blurred thumbnails, transcript, a logged, never-downloadable 360p playback (Alex, 2026-10-03, step-book question 32: "play a small version"; not offered for suspected or matched abuse material, which no moderator views), decide, reason code (§5.8) | ~300–400 |
| Chat (core, Alex 2026-10-02) | Matrix client on `chat.unset.sh` (our own, no fallback client; decision 11 revised), identity bridge, `chat-admin` seeding service; §5.6 | ~5–7k |
| **Total** | | **≈20–24k core, plus chat 5–7k; tests (12–18k) outside the number** (review, 2026-10-02) |

**Deferred until the first plugin needs them (decision 25):** the plugin manifest, registry and boundary lint, nav slots, mail transport, the generic notification inbox, cron hooks, the tenancy tables and the fixture plugin. No `plugin-api` package exists until then; the requirements are recorded in §5.5.

**Out of core:**
- **RSS module.** Prefs go to an app-DB table; no PDS patch.
- **MCP read server** (a later module; confirmed by Alex, 2026-10-02).
- **Plugins:** CRM, accounting, billing.
- **Dropped:**
  - the renderer (its views move in-app)
  - relay, Jetstream and `relay-keeper`
  - `account-manager` and the PDS patches (subject to the §5.3 checks)
  - the account app (Alex, 2026-10-02): every account action happens on the PDS's own branded `/account` page
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
- Hono has no production island story (HonoX is alpha), so the framework glue is ours: dev-mode SSR, the production manifest, CSS Modules kept identical on server and client, the island bootstrap and the serialiser. Budget 400–900 lines, not 150 (review, 2026-10-02). Phase 1 exit: glue at or under ~600 lines and CSS Modules verified identical on both sides; otherwise switch to **React Router 8** (v7 is no longer current) before Phase 2. The Phase 1 spike gives **Astro** one day as a second fallback (islands-native, zero JS by default; headers still from middleware because its CSP is a `<meta>` tag).

History check: the abandoned "Hono SPA" was client-rendered with browser-side OAuth. This design is the opposite.

**Tailwind is dropped:** about 29 utility classes were in use.

**Chat is not part of this app.** It is a separate bundle served only from `chat.<app domain>`. The app origin never loads matrix-js-sdk or WASM, and never needs homeserver `connect-src`.

### 5.2 Domains, processes and data

**Domains (Q1).** Three registrable domains plus a cookie-less throwaway for media:

| Domain | Hosts | Cookies |
|---|---|---|
| **App**, `unset.sh` | `unset.sh` (app); `chat.unset.sh` (chat); `admin.int.unset.sh` (Tailscale only) | the app's `__Host-` cookies, never `Domain=` (enforced by test) |
| **Handles**, `0x40.me` (Alex, 2026-10-02), separate, like bsky.social vs bsky.app | `*.<handle domain>`: `.well-known/atproto-did`, plus a 301 to `/@handle`. Production only: the development PDS mints its own suffix (`PDS_SERVICE_HANDLE_DOMAINS=.0x40.space`), because two PDSes cannot both answer for `*.0x40.me` (review, 2026-10-02) | none |
| **PDS**, `unset.ac` in production, `0x40.space` in development (Alex, 2026-10-02) | the PDS alone: sign-in, consent and its `/account` UI, branded, where every account action happens. No account app and no `account.<pds domain>` host (Alex, 2026-10-02; §5.3) | the PDS's own only; no main-app cookies |
| **Media**, a throwaway domain (for example `unsetcdn.net`; review, 2026-10-02) | the media proxy. Not same-site with the PDS, whose device cookie is `SameSite=Lax` and not under our control, and not same-site with the app. **Bluesky pictures through our server (Alex, 2026-10-03, decision 31):** pictures inside Bluesky posts shown in our feeds are fetched by `media` from the fixed Bluesky CDN or `getBlob` hosts through `net-guard` (no redirects, size cap), re-encoded with metadata stripped, PDQ-checked like every picture we process (decision 7), cached briefly by CID and served with the sandbox CSP and `nosniff`, so a viewer's address never reaches Bluesky. This is the one outbound connection `media` has; the earlier "none, ever" rule is amended here and nowhere else | fixed Bluesky media hosts only (decision 31) |

Why a separate handle domain:
- No same-site relationship between user-named hosts and the app's cookies.
- No user can claim an infrastructure host name.
- The wildcard certificate's DNS credential cannot touch the app zone or `_lexicon`.

Rules for the handle domain:
- A reserved-label list (`www`, `api`, `admin`, `account`, `mail`, `mta-sts`, `autoconfig`, `status`, `_*`) is enforced by `pds-admin`, with a test. The unpatched PDS does not reserve `mta-sts` or `autoconfig` (pds:handle/reserved.ts), so those are held by placeholder accounts.
- TLS via DNS-01 through a delegated `_acme-challenge` zone, or on-demand TLS with an `ask` endpoint.
- CAA, DNSSEC and HSTS `includeSubDomains` on every domain. `.ac` and `.sh` share one registry backend; pick a registrar with DNSSEC DS submission and hardware-key 2FA (`.ac` is not on Cloudflare Registrar).
- The development PDS never sets `PDS_CRAWLERS` (a reinstalled PDS on the same hostname breaks relay sync).
- **PDS rate limit:** the PDS limits 3,000 requests per 5 minutes **per IP**, and the app is one IP for every user. The PDS enforces no rate limits at all unless `PDS_RATE_LIMITS_ENABLED` is set, and its bypass list takes single addresses, not CIDR ranges (`config.ts:246-248`; step-book Phase 5 review, 2026-10-03). **The PDS writes client IPs (step-book Phase 1 review, `@atproto/pds` 0.5.37):** its request log records the socket address and every header, `X-Forwarded-For`, user agent and cookies included (`pds/src/logger.ts:40-58`, and the installer turns logging on), and its OAuth device table stores client IP and user agent taken from `X-Forwarded-For`, since it trusts private ranges as proxies (`account-manager/db/schema/device.ts:9-10`, `pds/src/index.ts:197-204`). **Provisional default, open to Alex (card queued):** the PDS gets the same treatment as Synapse (§5.6): the edge never forwards the client IP to it, PDS request logging is off, and per-client rate limiting happens at the edge, in memory, nothing stored. The PDS then sees one address for everyone, so its per-IP limits stay off and there is no bypass key or bypass address; the edge does the limiting and the deploy preflight checks the three settings. Our own `web` service reaches the PDS through the edge too, so the edge sees all of its calls as one client: that source gets its **own measured rate-limit class**, a ceiling keyed on its socket address, not an exemption (step-book P5.02 and P5.11). The cost is that the PDS's own "connected devices" page cannot show a location or address per session. Needed before ~1,000 users (review, 2026-10-02).

```
                 edge (Caddy, or cloudflared+traefik) — denies all admin-auth XRPC
      ┌────────────────────────────────────────────────────────────────────┐
      │ web (app origin) ──► Postgres ◄── indexer ◄─ack WS── tap ◄── PDS     │
      │                          ▲  (roles: web, indexer, tap, plugin_*)     │
      │ api (public read, own role) ─┘  media proxy (media domain)           │
      │ pds-admin (internal net only) ──► PDS admin API                      │
      │ chat-admin (internal net only, phase 6) ──► MAS admin API            │
      └────────────────────────────────────────────────────────────────────┘
```

**Processes:** one codebase with entrypoints `web`, `api` (the public read API), `admin`, `indexer`, `media` and the `review` worker (§5.8; split into a **no-network compute container** for transcode, hashes, the nudity gate, transcript and frame extraction, and a small **`review-egress` step** that may reach only one fixed host, Arachnid Shield, through `net-guard`, plus internal `pds-admin` for `preserve.create` alone, and never reads media, only the hashes; step-book gap 3, 2026-10-02; the Claude API host was removed by decision 30), plus the tiny dependency-free `pds-admin`, `chat-admin` (Phase 6, §5.6) and the Tap binary. The OAuth client's `requestLock` hook is a Postgres advisory lock (`pg_advisory_xact_lock(hashtext(did))`, ~40 lines) from Phase 1, so `web` can run two replicas and a deploy (`docker-rollout`: scale up, wait for health, retire the old) is not an outage; Compose has no rolling update of its own (review, 2026-10-02). Migrations run as a one-shot `migrate` service before the others, expand-then-contract so old and new code overlap.

**Database: Postgres (Q6).**
- App and index live in separate schemas with **separate roles**, and a role buys isolation only when it maps to a process (review, 2026-10-02):
  - `web`: read/write on app tables, read-only on the index, INSERT-only on audit;
  - `api`: read-only on the index and nothing else, so the public read API cannot select drafts;
  - `indexer`: read/write on the index, plus the `eraseDid` function (`SECURITY DEFINER`, owned by `migrator`, since `indexer` has no rights on app or plugin schemas);
  - `migrator`: owns the schemas and runs migrations, with `ALTER DEFAULT PRIVILEGES` so a new table never lands without grants; `web`, `api` and `indexer` have no DDL rights;
  - `tap`: its own database (Tap runs its own migrations);
  - later, one role per plugin.
- A **grant-matrix test** diffs `information_schema.role_table_grants` against a checked-in matrix; the "every table with a DID column" test reads `pg_catalog`, not a hand list.
- Audit rows are append-only.
- One database makes moderation and erasure single transactions.

**Public read API (XRPC):** `actor.getProfile`, `identity.resolveHandle`, `feed.getAuthorFeed` and `feed.getPost` are public with no key; signed-in `feed.getTimeline` and `actor.searchProfiles` need atproto service auth (these `api` endpoints serve third-party clients only; our own Following tab runs inside `web` with the app session and reads the index directly) (a short-lived token signed by the caller's PDS, audience our service DID) or the app session.
- It runs in its own `api` process with its own database role, which has no grant on the app schema, so drafts and private content cannot be selected by it; the grant-matrix test proves it (review, 2026-10-02: the first draft ran it inside `web` with `web`'s role, which made this claim false).
- No API keys for now: the data is already public on the network, so a key would not protect it. Abuse is handled by rate limits keyed on a salted hash of the client IP in memory with a 60-second TTL, never written anywhere (one sentence in the privacy notice), a global ceiling, response caching and size caps. Optional keys for higher limits can come later if a third party needs them.

**Indexer and Tap trust rules:**
- **Any atproto account may sign in from day one, so Tap follows the public relay from Phase 3** (Alex, 2026-10-02; this resolves review-list item 1, which had left the upstream as a setting). Tap runs in dynamic mode against `relay1.us-east.bsky.network` with `TAP_COLLECTION_FILTERS` for `sh.unset.*` and the `app.bsky.*` collections we read; repos are added at first login or signup, never by network-wide discovery. Own-PDS-only ingest was rejected because it would leave users from other PDSes unindexed, and collection-signal mode needs `listReposByCollection`, which a PDS does not serve. Cost: the whole relay firehose arrives and is filtered locally, **~200–300 GB/day inbound**, so the hosting plan must include it (§8 Phase 5). No own relay or full-network index.
- Tap is **beta** (its README says so): `TAP_ADMIN_PASSWORD` is set even though the admin API is never exposed, the binary is built from a pinned commit in CI, and the `@atproto/tap` client version is matched to it in the spike. The fallback is `@atproto/sync` on `subscribeRepos` (~300 lines).
- The indexer opens an **acked WebSocket to Tap on an internal network**, so nothing listens for inbound webhooks.
- The "PDS isn't ours" rule applies to the handle registry only: `*.0x40.me` handles are accepted only when `getRepoStatus` on our PDS confirms the account; records from any PDS are indexed.
- Handles in events are hints only; display handles come from `verifyHandle`.
- Ingest does four things: validate against the lexicon, upsert with a monotonic `rev` guard, promote filter columns, and drop likes whose subject isn't our post NSID.
- `#account active=false` hides records and blobs and ends sessions (§2 rule 7). `#account deleted` runs `eraseDid`.

**Media proxy:**
- Serves only blobs referenced by an indexed record of an active, non-delisted account.
- Sends a sandbox CSP and `nosniff`, has a size cap, uses `max-age` (not immutable), and is purged on takedown. URLs are CID-addressed and cacheable, so a caching CDN in front is a config change later.
- Draft previews need a second path, since drafts are not indexed and the media origin has no app cookie: short-lived HMAC-signed URLs minted by `web`, verified by `media`, same sandbox headers (~80 lines; review, 2026-10-02).

**`pds-admin`:**
- The only holder of the PDS admin password, on the internal network only. It verifies everything itself and trusts nothing from its callers (the admin panel design (`unset-plan/admin-panel/admin-panel-design.md`) §6.2, §6.6, §7.3).
- Every PDS action needs an envelope from `admin` carrying a moderator's WebAuthn signature over that exact action; `pds-admin` checks it against a **roster signed offline by an owner** and a **revoke file**, which replace `MODERATOR_DIDS`. `web`'s key is accepted for `invite.issue` only. `pds-admin` verifies **assertions only** (fixed-layout `authenticatorData`, flags, `rpIdHash`, `sha256(clientDataJSON)`, `crypto.verify`: ~80 lines of `node:crypto`, no CBOR); enrolment and attestation live in `admin` with `@simplewebauthn/server`, which writes the credential key into the roster as a JWK (review, 2026-10-02). The `jti` is 128 random bits so the WebAuthn random-challenge rule holds.
- Deletes and renames of a used handle go through a **7-day hold** on `pds-admin`'s own clock. It emails a receipt naming the real target to every owner, keeps its own hash-linked log and `jti` file, refuses actions on roster accounts, and offers lookups without email, signup open/close and `limits.raise`. It has no password, email or passthrough routes; a break-glass CLI covers emergencies; the reaper skips accounts with open cases.
- Takedown revokes the user's PDS tokens; deactivation does not; a record takedown does not stop `sync.*`.
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
- Lifecycle per §2 rule 7: idle 7 days, absolute 30 days. Moderator sessions live in `admin` only (§5.7).
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

**Account management (Alex, 2026-10-02): no account app.** The earlier plan put a separate OAuth-client app on `account.<pds domain>`; the review showed that `@atproto/pds` 0.5.36 refuses OAuth credentials for email change (`requestEmailUpdate.ts`), account deletion (`requestAccountDelete.ts`) and reactivation (`activateAccount.ts`) by design, and password reset is a password-handling flow, so of its five jobs only handle change and deactivate were possible. Alex dropped it.
- **Every account action happens on the PDS's own `/account` page, branded:** email change and confirmation, password, email 2FA, handle change, devices, connected apps, deactivate, reactivate and delete. The OAuth sign-in page already has "forgot password".
- The app and its emails deep-link to `https://<pds>/account`. Before the redirect the app shows one interstitial sentence ("You are going to **unset.ac**, our sign-in server; it is the only place you type your password"), the same sentence appears on the PDS pages via `PDS_SERVICE_NAME`, and a public "our domains" page is linked from the footer and `security.txt` (review 07).
- No `account.<pds domain>` host, no second OAuth client, no second session store or CSRF gate: about 700 lines and one origin removed. The PDS's built-in pages cannot be switched off, and blocking them at the proxy would recreate the fragile hacks, so they are the one account surface.
- Never a PDS patch and never the legacy `createSession` password path. If a public API is missing, the fallback is an upstream issue.

**Phase 2 go/no-go before dropping `account-manager` and `pds-gatekeeper`:**
- [ ] `/account` lets a user enable email 2FA.
- [ ] OAuth sign-in actually challenges for it on the pinned PDS. (The prototype hit `email-2fa-not-enforced-by-oauth-provider` on 0.5.9.)
- [ ] Password reset is reachable from the OAuth sign-in page.
- [ ] Captcha is unnecessary while invite-only, or the PDS's own hCaptcha env is used.
- [ ] **Branding (Alex, 2026-10-02):** the PDS sign-in, sign-up and `/account` pages, plus its emails, are set up with our name, logo, primary and status colours, light/dark backgrounds and ToS/privacy/support links, and Alex accepts screenshots of each in both themes. The PDS has no setting for fonts, custom CSS or layout, so these pages will look like ours but not identical to the app. If that isn't enough, the fallback is not cheap: thin in-app pages for handle change or deactivation would need the `identity:handle` and `account:status?action=manage` scopes, which §3 deliberately does not request (the manage scope lets a compromised `web` deactivate every hosted account), so adding them later forces a re-consent for every user and widens the app's blast radius; only a verify-email prompt fits the current scopes. Everything else links out; never email change, password or delete, which the PDS refuses over OAuth. The sign-in page itself always stays the PDS's. Patching the PDS is not the fallback.
- [ ] `PDS_EMAIL_DISABLE_CONFIRMATION_LINK` is set, so the confirm-email mail shows the code to enter on `https://unset.ac/account` and never links to bsky.app (review, 2026-10-02: the template links to bsky.app only when that flag is off). The deploy preflight fails otherwise.
- [ ] Recorded: the PDS offers users email 2FA only (no TOTP or WebAuthn), so the mailbox is the root of trust for account recovery; accepted for v1 (review, 2026-10-02).

### 5.4 Profile in the app (the binding decision)

- **One pure `ProfileView`** serves both the public page and the editor preview. The renderer's tested `escape`, `safeHref` and markdown code is ported. The 311-line duplicate React preview is deleted.
- **Public routes on the app origin (Q5):**
  - `/@alice`, `/@alice/p/{rkey}`;
  - private, not-found and unavailable state pages;
  - OG meta;
  - the "signed · DID · export" receipt;
  - the latest posts.

  Data comes from the index, so published, delist and suspend states and the media proxy all apply. Pictures in Bluesky posts come through the media proxy too, never from Bluesky's hosts directly (decision 31), so the images-only-from-the-media-origin CSP below holds for them as well.
- **This route group:**
  - Zero JavaScript.
  - Its own CSP: `default-src 'none'`, images only from the media origin, `form-action 'self'`, `frame-ancestors 'none'`, `base-uri 'none'`.
  - `Referrer-Policy: same-origin`, so Follow POSTs carry an Origin header.
  - Every response in the group, including 404, 503 and error pages, uses this CSP. A test requests `/@<script>` and checks it.
- **Follow** is a plain form POST that never redirects off-origin. A signed-out viewer gets the page back with a sign-in link.
- **Caching:**
  - anonymous 200: `public, max-age=60`, no stale-while-revalidate, with a strong ETag over profile CID, section CIDs, latest post CID and moderation version;
  - signed-in responses: `private, no-store`, `Vary: Cookie`;
  - **public pages carry no cookie variation** (step-book review, 2026-10-02): a theme or language cookie with `Vary: Cookie` would defeat the ≥90 % cache-hit target, so on public pages the theme follows `prefers-color-scheme`, the language follows `Accept-Language` with a URL override, and the theme and language cookies apply only on signed-in pages;
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

### 5.5 Plugin seam (trimmed; Alex, 2026-10-03, decision 25)

The first draft built a complete plugin system into the core before any plugin existed (manifest with declared capabilities, a generated registry, nav slots, cron, mail and notification interfaces, tenancy tables and a fixture plugin). Alex's engineering principles (`docs/engineering/`, principles 3, 7, 12 and 15) say a registry only when something is genuinely dynamic, no abstraction before evidence, and the deepest design effort for a public plugin API only once it has a consumer. So the core keeps only what cannot be retrofitted, and the first real plugin (CRM or accounting, later modules) brings the rest with it:

- **Kept in the core:**
  - every owner of personal data implements the **account-erase and export hooks** (`eraseDid`, export registry, §6); this is the one contract the core enforces from day one, because erasure that misses a data owner is a GDPR failure;
  - the rule that any later plugin gets its **own Postgres schema and role** with a pinned `search_path`, written down and tested by the role-matrix test, not by a plugin;
  - **session, CSRF and tenant checks run before any handler**, plugin or not, as plain middleware order in `web`. This fixes the prototype's gaps (no CRM/accounting action had an explicit Origin check, no plugin wrote to the audit log, erasure skipped plugin data) without a plugin framework;
  - the **composition root** wires the fixed set of services explicitly (principle 7); there is no registry.
- **Deferred to the first plugin:** the manifest and capability declarations, the generated registry and boundary lint, nav slots, `/p/<id>/…` routes, cron, mail and the notification inbox interfaces, the `tenants`/`tenant_members`/`tenant_plugins` tables and the fixture plugin. When the first plugin arrives, its PR designs these against a real consumer and carries the tenancy decision (who owns tenancy was the lesson from accounting depending on CRM; it is recorded here so it is not forgotten).
- Roughly 600–900 lines leave the core; the §4 size table is adjusted.

### 5.6 Chat (core feature, Alex 2026-10-02; built in phase 6)

Chat is part of the core product, not a module or plugin. It runs **beside the core but connected** (Alex, 2026-10-02): its own service and origin, so its encryption keys and sessions are isolated from the main app, joined to it only by the identity seam and the profile's "Message" button. **Matrix confirmed** (Alex, 2026-10-02) after comparing Signal, SimpleX, XMPP, P2P messengers, Keybase, PGP and Threema: Matrix is the only one that is browser-first, self-hostable, tied to our identity and has mature group encryption.

**Every unset.sh user can message every other one (Alex, 2026-10-02).** This needs, designed in Phase 6 from how Element and the spec do it, not invented:
- **the chat account is seeded at signup (Alex, 2026-10-02):** when an unset.sh account is created, its Matrix account and `did↔mxid` mapping (plus the MAS user ULID) are created too: `POST /api/admin/v1/users`, then `POST /api/admin/v1/upstream-oauth-links` with the DID as subject, in that order, idempotent on 409. Seeding creates the account only: no access token, device or encryption key is made for the user, and no membership is forged;
- **seeding runs in an isolated `chat-admin` service, never in `web` (Alex, 2026-10-02, decision 13):** the MAS admin scope is all-or-nothing and can mint a device or token for any user, so it follows the `pds-admin` pattern (internal network, one verb `seed(did, localpart)`, in the secret inventory). The client ships **`OnlySignedDevicesIsolationMode`** (MSC4153) from day one, so a device the user did not cross-sign receives no room keys; the "unable to decrypt" cases this creates are accepted;
- **chat sign-in is a step of signup (Alex, 2026-10-02):** onboarding takes the new user to `chat.unset.sh`, where they sign in themselves. That creates their first device and keys and sets up the recovery key, confirmed stored before it is shown (pitfall note `bootstrap-secret-storage-needs-setupnewsecretstorage`); a user who closes the tab mid-way lands in a consistent state (cross-signing and backup done, recovery pending with a nag). **MAS has no consent skip** (MAS 1.26 config schema), so this step shows MAS's consent screen; budget it in copy and screenshots. `web` forwards `login_hint`, `chat-auth` refuses a subject that does not match the handoff, and on a mismatch the client **fails closed** (Alex, 2026-10-03, step-book answer 52: chat "must be tied to the login connection of the account all together"): opening chat compares the chat session's user with the signed-in DID; a stale or foreign chat session is signed out and its local stores wiped before anything renders, no retry inside the wrong account, then chat signs in fresh as the current account (this replaces the 2026-10-02 "end the MAS session and retry"). Signing out of the app, a session revoke or a freeze ends that browser's chat device and wipes its local stores too. MAS has no end-session endpoint, so sign-out from the app reaches MAS through **back-channel logout** from `chat-auth` acting as the upstream provider, which also covers "sign out everywhere" (step-book Phase 6 review);
- **a message request is the invite only; no text until accepted (Alex, 2026-10-02, decision 12).** Megolm keys go to the devices that exist when a message is sent, and a seeded account has none, so "messages sent meanwhile become readable later" is impossible in Matrix E2EE and is dropped. This also answers how to invite someone who has never opened chat. Server-side spam control that needs no follow graph: `rc_invites.per_issuer`, MSC4380 `m.invite_permission_config`, and a Synapse `user_may_invite` module that throttles young accounts (~150 lines). Synapse modules are Python, so this is the **one written exception to TypeScript-everywhere** (step-book Phase 6 review, 2026-10-03): one folder, standard library only, tested black-box from Vitest against a running Synapse, built into a pinned image in CI. Block is `m.ignored_user_list` plus leave;
- **reports (Alex, 2026-10-03, decision 32, step-book question 50; first "Email only" at 16:52Z, revised at 16:55Z to "make our service account, 90 days"):** our own chat client sends message and user reports straight to `web`'s report route, where they are stored as `app.report` rows with `source = 'chat'` and reach the `admin` queue like every other report (§5.7), with the structured evidence below. Reports filed from other Matrix clients land in Synapse's `event_reports` and reach the same `admin` report inbox through **one limited chat-server service account**, scoped to the report and media admin paths and nothing else (the card option Alex approved): a non-human account whose session Alex issues and whose credential is rotated every 90 days with a reminder, calling through a proxy that allows only the report and media admin paths (a client-credentials admin token is not possible: MAS policy refuses it and Synapse wants a token tied to a user; Synapse 1.162, MAS 1.26; step-book Phase 6 review). The email-only intake considered first is dropped. Synapse serves its admin API on every client listener, so the edge blocks `/_synapse/admin` from the internet. **Confirmed by Alex the same day (questions 46 to 49):** the chat defaults as written (private read receipts, no typing indicator, joined-after-only history, one-to-one DMs, an Everyone/Nobody request setting, "later" allowed at signup, verified handles only); chat state follows the account automatically (one browser's sign-out ends that browser's chat; sign-out everywhere, takedown and erasure end every session; suspension locks chat; erasure deletes the chat account, its media and links); the server enforces "no message text before a request is accepted" for every client (decision 12), which with the new-account throttle and the unencrypted-media refusal is what the one Python module exists for; and that stdlib-only Python folder (~150 lines, tested from Vitest) is allowed;
- **encrypted media (Alex, 2026-10-02):** no scanning on people's devices; chat relies on reports. Evidence is structured, not screenshots: the reporter's client uploads the decrypted bytes plus the event's `file` block (`url`, `key`, `iv`, `hashes.sha256`), so the review worker fetches the ciphertext, decrypts and checks the hash, binding the evidence to a real event from a real sender. Uploads are fingerprint-checked like every other media, stored privately for the case only, and deleted when it closes; a match follows the abuse path and no moderator views it. This is a written carve-out to the admin design's "no private data: chat" rule, with its own RoPA purpose (reporter-supplied chat content);
- **no photos or videos from people you don't follow (Alex, 2026-10-02):** our chat client does not offer to send them and does not show them, only a notice. Matrix has no follow graph and no client hides media per sender (Element's MSC4278 gate keys on the join rule), so the borrowed pattern is "hidden by default, click to reveal" applied by our rule, covering every attachment kind (`m.file`, stickers, inline `data:` images, URL previews, invite avatars) and failing closed when the follow lookup fails. It protects only users of our client: by default MAS keeps dynamic client registration on, and the terms say the rule applies to the unset.sh client only (review, 2026-10-02; the alternative, MAS allowing only our static client, is noted for Alex);
- **no IP logs:** Synapse and MAS record client IPs by default and cannot be told not to, so the edge does not forward `X-Forwarded-For` to them (`x_forwarded: false`), both record the edge's internal address, per-IP rate limits move to the edge, `user_ips_max_age: 1d`, and `synapse.access.http` is dropped from the log config. Both also store `User-Agent` strings, so the edge strips or neutralises `User-Agent` on the way to Synapse and MAS (step-book Phase 6 review). The device list shows no location (review, 2026-10-02);
- the user's privacy switches respected: a private account can still be messaged by handle, but nothing about it is exposed beyond that.

**No fallback client (Alex, 2026-10-03, decision 11 revised, step-book question 53 "Drop backup app", chosen over the recommended "keep, known gap"):** our own chat client is the only client we ship; **the branded Element Web fallback is dropped.** The step-book Phase 6 review had found that Element, configured not forked, keeps most of the decisions above but not all: it sets `history_visibility: invited` on DMs, so the invite-only message request is honoured differently; "exclude insecure devices" is a feature flag rather than `OnlySignedDevicesIsolationMode`; and its module API can hide media per event but cannot gate avatars or the attach button, so "no media from people you don't follow" would show a button the server then refuses. Those gaps, the design-sheet mismatch (Q11) and Element's CVE cadence are why the fallback goes. The accepted cost is written down: if the native client is late, chat is late (the launch gate already requires it), and a person whose browser cannot run our client cannot chat. People may still use third-party Matrix clients against the server, which enforces the request rule, the new-account throttle and the unencrypted-media refusal for every client (decision 32 notes), but we ship, brand and support none.


- **Engine:**
  - Synapse (1.162) + MAS (1.26) + a `chat-auth` bridge (atproto identity → OIDC, `sub` = DID); `matrix-js-sdk` 43 pinned exactly (v43 moved OAuth refresh into the SDK; the prototype's `tokens.ts` is not ported). Still the only spec-stable path: conduwuit is archived, Dendrite in maintenance.
  - Federation off: `federation_domain_whitelist: []`, no `.well-known/matrix/server`, no 8448.
  - **`server_name` is fixed in Phase 1** because seeded accounts make it permanent: recommended `unset.sh` with `.well-known/matrix/client` delegation to `chat.unset.sh`, so MXIDs read `@alice:unset.sh` (review, 2026-10-02).
  - Served only from `chat.<app domain>`. Cold-load budget ≤3.5 MB gzipped (the crypto WASM alone is 2.1 MB): immutable caching, crypto loaded lazily after the MAS callback, store persisted in IndexedDB (§6.1).
  - Hosting for chat: Synapse, MAS, `chat-auth` and their Postgres need ~4 GB at launch, 8 GB or more by 2,500 users; the Phase 5 hosting decision includes it.
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
- **Size:** 5–7k lines for the MVP (review, 2026-10-02; the prototype spent 10.7k on DMs, Spaces and voice and never built request gating). The device-trust posture and the invite question are settled above, not "before GA".

### 5.7 Admin panel (internal; from the admin panel design (`unset-plan/admin-panel/admin-panel-design.md`))

- **What:** a small console for one or two people at `admin.int.unset.sh`: account lookup, delist, takedown and reinstate, end our sessions, invites, held deletes, the audit log, a health board, **the draft review queue** for posts the classifier marked unsure (§5.8) and the Matrix report intake (§5.6). Post-publication reports on public records live in Ozone (§5.8, Alex 2026-10-02). It cannot browse users, act as a user or read private data, with one **written carve-out** (Alex, 2026-10-02, decision 6): a draft the user has submitted for publication, after the on-screen notice, is reviewable until published or withdrawn; nothing else is. The web panel ships from the start, phone access included (Alex, 2026-10-02, decision 15; the CLI-only v1 proposed by the review was declined).
- **Where:** its own `admin` process, container, origin, DB role and key. No moderator routes in `web` (lint-enforced). No public DNS record; reachable only over Tailscale (Tailnet Lock, deny-by-default policy, Funnel and Tailscale SSH off, split DNS, our own DNS-01 certificate). Public inbound is only 443 and an 80 redirect; SSH moves onto Tailscale.
- **Login:** an allowed Tailscale device, a hardware security key with PIN (no synced passkeys, no OAuth at login), and that key's entry in the signed roster. Sessions `__Host-admin_sid`, 15 minutes idle, 8 hours absolute. **Enrolment with attestation happens on desktop Chrome or Firefox only** (Safari returns `fmt: "none"` and a zero AAGUID); phones assert only, and an enrolment from a browser that strips attestation is refused, not degraded (review, 2026-10-02). The RP id `admin.int.unset.sh` is fixed before the first enrolment.
- **Actions:** every PDS action and PII reveal carries a WebAuthn signature over that exact action (`challenge = sha256(JCS(action))`, random 128-bit `jti`), verified by `pds-admin`, which checks assertions only (§5.2); `@simplewebauthn/server` lives in `admin`. Irreversible actions go through a 7-day hold.
- **Size:** CI budget 3,000 lines as a **warning**, not a hard fail, incl. `pds-admin` and audit (Alex, 2026-10-02; a hard 2,400 ceiling would be gamed by moving code into shared packages). The real guards stay: no moderator route in `web` (lint) and CODEOWNERS on admin paths.
- **Audit:** schema `audit`, append-only through `audit.append()`, two hash-chained lanes (`mod`, `sec`), redactable side tables, chain heads copied off-box daily.
- **Plugins:** an optional `admin.views` manifest field; plugin code never runs inside `admin`.
- **Roles in Postgres:** add `admin` and `retention`.

### 5.8 Feeds and video posts (Alex, 2026-10-02)

**Feeds as tabs.** Atproto feeds (https://atproto.com/guides/feeds) are run by feed generators: a service that returns a list of post links, which an app then fills in with the posts.
- The top of the home screen shows tabs: Following, plus feeds the user picks, such as a news or tech feed. Users add, remove and reorder them. The list is stored privately in the app database.
- **Bluesky feeds are fetched through the user's own PDS session** (review, 2026-10-02): the server calls `app.bsky.feed.getFeed` and `getTimeline` on the user's PDS, which proxies to Bluesky's AppView with a service-auth token minted for that user (`aud=did:web:api.bsky.app#bsky_appview`; the `rpc:` scopes are in §3). Labels, viewer state, blocks and mutes come back hydrated, rate limits are per user and per PDS, and the generator sees the real requester. The first draft fetched skeletons anonymously from one server IP and hydrated them through `getPosts` (25 URIs per call, unpublished limits); that is gone, about 400 lines with it. `net-guard` only ever talks to the user's PDS. Our own videos are hydrated from our index.
- We run our own feed generators for unset.sh videos (latest, following) for our app and third-party unset.sh clients. They cannot be shown by other apps' AppViews, which hydrate only records they index (Bluesky's drops `sh.unset.*` URIs), so the earlier interop claim is withdrawn (review, 2026-10-02).
- Feeds show only public content. A private user's posts never enter any feed.
- **Labels:** Bluesky posts carry Bluesky's labels; the app always applies Bluesky's labeler plus ours (`atproto-accept-labelers` with our Ozone DID; our index ingests our Ozone's `subscribeLabels` stream into a `label` table). Hidden labels are not shown, warning labels sit behind a warning.

**Video posts.**
- Our own record type in `sh.unset.*` for a short video: 60 seconds max, with caption, poster frame, aspect ratio and an optional `captions` (WebVTT) field. **The repo blob is a re-encoded, metadata-stripped 1080p H.264 master, never the original** (review, 2026-10-02): `getBlob` is unauthenticated, so whatever is in the repo is served raw by the PDS and copied by relays. The upload is deleted after review. **Blob limits (step-book Phase 4 review):** the PDS default `blobUploadLimit` is 5 MB (`packages/pds/src/config/config.ts`) and the installer sets 300 MB; our deploy preflight asserts `PDS_BLOB_UPLOAD_LIMIT` is at least the master cap. A user on another PDS (decision 5) may have a lower limit that `describeServer` does not publish, so on a 413 from a PDS that is not ours the publish **pauses and asks the user** (Alex, 2026-10-02, decision 22): the draft moves to a "your PDS refused the full-quality file" state, and the user chooses to publish with the 720p rendition as the repo blob (recorded as `master_downgraded`, shown on the post's details) or to keep it as a draft; nothing lower-quality is stored without that choice. A second 413 on the 720p copy fails the publish with a plain message. Renditions and posters live solely in our `media` storage; the caption file and the Bluesky fallback thumbnail are repo blobs by design (other clients read them), with a served copy in `media`. Renditions, posters and caption files are written to `media` storage (written by the worker, read by the media proxy, per-DID prefixes so erasure is a prefix delete), never in the PDS blobstore; drafts in a `drafts` store with a 30-day lifecycle rule.
- **Renditions (review, 2026-10-02):** H.264 progressive MP4 with `-movflags +faststart` and a keyframe every 2 seconds, served with `Range` by the media proxy: **360p at ≤1.2 Mbps** for feeds, **720p at ≤3 Mbps** full screen, the 1080p master on request. Plays in a bare `<video>` everywhere without hls.js; HLS only if mid-clip adaptation proves necessary. **AV1 rejected** (about a third of iOS Safari decodes it; 3–10× slower to encode). Posters AVIF+WebP ≤30 KB with `aspect-ratio` from the record. The worker runs ffmpeg in its own container with no network except storage, on its own CPU quota so an upload burst cannot starve `web` or the PDS (≈1× real time on two cores per clip).
- Upload checks: length, size (original cap 250 MB), format and codec allow-list, re-encode everything, strip metadata such as location.
- **Compressed for feeds (Alex, 2026-10-02):** the 360p rendition in feeds, autoplay muted with `playsinline`, `preload="none"` behind the poster, honouring `prefers-reduced-motion` and `prefers-reduced-data`; 720p when a video is opened full screen on a fast connection.
- **Captions on every video (Alex, 2026-10-02, decision 19):** the local speech-to-text transcript becomes a WebVTT caption track before publish, editable by the creator (Alex, 2026-10-03: like YouTube's automatic subtitles), with a CC toggle in the player, off by default and remembered per viewer (Alex, 2026-10-03, step-book answer); without it a video post fails WCAG 1.2.2 (Level A). Every player has a visible pause and keyboard controls.
- **Caps from day one (Alex, 2026-10-02, decision 18):** a per-account storage quota (2 GB default, raised per account in `admin`) and a daily upload cap (10). Storage, not bandwidth, is the cost line (≈75 MB per video with the master and two renditions; ≈2 TB per month at 1,000 uploads a day). Alex funds hosting at first; paid plans come later.
- **"Also post to Bluesky" (Alex, 2026-10-02, decision 4):** the publish screen has an opt-in tick, default off, that writes an `app.bsky.feed.post` with an `app.bsky.embed.video` (the reviewed 720p rendition through Bluesky's video service, verified against a self-hosted PDS in the Phase 4 spike; `app.bsky.embed.external` to the permalink as the fallback) in the same `applyWrites` as `sh.unset.video`. Without it a video is visible on unset.sh only, since Bluesky renders `app.bsky.*` alone. A Bluesky post is public and copied; the tick says so.
- **Reviewed before going public (Alex, 2026-10-02):** a public post (video or Bluesky post) is uploaded to our private draft storage, processed and checked there, and written to the user's repo only after it passes. It must not reach the repo first, because anything in the repo is public at once and copied by relays.
  - Checks: known abuse-material fingerprint matching (the legal duty) plus an automated content classifier for the categories in our rules. A pass publishes; a clear fail is blocked with the reason and an appeal; anything uncertain goes to the draft review queue in `admin` (§5.7) for a person to decide (Alex, 2026-10-02, decision 6; it cannot live in Ozone, whose subjects are published records or DIDs).
  - **Fingerprints (Alex, 2026-10-02, decision 7):** PDQ for images and sampled frames (1 fps) is computed locally (TMK+PDQF video fingerprints are dropped from v1, since no provider we use checks them and a feature file kept "in case" is data we do not need; added back when a provider accepts it; step-book Phase 4 review) in the no-network compute container. MD5 is dropped too: Arachnid Shield's "exact" match is a SHA-1 of media uploaded to it, and it offers no hash-only exact lookup (official SDK `arachnid-shield-sdk-ts@37c633f`, `POST /v1/pdq/` with base64 PDQ hashes; step-book Phase 2 review, 2026-10-03), so v1 checks PDQ hashes only. The hashes, never the media, are handed to `review-egress` (§5.2) through a job row (so `web` and the compute container never hold the Arachnid credentials, which exist only in `review-egress`) and checked against the **Canadian Centre for Child Protection's Arachnid Shield API** (free; the official SDK depends on axios and cannot route through `net-guard`, so a small client of our own, about 60 lines, makes the one call; a spike against the provider's test hash confirms the API before the gate is built), the same organisation we report to (Cybertip.ca is the designated body under SOR/2011-292). This replaces "PhotoDNA on our servers", which is not a thing: PhotoDNA Cloud uploads the image to Microsoft and is images-only. The terms and privacy notice say that fingerprints of every photo and video, private ones included, leave for this check and that media never does. Exact and `csam`-classified matches are reported to Cybertip.ca; near matches on private content create a hold for an analyst, not a report. With PDQ only, every result is a near match by the provider's definition, so the exact-vs-near split goes to the lawyer hour as written and is adjusted to what the API returns.
  - **Local nudity gate (Alex, 2026-10-02, decision 8):** an open-source model (NudeNet class; the package is MIT, and its YOLOv8-derived weights are a lawyer-hour licence check, since Ultralytics YOLOv8 is AGPL-3.0; ~0.5 s per frame on CPU) runs inside the worker first. Adult content is banned at launch, so any nudity is already a fail or a human case and those frames **never leave our servers**. **Gore gate (decision 30):** a small local image-safety classifier (MIT, ~6M parameters, ONNX) runs on the same frames; it is low-maturity, so it can only hold a post for a person, never block, until its error rate is measured.
  - **Moderation stays local (Alex, 2026-10-03, decision 30):** "keep moderation as locally as possible, use available software, and explore deeper integration only if that is not enough." Every v1 check runs inside the no-network compute container and **no post content leaves our servers for moderation**. Text (comments, video captions and subtitles, the local whisper.cpp transcript, Bluesky post text and alt text) goes through a **local text gate** in three stages: spam and link rules, then Detoxify multilingual (Apache-2.0, EN/FR among its languages), then Llama Guard 3 1B (Llama 3.2 community licence) for the hazard categories. Child sexual exploitation (Llama Guard S4) is blocked and goes to a person, who decides on the Cybertip.ca report; other unsafe results and self-harm are held for a person; everything else is allowed. Image checks are the fingerprint, nudity and gore gates above. Anything a local tool is unsure about goes to the draft review queue. Model files are baked into the image, pinned by SHA-256, and the worker refuses to start on a mismatch. **The gates run in shadow mode first** (verdicts recorded, every post still routed to a person) until a labelled EN/FR set, kept outside the repo, shows the error rates; stored results are scores and categories only, never a copy of the text, deleted with the draft or comment. **The Claude API review of frames, captions and transcripts is removed from v1.** It stays a documented later option, turned on only if measurement shows the local tools are not enough and Alex approves; until then `review-egress` has no Anthropic host and Anthropic is not a processor. A pass publishes **without the user present**: the worker restores the user's OAuth session server-side from the session store and writes the records to their PDS, which is why the publish screen says the post will go live once review completes; a revoked session turns the pass into a "sign in to publish" state.
  - With decision 30 nothing about a post is sent to a third party for review; only PDQ fingerprints leave, to Arachnid Shield (decision 7). The first-publish consent checkbox for the Anthropic review (review, 2026-10-02) is therefore dropped; the publish screen and the privacy notice say that posts are checked automatically on our own servers before they go live, and that a person sees anything the checks are unsure about.
  - Models and cost: every model file is pinned by SHA-256 with its thresholds in the repo (a one-page **AI system record**: purpose, inputs, model versions and hashes, measured false-positive rate on ≥200 labelled own clips and a labelled EN/FR text set, retention, human reviewer; §6.1). Cost is RAM and CPU on our own worker, not a per-call price: roughly 2.7 GB resident for the text and gore models beside NudeNet and whisper.cpp, a few seconds per comment and under ten seconds added per video on four vCPUs (estimates from the step-book research, confirmed in the Phase 4 spike: Llama Guard 3 1B latency and French accuracy on our own samples). Comments, not videos, are the throughput line.
  - Statements of reasons say the decision used automated means and name the appeal route (DSA Art. 17); **an appeal is decided by a person**, never re-run through a model. A clear fail stays in draft storage until the appeal is decided, then is deleted. The 30-day draft expiry **skips a draft with an open appeal**, since a person must decide it; an appeal open longer than 7 days raises an alert in `admin` (step-book Phase 4 review).
  - **Abuse-material law (Alex, 2026-10-02, decision 9):** Bill C-16 is law (royal assent 2026-06-18, S.C. 2026 c. 19), amending the Mandatory Reporting Act: preservation is **one year after notification**, not 21 days, and a notification of manifest material must carry transmission data. So: a 365-day sealed, encrypted legal hold that no moderator browses, on `pds-admin`'s clock, surviving backup pruning and the draft TTL; **at the moment of a fingerprint match only**, the uploader's client address, time and route from that request are sealed with the hold and destroyed with it; nothing is recorded otherwise. **Sealed transmission buffer (Alex, 2026-10-02, decision 21):** the match is found after the upload request has ended, so every upload, pictures included (Alex, 2026-10-03, step-book question 43: one method for both), seals its client address, time and route into a small record encrypted to the legal-hold public key, keyed to the upload, with a hard expiry at the check deadline; a match moves it into the 365-day hold, anything else destroys it within minutes, and no process, log or moderator can read it meanwhile (the private key lives only in the hold path). The privacy notice names this brief retention; it is the one written exception to the no-address-logging rule. One Canadian lawyer hour on "collect vs provide" before production. The Act does not require proactive scanning (s. 6); ours is voluntary and said so.
  - The publish screen and the terms say plainly that public posts are reviewed automatically before they go live. Private posts are not sent to the automated content review (the fingerprint check alone applies to everything, decision 7).
  - **Fingerprint check on everything (Alex, 2026-10-02):** every photo and video the app processes is checked as above before it is stored for use: public and private posts, drafts, profile pictures and banners, any image pipeline. A match follows the same path (blocked, reported, 365-day sealed hold). Chat media is end-to-end encrypted and cannot be checked on the server; chat relies on reports and blocks media from people you don't follow (§5.6).
  - **Suspected abuse material (Alex, 2026-10-03, with decision 30):** when a local check, a reviewer or a chat evidence report suspects child sexual abuse material that no fingerprint matched, the item is blocked and sealed under the same legal hold as a match; an **emergency alert** goes to the owners at once; a person files the **Cybertip.ca** report (C3P is the designated body, and Arachnid Shield is a hash lookup, not a reporting channel, so suspected new material cannot be "sent to Arachnid"); the runbook says to call police directly when a child appears to be in imminent danger; the uploader's uploads are frozen (never the reporter's); and nothing goes to any third party, Claude included. The reporting duties and deadline for suspected versus matched material are on the lawyer-hour list (§6).
  - A report button stays on every post, for anything the review misses. **Forwarding (Alex, 2026-10-03, step-book question 36: "if it's a Bluesky post yes, otherwise no"):** a report on a Bluesky post made through us is always forwarded to Bluesky's moderation service, sent from our own moderation account so Bluesky never learns who reported; a report on unset.sh content is never forwarded.
**Our labeler: Ozone (Alex, 2026-10-02).** We run Bluesky's open-source moderation service, Ozone (MIT/Apache-2.0, Next.js and Postgres), as the unset.sh labeler, so our labels are available to Bluesky and every other atproto app (shown to users who subscribe to our labeler), not only ours.
- **Role: labels and post-publication report intake only** (Alex, 2026-10-02, decision 6). The draft review queue and Matrix reports live in `admin`. Ozone hydrates records through Bluesky's AppView and renders `sh.unset.*` as raw JSON, so moderators open our video on `unset.sh` and Ozone holds the case.
- Its public side (`com.atproto.label.*`, `com.atproto.moderation.createReport`, `/.well-known/*`, `_health`) is on the internet; everything else was to be Tailscale-only. **Decided by Alex (2026-10-03, decision 26): credential login over Tailscale.** The Tailscale-only design did not match how Ozone works: its moderator UI sends every `tools.ozone.*` call through the moderator's own PDS to the public `#atproto_labeler` endpoint (`ConfigurationContext.tsx:53-56`), and its OAuth client id is built from the forwarded host (`oauth-client.json/route.ts:11-23`). Alex chose Ozone's **credential login** (`AuthContext.tsx:74-76`) with an **app password**, over the tailnet, over the alternatives (public API accepted only from our PDS; labels-only Ozone; deferring Ozone). Consequences: the moderator UI and `tools.ozone.*` stay tailnet-only as the admin design intended; this revives the legacy password path for moderator accounts only (vault note `legacy-createsession-password-path`), so those accounts use app passwords scoped to Ozone, live on our PDS, and are listed in the secret inventory; the Phase 5 spike (P5.07) must confirm that the credential path reaches Ozone directly over the tailnet rather than through the PDS proxy, and if it does not, the question returns to Alex before Phase 5 proceeds. **Ozone's moderator login is atproto OAuth against the moderator's PDS** (review, 2026-10-02; our PDS offers email 2FA only), so no hardware key is possible at its login: the Tailscale layer is the gate, and Ozone never gets PDS admin power. Takedowns, deletes and account actions stay in the admin panel through `pds-admin`, with a hardware-key touch per action (§5.7).
- It has its own DID and label-signing key (secret inventory, backup and recovery runbook); its Postgres is a second PII store (report text, reporter DIDs) and gets a 6-month retention cron. Watchtower auto-update in its reference compose is disabled in favour of pinned digests. **The PDS's `PDS_MOD_SERVICE_DID` is never set** (step-book Phase 5 review, 2026-10-03): that setting makes any service JWT from that DID a PDS administrator (`auth-verifier.ts:148-174`), letting Ozone call `updateSubjectStatus` and take down any account with no `pds-admin` envelope. Only the separate `PDS_REPORT_SERVICE_URL` and `PDS_REPORT_SERVICE_DID` pair points at our Ozone, so reports route to it while takedowns stay with `pds-admin`. Foreign-PDS users' reports reach it with `atproto-proxy: <ozone did>#atproto_labeler` plus the matching `rpc:` scope.
- Built in Phase 5, before launch, after a spike that confirms the version and the label stream. New reports about public records then go to Ozone; the Phase 3 app table keeps reports about drafts and chat (step-book gap 6).

- Video raises cost and duty: storage, bandwidth and CPU grow fast, and abuse-material detection and reporting apply (admin design §8.1). Phase 5 sizes the hosting before launch (§8).
- **Comments (step-book gap 7):** a comment on a video is our own record `sh.unset.comment` (text, `subject` strongRef to the video, optional `parent` strongRef for one level of replies; counts keyed on the subject URI, not CID, per §2). When the video was also posted to Bluesky, the comment may additionally be written as an `app.bsky.feed.post` reply to that Bluesky post, opt-in like the post itself. Likes on our videos are `sh.unset.like` for the same reason (Bluesky hydrates only records it indexes). The private-account matrix in §11 (Q2b) is decided by Alex **before Phase 4 starts**; it is on the review list.
- Other post kinds: users can also write standard Bluesky posts (`app.bsky.feed.post`, text and images), which then appear in Bluesky. All posts follow the "Posts and follows" privacy switch (Q2b).

## 6. Privacy and compliance deliverables

These are deliverables, not intentions:

- **`eraseDid(did)`** covers the index, the app schemas and plugin hooks. It is triggered by `#account deleted` and by a moderator action. A test enumerates every table with a DID column.
- **Export** at `/settings/export`: the CAR link plus a JSON dump of every app-DB row for the DID.
- **Logging and retention** per the admin panel design (`unset-plan/admin-panel/admin-panel-design.md`) §8.1: no IPs or user agents in any traffic log or table, no per-user analytics, no user sign-in records; edge logs keep status, route and timing for 3 days (the Caddy log filter deletes `remote_ip` and `X-Forwarded-For`, checked in CI; the PDS log level is set likewise; Synapse and MAS never see a client IP, §5.6). The one exception is the sealed transmission data captured at a fingerprint match (§5.8).
- **Measurement (Alex, 2026-10-02, decision 17):** a nightly `metrics_daily` table of **rounded aggregate counts, service-wide** (accounts, profiles published, videos published/blocked/unsure, sessions active, reports opened/closed, time to first publish), rounded to buckets of 5 below 50, never joined to a DID, kept **13 months**, described in the privacy notice. No real-user performance beacon; CrUX and Lighthouse CI only.
- **Retention:**
  - admin action log: 2 years, and the **one narrow exception to the no-IP rule (Alex, 2026-10-03, decision 29):** each admin action may record the acting admin's private tailnet address, staff only, never a user's, kept with the log for 2 years and listed in the RoPA; admin security events: 1 year; moderation decisions: 1 year after the case closes;
  - reports: 6 months after the case closes (Ozone's Postgres included);
  - breach record (PIPEDA): 24 months; **abuse-material preservation: one year after notification** (C-16, S.C. 2026 c. 19; was 21 days before the review), transmission data sealed with the hold and destroyed with it; **per-upload sealed transmission buffer: minutes, until the fingerprint check returns** (decision 21);
  - abandoned drafts: 30 days; aggregate metrics: 13 months;
  - backups: **30 days** (Alex, 2026-10-03, step-book question 38; the card said 35 and the step book corrected it to 30 so erasure completes within a month), so erasure reaches the backups within 30 days; a legal hold is the only thing that outlives them. **Recovery objective (question 44):** at most 24 hours of data lost, core service back within 4 hours; the restore drill measures both, and a drill that passes but runs too slowly is a severity-2 bug.
- **Reports** go into the moderation queue, never into logs.
- **RoPA rewritten** for the reduced scope: drafts, reports, audit, OAuth tokens, the local automated review (no processor; scores only), Arachnid Shield (fingerprints only), the transactional email sender (a paid sending service hosted in Canada or the EU, shortlisted by the team and picked by Alex before the first invite; step-book answer 21), the outside heartbeat service (no personal data; answer 25), reporter-supplied chat content, aggregate metrics and the federation decision, with a lawful basis for each purpose.
- **Moderation and GDPR:** moderation history in exports, `dsar.export` for users who cannot log in, erasure of audit side tables, PLC tombstones, statements of reasons that say when automated means were used (DSA Art. 17(3)(c)) with an appeal decided by a person, and a public notice form on `unset.sh` (DSA Art. 16; Canada's notice-and-notice wants the same form).
- **Invite-country rule (Alex, 2026-10-02, decision 10):** no EU, UK or Australian invitees until a representative exists (GDPR Art. 27 and DSA Art. 13 attach on the first EU user; the "occasional" exemption never covers persistent accounts) and age assurance exists for Australia (its under-16 law has applied since 2025-12-10 with no size threshold and self-declaration is not enough). One config flag and one sentence in the terms.
- **Canadian law:** **Quebec Law 25 applies** regardless of Ontario (any enterprise with Quebec users): a named privacy officer on the privacy page, the incident register, and a privacy impact assessment before backups leave the province. **PIPEDA** applies in full the day the service is commercial (charges money or incorporates); the design meets it voluntarily before then. The Mandatory Reporting Act and the Criminal Code apply regardless. Bills as of 2026-10-02: **C-16 is law**; C-22 (Lawful Access) passed the House and Senate second reading, not law; C-63 died at prorogation; C-34 (Safe Social Media Act, under-16 rule) at first reading. A quarterly bills watch is in the compliance cadence. Age 16 stays self-declared on a neutral screen (free-form date, no hint of the threshold); a credible under-13 report deletes the account (COPPA actual-knowledge runbook).
- **Legal paperwork moves to Phase 1–2** (review, 2026-10-02): one-page terms and privacy notice with the Phase 2 signup, the Cybertip report-and-preserve runbook before any non-Alex upload, the notice form, the Arachnid Shield application, a one-page incident-response runbook (PIPEDA real-risk test, OPC form, Law 25 CAI notice, C-16 path), and one Canadian lawyer hour before production (C-16 transmission data, Law 25 PIA, PIPEDA applicability, whether the Llama licence's "Built with Llama" notice applies to a server-side check, the licence of NudeNet's YOLOv8-derived weights, the reporting duty for written child sexual material in comments, and the reporting duties and deadline for suspected versus fingerprint-matched material; decision 30).
- **Privacy notice** published, and linked from both the app and the PDS (`PDS_PRIVACY_POLICY_URL`).
- **Federation decision recorded** (Q2b): whether `PDS_CRAWLERS` points at the Bluesky relay.

### 6.1 Standards, accessibility and performance (Alex, 2026-10-02, decision 19)

Hard requirements with CI gates, not intentions. The prototype's `docs/compliance/security-standards.md` cited ASVS 4.0 chapters that no longer exist; it is rewritten.

| Standard | Level | CI check |
|---|---|---|
| OWASP ASVS | **5.0 Level 2**, as `docs/compliance/asvs-5-l2.md`: every L1+L2 row names the test or lint that proves it (open chapters: V6 admin login, V9 service-auth JWTs with `alg` allowlist, `aud`, `exp` ≤60 s, `lxm`, `jti` replay; V4 deny unknown methods and content types) | row → test id; test-count check |
| OWASP Top 10 | 2025, incl. **A10: a test that an exception inside the CSRF or authz middleware denies** | Vitest on middleware |
| RFC 9700, NIST SSDF, CIS Docker and Postgres | designed to | login tests, hadolint, image scan, role tests |
| SLSA | **Build L2** now, L3 later via a reusable workflow. Private-repo GitHub attestations likely need Enterprise Cloud (unverified) and keyless cosign would publish the repo identity to the public Rekor log, so: **cosign with a key pair and no transparency-log upload**, keys in a protected GitHub environment; upstream images mirrored by digest into private GHCR and signed the same way (step-book Phase 1 review, 2026-10-03) | `cosign verify` with our public key in the deploy preflight |
| SAST / DAST / deps | Semgrep CE per PR; ZAP baseline weekly against the compose stack (missing headers fail); Renovate `minimumReleaseAge: 7d`, `npm audit --audit-level=high`, `--ignore-scripts` in CI; CodeQL once the repo is public | per PR / weekly |
| WCAG | **2.2 AA** (chosen; AODA, EAA and ADA do not compel it): captions, visible pause, 24×24 targets, labelled glyph icons (`aria-hidden` plus hidden text), keyboard access to player and chat, reduced-motion autoplay; opaque cards under accent text (the 95 % alpha over the ASCII field is the one contrast risk) | `@axe-core/playwright` (wcag2a..wcag22aa) on every smoke page in **both themes**, zero violations; pa11y-ci on the zero-JS routes; a manual keyboard pass per phase exit |
| Core Web Vitals | budget table below | Lighthouse CI mobile preset, median of 3, `budget.json`; Playwright timings |
| SOC 2, ISO 27001/27017/27018, ISO 42001 | **certification track kept on paper** (Alex chose to keep it; the review proposed dropping it). Audits are a later cost, larger than hosting; nothing is bought now | the ASVS doc, the RoPA and the AI system record are the evidence base |
| AI system record | one page: purpose, inputs, the local models with pinned file hashes and thresholds, measured false-positive rate, retention, human reviewer (§5.8; no third-party model in v1, decision 30) | hashes pinned in the repo |
| Lexicon versioning | not SemVer: a breaking change is a new NSID, only optional fields are added; SemVer applies to read-API shapes (and a future `plugin-api`) only | `lex` diff in CI |
| Not applicable | App Store, Play, MASVS (no native app); CCPA/CPRA (no revenue, nothing sold); HIPAA, FERPA; PCI DSS becomes SAQ A only with Stripe Checkout on a route with its own CSP snapshot | |

**Performance budget** (p75, mid-range Android, slow 4G; review 08 §7):

| Surface | Budget |
|---|---|
| All pages | LCP ≤2.5 s, INP (TBT proxy) ≤200 ms, CLS ≤0.1; origin TTFB ≤200 ms warm, ≤500 ms cold; ≤5 queries and ≤50 ms DB per request, `statement_timeout` 2 s on `web` |
| All pages | CSS ≤40 KB unminified and ≤12 KB min+gzip per bundle; fonts ≤120 KB, two files, preloaded, `size-adjust` fallbacks |
| `/@handle` | **0 bytes of JS**; HTML ≤30 KB gzipped |
| App pages | JS ≤75 KB gzipped total, ≤15 KB per island |
| Images | AVIF+WebP; avatar ≤20 KB, poster ≤30 KB, explicit `aspect-ratio` |
| Feed clip | first frame ≤1 s after viewport entry; 360p ≤1.2 Mbps, 720p ≤3 Mbps, keyframe 2 s, faststart (ffprobe in the pipeline test) |
| Chat origin | cold load ≤3.5 MB gzipped, first room list ≤3 s warm and ≤15 s cold |
| Edge, transcoder | anonymous profile cache hit ≥90 %; ≤90 s wall time per 60-second clip on two cores, queue-depth alert |

## 7. Repository layout

```
unset.sh/
  apps/
    web/          # Hono server: routes/, screens/, islands/, profile/ (pure view)
    api/          # public read API, own DB role
    indexer/      # Tap consumer
    media/        # media proxy
    review/       # transcode, fingerprint, nudity and gore gates, text gate (no-network worker)
    admin/        # internal console incl. the draft review queue
    pds-admin/    # zero-dep internal service
    chat-admin/   # phase 6: MAS seeding, zero-dep
  packages/
    core/         # auth, identity, profile, social, moderation, db, audit, csp, csrf, config, i18n, seal
    lexicons/     # sh.unset.* JSON + permission set; @atproto/lex generated code (checked in)
    net-guard/    # the single egress classifier (ported with its 23 tests)
    ui/           # tokens.json → tokens.css, shared components, icon wrapper
  modules/        # chat/ (phase 6), rss/ (later): same boundary rules as plugins
  plugins/        # empty in v1 (decision 25); the first plugin brings the seam
  deploy/         # one compose.yaml with profiles, edge config, backup, preflight, tap build
  docs/           # short ADRs, runbooks (keys, lexicon publishing, rotation, restore), compliance
```

Tooling (Alex, 2026-10-02, decision 16):
- **TypeScript 7** (the Go port, GA 2026-07-08; TS 6 is Microsoft's last JS-based release) and **Node 26** (LTS 2026-10-28) from Phase 1; `engines.node: ">=26"`, `node:26` images by digest. One workspace and one lockfile; TypeScript project references.
- Biome 2.5 for lint and format, **CSS included**: `noHexColors`, `noMissingVarFunction`, `useLayeredStyles` and one GritQL plugin for token-only spacing, radius and font sizes replace Stylelint (optional second opinion only). Vite's Lightning CSS minifies. dependency-cruiser for boundaries.
- **Vitest only** (the prototype's `node:test` plus Vitest split is how 20 UI test files stopped running); the "discovered equals executed" guard compares `vitest list --json` with the reporter's file list. Playwright smoke tests with axe-core against a production build, in both themes; Lighthouse CI; Semgrep per PR (§6.1).
- Per-package line budgets as CI warnings; the direct and transitive dependency counts recorded at each phase exit.
- graphify graphs regenerated in CI.

## 8. Phases

Small PRs to a protected `main`; each phase ends at a demonstrable exit. No public users before the launch gate; a **closed test track** (Alex, 2026-10-02, decision 1) of at most 10 people Alex knows runs on the development PDS with disposable accounts from the end of Phase 2, labelled "not a launch", wiped before production, with a weekly 30-minute call; it grows at Phase 4 (video).

**Phase 0 — Decisions and bootstrap**
- Answer §11.
- Create the GitHub repo:
  - branch protection that applies to admins too, with PR + CI + **Alex as required human approver** (agents open PRs, never approve);
  - real CODEOWNERS, LICENSE, SECURITY.md;
  - Renovate, secret scanning and push protection.
- CI from commit 1, every action pinned by SHA:
  - typecheck, test (discovered = executed), lint, `npm audit`, gitleaks;
  - SBOM, image scan, hadolint, actionlint;
  - images signed with cosign (key pair, no public transparency log) plus provenance attestations kept with the image.
- The Phase 0 bootstrap bundle predates decisions 16 and 19 (it pins TypeScript 6.0.3 and Node 24, uses `node:test`, and has no Semgrep, SBOM or actionlint); the first commits after the repo exists move it to TypeScript 7, Node 26, Vitest and the full CI list above (step-book gap 9).
- Slim `CLAUDE.md`/`AGENTS.md`. Carry over the vault notes from review 07 §6 and archive the rest.
- Register the domains (the media throwaway included); set DNSSEC, CAA and HSTS; reserve labels; register the obvious look-alikes.
- Licence decided (Alex, 2026-10-03, decision 27): **AGPL-3.0-only for the applications, MIT for the small building blocks (`packages/`) and the lexicon record-type files**, so the record types can be adopted by other atproto apps. `LICENSE` (AGPL) and `LICENSE-MIT` at the root, the split stated in the README and in each `packages/*/package.json` `license` field.
- Generate the PDS rotation and recovery keys offline.
- Admin groundwork (§5.7): hardware-key 2FA and offline codes on GitHub, registrar and host; the allowed-signers file; a private repo ruleset with CODEOWNERS requiring security review on admin paths; the report-routing decision.
- **Exit:** CI passes on an empty repo and blocks a planted secret, a planted bare `fetch` and a planted `Domain=` cookie.

**Phase 1 — Platform, local stack, lexicon authority**
- Typed config, Hono server, CSRF gate, CSP, limits, trusted proxy.
- Postgres with migrations and roles; sealed storage; audit.
- i18n catalogs (EN/FR; these replace 1,076 inline `choose()` calls); `net-guard`; error pages.
- Token pipeline and UI kit; server-applied theme. Base styles for native elements (forms, type) so plain HTML looks right without classes. Styling is plain CSS: design tokens as custom properties, one CSS Module per shared component (Vite built-in, no extra dependency), and screens compose components and add no global CSS. No CSS framework (Alex, 2026-10-02). CI enforces it: Biome's CSS rules ban raw colours, radii, spacing and font sizes outside tokens (§7); `@layer tokens, base, components, screens` makes the no-global-CSS guard structural; a size budget fails the build if the total shipped CSS grows past its limit (start near 40 KB unminified, raised only in a reviewed PR). The axe-core and Lighthouse CI gates from §6.1 start here, on the shell.
- The framework-glue spike (§5.1): Hono SSR plus islands measured against the ~600-line exit, one day on Astro, React Router 8 named as the fallback. The OAuth advisory lock and the `migrator` role (§5.2).
- `compose.dev.yaml` with a real PDS, Tap and seeded accounts, so signed-in flows are testable locally.
- Admin platform (§5.7): the audit schema, edge rules and outside probes, Tailscale (Tailnet Lock, deny-by-default policy in the repo, split DNS), firewall rules with public port 22 closed, a source-IP test, and a rehearsed provider-console recovery before Phase 1 ends.
- **Production PDS deferred to Phase 5 (Alex, 2026-10-02, decision 20):** the hosting provider is decided in Phase 5 (decision 14), so no production machine exists before it. In Phase 1 the **lexicon authority account is created on the development PDS** (the `_lexicon` DNS record names a DID, not a server) and migrates to the production PDS with the standard atproto account migration in Phase 5; its did:plc rotation key is Alex's offline key so the account survives the dev PDS. `unset.ac` is still registered now (permanent name). Until the move, the development PDS hosts login-critical infrastructure, so it gets durability and integrity checks (a nightly export of the authority repo compared against the published set CID) plus a best-effort reachability probe that does not run on GitHub Actions (a 5-minute probe would exhaust a private repo's minutes); no availability percentage is promised, since a failed set lookup falls back to the PDS's last good copy (`lexicon-getter.ts:16-40`). Then create the lexicon authority, publish the schemas and permission set, and set `_lexicon` (with a DNS token scoped to `_acme-challenge` only, so the chat certificate's credential cannot touch login-critical DNS).
- **Permanent choices fixed here** (review, 2026-10-02): the Matrix `server_name` (§5.6), the Tailnet Lock recovery choice (whether Tailscale support holds a disablement secret; lost secrets are unrecoverable), the admin RP id.
- Legal paperwork, part 1 (§6): Arachnid Shield application, Cybertip runbook, incident-response page.
- **Exit:** Playwright smoke passes on the shell in both themes and both languages with zero axe violations, and the permission set resolves from outside.

**Phase 2 — Identity, auth, profile writing**
- OAuth with the set plus fallback, login, signup, logout and revoke, sessions with lifecycle, verify-email gate, invites, `/join`, `/me`, onboarding, the module identity seam.
- Profile editor: drafts, sections, privacy, publish/unpublish, image pipeline, preview through `ProfileView`.
- Brought forward from Phase 3 and 4 (step-book gaps 2, 5, 8): a minimal `pds-admin` with `invite.issue` only; a minimal `media` entrypoint serving only signed draft-preview URLs (published blobs follow in Phase 3); and the slot for the **image fingerprint gate** (PDQ, Arachnid Shield, §5.8) on profile pictures. **Arachnid timing (Alex, 2026-10-03, decision 23):** while only trusted people use the app (the closed test track, at most 10 known people), the real Arachnid Shield client, its spike and the C-16 transmission buffer (decision 21) move to Phase 5, before the production PDS; Phases 2 and 4 keep the check stage with a fake service. Three safeguards hold meanwhile: the application for access is filed in Phase 1, since it needs no code and approval can take a while; the pipeline keeps the check's slot, test runs use a fake service, and the production server refuses to start unless the real check is configured; and everything uploaded during the trusted test period is scanned once the real check is connected, as part of the launch gate. Decision 7 (every photo and video, private included, checked; the terms say so) holds unchanged for the public product.
- Run the §5.3 go/no-go list. Legal paperwork, part 2: one-page terms (invite-country rule, fingerprint check, automated review) and privacy notice live with signup.
- **Exit:** a new user signs up on the PDS, edits drafts, publishes and unpublishes; the repo contains records only while published. The closed test track starts.

**Phase 3 — Indexer, public profile, directory, moderation**
- Tap spike first: dynamic mode on the public relay with collection filters, inbound volume measured, ack WebSocket, trust rules (§5.2).
- Then the indexer, `eraseDid`, the media proxy on its own domain, the `api` entrypoint and grant-matrix test, the public `/@handle` routes, the handle-host redirects and well-known, the directory and search, and moderation (delist, suspend via signed assertion, report routing: reports land in an app table that `admin` lists, since Ozone arrives in Phase 5; step-book gap 6).
- Port the appview tests (ingest 33, db 25, verify 18, xrpc 24, media 7).
- Admin v1 (§5.7): attested key enrolment on desktop, per-action signing and the full `pds-admin` assertion verifier (the Phase 2 stub grows into it), off-box audit copies, runbooks 1 to 6, the 3,000-line warning budget.
- **Exit:**
  - `/@handle` renders with zero JS, and its images come only from the media origin.
  - An external resolver confirms handle↔DID.
  - A suspend stops the page, the bytes and the sessions.
  - Deletion leaves no rows.

**Phase 4 — Social**
- Short-video posts and the video pipeline (1080p master, progressive renditions, captions, quotas), the review pipeline (local text gate and gore gate in shadow mode first, decision 30) and the draft review queue in `admin`, the opt-in Bluesky post (with the `video.bsky.app` spike), standalone Bluesky posts, feed tabs through the PDS proxy, follows, home timeline, likes and comments: counts survive edits, the reply root is correct, foreign likes are ignored.
- Export page. The test track grows to video.
- **Exit:** parity with the prototype's non-chat, non-RSS social features, plus a regression test for each defect in §2; the rendition and first-frame budgets pass.

**Phase 5 — Production**
- One compose file with profiles; per-container egress networks: Tap and the indexer get general HTTPS egress through `net-guard` with private ranges blocked, because Tap follows the public relay and backfills from any PDS (decision 5) and `verifyHandle` needs outside DNS and HTTPS; `pds-admin` reaches only the PDS; `review-egress` reaches Arachnid Shield and `pds-admin` (§5.2, decision 30); `media` reaches the fixed Bluesky media hosts alone (decision 31); deploy by verified digest; `/health` reports the commit.
- Stand up the **production PDS** on `unset.ac` with no users (recovery key set, invite-only, admin XRPC denied, no client IP forwarded and request logging off, edge rate limiting (§5.2), `PDS_EMAIL_DISABLE_CONFIRMATION_LINK`) and migrate the lexicon authority account to it (decision 20, moved here from Phase 1).
- **Hosting provider decision (Alex, 2026-10-02, decision 14: decide here, not before).** On the review list with the price comparison: OVH Canada VPS ~CAD 12–17/month (KVM console, daily backup) vs 1984 Iceland ~€35–70/month for the same box, which also does not shield from Canadian orders; sized for the relay firehose (§5.2), chat (§5.6) and video storage (§5.8), on a plan with included traffic, not egress billing. The backup provider waits with it: **R2 has no Object Lock**, so audit segments and backups need Hetzner, B2 or Wasabi compliance mode; R2 can keep the public blob mirror. Alex asked for privacy-focused options (2026-10-03); the step book's comparison (`unset-plan/breakdown/reviews/backup-storage-privacy-research.md`, suggesting Scaleway Paris first and Impossible Cloud second) joins this decision, and hosting, media storage, mirror and locked-backup provider are all decided together at the start of Phase 5.
- Backups:
  - in-stack, age-encrypted, off-box, with a freshness alert;
  - covering Postgres, the PDS SQLite files, Tap's database and the media store;
  - a blob mirror by nightly `rclone sync` to the second provider;
  - restore drill (re-run after Phase 6).
- Secret inventory and rotation runbook.
- The RoPA and privacy notice from §6.
- Ozone labeler (§5.8; labels and public-record reports only), after its spike.
- Capacity: per-client rate limits at the edge (§5.2), the review worker on its own CPU quota, chat sizing.
- Admin v1.1 (§5.7): statements of reasons, appeals, blob and record takedown, GDPR cases, the export and notice-form work in `web`, the restore drill, the remaining runbooks, and the four extra admin tools Alex chose to build rather than leave as written procedures (2026-10-03, step-book question 45, "all four"): forced handle rename, invite-chain takedown, a global upload pause switch, exact-email account lookup.
- **Exit:**
  - a restore drill on a fresh host passes;
  - the edge rate-limit and spoofed-header tests pass;
  - production stack ready; no launch yet (see the launch gate after Phase 6).

**Phase 6 — Chat** (core feature, Alex 2026-10-02; MVP from §5.6): `chat-admin`, Synapse + MAS + `chat-auth`, the native client with `OnlySignedDevicesIsolationMode`, requests, block and report; no fallback client (decision 11 revised). The restore drill is re-run with the Matrix databases, media store and signing keys in the backup set.

**Launch gate (Alex, 2026-10-02, decision 2, restated):** no public launch, invite-only included, until the whole core is done: **all six phases**, chat included, every core feature from §4 shipped; **no severity-1 or severity-2 bug open** (severity-3 triaged; "no known bugs" was dropped as unreachable); CI green with **every test executed and passing**; the restore drill passing after Phase 6; the Phase 5 security tests passing; **the Arachnid Shield check live and every file uploaded during the test period scanned** (decision 23); a final security review. Then invite-only launch. **Estimated duration: roughly 12–18 months from the start of Phase 1** (review, 2026-10-02), derived from 20–24k core lines plus 5–7k chat plus 12–18k tests at the prototype's pace with agents; an estimate, not a commitment, re-measured at each phase exit. The closed test track gives feedback meanwhile.

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
| Tap (beta) misbehaves on the public relay | Phase 3 spike. The fallback is consuming `subscribeRepos` with `@atproto/sync`; the verify tests port either way. |
| `@atproto/lex` changes under us | Exact pin; generated code checked in, so changes show up as diffs. |
| Leaving Next.js costs more than estimated | Phase 1 measures the whole glue against ~600 lines; one Astro day; React Router 8 is the fallback before Phase 2. |
| PDS `/account` falls short (2FA, confirm-email, branding) | The §5.3 go/no-go list. It is now the only account surface (no account app). The fallback is an upstream fix or a thin app screen for what OAuth allows, never a patch. |
| Relay firehose volume or Tap beta bugs | ~200–300 GB/day budgeted in the Phase 5 hosting choice; `@atproto/sync` fallback; pinned commit; Phase 3 spike measures. |
| Chat is the long pole | No fallback client (Alex, 2026-10-03, decision 11 revised): if the native client is late, chat and therefore launch are late; the Phase 6 MVP is DMs only and the launch gate re-measures at each phase exit. |
| Abuse-material or legal duty met late | Terms, notice, Cybertip runbook, Arachnid Shield application and the notice form in Phase 1–2, before any non-Alex upload. |
| Launch gate slides | Severity-based gate with a month estimate re-measured at each phase exit; the closed test track supplies feedback from Phase 2. |
| Domain, namespace or federation chosen wrongly | Decided in Phase 0, before any account exists. |
| One host: host root reaches everything, including the online PLC rotation key | Offline recovery key can undo PLC changes within 72 hours; nightly PLC log check; provider, registrar, GitHub and the tailnet identity provider sit at the top of the trust tree with hardware-key 2FA (§5.7). `admin` takes the client IP from the socket only. |
| Chat arrives later than wanted | The identity seam ships in Phase 2, so chat plugs in without core changes. |

## 11. Questions for you (recommendation first)

**Q1. Domains.** Recommended: unset.sh replaces the 0x40 name.
- App at `unset.sh`, with chat later at `chat.unset.sh`.
- Handles on a **separate** registrable domain, the way Bluesky uses bsky.social for handles and bsky.app for the app.
- The PDS and media on a third domain. Reusing `0x40.space` for the PDS works if you're keeping it.
- Lexicons become `sh.unset.*`.
- **Decided by Alex (2026-10-02):** app `unset.sh`, PDS `unset.ac` in production (Alex buys it before production; `0x40.space` stays for development), handles `<user>.0x40.me`. **Evening amendments (Alex, 2026-10-02):** no account app, so no `account.<pds domain>` host (every account action is on the PDS's `/account`, §5.3); the media proxy moves to a cookie-less throwaway domain (review); the development PDS mints `.0x40.space` handles, never `.0x40.me` (review).
- **The PDS name is permanent once accounts exist:** every account's DID document points at it. So `unset.ac` is registered before the production PDS is set up (Phase 1), never swapped in later.
- Setup this needs: `PDS_SERVICE_HANDLE_DOMAINS=.0x40.me` on the production PDS only; wildcard DNS `*.0x40.me` to the edge; `/.well-known/atproto-did` on `*.0x40.me` routed to the PDS, everything else a 301 to `unset.sh/@<user>`; wildcard TLS via a delegated `_acme-challenge` zone; the reserved-label list on `0x40.me`; `PDS_RATE_LIMIT_BYPASS_IPS` for the app's internal address; CAA, DNSSEC and HSTS on every domain.
- **PDS on an unset.sh subdomain was considered and rejected (2026-10-02).** The atproto going-to-production guidance says to use separate domains for the PDS and the app, because OAuth pages and blobs on the app's site are a credential-theft risk. A subdomain like `login.unset.sh` is same-site with the app: the PDS serves raw `getBlob` user bytes on its own host whatever our proxy does, and same-site requests weaken the SameSite protection on its sign-in session. An entryway on `login.unset.sh` would avoid that but means building our own authorization server, since the PDS disables its own when behind one (`@atproto/pds` 0.5.36 `config.js`). So sign-in shows `unset.ac` in production, branded as unset.sh.
- `0x40.me` was the prototype's handle domain, so existing `*.0x40.me` handles collide with new accounts unless Q2a retires or migrates them first.

**Q2a. Existing accounts and data. Decided by Alex (2026-10-02 start fresh; 2026-10-03 decision 24: retire before Phase 1).** The prototype's own plan called its accounts disposable.
- **Decided by Alex (2026-10-03, decision 24): retire the old prototype accounts before Phase 1.** The old prototype PDS runs on `0x40.space`, the hostname the new development PDS takes in Phase 1, so old DIDs still pointing there would be answered by a PDS that has never seen them. A step before the development PDS install exports or notifies the old accounts, deactivates them, and removes the PDS from their DID documents (tombstone), then the hostname is reused. This settles review-list item 3 ("start fresh", provisional) as final; it cannot be undone once the DID documents change.
- Old accounts are retired on the old PDS (deactivated, then deleted) before the new production PDS issues `*.0x40.me` handles, so their DIDs no longer point at a live server and their `*.0x40.me` handles are free. Old handles re-registered by new accounts get new DIDs; bidirectional handle verification keeps other apps from linking them to the old ones.
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
- **Likes, comments and follows on a private account (proposal from the review, 2026-10-02; not yet an Alex decision):** the switches left these undefined. Proposed: (1) while "Posts and follows" is private, liking or replying to Bluesky posts is disabled with a one-line reason, because `app.bsky.feed.like` and a reply are public records naming the DID; (2) a private like, comment or follow on unset.sh content lives in the app DB and is shown to its target inside unset.sh ("a member liked this", "follows you"), and the user is told the author sees it, so it is not false privacy; (3) **public follows are mixed by target (Alex, 2026-10-03, decision 28, superseding the earlier "public follow = `app.bsky.graph.follow`"):** following an unset.sh account (one with an `sh.unset` profile record; refined in the step book) writes our own record, a new lexicon provisionally named `sh.unset.follow`, in the user's repo; following a Bluesky account writes an ordinary `app.bsky.graph.follow`; private follows stay inside unset.sh as before. The Following tab merges both kinds. Accepted cost: Bluesky's app does not show unset.sh-to-unset.sh follows. Alex's reasoning: public records should also be kept on our PDS unless the user interacts with a Bluesky account directly. The new lexicon and its `repo:` scope join the `sh.unset` permission set before it is first published (Phase 1), so no re-consent is needed; (4) flipping to public is a resumable batch (`applyWrites` ≤200 ops per call), not one request. A table of {post, follow, like-on-ours, like-on-Bluesky, comment-on-ours, comment-on-Bluesky} × {private, public} goes in the lexicon docs when Alex confirms.

**Q3. Web stack. Confirmed by Alex (2026-10-02): Hono.**
- **Hono + server-rendered React + islands (recommended).** Glue budgeted at 400–900 lines; Phase 1 exit at ~600 (§5.1).
- React Router 8 (the fallback; v7 is superseded), with one Astro spike day beside it (review, 2026-10-02).
- Next.js limited to route handlers.

**Q4. Chat. Decided by Alex (2026-10-02): a core feature.** Built in phase 6 on `chat.unset.sh`, DMs first, Matrix kept. **Evening decisions (Alex, 2026-10-02):** native client only; the branded Element Web fallback was dropped on 2026-10-03 (11, revised; §5.6); open for the phase reviews: who runs the Bluesky report forwarder and how the moderation account signs in (Phase 4 start), and how a MAS device is linked to the browser session (Phase 6 start); message requests are the invite only, no text until accepted (12); seeding in an isolated `chat-admin` service and `OnlySignedDevicesIsolationMode` from day one (13). Review fixes folded into §5.6: MAS consent screen with `login_hint` and end-session retry, no `X-Forwarded-For` to Synapse or MAS, Matrix reports in `admin`, the follow-gate protects our client only (said in the terms), `server_name` fixed in Phase 1, 5–7k lines.

**Q5. Public profile location.**
- **`unset.sh/@alice`, with handle hosts redirecting (recommended).**
- Serve it on the handle host for stricter origin isolation. Follow then needs a cross-site hop.

**Q6. Database.**
- **Postgres with per-role separation (recommended).**
- SQLite for the core, revisiting when plugins arrive.

**Q7. Drafts.**
- **Drafts in the app DB; only Publish writes to the repo (recommended).**
- Keep the prototype's behaviour with honest labels.

**Q8. Social features in the core:** posts, follows, timeline, likes, comments, directory. **Confirmed by Alex (2026-10-02).**
- **Yes (recommended)**, with RSS and MCP as later modules.

**Q9. Posts. Decided by Alex (2026-10-02):** our main post is a short, high-quality video (reels style, 60 seconds max) in our own lexicon. Users can also make other kinds of posts, including standard Bluesky posts. Standard.site is no longer the comparison point. See §5.8. **Evening amendments (Alex, 2026-10-02):** "also post to Bluesky" is an opt-in tick per post, default off (4; the review recommended on by default, since Bluesky renders only `app.bsky.*`); the repo blob is the stripped 1080p master, never the original (review); fingerprints via Arachnid Shield, local nudity gate, 365-day sealed hold (7, 8, 9); the unsure queue in `admin` (6); captions on every video, quotas and a daily cap (18, 19). **2026-10-03 (decision 30):** moderation is local-first; the Claude API review is out of v1 and nothing about a post leaves our servers for review.

**Q10. Hosting. Confirmed by Alex (2026-10-02): VPS for production, homelab for development.**
- **A small VPS for production, homelab for dev (recommended).**
- Keep the homelab with the Cloudflare Tunnel.
- **Provider: decide later, by Phase 5 (Alex, 2026-10-02, decision 14).** On the review list with the comparison: OVH Canada ~CAD 12–17/month vs 1984 Iceland ~€35–70/month; backups and audit need an Object Lock provider (Hetzner, B2, Wasabi), since R2 has none (§8 Phase 5).

**Q11. Design. Decided by Alex (2026-10-02):** all UI follows the **unset.sh design sheet** (the Design System artifact "unset.sh", https://claude.ai/artifact/78Sh5q9HGz74d5AQyMbQVt): Onyx/Platinum with Plum, Cyan and Emerald accents, Space Grotesk and JetBrains Mono, the ◉◉◉ mark, 2px corners with the cut button. Its `tokens.json` is the token source for the CSS Modules. New components may be added only if registered on the sheet with Alex's approval. The sheet currently uses Unicode characters in mono instead of an icon set; Iconoir may be integrated, which means registering it on the sheet first.

**Q12. License. Decided by Alex (2026-10-03, decision 27):** AGPL-3.0-only for the apps, MIT for the building blocks and the lexicon files. This settles the lexicons too, which were waiting on the code licence: they publish under MIT. Off the review list.
- **AGPL-3.0 (recommended).**
- MIT or Apache-2.0.

**Q13. Who may sign in. Decided by Alex (2026-10-02, decision 5): any atproto account from day one**, so Tap follows the public relay with collection filters from Phase 3 (§5.2). This closes the "indexer source as a setting" item that the first draft left provisional. The closed alternative (our PDS only, ~10 lines) was declined.

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

## Appendix B — What the 2026-10-02 adversarial review changed (eight reviewers; synthesis in `reviews/fable-review/`)

Alex's 19 decisions from the evening review are in the ADR; the fixes that needed no decision are in the text above with "(review, 2026-10-02)". In short:
- **Facts that had moved:** C-16 is law (one-year hold, transmission data); the PDS refuses OAuth for email change, delete and reactivate; Ozone cannot hold a draft or render our lexicon and signs moderators in with atproto OAuth; TypeScript 7 and Node 26 are current; React Router is v8; ASVS is 5.0; PhotoDNA is not a local tool.
- **Promises the systems could not keep, now rewritten:** the account app's scope (dropped), messages readable after a late first login (invite-only requests), the read-API role isolation (separate `api` process), the original video as a repo blob (1080p master), our feeds shown in other apps (withdrawn), hash matching with nothing leaving (hashes do leave, to C3P).
- **Size and sequence:** core 20–24k plus chat 5–7k plus tests; the review pipeline and the draft queue have rows; a closed test track from Phase 2; a severity-based launch gate with a month estimate; legal paperwork in Phase 1–2; the hosting choice in Phase 5.
- **Added requirements:** ASVS 5 L2, OWASP Top 10 2025, SLSA Build L2, WCAG 2.2 AA, a Core Web Vitals budget, Semgrep and ZAP, the invite-country rule, Law 25, aggregate metrics, captions, quotas, the nudity gate, the local text and gore gates (replacing the Anthropic review and its consent checkbox, decision 30) and the AI system record.
