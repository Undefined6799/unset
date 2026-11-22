-- phase: expand
-- The unset.cc door's browser list (build step 6; ADR 0093 decision 4, ADR 0095 decision 4), in its own schema under
-- its own role, `chat_auth`, the role of interfaces/chat-auth and of nothing else. One row per account signed in on a
-- browser: the browser as sha256 of the door cookie's 32 random bytes (a row is not a cookie), the member, their chat
-- user, the web session that signed the browser in (domains/messaging sessionRef, so web's Log out can later name
-- it), the device chat-admin minted for it, and the 32-byte storage lock key that opens that device's local key
-- store, sealed to its row (infrastructure/seal; sealed-columns.json). A second account on the same browser gets its
-- own row, device and key (ADR 0095: the first stays locked). Device and key never change for a row: a renewal
-- rewrites only the web session and the last use, so expiry keeps the same device and key (ADR 0095 decision 4).
-- The unique (browser_hash, did) pair is what a concurrent first sign-in loses on (rule DA-4). Erasure reads the table
-- by DID through the (did, device_id) unique index.
-- Personal data: purpose, to give a member's own browser back its chat device and lock key; lawful basis, the contract
-- the member accepted with the terms (chat is part of the service); deleted at Log out and erased by core.erase_did
-- below. Export comes with the export (none exists yet; ADR 0093 Consequences lists the browser list for it). How long
-- a row of a browser that never returns is kept is the lifecycle step's (build step 11).

-- The role, as migration 0003 makes every roster role: created only when missing, then brought to roles.json's state.
-- No password here: a login role gets one from its roster entry's password file (P1.12p), and this one names none
-- until the door has a Compose service.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'chat_auth') THEN
    CREATE ROLE chat_auth NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  ALTER ROLE chat_auth LOGIN CONNECTION LIMIT 10;
  ALTER ROLE chat_auth RESET ALL;
  ALTER ROLE chat_auth SET idle_in_transaction_session_timeout = '10s';
  ALTER ROLE chat_auth SET lock_timeout = '3s';
  ALTER ROLE chat_auth SET search_path = '';
  ALTER ROLE chat_auth SET statement_timeout = '2s';
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO chat_auth', current_database());
END
$$;

CREATE SCHEMA door;
GRANT USAGE ON SCHEMA door TO chat_auth;

CREATE TABLE door.browser (
  id uuid PRIMARY KEY,
  browser_hash bytea NOT NULL CHECK (octet_length(browser_hash) = 32),
  did types.did NOT NULL,
  chat_user text NOT NULL CHECK (chat_user ~ '^u[a-z2-7]{20}$'),
  web_session text NOT NULL CHECK (web_session ~ '^[A-Za-z0-9_-]{43}$'),
  device_id text NOT NULL CHECK (device_id ~ '^[A-Z0-9]{10}$'),
  lock_key types.sealed NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (browser_hash, did),
  UNIQUE (did, device_id)
);

-- The door finds rows by browser, adds them, renews them and deletes them at Log out; it can never change whose row
-- it is, which device it names or its key. DELETE is Log out's, and a device chat-admin reports ended.
GRANT SELECT (id, browser_hash, did, chat_user, device_id, lock_key) ON door.browser TO chat_auth;
GRANT INSERT (id, browser_hash, did, chat_user, web_session, device_id, lock_key) ON door.browser TO chat_auth;
GRANT UPDATE (web_session, last_used_at) ON door.browser TO chat_auth;
GRANT DELETE ON door.browser TO chat_auth;

-- core.erase_did, as in migration 0043, with door.browser.did added to step 2's list and its statement to step 4.
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
  v_sign_in bigint;
  v_chat_account bigint;
  v_door_browser bigint;
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
         'app.image_record.record_uri', 'app.sign_in.did', 'idx.page.did', 'idx.page.uri',
         'app.chat_account.did',
         'door.browser.did')
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
  DELETE FROM app.sign_in WHERE did = p_did;
  GET DIAGNOSTICS v_sign_in = ROW_COUNT;
  --    The chat mapping: its chat user is kept, with no DID, for the deactivation that erases the MAS account (ADR
  --    0096 decision 3), so the account can still be found once nothing here names the person.
  INSERT INTO app.chat_erasure (chat_user, queued_at)
    SELECT chat_user, now() FROM app.chat_account WHERE did = p_did
    ON CONFLICT (chat_user) DO NOTHING;
  DELETE FROM app.chat_account WHERE did = p_did;
  GET DIAGNOSTICS v_chat_account = ROW_COUNT;
  --    The door's browser list (0044): the member's chat devices per browser and their sealed lock keys. With the key
  --    gone no browser's local store opens again; the deactivation ends the devices themselves (ADR 0096).
  DELETE FROM door.browser WHERE did = p_did;
  GET DIAGNOSTICS v_door_browser = ROW_COUNT;
  DELETE FROM app.account WHERE did = p_did;
  GET DIAGNOSTICS v_account = ROW_COUNT;
  DELETE FROM idx.track_request WHERE did = p_did;
  GET DIAGNOSTICS v_track_request = ROW_COUNT;
  --    The index: idx.account_job, idx.profile, idx.page, idx.section and idx.record_blob, with their DID and AT-URI
  --    columns,
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
      'app.notification', v_notification, 'app.image_record', v_image_record, 'app.sign_in', v_sign_in,
      'app.chat_account', v_chat_account,
      'door.browser', v_door_browser));
END
$$;
