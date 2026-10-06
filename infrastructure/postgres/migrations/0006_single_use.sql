-- phase: expand
-- The durable single-use store (P1.16; plan section 2 rule 6, section 5.2 jti replay). A token that must work once is
-- consumed by one UPDATE, so a replay, a race or a restart cannot make it work twice. `id` is sha256 of the token for
-- an issued one, or of purpose, issuer and external id for a claimed one; the raw token is never stored.
CREATE TABLE app.single_use (
  id bytea PRIMARY KEY CHECK (octet_length(id) = 32),
  purpose text NOT NULL,
  bind_did types.did,
  bind_extra bytea,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- query: infrastructure/postgres/singleUse/store.ts:sweep
-- why: speed
CREATE INDEX single_use_expires_at ON app.single_use (expires_at);

-- bind_did has an erasure row, so every grant is a column list (02-shared-blocks section 11). web issues, consumes and
-- claims; retention sweeps (P1.16g gave it the schema). api has none: its jti table is idx.jti_seen (P3.11).
GRANT SELECT (id, purpose, bind_did, bind_extra, expires_at, consumed_at) ON app.single_use TO web;
GRANT INSERT (id, purpose, bind_did, bind_extra, expires_at, consumed_at) ON app.single_use TO web;
GRANT UPDATE (consumed_at) ON app.single_use TO web;
GRANT SELECT (expires_at) ON app.single_use TO retention;
GRANT DELETE ON app.single_use TO retention;
