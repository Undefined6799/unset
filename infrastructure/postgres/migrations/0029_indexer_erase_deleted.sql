-- phase: expand
-- The indexer may erase an account its PDS has confirmed deleted (book P3.06e in docs/ai/book/phase-3.md; P3.06
-- `confirm_deletion` step 2; plan section 5.2). Until this migration a confirmed deletion was hidden and left as a
-- `deletion_confirmed_not_erased` dead letter (P3.06s).
--
-- The narrowest form: indexer gets EXECUTE on one definer, idx.erase_deleted_account, and nothing in schema core. The
-- definer fixes the reason to 'account_deleted' and refuses unless the index already holds the account hidden as
-- deleted (pds_status 'deleted', not pds_active), the state confirm_deletion writes after our PDS's answer. It then
-- calls core.erase_did, which keeps its own checks: the closed reason list, the DID-column coverage check, the per-DID
-- lock, legal holds, the tombstone and the audit row.
--
-- A cap bounds what a buggy or compromised indexer could do by marking rows deleted first (it may UPDATE pds_status):
-- at most 20 'account_deleted' erasures in any hour, counted from the tombstones, above our expected deletion volume
-- at this size. Past it the function erases nothing and returns NULL (a refusal, not an error, so the
-- caller's transaction goes on), the indexer counts it and asks again an hour later, and an operator can still erase through the owner's path (core.erase_did as migrator). A transaction
-- lock serialises the count, so two concurrent calls cannot both pass at 19.
--
-- audit.append admits writers by session_user (migration 0016), so 'indexer' joins the writers of 'account.erased'
-- only. indexer holds no USAGE on schema audit and no EXECUTE on audit.append, so that admission is reachable only
-- through this definer and core.erase_did.

SET ROLE audit_owner;
UPDATE audit.actions SET writers = writers || 'indexer'::name
 WHERE action = 'account.erased' AND NOT 'indexer'::name = ANY (writers);
RESET ROLE;

CREATE FUNCTION idx.erase_deleted_account(p_did types.did) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c_max_per_hour CONSTANT integer := 20;
BEGIN
  IF p_did IS NULL OR NOT EXISTS (
    SELECT 1 FROM idx.account a WHERE a.did = p_did AND a.pds_status = 'deleted' AND NOT a.pds_active
  ) THEN
    RAISE EXCEPTION 'erase_not_confirmed_deleted' USING ERRCODE = '55000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('erase_deleted_account'));
  IF (SELECT count(*) FROM core.erased_did e
       WHERE e.why = 'account_deleted' AND e.erased_at > now() - interval '1 hour') >= c_max_per_hour THEN
    RETURN NULL;
  END IF;
  RETURN core.erase_did(p_did, 'account_deleted');
END
$$;
REVOKE EXECUTE ON FUNCTION idx.erase_deleted_account(types.did) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION idx.erase_deleted_account(types.did) TO indexer;

-- Deletions P3.06s confirmed but could not erase are asked about again, so the indexer erases them now.
INSERT INTO idx.account_job (did, kind, due_at, attempts, first_queued_at)
SELECT DISTINCT d.did, 'confirm_deletion', now(), 0, now()
  FROM idx.dead_letter d JOIN idx.account a ON a.did = d.did
 WHERE d.reason_code = 'deletion_confirmed_not_erased'
ON CONFLICT (did, kind) DO NOTHING;
