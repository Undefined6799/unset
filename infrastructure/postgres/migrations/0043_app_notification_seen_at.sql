-- phase: expand
-- A sign-in alert seen once is seen on every browser (book P2.27g, ADR 0108, Alex 2026-11-21 23:56Z). 0041 (ADR 0090)
-- left the alert per browser, because one account-wide time cannot say which browser looked: a browser the intruder
-- signed in later is told of the intruder's later sign-ins, and a time it moved would cover the first alert too.
-- So each alert keeps its own mark instead: set when a browser that may see it (one signed in before it, app.inbox)
-- shows it, and then counted on every browser of the member. The browser a sign-in is about never sees that alert, so
-- no browser the intruder holds can mark the alert about its first sign-in.
--
-- Only rows sent older_sessions_only are marked (notificationStore.ts); every other kind stays under the account mark.
-- One timestamp more on a row that already exists; it goes with the row (the 30-day sweep, dismissal, core.erase_did).
ALTER TABLE app.notification ADD COLUMN seen_at timestamptz;

GRANT SELECT (seen_at), UPDATE (seen_at) ON app.notification TO web;

-- As in 0041: a replaced view keeps its columns and grants (https://www.postgresql.org/docs/18/sql-createview.html),
-- and security_invoker is restated so web's own column grants keep applying under it.
CREATE OR REPLACE VIEW app.inbox WITH (security_invoker = true) AS
  SELECT s.id_hash AS viewer, n.id, n.did, n.reason, n.topic, n.created_at,
         coalesce(n.created_at <= s.notifications_seen_at, false)
           OR (NOT n.older_sessions_only AND coalesce(n.created_at <= a.notifications_seen_at, false))
           OR (n.older_sessions_only AND n.seen_at IS NOT NULL) AS seen
    FROM app.session s
    JOIN app.notification n ON n.did = s.did
    JOIN app.account a ON a.did = s.did
   WHERE NOT n.older_sessions_only OR n.created_at > s.created_at;
