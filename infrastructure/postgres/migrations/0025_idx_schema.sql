-- phase: expand
-- The index schema for the own-PDS profile slice (book P3.03s in docs/ai/book/phase-3.md, "P3.00 refinement for the
-- own-PDS profile slice"; ADR 0052). `idx` is derived data: what members published on our PDS, read by the indexer
-- (interfaces/indexer, a later step) and rebuildable from the PDS. Moderator decisions live outside it, in `mod`, so
-- truncating or rebuilding `idx` never clears a delist or a suspension (findings F-01).
--
-- Cut down from P3.03: no posts, labels or purge queue yet (no step reads them), no Tap columns (ADR 0052: no Tap in
-- this slice), and `idx.relay_cursor` added for the reader's cursor (book P3.01 outcome C). Secondary indexes come
-- with the queries that use them (the migration lint's `-- query:` rule); every table here is read by primary key
-- until then. Only `indexer` gets grants: the public page (P3.12s) adds `web`'s reads with its query.
--
-- Every DID column is types.did and every AT-URI column types.at_uri; each has a registry row and is covered by
-- core.erase_did below, which is replaced so erasure keeps covering every such column (its step 2 refuses to run
-- otherwise). Each AT-URI here names the DID of the row it is in, so deleting by `did` removes it.

CREATE SCHEMA mod;

-- The account as the index sees it. `pds_active` starts false: an account is visible only once our PDS confirms it
-- (book P3.06). `last_rev` is the one nullable rev (no commit seen yet); revs are TIDs and compare bytewise.
CREATE TABLE idx.account (
  did types.did PRIMARY KEY,
  handle text,
  handle_status text NOT NULL DEFAULT 'unresolved' CHECK (handle_status IN ('verified', 'invalid', 'unresolved')),
  handle_checked_at timestamptz,
  pds_active boolean NOT NULL DEFAULT false,
  pds_status text,
  moderation_version bigint NOT NULL DEFAULT 0,
  last_rev text COLLATE "C",
  track_requested_at timestamptz,
  backfilled_at timestamptz,
  updated_at timestamptz NOT NULL
);

-- Moderator decisions, with no foreign key to idx.account (F-01). Written only by the `mod` functions of book P3.06;
-- no role holds a grant on it.
CREATE TABLE mod.account_state (
  did types.did PRIMARY KEY,
  delisted boolean NOT NULL DEFAULT false,
  mod_suspended boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL
);

-- The one visibility rule. Owned by migrator, so a reader needs no grant on mod.account_state; P3.12s grants it.
CREATE VIEW idx.visible_account AS
  SELECT a.did, a.handle, a.handle_status, a.moderation_version
    FROM idx.account a
    LEFT JOIN mod.account_state m USING (did)
   WHERE a.pds_active AND NOT coalesce(m.delisted, false) AND NOT coalesce(m.mod_suspended, false);

-- Per-account work that needs the network, done outside the ingest transaction (book P3.06, P3.08; `backfill` is
-- ADR 0052 decision 5).
CREATE TABLE idx.account_job (
  did types.did NOT NULL REFERENCES idx.account (did) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('backfill', 'confirm_status', 'confirm_deletion', 'reconcile', 'handle_check')),
  due_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  first_queued_at timestamptz NOT NULL,
  PRIMARY KEY (did, kind)
);

-- The member's sh.unset.profile record (ADR 0051), rkey `self`, with the columns a page or a filter reads promoted.
CREATE TABLE idx.profile (
  did types.did PRIMARY KEY REFERENCES idx.account (did) ON DELETE CASCADE,
  uri types.at_uri NOT NULL,
  cid text NOT NULL,
  rev text COLLATE "C" NOT NULL,
  record jsonb NOT NULL,
  display_name text,
  discoverable boolean NOT NULL,
  avatar_cid text,
  indexed_at timestamptz NOT NULL
);

-- One sh.unset.section record per card; `position` is its place in the profile's card list, null when unlisted.
CREATE TABLE idx.section (
  uri types.at_uri PRIMARY KEY,
  did types.did NOT NULL REFERENCES idx.account (did) ON DELETE CASCADE,
  rkey text NOT NULL,
  cid text NOT NULL,
  rev text COLLATE "C" NOT NULL,
  record jsonb NOT NULL,
  position integer,
  indexed_at timestamptz NOT NULL
);

-- The blobs each indexed record references, so the media proxy (P3.09) serves only referenced blobs.
CREATE TABLE idx.record_blob (
  uri types.at_uri NOT NULL,
  cid text NOT NULL,
  did types.did NOT NULL REFERENCES idx.account (did) ON DELETE CASCADE,
  mime text NOT NULL,
  size integer NOT NULL,
  PRIMARY KEY (uri, cid)
);

-- Events and backfills that failed past their attempts. No record body is kept.
CREATE TABLE idx.dead_letter (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('event', 'track', 'backfill')),
  did types.did,
  collection text,
  rkey text,
  reason_code text NOT NULL,
  attempts integer NOT NULL,
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL
);

-- Counters for the health board; never a DID.
CREATE TABLE idx.ingest_stat (
  name text PRIMARY KEY,
  value bigint NOT NULL,
  updated_at timestamptz NOT NULL
);

-- The reader's position in each source's event stream, written in the same transaction as the event it follows
-- (ADR 0052 decision 4). Never a DID.
CREATE TABLE idx.relay_cursor (
  source text PRIMARY KEY,
  seq bigint NOT NULL,
  updated_at timestamptz NOT NULL
);

-- The indexer's grants, by column list on every table with a DID column (column-list ruling, plan section 5.2).
GRANT SELECT (
  did, handle, handle_status, handle_checked_at, pds_active, pds_status, moderation_version, last_rev,
  track_requested_at, backfilled_at, updated_at
) ON idx.account TO indexer;
GRANT INSERT (did, track_requested_at, updated_at) ON idx.account TO indexer;
GRANT UPDATE (
  handle, handle_status, handle_checked_at, pds_active, pds_status, last_rev, track_requested_at, backfilled_at,
  updated_at
) ON idx.account TO indexer;
GRANT DELETE ON idx.account TO indexer;

GRANT SELECT (did, kind, due_at, attempts, first_queued_at) ON idx.account_job TO indexer;
GRANT INSERT (did, kind, due_at, attempts, first_queued_at) ON idx.account_job TO indexer;
GRANT UPDATE (due_at, attempts) ON idx.account_job TO indexer;
GRANT DELETE ON idx.account_job TO indexer;

GRANT SELECT (did, uri, cid, rev, record, display_name, discoverable, avatar_cid, indexed_at) ON idx.profile TO indexer;
GRANT INSERT (did, uri, cid, rev, record, display_name, discoverable, avatar_cid, indexed_at) ON idx.profile TO indexer;
GRANT UPDATE (uri, cid, rev, record, display_name, discoverable, avatar_cid, indexed_at) ON idx.profile TO indexer;
GRANT DELETE ON idx.profile TO indexer;

GRANT SELECT (uri, did, rkey, cid, rev, record, position, indexed_at) ON idx.section TO indexer;
GRANT INSERT (uri, did, rkey, cid, rev, record, position, indexed_at) ON idx.section TO indexer;
GRANT UPDATE (cid, rev, record, position, indexed_at) ON idx.section TO indexer;
GRANT DELETE ON idx.section TO indexer;

GRANT SELECT (uri, cid, did, mime, size) ON idx.record_blob TO indexer;
GRANT INSERT (uri, cid, did, mime, size) ON idx.record_blob TO indexer;
GRANT DELETE ON idx.record_blob TO indexer;

GRANT SELECT (id, kind, did, collection, rkey, reason_code, attempts, first_seen, last_seen) ON idx.dead_letter TO indexer;
GRANT INSERT (kind, did, collection, rkey, reason_code, attempts, first_seen, last_seen) ON idx.dead_letter TO indexer;

GRANT SELECT, INSERT, UPDATE ON idx.ingest_stat TO indexer;
GRANT SELECT, INSERT, UPDATE ON idx.relay_cursor TO indexer;

-- core.erase_did, as in migration 0022, with the index's DID columns added to step 2's list and their statements to
-- step 4. Deleting the idx.account row removes its jobs, profile, sections and blob rows by cascade; dead letters and
-- the moderator state name the DID without a foreign key and are deleted by their own statements. The moderator's
-- decision itself stays in the audit `mod` lane (book P3.03 erasure registry). The signature, owner and grants are
-- unchanged, so CREATE OR REPLACE keeps them.
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
         'idx.dead_letter.did', 'mod.account_state.did', 'idx.profile.uri', 'idx.section.uri', 'idx.record_blob.uri')
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
      'idx.dead_letter', v_idx_dead_letter, 'mod.account_state', v_mod_account_state));
END
$$;
