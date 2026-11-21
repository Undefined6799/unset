-- phase: expand
-- Seen once is seen on the whole account (book P2.27f, ADR 0090, Alex 2026-11-21 19:36Z): the bell's count, cleared
-- per browser by 0039 (ADR 0085), now clears on every browser of the member when any of them shows the list or opens
-- the bell. The account keeps the time of the newest entry any of its browsers has shown; it only moves forward.
--
-- One kind of entry stays per browser: a row marked older_sessions_only (the sign-in alert, ADR 0079 point 4). The
-- browser a sign-in is about may not see that alert, and a look there must not clear it on the member's other
-- browsers, so the account mark never covers such a row; only the session mark of a browser that showed it does.
-- Every kind added later (chat included) is covered by the account mark unless it is sent older_sessions_only.
--
-- One timestamp more on a row that exists already; it goes with the account row (core.erase_did deletes it).
ALTER TABLE app.account ADD COLUMN notifications_seen_at timestamptz;

GRANT SELECT (notifications_seen_at), UPDATE (notifications_seen_at) ON app.account TO web;

-- A view may keep its columns and grants when replaced (https://www.postgresql.org/docs/18/sql-createview.html);
-- security_invoker is restated so web's own column grants keep applying under it. The account row always exists for a
-- notification (app.notification.did references app.account), so the join drops nothing.
CREATE OR REPLACE VIEW app.inbox WITH (security_invoker = true) AS
  SELECT s.id_hash AS viewer, n.id, n.did, n.reason, n.topic, n.created_at,
         coalesce(n.created_at <= s.notifications_seen_at, false)
           OR (NOT n.older_sessions_only AND coalesce(n.created_at <= a.notifications_seen_at, false)) AS seen
    FROM app.session s
    JOIN app.notification n ON n.did = s.did
    JOIN app.account a ON a.did = s.did
   WHERE NOT n.older_sessions_only OR n.created_at > s.created_at;
