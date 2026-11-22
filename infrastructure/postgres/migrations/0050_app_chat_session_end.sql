-- phase: expand
-- Ending chat when web ends a session (ADR 0095 decision 5: Log out on unset.sh ends chat on the browsers that web
-- session signed in, through a queued job; ADR 0096 decision 7: a grant revoked at the PDS ends every chat session of
-- the account and deletes its lock keys). The door's browser list names, per entry, the web session that last signed
-- it in (migration 0044, door.browser.web_session, domains/messaging sessionRef). web cannot read the door's schema,
-- so it calls app.end_chat_sessions, as its owner, inside the transaction that ends the web session: the session's
-- reference is marked ended, and the devices it signed in (or, with a DID, every device of the member) are queued for
-- chat-admin's session.end. No network I/O runs in that transaction (rule DA-4); web's job drains the queue, as the
-- erasure job drains app.chat_erasure (migration 0048), and deletes the entry, and with it the lock key, only once
-- chat-admin has ended the device, so a failure leaves the entry for the next try (as the door's own Log out does).
--
-- A ticket web signed for the session just before it ended may still reach the door. door.ended_session keeps each
-- ended reference for an hour (a ticket lives 60 seconds), and a trigger on door.browser refuses an add or a renewal
-- from an ended reference: the door then reads `taken` or `busy` and ends the device it just minted (domains/messaging
-- door.ts redeem). Both sides take the reference's advisory lock first, and the trigger's check is a statement of its
-- own, which in READ COMMITTED sees what committed before it (PostgreSQL 18 docs, transaction-iso.html 13.2.1 and
-- plpgsql-implementation.html 41.11.1, "each SQL command ... in a VOLATILE function sees a new snapshot"), so
-- whichever commits first, the late ticket loses.
--
-- A device queued by one session is due after `p_after_s` seconds; if the same browser signs in again from a live web
-- session before then, the door renews the entry to that session and the claim drops the job. A device queued by DID
-- is ended whatever the entry says since.
-- Personal data: chat user and device are pseudonymous (ADR 0010), kept only until the device is ended; the reference
-- is a one-way hash of a session row's key, kept an hour. Neither names a DID, so core.erase_did does not list them;
-- erasure ends every device through the deactivation (ADR 0096 decision 3) and a queued end then finds nothing to do.
-- Purpose and lawful basis as Log out itself (the contract the member accepted).

CREATE TABLE door.ended_session (
  web_session text PRIMARY KEY CHECK (web_session ~ '^[A-Za-z0-9_-]{43}$'),
  ended_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.chat_session_end (
  chat_user text NOT NULL CHECK (chat_user ~ '^u[a-z2-7]{20}$'),
  device_id text NOT NULL CHECK (device_id ~ '^[A-Z0-9]{10}$'),
  -- The ended session that queued the device, or NULL when it was queued by DID and ends unconditionally.
  web_session text CHECK (web_session ~ '^[A-Za-z0-9_-]{43}$'),
  due_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_token uuid,
  PRIMARY KEY (chat_user, device_id)
);

-- web puts a claimed row back; it adds, claims and deletes rows only through the functions below.
GRANT SELECT (chat_user, device_id, attempts, lease_token) ON app.chat_session_end TO web;
GRANT UPDATE (due_at, attempts, lease_token) ON app.chat_session_end TO web;

CREATE FUNCTION app.end_chat_sessions(p_refs text[], p_did types.did, p_after_s integer) RETURNS integer
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
      SET due_at = LEAST(q.due_at, excluded.due_at),
          web_session = CASE WHEN excluded.web_session IS NULL THEN NULL ELSE q.web_session END;
  GET DIAGNOSTICS v_queued = ROW_COUNT;
  RETURN v_queued;
END
$$;

-- Claims up to `p_limit` due devices under fresh leases (SKIP LOCKED, one statement). A device queued by a session
-- whose entry a live session has renewed since is the browser's again: its row is dropped, not returned.
CREATE FUNCTION app.claim_chat_session_end(p_limit integer, p_lease_s integer)
  RETURNS TABLE (chat_user text, device_id text, attempts integer, lease text)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_lease_s IS NULL OR p_lease_s NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'end_chat_bad_input' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH due AS (
    SELECT q.chat_user, q.device_id, q.web_session FROM app.chat_session_end q
     WHERE q.due_at <= now() ORDER BY q.due_at, q.chat_user, q.device_id LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), rebound AS (
    DELETE FROM app.chat_session_end q USING due d, door.browser b
     WHERE q.chat_user = d.chat_user AND q.device_id = d.device_id AND d.web_session IS NOT NULL
       AND b.chat_user = d.chat_user AND b.device_id = d.device_id AND b.web_session <> d.web_session
    RETURNING q.chat_user, q.device_id
  ), claimed AS (
    UPDATE app.chat_session_end q SET due_at = now() + make_interval(secs => p_lease_s), lease_token = gen_random_uuid()
      FROM due d
     WHERE q.chat_user = d.chat_user AND q.device_id = d.device_id
       AND NOT EXISTS (SELECT 1 FROM rebound r WHERE r.chat_user = d.chat_user AND r.device_id = d.device_id)
    RETURNING q.chat_user, q.device_id, q.attempts, q.lease_token
  )
  SELECT c.chat_user, c.device_id, c.attempts, c.lease_token::text FROM claimed c;
END
$$;

-- Once chat-admin has ended the device: the queued row and the door's entry, with its lock key, go together, and only
-- while the caller still holds the lease. False when it no longer does.
CREATE FUNCTION app.finish_chat_session_end(p_user text, p_device text, p_lease uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  DELETE FROM app.chat_session_end WHERE chat_user = p_user AND device_id = p_device AND lease_token = p_lease;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  DELETE FROM door.browser WHERE chat_user = p_user AND device_id = p_device;
  RETURN true;
END
$$;

-- The door's side: an add or a renewal from an ended session does nothing (the row is skipped).
CREATE FUNCTION door.refuse_ended_session() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('chat-session:' || NEW.web_session));
  IF EXISTS (SELECT 1 FROM door.ended_session WHERE web_session = NEW.web_session) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER browser_refuse_ended_session BEFORE INSERT OR UPDATE OF web_session ON door.browser
  FOR EACH ROW EXECUTE FUNCTION door.refuse_ended_session();

-- The erasure job (migration 0048) reads how long ago a row was queued: an account MAS does not hold yet may still be
-- created by a creation claimed before the erasure, so "no account" only finishes the row once none can land.
GRANT SELECT (queued_at) ON app.chat_erasure TO web;

GRANT EXECUTE ON FUNCTION app.end_chat_sessions(text[], types.did, integer) TO web;
GRANT EXECUTE ON FUNCTION app.claim_chat_session_end(integer, integer) TO web;
GRANT EXECUTE ON FUNCTION app.finish_chat_session_end(text, text, uuid) TO web;
