-- phase: expand
-- The single-use sweep as one fixed statement (P1.16w; whole-project review 2026-11-15, privacy item 4; Alex's
-- decision 3 of 2026-11-15T23:29Z). 0006 lets only retention delete from app.single_use, and no process runs as
-- retention until interfaces/jobs exists (P4.25), so consumed and expired tokens, some bound to a DID, were never
-- removed. web calls this from its hourly sweeps (interfaces/http/jobs/sweeps.ts). It takes no argument and deletes
-- only rows a day past expiry, so web gains no DELETE: it still cannot remove a live or just-used
-- token, and a replayed token finds its row or, a day after expiry, no row, and is refused either way. Returns the
-- number of rows removed.
CREATE FUNCTION app.sweep_single_use() RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, app
AS $$
DECLARE
  swept int;
BEGIN
  DELETE FROM app.single_use WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS swept = ROW_COUNT;
  RETURN swept;
END
$$;

-- 0003 revokes EXECUTE on migrator's routines from PUBLIC. retention keeps its own DELETE from 0006 and gets the
-- function too, so the jobs process (P4.25) runs the same statement.
GRANT EXECUTE ON FUNCTION app.sweep_single_use() TO web, retention;
