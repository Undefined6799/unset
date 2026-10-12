-- phase: expand
-- unset: no-transaction
-- P2.03i: the sweep's index, built concurrently in its own file as 0012 is (docs/human/db/migrations.md).
-- query: infrastructure/session/store.ts:sweep
-- why: speed
CREATE INDEX CONCURRENTLY IF NOT EXISTS session_absolute_expires_at ON app.session (absolute_expires_at);
