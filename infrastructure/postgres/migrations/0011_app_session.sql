-- phase: expand
-- The browser session table (P2.03x; plan section 5.3 "Sessions"; architecture record 2026-10-07
-- p203-session-store-trusted). A row maps sha256 of the 32-byte cookie id to a DID; the raw id is never stored. The
-- store (P2.03, infrastructure/postgres/session/) reads, touches, rotates and sweeps it; every time comparison uses
-- the database clock.
CREATE TABLE app.session (
  id_hash bytea PRIMARY KEY CHECK (octet_length(id_hash) = 32),
  did types.did NOT NULL,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  -- A cache of the PDS's emailConfirmed (P2.11); null until checked.
  email_confirmed boolean,
  email_checked_at timestamptz
);

-- did has an erasure row, so every grant is a column list (02-shared-blocks section 11). web creates, reads, touches
-- and sweeps sessions; no other role holds anything on the table.
GRANT SELECT (id_hash, did, created_at, last_seen_at, absolute_expires_at, email_confirmed, email_checked_at)
  ON app.session TO web;
GRANT INSERT (id_hash, did, created_at, last_seen_at, absolute_expires_at) ON app.session TO web;
GRANT UPDATE (last_seen_at, email_confirmed, email_checked_at) ON app.session TO web;
GRANT DELETE ON app.session TO web;
