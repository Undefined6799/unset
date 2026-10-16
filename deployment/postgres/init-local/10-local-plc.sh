#!/usr/bin/env bash
# The local stack's PLC directory gets its own role and database (P1.34u, issue #781). Local only: compose.local.yaml
# mounts this file next to the shared bootstrap (P1.34v); dev and prod never mount this folder, and roles.json has no
# PLC role. The official image runs it once, at initdb, as the bootstrap superuser, after 00-bootstrap.sh
# (docker-entrypoint.sh docker_process_init_files runs /docker-entrypoint-initdb.d/* in sorted order, postgres:18.6).
#
# The PLC server runs its own Kysely migrations into schema public of the database it is given
# (did-method-plc bed123d, packages/server/src/db/index.ts:95-99 and service/index.js:10-16), and needs no extension,
# so owning its database is all the role needs. It has no right anywhere else: 00-bootstrap.sh revoked PUBLIC from the
# unset and tap databases, and this file revokes it from the default ones. The password is read as in 00-bootstrap.sh:
# a backtick \set inside psql, reaching SQL only through :'name' quoting, never through argv or the environment.
set -euo pipefail

SECRETS=/run/secrets

# Fail closed before any statement: a missing or empty secret file stops the container.
if [ ! -s "$SECRETS/pg_plc_password" ]; then
  echo "10-local-plc: secret pg_plc_password is missing or empty" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --no-psqlrc --no-password --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v secrets="$SECRETS" <<'SQL'
-- SCRAM for this session too, so the verifier never depends on the order of the init files.
SET password_encryption = 'scram-sha-256';

\set plc_file :secrets '/pg_plc_password'
\set plc_password `cat :'plc_file'`
CREATE ROLE plc LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'plc_password';
\unset plc_password

CREATE DATABASE plc OWNER plc;
REVOKE ALL ON DATABASE plc FROM PUBLIC;
-- PUBLIC holds CONNECT and TEMPORARY on the default databases (PG 18 docs, ddl-priv.html, "Default privileges"), so
-- the plc role could otherwise open postgres or template1 and fill the volume with temporary tables. Only the
-- bootstrap superuser, which bypasses grants, connects to either; no role creates databases from template1.
REVOKE CONNECT, TEMPORARY ON DATABASE postgres, template1 FROM PUBLIC;

\connect plc
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL
