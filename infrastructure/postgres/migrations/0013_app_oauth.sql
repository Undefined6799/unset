-- phase: expand
-- The OAuth client's stores (P2.04; plan section 5.3 "OAuth client"): the in-flight authorization state (PKCE verifier,
-- DPoP key) and each member's token set. Both values are sealed (P1.14), bound to their row by the seal context
-- (sealed-columns.json), so a database dump yields no usable token and a value copied to another row does not open.
-- infrastructure/postgres/oauthStores.ts reads and writes them; every time comparison uses the database clock.
CREATE TABLE app.oauth_state (
  key text PRIMARY KEY,
  sealed types.sealed NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE app.oauth_session (
  did types.did PRIMARY KEY,
  sealed types.sealed NOT NULL,
  -- The OAuth client key id the token set is bound to; not secret. Read only by the key-rotation runbook.
  client_kid text NOT NULL,
  updated_at timestamptz NOT NULL
);

-- web creates, reads, replaces and deletes both; no other role holds anything on them. oauth_session.did has an
-- erasure row, so its grants are column lists (02-shared-blocks section 11); oauth_state gets the same form.
GRANT SELECT (key, sealed, expires_at), INSERT (key, sealed, expires_at), UPDATE (sealed, expires_at)
  ON app.oauth_state TO web;
GRANT DELETE ON app.oauth_state TO web;
GRANT SELECT (did, sealed, client_kid, updated_at), INSERT (did, sealed, client_kid, updated_at),
  UPDATE (sealed, client_kid, updated_at) ON app.oauth_session TO web;
GRANT DELETE ON app.oauth_session TO web;
