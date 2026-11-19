# Sign-in and onboarding

A member signs in with an account on our PDS, then passes an age check (16 and over), the terms and a confirmed email. The last onboarding step is a placeholder.

## Route

All of these live under [`interfaces/web/src/routes/`](../../../interfaces/web/src/routes).

- `login/` starts sign-in. `login/continue/` sends the browser on to the authorization server. The sign-in page uses the bare shell.
- `oauth/callback/` turns a grant into a session, for the browser that started it.
- `oauth/jwks.json` publishes the client's public keys. `oauth-client-metadata.json` publishes the client metadata.
- `verify-email/` is the confirmed-email step.
- `welcome/` sends the member to the step they are on. `welcome/age/`, `welcome/terms/` and `welcome/chat/` are those steps. `welcome/blocked/` is the under-16 block.
- `logout/` ends this browser's session. `logout/everywhere/` ends every session for the member.
- `me/` redirects a signed-in member to `/<DID>`.
- `signed-out/` points at the sign-in server after sign-out.
- `invite/` is where a member asks for a one-use sign-up code and sees join links from the last 7 days. The app gate applies: onboarding done, and a confirmed email.
- `join/` is the page an invite link opens (`/join?invite=<code>`). Anyone may read it. The form starts a sign-up at our PDS. The code is checked by the PDS's sign-up form.

## Operation

The work is in [`interfaces/web/src/lib/server/`](../../../interfaces/web/src/lib/server).

- [`sign-in.ts`](../../../interfaces/web/src/lib/server/sign-in.ts) chooses the account and starts authorization. It does not create a session. From `/join` it starts a sign-up (`startSignUp`) the same way.
- [`sign-in-state.ts`](../../../interfaces/web/src/lib/server/sign-in-state.ts) holds the browser's sign-in cookies, including the `__Host-` nonce.
- [`sign-in-lock.ts`](../../../interfaces/web/src/lib/server/sign-in-lock.ts) keeps one sign-in at a time for an account.
- [`oauth-callback.ts`](../../../interfaces/web/src/lib/server/oauth-callback.ts) checks the grant and creates the session.
- [`session.ts`](../../../interfaces/web/src/lib/server/session.ts) reads the `__Host-sid` cookie.
- [`app-gate.ts`](../../../interfaces/web/src/lib/server/app-gate.ts) runs after the session: onboarding, then a confirmed email. The welcome and verify-email pages skip it, because that is where it sends people.
- [`welcome.ts`](../../../interfaces/web/src/lib/server/welcome.ts) decides which step a member is on. An under-16 answer blocks the account.
- [`email-refresh.ts`](../../../interfaces/web/src/lib/server/email-refresh.ts) asks the PDS again when the cached email confirmation is stale.
- [`age-gate-audit.ts`](../../../interfaces/web/src/lib/server/age-gate-audit.ts) writes the audit row for an under-16 block, in the block's own transaction.
- [`invite-audit.ts`](../../../interfaces/web/src/lib/server/invite-audit.ts) writes the audit row when pds-admin refuses a member.
- [`sign-out.ts`](../../../interfaces/web/src/lib/server/sign-out.ts) ends this browser's session, or every session.

[`routes/welcome/onboarding.server.ts`](../../../interfaces/web/src/routes/welcome/onboarding.server.ts) is the shared helper for the onboarding pages.

`welcome/chat` is a placeholder. Continuing calls `finishChat`, which marks onboarding done. The page's comment says P6.17 replaces it. Nothing here sets up chat.

## Domain rules

[`domains/identity/`](../../../domains/identity) holds the decisions. The web process turns them into redirects.

- [`auth/age.ts`](../../../domains/identity/auth/age.ts) judges the date. The date is not stored.
- [`auth/gates.ts`](../../../domains/identity/auth/gates.ts) decides the confirmed-email gate.
- [`verify-handle.ts`](../../../domains/identity/verify-handle.ts) checks a handle and a DID in both directions.
- [`resolve-handle.ts`](../../../domains/identity/resolve-handle.ts) and [`resolve-did.ts`](../../../domains/identity/resolve-did.ts) resolve a handle and a DID document. An outage is `unavailable`, not "no such account".
- [`did-doc.ts`](../../../domains/identity/did-doc.ts) reads the atproto fields of a DID document. It does not decide the handle.
- [`legal/versions.ts`](../../../domains/identity/legal/versions.ts) names the terms and privacy versions the gate compares.
- [`invites.ts`](../../../domains/identity/invites.ts) makes one form submission one request and one stored row. `joinCode` accepts a code of letters, digits and dashes, at most 64 characters. The PDS sign-up form is what checks it.

## Adapter

- [`infrastructure/pds/oauth/`](../../../infrastructure/pds/oauth) is the OAuth client, its scopes and the identity resolvers. Tokens are DPoP-bound.
- [`infrastructure/session/`](../../../infrastructure/session) stores browser sessions. A row is keyed by the hash of the cookie.
- [`infrastructure/postgres/accountRepository.ts`](../../../infrastructure/postgres/accountRepository.ts) and [`accountStore.ts`](../../../infrastructure/postgres/accountStore.ts) hold the account and its onboarding state. [`oauthStores.ts`](../../../infrastructure/postgres/oauthStores.ts) holds sealed OAuth state and token sets. [`singleUse/`](../../../infrastructure/postgres/singleUse) holds single-use nonces. [`inviteStore.ts`](../../../infrastructure/postgres/inviteStore.ts) holds a member's invites. The code is sealed. A sweep clears a code 7 days after it was made.
- [`infrastructure/net-guard/`](../../../infrastructure/net-guard) is the check on every outbound request.
- [`infrastructure/seal/`](../../../infrastructure/seal) seals tokens at rest.
- [`infrastructure/audit/`](../../../infrastructure/audit) takes the audit rows.

## Tables and grants

Migrations are in [`infrastructure/postgres/migrations/`](../../../infrastructure/postgres/migrations). Roles and the grant matrix are [`roles.json`](../../../infrastructure/postgres/roles.json) and [`grant-matrix.json`](../../../infrastructure/postgres/grant-matrix.json).

- `app.session` (0011, 0012, 0019, 0020). `web` is the only role with table grants. The cookie hash is the key.
- `app.oauth_state` and `app.oauth_session` (0013). `web` is the only role.
- `app.end_sessions_for_did` (0014) ends a member's sessions. `web` and `indexer` may execute it. `indexer` has no grant on the session tables (0027).
- `app.account` holds onboarding state (0015). `privacy_notice_seen_version` (0032) is the privacy notice version a member dismissed the banner for. `privacy_version` still holds what the terms step accepted. `web` may select and update `privacy_notice_seen_version`, and the column has no insert grant.
- `app.invite` (0033) is one row per invite a member asked for. The code is sealed. `web` may select every column, insert `id`, `inviter_did`, `submission_id`, `state` and `created_at`, update `state`, `sealed_code` and `hidden_at`, and delete a row. No other role has a grant. The same migration records the `invite.denied` audit action.
- `app.single_use` holds nonces (0006, 0023).
- Audit is 0008 to 0010 and 0016 to 0018.

Finishing onboarding queues the member for indexing. `finishChat` sets `app.account.onboarding` to `done` and inserts `idx.track_request` in the same transaction (0026). See [public indexing](public-indexing.md).

## Tests

Integration: [`tests/integration/web/sign-in.test.ts`](../../../tests/integration/web/sign-in.test.ts), [`sign-out.test.ts`](../../../tests/integration/web/sign-out.test.ts), [`gate.test.ts`](../../../tests/integration/web/gate.test.ts), [`welcome/onboarding.test.ts`](../../../tests/integration/web/welcome/onboarding.test.ts), [`welcome/account-row.test.ts`](../../../tests/integration/web/welcome/account-row.test.ts), [`app/invite.test.ts`](../../../tests/integration/web/app/invite.test.ts), [`tests/integration/oauth/refresh.test.ts`](../../../tests/integration/oauth/refresh.test.ts), [`tests/integration/session/store.test.ts`](../../../tests/integration/session/store.test.ts), [`tests/integration/postgres/oauth-stores.test.ts`](../../../tests/integration/postgres/oauth-stores.test.ts), [`account-store.test.ts`](../../../tests/integration/postgres/account-store.test.ts), [`invite-store.test.ts`](../../../tests/integration/postgres/invite-store.test.ts), [`single-use.test.ts`](../../../tests/integration/postgres/single-use.test.ts).

Unit tests sit beside the server files, `domains/identity/`, `infrastructure/pds/oauth/` and `infrastructure/session/`.

## When it is off or replaced

There is no switch. Without a session, the public pages still answer and the rest of the app sends the browser to sign in.
