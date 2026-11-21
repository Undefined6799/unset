-- phase: expand
-- The bell's count clears when it is opened (book P2.27e, ADR 0085, Alex 2026-11-21 05:16Z). Each browser session keeps
-- the time of the newest notification it has shown, on the notifications page or by opening the bell; the badge counts
-- only entries sent after it, and an entry stays listed until it is dismissed (ADR 0081). The mark is per browser, not
-- per account, so a browser that signed in as the member (the one a sign-in notification is about) cannot clear the
-- badge on the member's other browsers (ADR 0079 point 4). It is one more timestamp on a row that already exists, and
-- it goes with the row: at sign out, at expiry, and when the member is erased (core.erase_did, 0038, deletes every
-- app.session row through app.end_sessions_for_did).
ALTER TABLE app.session ADD COLUMN notifications_seen_at timestamptz;

GRANT SELECT (notifications_seen_at), UPDATE (notifications_seen_at) ON app.session TO web;

-- app.inbox (0036) says, for each row, whether this browser has seen it. A view may gain columns at the end of its
-- list and keeps its grants when replaced (https://www.postgresql.org/docs/18/sql-createview.html); security_invoker
-- is restated so web's own column grants keep applying under it. A session with no mark has seen nothing.
CREATE OR REPLACE VIEW app.inbox WITH (security_invoker = true) AS
  SELECT s.id_hash AS viewer, n.id, n.did, n.reason, n.topic, n.created_at,
         coalesce(n.created_at <= s.notifications_seen_at, false) AS seen
    FROM app.session s
    JOIN app.notification n ON n.did = s.did
   WHERE NOT n.older_sessions_only OR n.created_at > s.created_at;

GRANT SELECT (seen) ON app.inbox TO web;
