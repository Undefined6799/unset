# Rotating the OAuth client keys

The web server signs its OAuth client assertions with the keys in `OAUTH_CLIENT_KEYS` (a secret file: a JSON array of
private ES256 JWKs) and starts new logins with `OAUTH_ACTIVE_KID` (P2.04, ADR 0021). Each member's token set is bound
to the key it was made with (`app.oauth_session.client_kid`), and every refresh signs with that key
(@atproto/oauth-client 0.8.9, `oauth-client-auth.js`). A token set whose key is gone is deleted at its next refresh, and
that member signs in again.

## Planned rotation
1. Generate a new P-256 key with a new `kid` and add it to `OAUTH_CLIENT_KEYS`, keeping the old one. Deploy. The JWKS
   route (`/oauth/jwks.json`) now publishes both.
2. Set `OAUTH_ACTIVE_KID` to the new kid. Deploy. Only new logins use it.
3. Wait until no token set uses the old key:
   `SELECT count(*) FROM app.oauth_session WHERE client_kid = '<old kid>';`
   Refresh lifetimes run to months, so waiting out a fixed period is not enough.
4. Once the count is 0, remove the old key and deploy. If Alex accepts a forced re-login for the members still on it,
   the key may go earlier; they sign in again at their next request.

## A compromised key
Remove it at once and deploy; accept the forced re-login for every token set bound to it. Record the incident.
