-- phase: expand
-- Audit retention and erasure, part 2 of 2 (P1.15f, split from P1.15a by rule SE-6; plan section 6 retention classes,
-- section 2 rule 11; admin design 7.3 and 8). The audit tables refused every DELETE, so a body row could never leave:
-- not when its class ran out, not when the person it names asked to be erased. This adds the only lawful ways out, all
-- SECURITY DEFINER functions owned by audit_owner: redact (one expired body row), erase_subject (a person's
-- security-lane body rows), and seal_segment, mark_anchored and drop_segment (whole months of an expired, anchored
-- chain; tables in 0017). The chain row of a redacted or erased event stays, so the hash chain still verifies;
-- verifyChain reads a missing body row as redacted (P1.15). Scheduling these and the off-box anchor are P3.22;
-- erase_subject's one caller and its grant are P3.07 and P3.07g.

SET ROLE audit_owner;

-- The append-only triggers' one exception. A DELETE passes only while it runs as audit_owner, which the functions
-- below do as definers, with audit.maintenance set for the transaction to 'body' (event_body rows) or 'segment'
-- (event_body and chain rows). UPDATE and TRUNCATE stay refused for everyone. For a service role the setting opens
-- nothing: none holds DELETE on these tables or can become audit_owner. It is no defence against the owner: a session
-- that is audit_owner and sets audit.maintenance itself can delete rows outside the functions. Only migrator and a
-- superuser can become audit_owner (0003), and both could already drop the triggers (0008), so this adds no new
-- power; it stays the residual until the off-box anchor (P3.22) makes such a delete detectable. The return value of
-- a statement-level trigger is ignored.
CREATE OR REPLACE FUNCTION audit.refuse_change() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
DECLARE
  v_mode text := coalesce(current_setting('audit.maintenance', true), '');
BEGIN
  IF TG_OP = 'DELETE' AND current_user = 'audit_owner' AND TG_TABLE_SCHEMA = 'audit'
    AND ((TG_TABLE_NAME = 'event_body' AND v_mode IN ('body', 'segment'))
      OR (TG_TABLE_NAME = 'chain' AND v_mode = 'segment')) THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'audit is append-only' USING ERRCODE = 'UA005';
END
$$;

-- audit.segment changes only the way the functions below change it: anchored_at and dropped_at are each set once,
-- and nothing else moves. chainStart trusts a dropped segment's head_hash, so that hash must not be editable.
CREATE FUNCTION audit.segment_transition() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
BEGIN
  IF (NEW.lane, NEW.id, NEW.first_seq, NEW.last_seq, NEW.prev_hash, NEW.head_hash, NEW.sealed_at)
       IS DISTINCT FROM (OLD.lane, OLD.id, OLD.first_seq, OLD.last_seq, OLD.prev_hash, OLD.head_hash, OLD.sealed_at)
    OR NEW.max_class_expiry IS DISTINCT FROM OLD.max_class_expiry
    OR (OLD.anchored_at IS NOT NULL AND NEW.anchored_at IS DISTINCT FROM OLD.anchored_at)
    OR (OLD.dropped_at IS NOT NULL AND NEW.dropped_at IS DISTINCT FROM OLD.dropped_at) THEN
    RAISE EXCEPTION 'audit is append-only' USING ERRCODE = 'UA005';
  END IF;
  RETURN NEW;
END
$$;

-- Both tables of 0017 are append-only too, even for the owner: no DELETE or TRUNCATE on either (refuse_change's
-- exception names event_body and chain only), no UPDATE of redaction_log, and only the two transitions above on
-- segment. The same residual applies: whoever can become audit_owner can drop a trigger.
CREATE TRIGGER segment_append_only BEFORE DELETE OR TRUNCATE ON audit.segment
  FOR EACH STATEMENT EXECUTE FUNCTION audit.refuse_change();
CREATE TRIGGER segment_transitions BEFORE UPDATE ON audit.segment
  FOR EACH ROW EXECUTE FUNCTION audit.segment_transition();
CREATE TRIGGER redaction_log_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON audit.redaction_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit.refuse_change();

-- Removes one body row whose retention class has run out, and says whether a row went. A class counted from a case's
-- close is refused until P3 supplies close dates, so it is kept (fail safe).
CREATE FUNCTION audit.redact(p_lane text, p_seq bigint) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, audit
AS $$
DECLARE
  v_expired boolean;
  v_rows int;
BEGIN
  SELECT r.counted_from = 'event' AND now() > c.ts + r.keep INTO v_expired
    FROM audit.chain c JOIN audit.retention_classes r ON r.class = c.retention_class
   WHERE c.lane = p_lane AND c.seq = p_seq;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF NOT v_expired THEN
    RAISE EXCEPTION 'audit_retention_active' USING ERRCODE = 'UA006';
  END IF;
  PERFORM set_config('audit.maintenance', 'body', true);
  DELETE FROM audit.event_body b WHERE b.lane = p_lane AND b.seq = p_seq;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM set_config('audit.maintenance', '', true);
  IF v_rows = 0 THEN
    RETURN false;
  END IF;
  INSERT INTO audit.redaction_log (lane, seq, part, by) VALUES (p_lane, p_seq, 'redact', session_user);
  RETURN true;
END
$$;

-- The erasure path (strategy audit_redact). Removes the security-lane body rows that name the person as the subject
-- or as the actor, whatever their class: erasure of the person's own data overrides the security class. The
-- moderation lane is never touched; its rows stay until their class ends (admin design 8). Returns the count.
-- P3.07g grants it to the owner of core.erase_did, its one caller.
CREATE FUNCTION audit.erase_subject(p_did types.did) RETURNS bigint
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, audit
AS $$
DECLARE
  v_rows bigint;
BEGIN
  IF p_did IS NULL THEN
    RAISE EXCEPTION 'audit_bad_input' USING ERRCODE = 'UA003';
  END IF;
  PERFORM set_config('audit.maintenance', 'body', true);
  WITH gone AS (
    DELETE FROM audit.event_body b
     WHERE b.lane = 'sec' AND (b.subject = p_did OR b.actor = p_did)
    RETURNING b.lane, b.seq
  ), logged AS (
    INSERT INTO audit.redaction_log (lane, seq, part, by) SELECT g.lane, g.seq, 'erase', session_user FROM gone g
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM logged;
  PERFORM set_config('audit.maintenance', '', true);
  RETURN v_rows;
END
$$;

-- Seals every unsealed row of the lane up to the end of a finished month into one segment. Rows are taken by seq, not
-- by time alone, so segments never leave a gap: the segment starts where the last one ended. Returns false when the
-- lane has no unsealed row in or before that month. It holds the lane's append lock while it reads one month of
-- chain rows, and waits at most 2 s for it (55P03, as audit.append does), so it gives way to appends and the caller
-- tries again. max_class_expiry is fixed here: a legal hold placed later does not move it, so P4.07 must make
-- drop_segment ask the hold table as well.
CREATE FUNCTION audit.seal_segment(p_lane text, p_month date) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, audit
  SET lock_timeout = '2s'
AS $$
DECLARE
  v_end timestamptz := (p_month + interval '1 month')::timestamp AT TIME ZONE 'UTC';
  v_id int := (to_char(p_month, 'YYYYMM'))::int;
  v_first bigint;
  v_last bigint;
  v_prev bytea;
  v_head bytea;
  v_expiry timestamptz;
BEGIN
  IF p_month IS NULL OR p_month <> date_trunc('month', p_month)::date OR v_end > now() THEN
    RAISE EXCEPTION 'audit_month_not_over' USING ERRCODE = 'UA007';
  END IF;
  -- The lane's append lock, so no row lands between reading the range and sealing it.
  PERFORM pg_advisory_xact_lock(hashtext('audit:' || p_lane));
  IF EXISTS (SELECT 1 FROM audit.segment s WHERE s.lane = p_lane AND s.id >= v_id) THEN
    RAISE EXCEPTION 'audit_segment_sealed' USING ERRCODE = 'UA007';
  END IF;
  SELECT coalesce(max(s.last_seq) + 1, 1) INTO v_first FROM audit.segment s WHERE s.lane = p_lane;
  SELECT max(c.seq) INTO v_last FROM audit.chain c WHERE c.lane = p_lane AND c.seq >= v_first AND c.ts < v_end;
  IF v_last IS NULL THEN
    RETURN false;
  END IF;
  SELECT c.prev_hash INTO v_prev FROM audit.chain c WHERE c.lane = p_lane AND c.seq = v_first;
  SELECT c.row_hash INTO v_head FROM audit.chain c WHERE c.lane = p_lane AND c.seq = v_last;
  -- Droppable only when every row's class is counted from the event; one case_close row keeps the whole segment.
  SELECT CASE WHEN bool_and(r.counted_from = 'event') THEN max(c.ts + r.keep) END INTO v_expiry
    FROM audit.chain c JOIN audit.retention_classes r ON r.class = c.retention_class
   WHERE c.lane = p_lane AND c.seq BETWEEN v_first AND v_last;
  INSERT INTO audit.segment (lane, id, first_seq, last_seq, prev_hash, head_hash, max_class_expiry, sealed_at)
    VALUES (p_lane, v_id, v_first, v_last, v_prev, v_head, v_expiry, now());
  RETURN true;
END
$$;

-- Records that a segment's head hash was written off-box. All it proves is that the caller knew the hash sealed
-- here, so a stale or wrong copy cannot be marked; it cannot prove the off-box write happened. That is the anchoring
-- job's duty (P3.22, which gets the grant) and the reason the daily check compares against the off-box copy.
CREATE FUNCTION audit.mark_anchored(p_lane text, p_id int, p_head_hash bytea) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, audit
AS $$
BEGIN
  UPDATE audit.segment s SET anchored_at = coalesce(s.anchored_at, now())
   WHERE s.lane = p_lane AND s.id = p_id AND s.head_hash = p_head_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit_anchor_mismatch' USING ERRCODE = 'UA007';
  END IF;
END
$$;

-- Drops a segment's chain and body rows. Only the oldest segment that still has its rows, only once it is anchored
-- off-box and every row's class has run out, and never the lane's last rows: audit.append continues the chain from
-- the newest row, so a lane must keep one. It never takes the append lock, so a large drop does not make audited
-- actions wait: the rows it removes are behind the head, which appends alone read, and once a row exists after the
-- segment it stays. The segment's row lock serialises two drops.
CREATE FUNCTION audit.drop_segment(p_lane text, p_id int) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, audit
AS $$
DECLARE
  s audit.segment%ROWTYPE;
BEGIN
  SELECT * INTO s FROM audit.segment x WHERE x.lane = p_lane AND x.id = p_id AND x.dropped_at IS NULL FOR UPDATE;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM audit.segment x WHERE x.lane = p_lane AND x.id < p_id AND x.dropped_at IS NULL)
  THEN
    RAISE EXCEPTION 'audit_segment_not_oldest' USING ERRCODE = 'UA007';
  END IF;
  IF s.anchored_at IS NULL THEN
    RAISE EXCEPTION 'audit_segment_not_anchored' USING ERRCODE = 'UA007';
  END IF;
  IF s.max_class_expiry IS NULL OR now() <= s.max_class_expiry THEN
    RAISE EXCEPTION 'audit_retention_active' USING ERRCODE = 'UA006';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit.chain c WHERE c.lane = p_lane AND c.seq > s.last_seq) THEN
    RAISE EXCEPTION 'audit_segment_is_chain_head' USING ERRCODE = 'UA007';
  END IF;
  PERFORM set_config('audit.maintenance', 'segment', true);
  WITH gone AS (
    DELETE FROM audit.event_body b WHERE b.lane = p_lane AND b.seq BETWEEN s.first_seq AND s.last_seq
    RETURNING b.lane, b.seq
  )
  INSERT INTO audit.redaction_log (lane, seq, part, by) SELECT g.lane, g.seq, 'drop', session_user FROM gone g;
  DELETE FROM audit.chain c WHERE c.lane = p_lane AND c.seq BETWEEN s.first_seq AND s.last_seq;
  PERFORM set_config('audit.maintenance', '', true);
  UPDATE audit.segment x SET dropped_at = now() WHERE x.lane = p_lane AND x.id = p_id;
END
$$;

-- No role may call any of these yet. The retention job's EXECUTE on seal_segment, redact and drop_segment comes with
-- the process that runs them (P3.22), in its own migration: a grant on an existing function is trusted base (SE-6).
RESET ROLE;
