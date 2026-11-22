-- phase: expand
-- The chat partner's public name (ADR 0107): the display name of a member's published profile, by chat user, for
-- chat_auth to show over the handle. Read-only and copied nowhere: a view owned by migrator, run with its owner's
-- rights (https://www.postgresql.org/docs/18/sql-createview.html, security_invoker defaults to false), so chat_auth
-- reads it with no grant on idx.profile, idx.public_profile or app.chat_account; security_barrier keeps a function in
-- the door's own WHERE clause from seeing a row the view leaves out
-- (https://www.postgresql.org/docs/18/rules-privileges.html). It is built on door.chat_contact (migration 0047), so the
-- page rule is web's own: only a ready chat account whose public page shows (idx.public_profile, migrations 0025 and
-- 0030), and a hidden, deactivated, suspended, erased or profile-less member reads as missing (D7, SE-2). The view
-- holds no row of its own: core.erase_did deletes the rows under it.
CREATE VIEW door.chat_name WITH (security_barrier) AS
  SELECT c.chat_user, p.display_name
    FROM door.chat_contact c
    JOIN idx.profile p USING (did);

GRANT SELECT (chat_user, display_name) ON door.chat_name TO chat_auth;
