-- phase: expand
-- P2.27 (ADR 0079): when this browser last opened its "new sign-in" notifications. The notification is not stored: it
-- is worked out from the member's other live sessions that began after this one and after this time
-- (infrastructure/session store.ts signInsSince), so the app keeps no sign-in record (plan §6) and an entry ends with
-- its session. One time per session, not per account: a person who signed in with a stolen password can dismiss the
-- alert only in their own browser, never in the member's.
-- Not new personal data beyond the session row it sits on; it leaves with the row (sign-out, expiry,
-- app.end_sessions_for_did, erasure). Nullable with no default, so adding it rewrites nothing
-- (https://www.postgresql.org/docs/18/sql-altertable.html, Notes).
-- web reads it and moves it forward (markSignInsSeen); no INSERT, because a new session has opened nothing. Column
-- grants only, like the rest of app.session (0011; https://www.postgresql.org/docs/18/sql-grant.html).
ALTER TABLE app.session ADD COLUMN sign_ins_seen_at timestamptz;

GRANT SELECT (sign_ins_seen_at), UPDATE (sign_ins_seen_at) ON app.session TO web;
