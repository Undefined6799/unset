// The one query that lists every DID-bearing column (P1.13; plan section 2 rule 11). A column holds a DID when its type
// is one of the `types` domains from migration 0004, or an array of one; the catalog says so, not a hand-kept list.
// Read by the erasure-registry test, by eraseDid (P3.07) and by the export policy (P4.26).
import { type Pool, withClient } from "./pool.ts";

export type DidColumnKind = "did" | "did[]" | "at_uri" | "at_uri[]";
export type DidColumn = {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
  readonly kind: DidColumnKind;
};

/** Tables and partitioned tables in every schema, plugin schemas included; views derive from them and are skipped. */
const QUERY = `
  SELECT n.nspname AS schema, c.relname AS table, a.attname AS column,
         CASE t.typname WHEN 'did' THEN 'did' WHEN '_did' THEN 'did[]'
                        WHEN 'at_uri' THEN 'at_uri' ELSE 'at_uri[]' END AS kind
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
   WHERE t.typname IN ('did', '_did', 'at_uri', '_at_uri')
     AND t.typnamespace = 'types'::regnamespace
     AND c.relkind IN ('r', 'p')
     AND a.attnum > 0 AND NOT a.attisdropped
   ORDER BY 1, 2, 3`;

export function didColumns(pool: Pool): Promise<DidColumn[]> {
  return withClient(pool, null, async (client) => (await client.query<DidColumn>(QUERY)).rows);
}
