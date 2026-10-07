-- phase: expand
-- The audit store, part 1 of 3 (P1.15m; plan section 5.7, admin design sections 7.1 to 7.4 and 8.1): what audit_owner
-- needs to create it, and its functions. Moderation and security events are written only through audit.append, which
-- stamps the writing role itself and chains each row to the previous one in its lane by a hash over the row's own
-- metadata. The tables follow in 0009 (P1.15d) and the writers' EXECUTE grants in 0010 (P1.15g); until then nothing
-- can call append (step book record 2026-10-06-p115m-tailnet-deferral-steps). User sign-ins are never audited (plan
-- section 6).

-- audit_owner creates every audit object, so it needs to resolve types.did and call pgcrypto (installed in public at
-- initdb). USAGE grants nothing inside either schema.
GRANT USAGE ON SCHEMA types TO audit_owner;
GRANT USAGE ON SCHEMA public TO audit_owner;

SET ROLE audit_owner;

-- No routine audit_owner creates is executable by PUBLIC (0003 does the same for migrator). It comes before every
-- CREATE FUNCTION below, which run as audit_owner (architecture record 2026-10-06-p115m-tailnet-pii-deferred, (i)).
ALTER DEFAULT PRIVILEGES FOR ROLE audit_owner REVOKE EXECUTE ON ROUTINES FROM PUBLIC;

-- The functions name the audit tables only inside plpgsql bodies, which resolve them when called, never in a signature,
-- a row type or a LANGUAGE sql body, which resolve at CREATE (same record, (ii)).

-- lp(x): the 2-byte big-endian byte length of the UTF-8 text, then its bytes. The chain's text columns are short
-- (lane, action, a role name of at most 63 bytes, a retention class), far below 65 535 bytes.
CREATE FUNCTION audit.lp(x text) RETURNS bytea
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN substring(pg_catalog.int4send(pg_catalog.octet_length(pg_catalog.convert_to(x, 'UTF8'))) FROM 3 FOR 2)
    || pg_catalog.convert_to(x, 'UTF8');

-- row_hash = sha256("unset.audit.v1" || 0x00 || lp(lane) || u64be(seq) || i64be(ts in microseconds since the Unix
-- epoch) || lp(action) || lp(writer) || lp(retention_class) || prev_hash || body_mac). Every chain column is in it, so
-- editing one (a relabelled action, a moved time, an early-redaction trick through retention_class) breaks the chain
-- even after the body row is gone. infrastructure/audit/rowHash.ts (P1.15) computes the same bytes.
CREATE FUNCTION audit.row_hash(
  lane text, seq bigint, ts timestamptz, action text, writer name, retention_class text,
  prev_hash bytea, body_mac bytea
) RETURNS bytea
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN pg_catalog.sha256(
    pg_catalog.convert_to('unset.audit.v1', 'UTF8') || '\x00'::bytea
    || audit.lp(lane) || pg_catalog.int8send(seq)
    || pg_catalog.int8send((EXTRACT(epoch FROM ts) * 1000000)::bigint)
    || audit.lp(action) || audit.lp(writer::text) || audit.lp(retention_class)
    || prev_hash || body_mac
  );

-- The one way in. The writer is the session's login role, stamped here; p_actor_did and p_actor_key are what that
-- process asserts about the human, which the database cannot verify. Errors are fixed words with SQLSTATE class UA,
-- and any of them rolls back the caller's transaction (admin design 7.2: a failed `attempted` write means stop).
-- There is no personal-data argument: the audit never stores an admin's network address (Alex, P1a-A1, 2026-10-07),
-- and a future personal field would be its own decision, with a new side table and a new signature (architecture
-- record 2026-10-06-p115m-tailnet-pii-deferred).
CREATE FUNCTION audit.append(
  p_action text, p_outcome text, p_actor_did types.did, p_actor_key text, p_target types.did, p_reason text,
  p_case uuid, p_jti text, p_request_id uuid, p_receipt bytea
) RETURNS TABLE (lane text, seq bigint, row_hash bytea)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, audit
  SET lock_timeout = '2s'
AS $$
#variable_conflict use_column
DECLARE
  w name := session_user;
  v_lane text;
  v_writers name[];
  v_retention text;
  v_rate text;
  caps CONSTANT jsonb := '{"user_triggered": 300, "system": 600, "operator": 120}';
  v_seq bigint;
  v_prev bytea;
  v_ts timestamptz;
  v_body text;
  v_k_body bytea := public.gen_random_bytes(32);
  v_body_mac bytea;
  v_hash bytea;
  v_since timestamptz;
BEGIN
  -- 1. The action exists and this role may write it.
  SELECT x.lane, x.writers, x.retention_class, x.rate_class INTO v_lane, v_writers, v_retention, v_rate
    FROM audit.actions x WHERE x.action = p_action;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit_unknown_action' USING ERRCODE = 'UA001';
  END IF;
  IF NOT w = ANY (v_writers) THEN
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

  -- 3. A cap per writer and rate class over the last minute, so one class's flood cannot block another. The bound
  -- is a variable, not clock_timestamp() itself, so the (writer, ts) index can range-scan it (a volatile call cannot
  -- bound an index scan).
  v_since := clock_timestamp() - interval '1 minute';
  IF (SELECT count(*) FROM audit.chain c JOIN audit.actions x ON x.action = c.action
       WHERE c.writer = w AND x.rate_class = v_rate AND c.ts > v_since)
     >= (caps ->> v_rate)::int THEN
    RAISE EXCEPTION 'audit_rate_limited' USING ERRCODE = 'UA004';
  END IF;

  -- 4. One writer at a time per lane, so seqs stay contiguous.
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || v_lane));

  -- 5. The previous link, or 32 zero bytes at genesis.
  SELECT c.seq, c.row_hash INTO v_seq, v_prev FROM audit.chain c WHERE c.lane = v_lane ORDER BY c.seq DESC LIMIT 1;
  v_seq := coalesce(v_seq, 0) + 1;
  v_prev := coalesce(v_prev, '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea);
  v_ts := date_trunc('microseconds', clock_timestamp());

  -- 6. The body, MACed exactly as stored.
  v_body := jsonb_strip_nulls(jsonb_build_object(
    'ts', v_ts, 'writer', w, 'actor', p_actor_did, 'actor_key', p_actor_key, 'action', p_action,
    'outcome', p_outcome, 'target', p_target, 'reason', p_reason, 'case', p_case, 'jti', p_jti,
    'request', p_request_id, 'receipt', encode(p_receipt, 'hex')))::text;
  v_body_mac := public.hmac(convert_to(v_body, 'UTF8'), v_k_body, 'sha256');

  -- 7. Link and write.
  v_hash := audit.row_hash(v_lane, v_seq, v_ts, p_action, w, v_retention, v_prev, v_body_mac);
  INSERT INTO audit.chain (lane, seq, ts, action, writer, retention_class, body_mac, prev_hash, row_hash)
    VALUES (v_lane, v_seq, v_ts, p_action, w, v_retention, v_body_mac, v_prev, v_hash);
  INSERT INTO audit.event_body (lane, seq, subject, k_body, body_text) VALUES (v_lane, v_seq, p_target, v_k_body, v_body);
  RETURN QUERY SELECT v_lane, v_seq, v_hash;
END
$$;

-- The append-only triggers' function (the triggers come with the tables in 0009). One statement-level trigger per
-- table (PostgreSQL 18 runs TRUNCATE triggers only FOR EACH STATEMENT; architecture ruling 2026-10-06 23:10Z) refuses a
-- zero-row UPDATE too. P1.15a's redaction and segment functions add their one exception (the audit.maintenance
-- setting) when they land. migrator, acting as the owner, can drop the triggers; P3.22's off-box anchor answers that.
CREATE FUNCTION audit.refuse_change() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'audit is append-only' USING ERRCODE = 'UA005';
END
$$;

RESET ROLE;
