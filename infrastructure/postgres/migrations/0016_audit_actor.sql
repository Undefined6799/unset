-- phase: expand
-- The audit actor column (P1.15k; ADR 0043; whole-project review 2026-11-15, security finding 3). Until now the actor
-- of an event lived only inside event_body.body_text, where erasure cannot find it: audit.erase_subject (P1.15a) looks
-- for a DID in a types.did column (docs/human/db/erasure.md). For report.submitted the actor is the reporter and the
-- subject is the reported account, so a reporter's own rows were out of reach. The tables are append-only, so a
-- column added later could never be filled for the rows already written; it is added before the first report.
--
-- actor is the person who caused the event, as the writing process asserts it (p_actor_did): a member for
-- user_triggered actions, an admin for operator actions. System work has no person, so actor is null and
-- chain.writer names the process. It sits in the side row, beside subject, never in the chain, so it is erased or
-- redacted with the body and the row hash is unchanged (body_text has carried the actor since 0008).
--
-- A column whose type is a domain with a constraint rewrites the table under an ACCESS EXCLUSIVE lock
-- (https://www.postgresql.org/docs/18/sql-altertable.html, Notes; read 2026-11-15 from the REL_18_STABLE source,
-- doc/src/sgml/ref/alter_table.sgml). The rewrite is not an UPDATE, so the append-only trigger does not fire, and
-- every stored value is kept. Rows written before this file keep a null actor: they cannot be updated. The only
-- action written so far is age_gate.blocked, whose actor is its subject, so erasure by subject reaches them.

SET ROLE audit_owner;

ALTER TABLE audit.event_body ADD COLUMN actor types.did;

-- audit.append as in 0008, with two changes: it stores p_actor_did in the new column, and step 2 refuses a
-- user_triggered or operator action that names no actor (audit_bad_input). The signature is the same, so the
-- function keeps its owner and the EXECUTE grants of 0010
-- (https://www.postgresql.org/docs/18/sql-createfunction.html, Description; same source, create_function.sgml).
CREATE OR REPLACE FUNCTION audit.append(
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

  -- 2. Typed fields only: nothing free-text reaches the record. A person's event names the person (ADR 0043).
  IF p_outcome IS NULL OR p_outcome NOT IN ('attempted', 'succeeded', 'failed', 'denied', 'unknown')
    OR (p_reason IS NOT NULL AND NOT EXISTS (SELECT 1 FROM audit.reasons r WHERE r.reason = p_reason))
    OR (p_jti IS NOT NULL AND p_jti !~ '^[A-Za-z0-9_-]{22}$')
    OR (p_actor_key IS NOT NULL AND (p_actor_key !~ '^[A-Za-z0-9_-]+$' OR length(p_actor_key) > 1366))
    OR (p_receipt IS NOT NULL AND octet_length(p_receipt) <> 32)
    OR (v_rate IN ('user_triggered', 'operator') AND p_actor_did IS NULL) THEN
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
  INSERT INTO audit.event_body (lane, seq, subject, actor, k_body, body_text)
    VALUES (v_lane, v_seq, p_target, p_actor_did, v_k_body, v_body);
  RETURN QUERY SELECT v_lane, v_seq, v_hash;
END
$$;

RESET ROLE;
