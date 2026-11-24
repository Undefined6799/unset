-- phase: expand
-- A device queued by one Log out and signed in again by a second web session follows the second Log out (ADR 0095
-- decision 5; Codex review of migration 0051). 0051's upsert kept the first session's reference when the same
-- browser, signed in again through session B within session A's grace, was logged out from B: the claim then saw
-- the entry renewed to B, not A, took it for a rebound and dropped the job, and the device stayed signed in. Now a
-- session-scoped end that meets a session-scoped one takes the new reference and the new grace (the old job was for
-- a session the browser has left, and the browser's own sign-out page needs B's grace); an end queued by DID stays
-- unconditional, due at the earlier of the two, as before. CREATE OR REPLACE keeps the function's owner and its
-- EXECUTE grant (PostgreSQL 18 docs, sql-createfunction.html). No new personal data.
CREATE OR REPLACE FUNCTION app.end_chat_sessions(p_refs text[], p_did types.did, p_after_s integer) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_ref text;
  v_queued integer;
BEGIN
  IF p_refs IS NULL OR cardinality(p_refs) > 1000 OR p_after_s IS NULL OR p_after_s NOT BETWEEN 0 AND 3600
    OR EXISTS (SELECT 1 FROM unnest(p_refs) r WHERE r IS NULL OR r !~ '^[A-Za-z0-9_-]{43}$') THEN
    RAISE EXCEPTION 'end_chat_bad_input' USING ERRCODE = '22023';
  END IF;
  -- In one order, so two calls never wait on each other's locks.
  FOR v_ref IN SELECT DISTINCT r FROM unnest(p_refs) r ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtext('chat-session:' || v_ref));
  END LOOP;
  DELETE FROM door.ended_session WHERE ended_at < now() - interval '1 hour';
  INSERT INTO door.ended_session (web_session) SELECT DISTINCT r FROM unnest(p_refs) r
    ON CONFLICT (web_session) DO NOTHING;
  INSERT INTO app.chat_session_end AS q (chat_user, device_id, web_session, due_at)
    SELECT b.chat_user, b.device_id, CASE WHEN p_did IS NULL THEN b.web_session END,
           now() + make_interval(secs => p_after_s)
      FROM door.browser b
     WHERE b.web_session = ANY (p_refs) OR b.did = p_did
    ON CONFLICT (chat_user, device_id) DO UPDATE
      SET due_at = CASE WHEN q.web_session IS NOT NULL AND excluded.web_session IS NOT NULL THEN excluded.due_at
                        ELSE LEAST(q.due_at, excluded.due_at) END,
          web_session = CASE WHEN q.web_session IS NULL OR excluded.web_session IS NULL THEN NULL
                             ELSE excluded.web_session END;
  GET DIAGNOSTICS v_queued = ROW_COUNT;
  RETURN v_queued;
END
$$;
