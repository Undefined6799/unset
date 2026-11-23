-- phase: expand
-- Sign out everywhere reaching chat in the browser that pressed it (ADR 0095 decision 5, note of 2026-11-21). It
-- queues every chat device of the member by DID, due at once and ended whatever the entry says (migration 0051), and
-- the other browsers keep exactly that. The browser that pressed it goes through unset.cc's sign-out page like Log
-- out (interfaces/web lib/server/sign-out.ts), which needs its own device alive long enough to back up keys and log
-- out; due at once, web's job could end it first. In the same transaction web holds that browser's rows back by the
-- Log out grace: the devices whose door entry this web session last signed in. It only delays (never makes a row
-- due sooner, never adds or deletes one, never touches a leased row) and keeps the row's DID mark, so a renewal
-- cannot save the device and it is still ended when the grace runs out. web already may set due_at on any queued row
-- (migration 0052's grant) but reads no door table, so the join to door.browser runs here, as its owner.
-- No new personal data.
CREATE FUNCTION app.hold_chat_session_end(p_ref text, p_after_s integer) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_held integer;
BEGIN
  IF p_ref IS NULL OR p_ref !~ '^[A-Za-z0-9_-]{43}$' OR p_after_s IS NULL OR p_after_s NOT BETWEEN 0 AND 3600 THEN
    RAISE EXCEPTION 'end_chat_bad_input' USING ERRCODE = '22023';
  END IF;
  UPDATE app.chat_session_end q SET due_at = GREATEST(q.due_at, now() + make_interval(secs => p_after_s))
    FROM door.browser b
   WHERE b.web_session = p_ref AND q.chat_user = b.chat_user AND q.device_id = b.device_id AND q.lease_token IS NULL;
  GET DIAGNOSTICS v_held = ROW_COUNT;
  RETURN v_held;
END
$$;

GRANT EXECUTE ON FUNCTION app.hold_chat_session_end(text, integer) TO web;
