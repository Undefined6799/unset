-- phase: expand
-- eraseDid, as far as the app holds data today (P3.07k, cut down; plan section 6 "eraseDid(did)", section 2 rule 11).
-- One function removes every row that names a DID, following infrastructure/postgres/erasure-registry.json: one
-- hand-written statement per registry row, so a reviewer reads exactly what is deleted, and the coverage test
-- (tests/integration/postgres/erase-did.test.ts) fails when a DID column has no statement here.
--
-- Not here yet, each with the step that brings what it needs: the tombstone and its key (P3.07, with the indexer that
-- reads it), the object-store and untrack outbox (P3.07; web stores nothing per DID yet, and ADR 0041 Decision 7 gates
-- that part on the forced vacuum), legal holds (P4.07h; no hold can exist), and the callers' grants (indexer P3.07,
-- admin P3.20a, a member's own request P5.08b). Until then no role may call it: an owner runs it as migrator from
-- docs/human/runbooks/erasure.md.
--
-- Brought forward from Phase 3 by the whole-project review of 2026-11-15 (privacy item 4; Alex's decision 2 of
-- 2026-11-15T23:29Z): without it an erasure request could only be met by hand-written SQL.

CREATE SCHEMA core;

-- The owner's manual run is recorded like any other erasure; the row has no target, so the audit never re-records
-- the DID it just erased.
SET ROLE audit_owner;
UPDATE audit.actions SET writers = writers || 'migrator'::name WHERE action = 'account.erased';
RESET ROLE;

CREATE FUNCTION core.erase_did(p_did types.did, p_why text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  v_single_use bigint;
  v_session bigint;
  v_oauth_session bigint;
  v_account bigint;
  v_audit bigint;
BEGIN
  -- 1. A DID and a reason from the closed list.
  IF p_did IS NULL OR p_why IS NULL
    OR p_why NOT IN ('account_deleted', 'moderator_foreign', 'user_request', 'legal_hold_closed') THEN
    RAISE EXCEPTION 'erase_bad_input' USING ERRCODE = '22023';
  END IF;

  -- 2. One erasure of a DID at a time.
  PERFORM pg_advisory_xact_lock(hashtext('erase:' || p_did::text));

  -- 3. One statement per registry row, children before parents. Any error rolls the whole call back.
  DELETE FROM app.single_use WHERE bind_did = p_did;
  GET DIAGNOSTICS v_single_use = ROW_COUNT;
  DELETE FROM app.session WHERE did = p_did;
  GET DIAGNOSTICS v_session = ROW_COUNT;
  DELETE FROM app.oauth_session WHERE did = p_did;
  GET DIAGNOSTICS v_oauth_session = ROW_COUNT;
  DELETE FROM app.account WHERE did = p_did;
  GET DIAGNOSTICS v_account = ROW_COUNT;

  -- 4. audit.event_body.subject and .actor (strategy audit_redact): the security lane's rows about the person. The
  --    moderation lane keeps its rows until their class ends (admin design 8).
  v_audit := audit.erase_subject(p_did);

  -- 5. The record that it happened, with no actor and no target.
  PERFORM audit.append('account.erased', 'succeeded', NULL, NULL, NULL, p_why, NULL, NULL, NULL, NULL);

  RETURN jsonb_build_object(
    'outcome', 'erased',
    'counts', jsonb_build_object(
      'app.single_use', v_single_use, 'app.session', v_session, 'app.oauth_session', v_oauth_session,
      'app.account', v_account, 'audit.event_body', v_audit));
END
$$;
