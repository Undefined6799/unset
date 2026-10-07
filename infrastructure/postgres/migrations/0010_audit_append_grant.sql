-- phase: expand
-- The audit store, part 3 of 3 (P1.15g; plan section 5.7): the writers of P1.15's actions may call audit.append, the
-- only way into the audit tables (0008 and 0009). review and review_egress get it with their phase (P4.07).

SET ROLE audit_owner;

GRANT EXECUTE ON FUNCTION audit.append(text, text, types.did, text, types.did, text, uuid, text, uuid, bytea)
  TO web, indexer, admin;

RESET ROLE;
