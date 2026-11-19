-- phase: expand
-- Member invites (book P2.10 in docs/ai/book/phase-2.md). One row per invite a member asked for: `pending` while
-- pds-admin is asked for a code, `issued` once the code is stored, sealed (P1.14: a code is a sign-up credential, so a
-- dump yields none). The submission id makes a double submit one row and one request to pds-admin (plan §2 rule 12a,
-- rule DA-2). The inviter's DID is personal data, so every grant is a column list; web deletes only the pending row a
-- failed request leaves (DELETE is row-level, as on app.oauth_session). The app keeps no record of who used a code:
-- the PDS keeps that (plan, invite-chain takedown P5.08e).
CREATE TABLE app.invite (
  id uuid PRIMARY KEY,
  inviter_did types.did NOT NULL,
  submission_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'issued')),
  sealed_code types.sealed,
  created_at timestamptz NOT NULL,
  hidden_at timestamptz,
  CHECK ((state = 'issued') = (sealed_code IS NOT NULL)),
  UNIQUE (inviter_did, submission_id)
);
-- No index beyond the unique one: it leads with inviter_did, so the Invite page's list and erasure reach a member's
-- rows through it, and a member makes at most five a day, so sorting them is cheap.

GRANT SELECT (id, inviter_did, submission_id, state, sealed_code, created_at, hidden_at) ON app.invite TO web;
GRANT INSERT (id, inviter_did, submission_id, state, created_at) ON app.invite TO web;
GRANT UPDATE (state, sealed_code, hidden_at) ON app.invite TO web;
GRANT DELETE ON app.invite TO web;

-- pds-admin refused the member (their account is not one it may issue for): a security event in web's lane.
SET ROLE audit_owner;
INSERT INTO audit.actions (action, lane, writers, retention_class, rate_class) VALUES
  ('invite.denied', 'sec', '{web}', 'security', 'user_triggered');
RESET ROLE;

-- core.erase_did, as in migration 0028, with app.invite.inviter_did added to the covered columns and its rows deleted
-- in step 4. The signature, owner and grants are unchanged, so CREATE OR REPLACE keeps them.
CREATE OR REPLACE FUNCTION core.erase_did(p_did types.did, p_why text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  -- pg_temp is listed last on purpose: left out, it is searched first for relations, and a temporary table named
  -- like a catalog could answer the check in step 2. The catalogs there are schema-qualified as well.
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_single_use bigint;
  v_session bigint;
  v_oauth_session bigint;
  v_account bigint;
  v_invite bigint;
  v_audit bigint;
  v_idx_account bigint;
  v_idx_dead_letter bigint;
  v_mod_account_state bigint;
  v_track_request bigint;
BEGIN
  -- 1. A DID and a reason from the closed list.
  IF p_did IS NULL OR p_why IS NULL
    OR p_why NOT IN ('account_deleted', 'moderator_foreign', 'user_request', 'legal_hold_closed') THEN
    RAISE EXCEPTION 'erase_bad_input' USING ERRCODE = '22023';
  END IF;

  -- 2. Fail closed on a DID column this function does not know: a table added later without its statement below
  --    stops every erasure until a migration replaces this function, so nothing is ever reported erased while a
  --    row still names the person. The catalog is the list, as in infrastructure/postgres/didColumns.ts.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
     WHERE t.typname IN ('did', '_did', 'at_uri', '_at_uri') AND t.typnamespace = 'types'::regnamespace
       AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
       AND (n.nspname::text || '.' || c.relname::text || '.' || a.attname::text) NOT IN (
         'app.single_use.bind_did', 'app.session.did', 'app.oauth_session.did', 'app.account.did',
         'app.invite.inviter_did',
         'audit.event_body.subject', 'audit.event_body.actor',
         'idx.account.did', 'idx.account_job.did', 'idx.profile.did', 'idx.section.did', 'idx.record_blob.did',
         'idx.dead_letter.did', 'mod.account_state.did', 'idx.profile.uri', 'idx.section.uri', 'idx.record_blob.uri',
         'idx.track_request.did')
  ) THEN
    RAISE EXCEPTION 'erase_uncovered_did_column' USING ERRCODE = '55000';
  END IF;

  -- 3. One erasure of a DID at a time.
  PERFORM pg_advisory_xact_lock(hashtext('erase:' || p_did::text));

  -- 4. One statement per registry row, children before parents. Any error rolls the whole call back.
  DELETE FROM app.single_use WHERE bind_did = p_did;
  GET DIAGNOSTICS v_single_use = ROW_COUNT;
  --    app.session.did and app.oauth_session.did go through the one function that ends a DID's sessions (0014;
  --    infrastructure/session's session.end_sessions_single_sql keeps it the only such delete). 'deleted' is its
  --    reason that also removes the token set. It reports sessions only, so the token set is counted first.
  SELECT count(*) INTO v_oauth_session FROM app.oauth_session WHERE did = p_did;
  v_session := app.end_sessions_for_did(p_did, 'deleted');
  DELETE FROM app.invite WHERE inviter_did = p_did;
  GET DIAGNOSTICS v_invite = ROW_COUNT;
  DELETE FROM app.account WHERE did = p_did;
  GET DIAGNOSTICS v_account = ROW_COUNT;
  DELETE FROM idx.track_request WHERE did = p_did;
  GET DIAGNOSTICS v_track_request = ROW_COUNT;
  --    The index: idx.account_job, idx.profile, idx.section and idx.record_blob, with their DID and AT-URI columns,
  --    cascade from idx.account; each AT-URI there names the DID of its own row.
  DELETE FROM idx.dead_letter WHERE did = p_did;
  GET DIAGNOSTICS v_idx_dead_letter = ROW_COUNT;
  DELETE FROM idx.account WHERE did = p_did;
  GET DIAGNOSTICS v_idx_account = ROW_COUNT;
  DELETE FROM mod.account_state WHERE did = p_did;
  GET DIAGNOSTICS v_mod_account_state = ROW_COUNT;

  -- 5. audit.event_body.subject and .actor (strategy audit_redact): the security lane's rows about the person. The
  --    moderation lane keeps its rows until their class ends (admin design 8).
  v_audit := audit.erase_subject(p_did);

  -- 6. The record that it happened, with no actor and no target.
  PERFORM audit.append('account.erased', 'succeeded', NULL, NULL, NULL, p_why, NULL, NULL, NULL, NULL);

  -- 7. The tombstone: a keyed HMAC of the DID, never the DID (idx.is_erased reads it).
  INSERT INTO core.erased_did (did_hmac, erased_at, why, outcome)
    VALUES (core.erased_did_hmac(p_did), now(), p_why, 'erased')
    ON CONFLICT (did_hmac) DO UPDATE SET erased_at = excluded.erased_at, why = excluded.why, outcome = excluded.outcome;

  RETURN jsonb_build_object(
    'outcome', 'erased',
    'counts', jsonb_build_object(
      'app.single_use', v_single_use, 'app.session', v_session, 'app.oauth_session', v_oauth_session,
      'app.account', v_account, 'app.invite', v_invite, 'audit.event_body', v_audit, 'idx.account', v_idx_account,
      'idx.dead_letter', v_idx_dead_letter, 'mod.account_state', v_mod_account_state,
      'idx.track_request', v_track_request));
END
$$;
