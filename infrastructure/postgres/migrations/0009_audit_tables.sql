-- phase: expand
-- The audit store, part 2 of 3 (P1.15d; plan section 5.7, admin design sections 7.1 to 7.4 and 8.1): the tables, their
-- seeds and the append-only triggers, created as audit_owner. Personal fields sit in side rows with their own MAC keys,
-- so a side row can later be erased (P1.15a) without breaking the chain. 0008 holds the functions; 0010 (P1.15g) lets
-- the writers call audit.append.

SET ROLE audit_owner;

CREATE TABLE audit.retention_classes (
  class text PRIMARY KEY,
  keep interval NOT NULL,
  counted_from text NOT NULL CHECK (counted_from IN ('event', 'case_close'))
);
INSERT INTO audit.retention_classes (class, keep, counted_from) VALUES
  ('mod_action', '2 years', 'event'),
  ('mod_decision', '1 year', 'case_close'),
  ('security', '1 year', 'event'),
  ('pii_admin', '2 years', 'event');

-- The closed list of actions. The writing role must be one of the action's writers; the lane comes from here, never
-- from a caller. Later steps add actions by migration.
CREATE TABLE audit.actions (
  action text PRIMARY KEY,
  lane text NOT NULL CHECK (lane IN ('mod', 'sec')),
  writers name[] NOT NULL,
  retention_class text NOT NULL REFERENCES audit.retention_classes,
  rate_class text NOT NULL CHECK (rate_class IN ('user_triggered', 'operator', 'system'))
);
INSERT INTO audit.actions (action, lane, writers, retention_class, rate_class) VALUES
  ('mod.delist', 'mod', '{admin}', 'mod_action', 'operator'),
  ('mod.undelist', 'mod', '{admin}', 'mod_action', 'operator'),
  ('mod.takedown', 'mod', '{admin}', 'mod_action', 'operator'),
  ('mod.reinstate', 'mod', '{admin}', 'mod_action', 'operator'),
  ('mod.sessions_ended', 'mod', '{admin}', 'mod_action', 'operator'),
  ('pii.email_reveal', 'mod', '{admin}', 'mod_action', 'operator'),
  ('hold.created', 'mod', '{admin}', 'mod_action', 'operator'),
  ('hold.executed', 'mod', '{admin}', 'mod_action', 'operator'),
  ('mod.decision', 'mod', '{admin}', 'mod_decision', 'operator'),
  ('report.submitted', 'sec', '{web}', 'security', 'user_triggered'),
  ('age_gate.blocked', 'sec', '{web}', 'security', 'user_triggered'),
  ('index.account_state', 'sec', '{indexer}', 'security', 'system'),
  ('account.erased', 'sec', '{indexer,admin}', 'security', 'system'),
  ('pii.review_play', 'mod', '{admin}', 'mod_action', 'operator'),
  ('csam.suspected', 'mod', '{review,review_egress}', 'mod_action', 'system');

-- The closed reason list (admin design section 7.4, plus the codes P2.12, the Arachnid classification and P3.07 pass).
CREATE TABLE audit.reasons (reason text PRIMARY KEY);
INSERT INTO audit.reasons (reason) VALUES
  ('spam'), ('impersonation'), ('illegal_content'), ('harassment'), ('legal_order'), ('user_request_gdpr'),
  ('security_incident'), ('support_request'), ('csam'), ('underage'), ('age_gate_hosted'),
  ('harmful-abusive-material'), ('account_deleted'), ('moderator_foreign'), ('user_request'), ('legal_hold_closed');

-- One row per event, per lane. It holds no personal data: body_mac covers the body row, and row_hash covers this row.
CREATE TABLE audit.chain (
  lane text NOT NULL CHECK (lane IN ('mod', 'sec')),
  seq bigint NOT NULL CHECK (seq > 0),
  ts timestamptz NOT NULL,
  action text NOT NULL REFERENCES audit.actions,
  writer name NOT NULL,
  retention_class text NOT NULL REFERENCES audit.retention_classes,
  body_mac bytea NOT NULL CHECK (octet_length(body_mac) = 32),
  prev_hash bytea NOT NULL CHECK (octet_length(prev_hash) = 32),
  row_hash bytea NOT NULL CHECK (octet_length(row_hash) = 32),
  PRIMARY KEY (lane, seq)
);

-- query: infrastructure/postgres/migrations/0008_audit.sql:audit.append
-- why: speed
CREATE INDEX chain_writer_ts ON audit.chain (writer, ts);

-- subject is the event's target DID (null when none). body_text is the exact text that was MACed, so the MAC never
-- depends on Postgres printing jsonb the same way after an upgrade.
CREATE TABLE audit.event_body (
  lane text NOT NULL,
  seq bigint NOT NULL,
  subject types.did,
  k_body bytea NOT NULL,
  body_text text NOT NULL,
  PRIMARY KEY (lane, seq),
  FOREIGN KEY (lane, seq) REFERENCES audit.chain
);

-- Append-only, even for the owner: audit.refuse_change (0008) refuses every UPDATE, DELETE and TRUNCATE.
CREATE TRIGGER chain_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON audit.chain
  FOR EACH STATEMENT EXECUTE FUNCTION audit.refuse_change();
CREATE TRIGGER event_body_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON audit.event_body
  FOR EACH STATEMENT EXECUTE FUNCTION audit.refuse_change();

-- auditor reads the chain only, never a body row (the daily links check, P3.22).
GRANT SELECT ON audit.chain TO auditor;

RESET ROLE;
