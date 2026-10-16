-- phase: expand
-- Ends every browser session of a DID (P2.04s; contract in the book's P2.03 Outputs and P3.06). The one place that
-- deletes a DID's sessions: infrastructure/session's destroyAllForDid calls it inside the caller's transaction, so the
-- caller's own change (sign out everywhere, the under-16 block, an account state) and this delete commit together.
-- It also deletes the DID's OAuth token set, so a caller that must revoke the grant at the authorization server does
-- that first. A deactivated account may come back, so 'deactivated' keeps the token set (allow-list, F17).
-- The reasons are one closed list shared with P3.06; infrastructure/session's END_SESSIONS_REASONS mirrors it, and
-- session.reasons_match_check compares the two. It returns the number of sessions ended.
CREATE FUNCTION app.end_sessions_for_did(p_did types.did, p_why text) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app
AS $$
DECLARE
  ended int;
BEGIN
  IF p_why IS NULL OR p_why NOT IN ('deactivated', 'takendown', 'suspended', 'deleted', 'unknown', 'mod_suspended',
      'mod_end_sessions', 'user_signout_all', 'underage', 'auth_dead') THEN
    RAISE EXCEPTION 'end_sessions_unknown_why' USING ERRCODE = '22023';
  END IF;
  DELETE FROM app.session WHERE did = p_did;
  GET DIAGNOSTICS ended = ROW_COUNT;
  IF p_why <> 'deactivated' THEN
    DELETE FROM app.oauth_session WHERE did = p_did;
  END IF;
  RETURN ended;
END
$$;

-- 0003 revokes EXECUTE on migrator's routines from PUBLIC; web is the only caller in Phase 2 (P3.06g adds indexer and
-- admin).
GRANT EXECUTE ON FUNCTION app.end_sessions_for_did(types.did, text) TO web;
