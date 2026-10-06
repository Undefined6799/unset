#!/usr/bin/env bash
# The cluster's first roles (P1.11g; plan §5.2, §6.1 CIS Postgres). The official image runs this once, at initdb, as
# the bootstrap superuser (an executable *.sh in /docker-entrypoint-initdb.d; docker-entrypoint.sh
# docker_process_init_files, postgres:18.6). It creates exactly `migrator` (runs every migration), `tap`, their
# databases and the PUBLIC revokes. Every other role comes from migrations (P1.12).
#
# Passwords are read inside psql with a backtick \set (psql shell-quotes :'name' there), so they never appear in argv
# or the environment, and reach SQL only through :'name' literal quoting (psql docs, "SQL Interpolation", PG 18).
set -euo pipefail

SECRETS=/run/secrets

# Fail closed before any statement: a missing or empty secret file stops the container.
for name in pg_migrator_password pg_tap_password; do
  if [ ! -s "$SECRETS/$name" ]; then
    echo "00-bootstrap: secret $name is missing or empty" >&2
    exit 1
  fi
done

psql -v ON_ERROR_STOP=1 --no-psqlrc --no-password --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v secrets="$SECRETS" <<'SQL'
-- SCRAM only, before any role gets a password (PG 18 deprecates MD5; stated, not assumed).
ALTER SYSTEM SET password_encryption = 'scram-sha-256';
SELECT pg_reload_conf();
SET password_encryption = 'scram-sha-256';

\set migrator_file :secrets '/pg_migrator_password'
\set tap_file :secrets '/pg_tap_password'
\set migrator_password `cat :'migrator_file'`
\set tap_password `cat :'tap_file'`

CREATE ROLE migrator LOGIN NOSUPERUSER NOCREATEDB CREATEROLE NOREPLICATION NOBYPASSRLS
  PASSWORD :'migrator_password';
CREATE ROLE tap LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'tap_password';
\unset migrator_password
\unset tap_password

CREATE DATABASE unset OWNER migrator;
CREATE DATABASE tap OWNER tap;
REVOKE ALL ON DATABASE unset FROM PUBLIC;
REVOKE ALL ON DATABASE tap FROM PUBLIC;

\connect unset
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
