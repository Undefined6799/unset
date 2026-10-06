-- phase: expand
-- The audit lanes (P1.15m; plan section 5.7, admin design sections 7.1 to 7.4 and 8.1). Moderation and security events
-- are written only through audit.append, which stamps the writing role itself and chains each row to the previous one
-- in its lane by a hash over the row's own metadata. Personal fields sit in side rows with their own MAC keys, so a
-- side row can later be erased (P1.15a) without breaking the chain. User sign-ins are never audited (plan section 6).

-- audit_owner creates every object below, so it needs to resolve types.did and call pgcrypto (installed in public at
-- initdb). USAGE grants nothing inside either schema.
GRANT USAGE ON SCHEMA types TO audit_owner;
GRANT USAGE ON SCHEMA public TO audit_owner;

SET ROLE audit_owner;

-- No routine audit_owner creates is executable by PUBLIC (0003 does the same for migrator).
ALTER DEFAULT PRIVILEGES FOR ROLE audit_owner REVOKE EXECUTE ON ROUTINES FROM PUBLIC;

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

-- One row per event, per lane. It holds no personal data: the MACs cover the side rows, and row_hash covers this row.
CREATE TABLE audit.chain (
  lane text NOT NULL CHECK (lane IN ('mod', 'sec')),
  seq bigint NOT NULL CHECK (seq > 0),
  ts timestamptz NOT NULL,
  action text NOT NULL REFERENCES audit.actions,
  writer name NOT NULL,
  retention_class text NOT NULL REFERENCES audit.retention_classes,
  body_mac bytea NOT NULL CHECK (octet_length(body_mac) = 32),
  pii_mac bytea NOT NULL CHECK (octet_length(pii_mac) = 32),
  prev_hash bytea NOT NULL CHECK (octet_length(prev_hash) = 32),
  row_hash bytea NOT NULL CHECK (octet_length(row_hash) = 32),
  PRIMARY KEY (lane, seq)
);

-- query: infrastructure/postgres/migrations/0007_audit.sql:audit.append
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

-- subject is the person whose data the row holds: for tailnet_ip, the acting admin, not the target.
CREATE TABLE audit.event_pii (
  lane text NOT NULL,
  seq bigint NOT NULL,
  subject types.did NOT NULL,
  k_pii bytea NOT NULL,
  pii_text text NOT NULL,
  PRIMARY KEY (lane, seq),
  FOREIGN KEY (lane, seq) REFERENCES audit.chain
);

-- lp(x): the 2-byte big-endian byte length of the UTF-8 text, then its bytes. The chain's text columns are short
-- (lane, action, a role name of at most 63 bytes, a retention class), far below 65 535 bytes.
CREATE FUNCTION audit.lp(x text) RETURNS bytea
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN substring(pg_catalog.int4send(pg_catalog.octet_length(pg_catalog.convert_to(x, 'UTF8'))) FROM 3 FOR 2)
    || pg_catalog.convert_to(x, 'UTF8');

-- row_hash = sha256("unset.audit.v1" || 0x00 || lp(lane) || u64be(seq) || i64be(ts in microseconds since the Unix
-- epoch) || lp(action) || lp(writer) || lp(retention_class) || prev_hash || body_mac || pii_mac). Every chain column is
-- in it, so editing one (a relabelled action, a moved time, an early-redaction trick through retention_class) breaks
-- the chain even after the side rows are gone. infrastructure/audit/rowHash.ts (P1.15) computes the same bytes.
CREATE FUNCTION audit.row_hash(
  lane text, seq bigint, ts timestamptz, action text, writer name, retention_class text,
  prev_hash bytea, body_mac bytea, pii_mac bytea
) RETURNS bytea
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN pg_catalog.sha256(
    pg_catalog.convert_to('unset.audit.v1', 'UTF8') || '\x00'::bytea
    || audit.lp(lane) || pg_catalog.int8send(seq)
    || pg_catalog.int8send((EXTRACT(epoch FROM ts) * 1000000)::bigint)
    || audit.lp(action) || audit.lp(writer::text) || audit.lp(retention_class)
    || prev_hash || body_mac || pii_mac
  );

-- The one way in. The writer is the session's login role, stamped here; p_actor_did and p_actor_key are what that
-- process asserts about the human, which the database cannot verify. Errors are fixed words with SQLSTATE class UA,
-- and any of them rolls back the caller's transaction (admin design 7.2: a failed `attempted` write means stop).
CREATE FUNCTION audit.append(
  p_action text, p_outcome text, p_actor_did types.did, p_actor_key text, p_target types.did, p_reason text,
  p_case uuid, p_jti text, p_request_id uuid, p_receipt bytea, p_pii jsonb
) RETURNS TABLE (lane text, seq bigint, row_hash bytea)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, audit
  SET lock_timeout = '2s'
AS $$
#variable_conflict use_column
DECLARE
  w name := session_user;
  a audit.actions;
  caps CONSTANT jsonb := '{"user_triggered": 300, "system": 600, "operator": 120}';
  v_seq bigint;
  v_prev bytea;
  v_ts timestamptz;
  v_body text;
  v_k_body bytea := public.gen_random_bytes(32);
  v_body_mac bytea;
  v_pii text;
  v_k_pii bytea := public.gen_random_bytes(32);
  v_pii_mac bytea;
  v_hash bytea;
  v_since timestamptz;
BEGIN
  -- 1. The action exists and this role may write it.
  SELECT * INTO a FROM audit.actions x WHERE x.action = p_action;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit_unknown_action' USING ERRCODE = 'UA001';
  END IF;
  IF NOT w = ANY (a.writers) THEN
    RAISE EXCEPTION 'audit_writer_denied' USING ERRCODE = 'UA002';
  END IF;

  -- 2. Typed fields only: nothing free-text reaches the record.
  IF p_outcome IS NULL OR p_outcome NOT IN ('attempted', 'succeeded', 'failed', 'denied', 'unknown')
    OR (p_reason IS NOT NULL AND NOT EXISTS (SELECT 1 FROM audit.reasons r WHERE r.reason = p_reason))
    OR (p_jti IS NOT NULL AND p_jti !~ '^[A-Za-z0-9_-]{22}$')
    OR (p_actor_key IS NOT NULL AND (p_actor_key !~ '^[A-Za-z0-9_-]+$' OR length(p_actor_key) > 1366))
    OR (p_receipt IS NOT NULL AND octet_length(p_receipt) <> 32) THEN
    RAISE EXCEPTION 'audit_bad_input' USING ERRCODE = 'UA003';
  END IF;
  -- No PII yet: the one booked field, the acting admin's tailnet address (P1a-A1), waits for Alex's answer, then
  -- comes back with its own ip-columns allow entry (architecture record 2026-10-06-p115m-tailnet-pii-deferred). The
  -- side table and its insert path below stay, so that change only replaces this check.
  IF p_pii IS NOT NULL THEN
    RAISE EXCEPTION 'audit_bad_input' USING ERRCODE = 'UA003';
  END IF;

  -- 3. A cap per writer and rate class over the last minute, so one class's flood cannot block another. The bound
  -- is a variable, not clock_timestamp() itself, so the (writer, ts) index can range-scan it (a volatile call cannot
  -- bound an index scan).
  v_since := clock_timestamp() - interval '1 minute';
  IF (SELECT count(*) FROM audit.chain c JOIN audit.actions x ON x.action = c.action
       WHERE c.writer = w AND x.rate_class = a.rate_class AND c.ts > v_since)
     >= (caps ->> a.rate_class)::int THEN
    RAISE EXCEPTION 'audit_rate_limited' USING ERRCODE = 'UA004';
  END IF;

  -- 4. One writer at a time per lane, so seqs stay contiguous.
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || a.lane));

  -- 5. The previous link, or 32 zero bytes at genesis.
  SELECT c.seq, c.row_hash INTO v_seq, v_prev FROM audit.chain c WHERE c.lane = a.lane ORDER BY c.seq DESC LIMIT 1;
  v_seq := coalesce(v_seq, 0) + 1;
  v_prev := coalesce(v_prev, '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea);
  v_ts := date_trunc('microseconds', clock_timestamp());

  -- 6. The body, MACed exactly as stored.
  v_body := jsonb_strip_nulls(jsonb_build_object(
    'ts', v_ts, 'writer', w, 'actor', p_actor_did, 'actor_key', p_actor_key, 'action', p_action,
    'outcome', p_outcome, 'target', p_target, 'reason', p_reason, 'case', p_case, 'jti', p_jti,
    'request', p_request_id, 'receipt', encode(p_receipt, 'hex')))::text;
  v_body_mac := public.hmac(convert_to(v_body, 'UTF8'), v_k_body, 'sha256');

  -- 7. PII, when there is any; otherwise the MAC of nothing under a key nobody keeps.
  IF p_pii IS NOT NULL THEN
    v_pii := p_pii::text;
    v_pii_mac := public.hmac(convert_to(v_pii, 'UTF8'), v_k_pii, 'sha256');
  ELSE
    v_pii_mac := public.hmac(''::bytea, public.gen_random_bytes(32), 'sha256');
  END IF;

  -- 8. Link and write.
  v_hash := audit.row_hash(a.lane, v_seq, v_ts, p_action, w, a.retention_class, v_prev, v_body_mac, v_pii_mac);
  INSERT INTO audit.chain (lane, seq, ts, action, writer, retention_class, body_mac, pii_mac, prev_hash, row_hash)
    VALUES (a.lane, v_seq, v_ts, p_action, w, a.retention_class, v_body_mac, v_pii_mac, v_prev, v_hash);
  INSERT INTO audit.event_body (lane, seq, subject, k_body, body_text) VALUES (a.lane, v_seq, p_target, v_k_body, v_body);
  IF p_pii IS NOT NULL THEN
    INSERT INTO audit.event_pii (lane, seq, subject, k_pii, pii_text) VALUES (a.lane, v_seq, p_actor_did, v_k_pii, v_pii);
  END IF;
  RETURN QUERY SELECT a.lane, v_seq, v_hash;
END
$$;

-- Append-only, even for the owner: one statement-level trigger per table (PostgreSQL 18 runs TRUNCATE triggers only
-- FOR EACH STATEMENT; architecture ruling 2026-10-06 23:10Z), so a zero-row UPDATE is refused too. P1.15a's redaction
-- and segment functions add their one exception (the audit.maintenance setting) when they land. migrator, acting as the owner, can drop the triggers; P3.22's
-- off-box chain-head anchor answers that.
CREATE FUNCTION audit.refuse_change() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'audit is append-only' USING ERRCODE = 'UA005';
END
$$;

CREATE TRIGGER chain_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON audit.chain
  FOR EACH STATEMENT EXECUTE FUNCTION audit.refuse_change();
CREATE TRIGGER event_body_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON audit.event_body
  FOR EACH STATEMENT EXECUTE FUNCTION audit.refuse_change();
CREATE TRIGGER event_pii_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON audit.event_pii
  FOR EACH STATEMENT EXECUTE FUNCTION audit.refuse_change();

-- The writers of P1.15's actions call append; review and review_egress get it with their phase (P4.07). auditor reads
-- the chain only, never a side row (the daily links check, P3.22).
GRANT EXECUTE ON FUNCTION audit.append(text, text, types.did, text, types.did, text, uuid, text, uuid, bytea, jsonb)
  TO web, indexer, admin;
GRANT SELECT ON audit.chain TO auditor;

RESET ROLE;
