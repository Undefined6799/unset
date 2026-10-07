-- phase: expand
-- The sealed-value domain (P1.14d; plan section 5.3). A column that stores a seal envelope (`s1.<kid>.<rest>`, from
-- infrastructure/seal) is declared with it, so tests/integration/postgres/sealed-columns.test.ts finds it by type in
-- pg_catalog and fails while it has no row in infrastructure/postgres/sealed-columns.json, which names the row key its
-- seal context binds. The check holds the format and key id only; opening a value is seal's job, never the database's.
--
-- USAGE on a domain is PostgreSQL's default type privilege (PUBLIC; docs 18 ddl-priv, Table 5.2), as for types.did in
-- 0004: the schema USAGE granted in 0003 is the gate.
CREATE DOMAIN types.sealed AS text
  CHECK (VALUE ~ '^s1\.[a-z0-9]{1,16}\.');
