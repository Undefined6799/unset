-- phase: expand
-- P2.19b: the CID the member's PDS gave an image's main version (com.atproto.repo.uploadBlob's answer), noted when a
-- card first publishes it; NULL until then. After a card write lands, web keeps the use of the image the record
-- shows, found by this CID, and takes back the others (below). A CID is no personal data beyond the image it names,
-- and goes with its row (erased with the member by core.erase_did and the cascade from app.account).
-- Base32 CIDv1 (https://atproto.com/specs/data-model, "Link and CID Formats": multibase `b`).
ALTER TABLE app.image ADD COLUMN blob_cid text CHECK (blob_cid ~ '^b[a-z2-7]{20,200}$');

GRANT SELECT (blob_cid), UPDATE (blob_cid) ON app.image TO web;

-- Settling a card's uses after a write (Codex review of #1860). `holds` has one random token per save that asked for
-- the use and has not yet settled or taken it back, so a failed save removes only its own token, and the use goes
-- only when no save holds it and no write settled it. `settled_rev` is the PDS commit revision (a TID;
-- https://atproto.com/specs/tid) of the write that settled the use, NULL while the use is only saves'. No personal
-- data beyond the row it is on, erased with it.
ALTER TABLE app.image_use
  ADD COLUMN holds uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN settled_rev text CHECK (settled_rev ~ '^[2-7a-z]{13}$');

GRANT SELECT (holds, settled_rev), INSERT (holds, settled_rev), UPDATE (holds, settled_rev) ON app.image_use TO web;

-- The last write settled on each of the member's card records (Codex review of #1860): its PDS commit revision, and
-- whether the record was deleted. Settling reads it under the record's lock, so a write older than the last settled
-- one, or any write after a delete, changes nothing but takes back its own uses, even when the newer write left the
-- card no picture (and so no use to hold its revision). Web never reuses a card's record key (a TID). One small row
-- per card record; it goes with the member (core.erase_did below and the cascade from app.account).
CREATE TABLE app.image_record (
  record_uri types.at_uri PRIMARY KEY,
  did types.did NOT NULL REFERENCES app.account (did) ON DELETE CASCADE,
  settled_rev text CHECK (settled_rev ~ '^[2-7a-z]{13}$'),
  removed boolean NOT NULL DEFAULT false,
  CHECK (substring(record_uri FROM '^at://([^/]+)') = did)
);
-- The foreign key's index, which erasure reads.
-- query: infrastructure/postgres/migrations/0037_image_blob_cid.sql
-- why: foreign-key
CREATE INDEX image_record_did ON app.image_record (did);

GRANT SELECT (record_uri, did, settled_rev, removed), INSERT (record_uri, did, settled_rev, removed),
  UPDATE (settled_rev, removed) ON app.image_record TO web;

-- core.erase_did, as in migration 0036, with app.image_record's two columns added to step 2's list and its statement
-- to step 4, before app.account (the rows would also go by cascade; the statement counts them). The signature, owner
-- and grants are unchanged, so CREATE OR REPLACE keeps them.
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
  v_discoverability bigint;
  v_image bigint;
  v_image_use bigint;
  v_image_upload bigint;
  v_notification bigint;
  v_image_record bigint;
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
         'idx.track_request.did', 'app.discoverability.did', 'app.image.did', 'app.image_use.record_uri',
         'app.image_upload.did', 'app.notification.did', 'app.image_record.did',
         'app.image_record.record_uri')
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
  DELETE FROM app.discoverability WHERE did = p_did;
  GET DIAGNOSTICS v_discoverability = ROW_COUNT;
  DELETE FROM app.image_use u USING app.image i WHERE u.image_id = i.id AND i.did = p_did;
  GET DIAGNOSTICS v_image_use = ROW_COUNT;
  DELETE FROM app.image_record WHERE did = p_did;
  GET DIAGNOSTICS v_image_record = ROW_COUNT;
  DELETE FROM app.image WHERE did = p_did;
  GET DIAGNOSTICS v_image = ROW_COUNT;
  DELETE FROM app.image_upload WHERE did = p_did;
  GET DIAGNOSTICS v_image_upload = ROW_COUNT;
  DELETE FROM app.notification WHERE did = p_did;
  GET DIAGNOSTICS v_notification = ROW_COUNT;
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
      'idx.track_request', v_track_request, 'app.discoverability', v_discoverability,
      'app.image', v_image, 'app.image_use', v_image_use, 'app.image_upload', v_image_upload,
      'app.notification', v_notification, 'app.image_record', v_image_record));
END
$$;
