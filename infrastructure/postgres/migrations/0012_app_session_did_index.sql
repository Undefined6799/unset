-- phase: expand
-- unset: no-transaction
-- P2.03i: app.session already exists (0011), so the index is built concurrently and the file holds one statement
-- (docs/human/db/migrations.md). A failed build leaves an INVALID index that IF NOT EXISTS skips; drop it by hand and
-- rerun (https://www.postgresql.org/docs/18/sql-createindex.html, "Building Indexes Concurrently").
-- query: infrastructure/session/store.ts:setEmailConfirmed
-- why: speed
CREATE INDEX CONCURRENTLY IF NOT EXISTS session_did ON app.session (did);
