// Seal contexts (P1.14): the column and row a sealed value belongs to, bound into it as GCM additional data, so a
// value moved to another row or column fails to open. A context is never a free string: only `sealContext` makes one,
// and the column ids come from the registry the database side keeps (P1.14d types them as its keys).

import { SealError } from "./seal.ts";

declare const sealContextBrand: unique symbol;
/** `"<schema>.<table>.<column>|<rowKey>"`, made only by `sealContext`. */
export type SealContext = string & { readonly [sealContextBrand]: true };

const COLUMN = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;
/** Printable ASCII without `|`, which separates the row key from the column. */
const ROW_KEY = /^[\x20-\x7b\x7d\x7e]+$/;

/** `seal.format` unless `context` has the shape `sealContext` makes: a cast from a free string is refused too. */
export function checkContext(context: SealContext): void {
  const bar = context.indexOf("|");
  if (bar === -1 || !COLUMN.test(context.slice(0, bar)) || !ROW_KEY.test(context.slice(bar + 1)))
    throw new SealError("seal.format");
}

/** The context for one column of one row. Throws on a malformed column or row key; neither is ever echoed. */
export function sealContext(column: string, rowKey: string): SealContext {
  if (!COLUMN.test(column)) throw new Error("seal context: column is not <schema>.<table>.<column>");
  if (!ROW_KEY.test(rowKey)) throw new Error("seal context: row key is empty, not printable ASCII, or holds |");
  return `${column}|${rowKey}` as SealContext;
}
