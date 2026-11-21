# 0081 — Chat sign-in is minted by our servers: web signs a ticket, the door on unset.cc redeems it, chat-admin alone holds the MAS credential

Status: Accepted by Alex 2026-11-21 00:55Z: asked in the project chat whether he accepts this record as it stands, he
answered "yes" (P6.00, minimal chat build, 2026-11-21). Two parts are already Alex's decisions of 2026-11-20 in the
chat planning thread: a public door in front of `chat-admin` ("Accepted"), and third-party Matrix apps off at launch,
with no login provider in MAS. The reversal of PLAN §5.6 that server-minted sessions need is recorded as his by that
answer.

## Context
The accepted plan (PLAN §5.6 bullets 1 to 3; decision 13 in ADR 0001; step book P6.03, P6.04, P6.07) has the member
sign in to chat themselves: MAS shows its consent screen, `chat-auth` is an OIDC provider for MAS (`sub` = DID, about
340 lines and the `oidc-provider` package), MAS keeps an upstream link per member, and sign-out reaches MAS by
back-channel logout. It says seeding makes "no access token, device or encryption key", and that `chat-admin` has one
verb, `seed`, with `personal-sessions` "never added".

The 2026-11-20 spikes and the 2026-11-21 run (configs in `/mnt/project-files/chat-spike/round3/`) showed a simpler
path. MAS 1.26.0 mints a session for any user through its admin API, `POST /api/admin/v1/personal-sessions`
(`docs/api/spec.json`), and a full end-to-end encrypted matrix-js-sdk 43.0.0 client on such a session, scope
`urn:matrix:client:api:* urn:matrix:client:device:<ID>`, did cross-signing, secret storage, key backup and a second
device decrypting history. MAS served Synapse 1.162.0 with internal listeners only: one with `discovery`, `oauth`
and `health` for Synapse, one with `adminapi` for `chat-admin`; `human`, `graphql`, `assets` and `compat` were not
mounted and answered 404, and `adminapi` answered 404 on Synapse's listener. That settles item 1 of the build plan's
unverified list.

Also tested: an admin client can mint any scope for anyone, `urn:mas:admin` included; `/regenerate` left the old
token working for about two minutes; renewing on the same device ID must mint before it revokes, or the device is
deleted. Documented: without `expires_in` a token never expires (`CreatePersonalSessionRequest`, spec.json); a device
ID may hold only `a-z`, `A-Z`, `0-9` and `-` and needs at least 10 characters (MAS 1.26.0 `docs/reference/scopes.md`).

The security pass of 2026-11-20 (finding 1) found that redeeming at `chat-admin` would put the most powerful chat
credential on the public internet. The minimal version (build plan 2026-11-21) has no dock, so no sign-in ticket
ever sits on an unset.sh page. The step book still spells `chat.unset.sh`, `mas.unset.sh` and `chat-auth.unset.sh`;
ADR 0025 made chat `unset.cc`, and that record wins.

## Decision
1. **Our servers mint every chat session.** `chat-admin` calls `POST /api/admin/v1/personal-sessions` with the scope
   `urn:matrix:client:api:* urn:matrix:client:device:<ID>`, a constant in its code that it never takes from a caller,
   and always with `expires_in`. A new browser gets a new device ID of 10 random characters from A-Z0-9, made by
   `chat-admin`; a device ID is never reused once revoked. Renewal mints the new session on the same device ID first
   and only then revokes the old one. `/regenerate` is never called. Ending a browser's chat is
   `POST /api/admin/v1/personal-sessions/{id}/revoke`, which removes its device too.
2. **MAS has no public address and no login pages.** `passwords: { enabled: false }`, no `upstream_oauth2`, and the
   two internal listeners described above. The MAS admin API guide calls a public admin API "safe" (`admin-api.md`);
   we keep it internal anyway. With no way to log in, no third-party Matrix client can get a token.
3. **`web` is where identity comes from.** For the unset.cc sign-in it signs a ticket (the P2.14 identity seam):
   single use, at most 60 seconds, for audience `chat-admin`, naming the DID, the web session it came from and a
   one-time value that unset.cc set in the browser before the redirect, so a link cannot sign a browser into someone
   else's account (security pass finding 8). `web` keeps the DID to chat-ID mapping (ADR 0010) and queues "create
   chat account" in the signup transaction. It never holds a chat token or the MAS credential.
4. **The door is `interfaces/chat-auth`, repurposed, public on unset.cc.** It checks the one-time value, passes the
   ticket to `chat-admin`, and returns the token, who the member is and the browser's storage lock key (ADR 0083).
   It keeps the browser list and the lock keys, sealed with `infrastructure/seal`, in its own schema under its own
   database role. It sets unset.cc's own host-only `__Host-` cookie. It answers the chat page's lookups, such as a
   member's chat ID for the Message button, by asking `web` on the internal network, so ADR 0003's rule that a
   private member reads as missing stays in one place. It receives counts on a separate internal port (ADR 0082). It
   holds no MAS credential and no message key.
5. **`chat-admin` is internal and shaped like `pds-admin` (ADR 0060).** It is the only holder of the MAS admin client
   credential (client credentials grant, scope `urn:mas:admin`, the client listed in `policy.data.admin_clients`). It
   takes signed, single-use, short-lived envelopes through `shared/admin-envelope`, writes each `jti` before acting,
   keeps a quota per command, uses no third-party package and makes its outbound calls from one file. Its commands
   are fixed: create account, mint session, end sessions, and the three account calls of ADR 0084. A mint needs a
   ticket `web` signed; the door's own key may only end a session in its browser list.
6. **Networks.** The edge routes unset.cc to the chat page, `/_matrix/client/*` to Synapse and the door's paths to the
   door; nothing routes to MAS or `chat-admin`. Synapse reaches only MAS's Synapse listener and the door's count port.
   Only `chat-admin` reaches MAS's admin listener. Synapse and MAS each keep their own database and role.

Deferred to later records, with the pieces that need them: the dock in unset.sh and its renewal proof (finding 3),
passkeys, approve from another browser, reset and its allow-reset command, groups, media, export, the device list
and "new browser signed in" notices.

## Alternatives
- **Keep the accepted design: `chat-auth` as MAS's OIDC provider.** It works, but adds a consent screen MAS cannot
  skip, an OIDC provider of our own, upstream links and back-channel logout, all to reach the session the admin API
  mints directly. Declined.
- **Browsers redeem at `chat-admin`.** One process fewer, but the credential that can act as anyone becomes reachable
  from the internet (finding 1). Rejected.
- **The door holds the MAS credential.** Same exposure as the previous option, in a process that parses public input.
  Rejected.

## Consequences
- Supersedes, without editing them: PLAN §5.6's "no access token, device or encryption key is made for the user"
  (sessions, not keys, are now made by us), its MAS upstream link at seeding, its MAS consent step, `login_hint` and
  back-channel logout; decision 13's single verb `seed` (ADR 0001 log, PLAN §5.6 bullet 2); step book P6.03 (OIDC
  provider), P6.04's "`personal-sessions` ... never added", P6.07 (MAS consent) and the book's hostnames. Decision
  13's isolation of the MAS credential and `OnlySignedDevicesIsolationMode` stand.
- Personal sessions are a MAS admin feature used here as everyone's sign-in. Every MAS update reruns the sign-in tests
  before the pin moves (build plan, unverified item 8).
- A revoked token can keep working for about two minutes (spike). A hacked `web` can sign a new browser in as any
  member; that browser gets no message keys (isolation mode) but sees who the member talks to.
- The identity seam (P2.14) is not in the repository yet; it is built in this phase or lands first with Phase 2.
- The browser list and lock keys are personal data in the door's schema: they join `eraseDid` and the export (ADR 0084).

## Compliance
- Build step 2: startup checks refuse a MAS config with a public listener, a login resource, passwords on or an
  upstream provider; a test that MAS serves Synapse with internal listeners only.
- Build step 4: `chat-admin` tests for envelope rejection, replay, quotas, the constant scope, `expires_in`,
  mint-before-revoke, device ID format, and that no route takes a scope.
- dependency-cruiser's admin-service rows and the workspace check cover `chat-admin` as they cover `pds-admin`; the
  egress guard's exemption names its one outbound file.
- The edge refuses MAS, `/_synapse/admin` and `chat-admin` from the internet (P6.02a).

## Follow-up

2026-11-21: MAS pinned at 1.29.0 (Alex, 2026-11-21, 'use the latest version'), re-checked: `docs/api/spec.json`, `crates/handlers/src/admin/v1/personal_sessions/add.rs` and `revoke.rs`, and `docs/reference/scopes.md` (device ID rule) are identical to 1.26.0, so the minting, `expires_in`, the constant scope and the device ID format hold as written; `oauth2_sessions/list.rs` and `token.rs` changed only in tests or a refactor, and `policies/authorization_grant.rego` only in how it formats messages. Read from the v1.26.0 and v1.29.0 source trees on 2026-11-21; no live run of 1.29.0 was possible here (the image pull and the release binary download were both refused), so the 1.29.0 behaviour is unverified until the image test runs it.
