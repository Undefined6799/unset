-- phase: expand
-- retention reaches the app schema (P1.16g): the jobs process sweeps expired single-use tokens (P1.16) as retention.
-- USAGE alone grants nothing inside the schema; each table P1.16 and later steps create grants retention its own
-- column-list rights. Schema USAGE is trusted base (SE-6), so it lands apart from the table that needs it.
GRANT USAGE ON SCHEMA app TO retention;
