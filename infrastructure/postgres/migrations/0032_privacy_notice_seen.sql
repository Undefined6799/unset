-- phase: expand
-- P2.12b (docs/ai/book/phase-2.md; Alex's "Dismiss button", 2026-10-19 02:58:35Z): the privacy notice version a
-- member dismissed the changed-notice banner for. A seen record, never an acceptance: privacy_version still holds only
-- what the terms step accepted. Its type matches privacy_version (0015). Nullable with no default, so adding it
-- rewrites nothing (https://www.postgresql.org/docs/18/sql-altertable.html, Notes) and every existing account keeps
-- seeing the banner for a changed notice until it dismisses it. It leaves with the row on erasure
-- (erasure-registry.json, app.account.did, delete_row).
-- Column grants only, like the rest of app.account (0015): web reads it for the banner and writes it from the dismiss
-- POST; no INSERT, because the row always exists before the banner can show; no other role gets it
-- (https://www.postgresql.org/docs/18/sql-grant.html, column privileges).
ALTER TABLE app.account ADD COLUMN privacy_notice_seen_version text;

GRANT SELECT (privacy_notice_seen_version), UPDATE (privacy_notice_seen_version) ON app.account TO web;
