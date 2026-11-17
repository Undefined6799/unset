-- phase: expand
-- The track queue for the own-PDS profile slice (book P3.02s in docs/ai/book/phase-3.md, "P3.00 refinement for the
-- own-PDS profile slice"; ADR 0052 decision 3). Only members are indexed: a DID is queued when its onboarding ends,
-- in the transaction that sets app.account.onboarding to 'done' (infrastructure/postgres/accountRepository.ts
-- `finishChat`), so the age gate has passed and the terms and privacy notice are accepted. A sign-in alone queues
-- nothing: the book's insert in the sign-in callback would also queue a blocked under-16 account and anyone who
-- stopped before the terms. The indexer's track loop (a later step, after the P3.07s tombstone, so an erased DID is
-- never tracked again) turns each row into an idx.account row and deletes it.
--
-- The queue is in `idx`, not `app` as the book has it: `web` and `indexer` both already use `idx`, while `indexer`
-- has no access to `app`, so no role gains anything on an existing schema. It holds no decision of ours (rule DA-1):
-- the fact is app.account.onboarding, and rebuilding `idx` re-queues every member with the statement below.
--
-- `web` may only add a row: it cannot read, change or delete the queue, so a compromised web process learns nothing
-- from it and can only queue DIDs. `indexer` reads and deletes and cannot add. The queue is read by primary key and in
-- full, so it has no secondary index.
CREATE TABLE idx.track_request (
  did types.did PRIMARY KEY,
  requested_at timestamptz NOT NULL
);

GRANT INSERT (did, requested_at) ON idx.track_request TO web;
GRANT SELECT (did, requested_at) ON idx.track_request TO indexer;
GRANT DELETE ON idx.track_request TO indexer;

-- Every member who finished onboarding before this migration (book P3.02 algorithm step 6, by the rule above).
INSERT INTO idx.track_request (did, requested_at) SELECT did, now() FROM app.account WHERE onboarding = 'done';

-- core.erase_did, as in migration 0025, with idx.track_request.did added to step 2's list and its statement to step 4.
-- The signature, owner and grants are unchanged, so CREATE OR REPLACE keeps them.
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

  RETURN jsonb_build_object(
    'outcome', 'erased',
    'counts', jsonb_build_object(
      'app.single_use', v_single_use, 'app.session', v_session, 'app.oauth_session', v_oauth_session,
      'app.account', v_account, 'audit.event_body', v_audit, 'idx.account', v_idx_account,
      'idx.dead_letter', v_idx_dead_letter, 'mod.account_state', v_mod_account_state,
      'idx.track_request', v_track_request));
END
$$;
