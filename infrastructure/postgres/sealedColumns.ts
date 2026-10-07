// The sealed column registry (P1.14d; plan §5.3). A seal context is never a free string: it comes only from a column
// listed in sealed-columns.json and that row's key, so two call sites can never share or drift on one. Every column of
// type `types.sealed` (migration 0007) has a row; a row with a `form` registers a text or bytea column that names a
// stream-sealed object or holds a public-key record (step book P1.14 "Registering contexts"). The catalog query is
// what the registry test compares against.
import { type SealContext, sealContext } from "@unset/infrastructure-seal";
import { type Pool, withClient } from "./pool.ts";
import registry from "./sealed-columns.json" with { type: "json" };

export type SealedForm = "sealStream" | "sealToStream" | "sealTo";
export type SealedRow = { readonly rowKey: string; readonly form?: SealedForm };
export type SealedRegistry = Readonly<Record<string, SealedRow>>;
/** A registered column, `<schema>.<table>.<column>`: the keys of sealed-columns.json, typed with no generator. */
export type SealedColumnId = keyof typeof registry & string;

const IDENTIFIER = "[a-z_][a-z0-9_]{0,62}";
const COLUMN = new RegExp(`^${IDENTIFIER}\\.${IDENTIFIER}\\.${IDENTIFIER}$`);
const ROW_KEY = new RegExp(`^${IDENTIFIER}$`);
const FORMS: readonly string[] = ["sealStream", "sealToStream", "sealTo"];

/** Why one registry row is refused, or undefined when its key and fields are well formed. */
function rowProblem(key: string, row: unknown): string | undefined {
  if (!COLUMN.test(key)) return `${key} is not <schema>.<table>.<column>`;
  if (typeof row !== "object" || row === null) return `${key} has no row`;
  const { rowKey, form, ...rest } = row as Record<string, unknown>;
  if (typeof rowKey !== "string" || !ROW_KEY.test(rowKey)) return `${key} needs a rowKey column name`;
  if (form !== undefined && !FORMS.includes(String(form))) return `${key} has an unknown form`;
  if (Object.keys(rest).length > 0) return `${key} has a field other than rowKey and form`;
  return undefined;
}

/** The registry as read, after checking every key and row; anything else throws before any query is built. */
export function parseRegistry(value: unknown): SealedRegistry {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("sealed-columns.json: not an object");
  for (const [key, row] of Object.entries(value)) {
    const problem = rowProblem(key, row);
    if (problem !== undefined) throw new Error(`sealed-columns.json: ${problem}`);
  }
  return value as SealedRegistry;
}

export const SEALED_COLUMNS: SealedRegistry = parseRegistry(registry);

/** The context for `rowKey` of a column in `registry`; an unregistered column throws, even when cast to an id. */
export function contextIn(registry_: SealedRegistry, column: string, rowKey: string): SealContext {
  if (!Object.hasOwn(registry_, column)) throw new Error("seal context: the column is not in sealed-columns.json");
  return sealContext(column, rowKey);
}

/** The seal context of one row of a registered column. */
export const sealedContext = (column: SealedColumnId, rowKey: string): SealContext =>
  contextIn(SEALED_COLUMNS, column, rowKey);

export type CatalogColumn = { readonly key: string; readonly type: "sealed" | "text" | "bytea" };

/** Columns of tables in every schema that are `types.sealed`, or plain text or bytea a `form` row may name. */
const QUERY = `
  SELECT n.nspname || '.' || c.relname || '.' || a.attname AS key,
         CASE WHEN t.typname = 'sealed' AND t.typnamespace = 'types'::regnamespace THEN 'sealed' ELSE t.typname END
           AS type
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
   WHERE ((t.typname = 'sealed' AND t.typnamespace = 'types'::regnamespace) OR t.oid IN ('text'::regtype, 'bytea'::regtype))
     AND c.relkind IN ('r', 'p')
     AND a.attnum > 0 AND NOT a.attisdropped
     AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
   ORDER BY 1`;

export function sealedColumns(pool: Pool): Promise<CatalogColumn[]> {
  return withClient(pool, null, async (client) => (await client.query<CatalogColumn>(QUERY)).rows);
}
