-- phase: expand
-- The indexer may end a DID's browser sessions (book P3.06g in docs/ai/book/phase-3.md, "P3.00 refinement for the
-- own-PDS profile slice"): when our PDS reports an account takendown, suspended, deleted or deactivated, P3.06s
-- ends its sessions in the transaction that records the state, through the one function that deletes sessions
-- (migration 0014, app.end_sessions_for_did; its reasons are a closed list, and 'deactivated' keeps the token set).
--
-- Calling a function in `app` needs USAGE on the schema as well as EXECUTE on the function. USAGE alone grants no
-- table, sequence or function: every app table grant is per role, and migration 0003 revokes EXECUTE from PUBLIC on
-- migrator's routines, so no function in `app` is executable by PUBLIC. tests/integration/postgres/
-- indexer-app-access.test.ts pins what `indexer` can reach there to this one function and no relation.
GRANT USAGE ON SCHEMA app TO indexer;
GRANT EXECUTE ON FUNCTION app.end_sessions_for_did(types.did, text) TO indexer;
