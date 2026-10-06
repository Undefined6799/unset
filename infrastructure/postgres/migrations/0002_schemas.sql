-- phase: expand
-- The application schemas (P1.12s; plan section 5.2), owned by migrator, the role every migration runs as. Nobody
-- else may use them yet: P1.12 adds the roles and grants (a trusted-base change of its own, SE-6), and `audit` passes
-- to `audit_owner` there. `idx` is the one name for the index schema, never `index`.
CREATE SCHEMA app;
CREATE SCHEMA idx;
CREATE SCHEMA audit;
CREATE SCHEMA types;
