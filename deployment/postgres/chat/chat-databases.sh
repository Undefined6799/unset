#!/usr/bin/env bash
# The chat servers' roles and databases (P6.02; ADR 0086 Decision 3): synapse and mas, each a login role that owns its
# own database and holds no other right. Not an initdb file: the staging cluster already exists, so an operator runs
# this once inside the postgres container, as its postgres user over the local socket (pg_hba.conf's only superuser
# line), as docs/human/runbooks/chat-servers.md says. It may run again: what exists is left as it is.
#
# Synapse needs its database in the C collation and ctype, UTF8 (synapse docs/postgres.md at v1.165.0, "Set up
# database"), so it is made from template0. Passwords are read as in 00-bootstrap.sh: a backtick \set inside psql,
# reaching SQL only through :'name' quoting, never through argv or the environment (psql docs, "SQL Interpolation").
set -euo pipefail

SECRETS=/run/secrets

# Fail closed before any statement: a missing or empty secret file stops the script.
for name in pg_synapse_password pg_mas_password; do
  if [ ! -s "$SECRETS/$name" ]; then
    echo "chat-databases: secret $name is missing or empty" >&2
    exit 1
  fi
done

psql -v ON_ERROR_STOP=1 --no-psqlrc --no-password --username postgres --dbname postgres -v secrets="$SECRETS" <<'SQL'
SET password_encryption = 'scram-sha-256';
\set synapse_file :secrets '/pg_synapse_password'
\set mas_file :secrets '/pg_mas_password'
\set synapse_password `cat :'synapse_file'`
\set mas_password `cat :'mas_file'`

SELECT 'CREATE ROLE synapse LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'synapse') \gexec
SELECT 'CREATE ROLE mas LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mas') \gexec
-- The password is always the file's: a rotated file takes effect on the next run.
ALTER ROLE synapse PASSWORD :'synapse_password';
ALTER ROLE mas PASSWORD :'mas_password';
\unset synapse_password
\unset mas_password

SELECT 'CREATE DATABASE synapse OWNER synapse TEMPLATE template0 ENCODING ''UTF8'' LC_COLLATE ''C'' LC_CTYPE ''C'''
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'synapse') \gexec
SELECT 'CREATE DATABASE mas OWNER mas'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mas') \gexec
REVOKE ALL ON DATABASE synapse FROM PUBLIC;
REVOKE ALL ON DATABASE mas FROM PUBLIC;

\connect synapse
REVOKE ALL ON SCHEMA public FROM PUBLIC;
\connect mas
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL
