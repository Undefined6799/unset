-- phase: expand
-- Audit retention, part 1 of 2 (P1.15a; plan section 6 retention classes; admin design 7.3): the two tables the
-- retention and erasure functions of 0018 (P1.15f) write. Nothing writes them until then. Neither holds personal data.

SET ROLE audit_owner;

-- One segment per lane and calendar month (UTC), numbered YYYYMM. prev_hash is the hash before first_seq and
-- head_hash the row_hash of last_seq, so after a drop the rest of the chain verifies from this row. It holds no
-- personal data and stays after its rows are dropped.
CREATE TABLE audit.segment (
  lane text NOT NULL CHECK (lane IN ('mod', 'sec')),
  id int NOT NULL CHECK (id BETWEEN 200001 AND 999912),
  first_seq bigint NOT NULL CHECK (first_seq > 0),
  last_seq bigint NOT NULL,
  prev_hash bytea NOT NULL CHECK (octet_length(prev_hash) = 32),
  head_hash bytea NOT NULL CHECK (octet_length(head_hash) = 32),
  max_class_expiry timestamptz,
  sealed_at timestamptz NOT NULL,
  anchored_at timestamptz,
  dropped_at timestamptz,
  PRIMARY KEY (lane, id),
  CHECK (last_seq >= first_seq)
);

-- Why a body row is missing: one line per removed row, with the lane, the seq, the function that removed it and the
-- login role that called it. No personal data. It keeps the month only, never the instant: the rows of one erasure
-- would share an instant, and that would mark which events belonged to one person.
CREATE TABLE audit.redaction_log (
  lane text NOT NULL,
  seq bigint NOT NULL,
  part text NOT NULL CHECK (part IN ('redact', 'erase', 'drop')),
  month date NOT NULL DEFAULT (date_trunc('month', now() AT TIME ZONE 'UTC'))::date,
  by name NOT NULL,
  PRIMARY KEY (lane, seq)
);

GRANT SELECT ON audit.segment, audit.redaction_log TO auditor;

RESET ROLE;
