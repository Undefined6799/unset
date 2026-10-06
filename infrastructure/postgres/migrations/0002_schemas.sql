-- phase: expand
-- The application schemas (P1.12; plan section 5.2), owned by migrator, the role every migration runs as. Nobody
-- else may use them until migration 0003 adds the roles and grants, where `audit` passes to `audit_owner`. `idx` is
-- the one name for the index schema, never `index`.
CREATE SCHEMA app;
CREATE SCHEMA idx;
CREATE SCHEMA audit;
CREATE SCHEMA types;
