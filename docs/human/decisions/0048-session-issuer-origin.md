# 0048 — The session row records the sign-in server's origin

Status: Accepted by Alex, 2026-11-15 23:29:47Z, against f30636e. The coordinator's project-chat post asked for the
line "accept ADR 0048 at f30636e", on the head it had reviewed; Alex replied with that line. He had approved the
feature at 23:15:56Z ("yes a b c", item b). From here the record changes only to be marked superseded.

## Context
The account page and the settings Account page show a link to the member's account on their sign-in server ("Your
account on ..."). The link must follow the issuer OAuth recorded at sign-in, never a DID-document field (P2.08b).
Today the only place that issuer is stored is inside the sealed OAuth token set, so each view of those pages reads
`app.oauth_session` and unseals the whole set, access token, refresh token and DPoP key included, to take one
string from it (`issuerOf`, `interfaces/http/compose.ts`). The whole-project review of 2026-11-15 (functionality
F6) counted this as one of the account page's avoidable round trips and as credentials handled on a read path that
needs none.

Sign-out already faces the same need once the token set is gone and solves it with a cookie that carries the
issuer's origin (`routes/sign-in-state.ts`).

## Decision
1. `app.session` gets a nullable column `issuer_origin text` (migration 0019; web's column grants are the
   migration after it, in their own pull request, because the trusted-base check requires that split). It holds the https origin of the
   issuer the OAuth library verified at the callback, in the form `issuerOrigin` (`routes/sign-in-state.ts`)
   returns; a database check keeps that form.
2. The callback writes it when it creates the session. Nothing updates it: web holds SELECT and INSERT on the
   column, not UPDATE. A new sign-in makes a new row.
3. The session read returns it, and the account pages use it for the link. When it is null (a session older than
   the column) they fall back to the token set as today, until those sessions expire (30 days at most).
4. The origin is not new personal data and has no retention of its own: it is the same value the sealed token set
   and the sign-out cookie already hold, and it is deleted with its session row on sign-out, expiry,
   `app.end_sessions_for_did` and erasure (`app.session.did` is `delete_row` in the erasure registry).

## Alternatives
- **Leave it.** One extra query and one unseal per account page view. Works, but every later page that needs the
  issuer copies the pattern and touches the credentials again.
- **A plain `iss` column on `app.oauth_session`.** One row per DID, so no duplication across a member's browsers.
  Not chosen: the page would still need a second query on a second table, and the library's session store owns
  that table's shape (`infrastructure/postgres/oauthStores.ts`), so a side column there has to be kept in step
  with every write the library makes.
- **Carry it in a cookie, as sign-out does.** No schema change. Not chosen: a cookie is client-held input that must
  be re-checked on every read, where the row is written once by the server from a verified value.

## Consequences
- One nullable column and two column grants on a table the trusted base owns; the column is unsealed, like `did`.
- A member's sessions on several browsers each store the origin. It can differ between them only if they signed in
  through different issuers, which is the fact each row is meant to record.
- Until old sessions expire the fallback read stays; removing it is a later contract step, not part of this.
- The origin is readable to anyone who can read `app.session` (the `web` role). It names the member's PDS host,
  which their DID document already publishes.

## Compliance
`infrastructure/postgres/grant-matrix.json` gets `app.session.issuer_origin` (SELECT, INSERT for `web`) with the
grant migration, checked against the live grants by `tests/integration/postgres/grants.test.ts`. The store and page
tests land with the PRs that use the column (P2.03o, P2.13f).
