-- phase: expand
-- The DID and AT-URI domains (P1.13; plan section 2 rule 11, section 6 eraseDid). Every column that can hold a DID
-- is declared with one of these, so tests/integration/postgres/did-columns.test.ts finds it by type in pg_catalog and
-- fails while it has no row in infrastructure/postgres/erasure-registry.json. Erasure reads a column type, not a name.
--
-- A domain's USAGE comes from PostgreSQL's default type privilege (PUBLIC; docs 18 ddl-priv, Table 5.2), so any role
-- that can reach the types schema may declare or cast to one. A domain holds no data; the schema USAGE granted in 0003
-- (web, api, indexer, admin) is the gate.

-- did:plc is 24 base32 characters; did:web is a lowercase host name only, with no port or path, as atproto uses it
-- (https://atproto.com/specs/did).
CREATE DOMAIN types.did AS text
  CHECK (VALUE ~ '^did:(plc:[a-z2-7]{24}|web:[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+)$');

-- The authority of an AT-URI as a DID; the cast to types.did rejects anything that is not one. Only its owner may run it
-- until a step that reads these columns (erasure, P3.07) grants it.
CREATE FUNCTION types.at_uri_did(uri text) RETURNS types.did
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN substring(uri FROM '^at://([^/]+)')::types.did;

-- An AT-URI names its repository's DID in the authority, so a column holding one is a DID column for erasure. A handle
-- authority is resolved to its DID before storage and never stored (https://atproto.com/specs/at-uri-scheme). The
-- check casts the authority to types.did rather than calling types.at_uri_did: a domain check runs with the writer's
-- rights, 0003 lets PUBLIC execute no routine, and a cast needs only the domain's USAGE.
CREATE DOMAIN types.at_uri AS text
  CHECK (VALUE ~ '^at://did:(plc|web):[^/]+(/[^/]+(/[^/]+)?)?$'
    AND substring(VALUE FROM '^at://([^/]+)')::types.did IS NOT NULL);
