-- phase: expand
-- A notification reason for the owner (book P2.10s; ADR 0080 point 4, ADR 0079): web tells the member named by
-- INVITE_REQUEST_OWNER_DID when a visitor's invite request could not be mailed to them, at most once a UTC day (its
-- dedupe key). The entry carries no address and no topic; the visitor's address was forgotten with the failure.
-- The closed reason list grows by migration (0036): the CHECK is replaced by one that also allows the new reason.
-- Every row already stored passes it, so build and older builds keep working; ALTER TABLE ... ADD CONSTRAINT scans
-- app.notification once under ACCESS EXCLUSIVE (https://www.postgresql.org/docs/18/sql-altertable.html, read
-- 2026-11-21), a table of at most 30 days of entries per member.
ALTER TABLE app.notification
  DROP CONSTRAINT notification_reason_check,
  ADD CONSTRAINT notification_reason_check CHECK (reason IN ('sign_in', 'privacy_notice', 'invite_mail_failed'));
