-- phase: expand
-- The role roster and baseline grants (P1.12; plan section 5.2, roles map to processes; section 6.1, CIS Postgres).
-- Every role in infrastructure/postgres/roles.json is created here with no table privilege; each table's creating
-- step grants what its roles need, by column list on a personal-data table, and
-- tests/integration/postgres/grants.test.ts diffs the cluster against grant-matrix.json and roles.json.
--
-- Roles are cluster-global while every database runs this file (each test file clones its own), so it is idempotent:
-- a role is created only when missing, then brought to the roster's state. A CREATEROLE role may change LOGIN and
-- CONNECTION LIMIT on a role it created, but only a superuser may change SUPERUSER, REPLICATION or BYPASSRLS, and
-- only a CREATEDB role CREATEDB (PostgreSQL 18 ALTER ROLE, checked on postgres:18.6), so those are fixed at creation.
-- No role gets a password here: P1.12p sets one, as migrator, for each login role whose roster entry names a password
-- file, so a login role whose entry names none cannot log in.

-- The roster: name, login, connection limit (-1 for a group or owner), statement_timeout (null: none set).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('web', true, 40, '2s'),
    ('api', true, 20, '2s'),
    ('indexer', true, 10, '10s'),
    ('admin', true, 10, '5s'),
    ('retention', true, 2, '60s'),
    ('media', true, 10, '2s'),
    ('review', true, 4, '10s'),
    ('review_egress', true, 2, '5s'),
    ('auditor', true, 2, '60s'),
    ('backup', true, 2, '0'),
    ('legal_hold_reader', false, -1, null),
    ('audit_owner', false, -1, null)
  ) AS roster (name, login, connection_limit, statement_timeout)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = r.name) THEN
      EXECUTE format('CREATE ROLE %I NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', r.name);
    END IF;
    EXECUTE format('ALTER ROLE %I %s CONNECTION LIMIT %s', r.name,
      CASE WHEN r.login THEN 'LOGIN' ELSE 'NOLOGIN' END, r.connection_limit);
    -- Every role: no stale setting, no session left idle in a transaction, no long lock wait, and an empty
    -- search_path, so code always schema-qualifies and an unqualified name can never be hijacked.
    EXECUTE format('ALTER ROLE %I RESET ALL', r.name);
    EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = %L', r.name, '10s');
    EXECUTE format('ALTER ROLE %I SET lock_timeout = %L', r.name, '3s');
    EXECUTE format('ALTER ROLE %I SET search_path = %L', r.name, '');
    IF r.statement_timeout IS NOT NULL THEN
      EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', r.name, r.statement_timeout);
    END IF;
  END LOOP;
END
$$;

-- This database: CONNECT for every login role and nothing for PUBLIC. A database cloned from a template starts with
-- the default ACL, which lets PUBLIC connect, so the revoke runs in every database, named by current_database().
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO web, api, indexer, admin, retention, media, review, '
    'review_egress, auditor, backup', current_database());
END
$$;

-- migrator may SET ROLE audit_owner, so it can hand the audit schema over below and P1.15 can create the audit objects
-- as their owner, but it never inherits that role's rights. So migrator can act as the audit owner (and drop its
-- triggers); the off-box chain-head anchor (P3.22) answers that.
GRANT audit_owner TO migrator WITH SET TRUE, INHERIT FALSE;

-- Schema use. USAGE alone grants nothing inside a schema; table, sequence and function grants come with each object.
GRANT USAGE ON SCHEMA app TO web, admin;
GRANT USAGE ON SCHEMA idx TO web, api, indexer, admin;
GRANT USAGE ON SCHEMA types TO web, api, indexer, admin;
-- audit: the callers of audit.append (P1.15), retention for P1.15a's segment and redaction functions, and auditor
-- for P1.15's and P1.15a's reads. migrator grants while it owns the schema; the grants survive the owner change.
GRANT USAGE ON SCHEMA audit TO web, indexer, admin, retention, auditor;
ALTER SCHEMA audit OWNER TO audit_owner;

-- Default privileges, narrowed (plan section 5.2 at 9c54e52): no ON TABLES default for any role in any schema,
-- because a default cannot tell a personal-data table from another. Routines are never executable by PUBLIC: the
-- revoke is global, since a per-schema default privilege can only add to the global ones (PostgreSQL 18 ALTER
-- DEFAULT PRIVILEGES). Defaults bind the creating role, and migrator may not set audit_owner's (it does not inherit
-- that role), so the step that first creates routines as audit_owner (P1.15) adds the same line for it;
-- grants.test.ts fails any routine PUBLIC may execute, whoever created it.
ALTER DEFAULT PRIVILEGES FOR ROLE migrator REVOKE EXECUTE ON ROUTINES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO web;
