-- phase: expand
-- The owner of core.erase_did may reach the audit (P3.07g; plan section 5.2 roles; admin design section 8). erase_did
-- (P3.07k) is a SECURITY DEFINER function owned by migrator, so migrator is the one role that needs to call
-- audit.erase_subject (the person's security-lane rows go) and audit.append (the erasure itself is recorded, with no
-- target). No service role is granted erase_subject: it is reached only through erase_did. Both functions exist
-- since 0008 and 0018.

SET ROLE audit_owner;

-- USAGE grants nothing inside the schema; the two EXECUTE grants below are all migrator holds there.
GRANT USAGE ON SCHEMA audit TO migrator;
GRANT EXECUTE ON FUNCTION audit.erase_subject(types.did) TO migrator;
GRANT EXECUTE ON FUNCTION audit.append(text, text, types.did, text, types.did, text, uuid, text, uuid, bytea)
  TO migrator;

RESET ROLE;
