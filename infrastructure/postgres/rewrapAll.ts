// Key rotation for stored values (P1.14d; step book P1.14 `rewrapAll`). After a new key becomes active, every value in
// a registered `types.sealed` column gets its data key re-wrapped by it; the data part, and so the plaintext and the
// context, are untouched. Concurrency (rule DA-4): each batch is one transaction that locks its rows with
// FOR UPDATE SKIP LOCKED, so a row a request is writing is skipped and picked up by a later batch, and nothing but
// local crypto runs inside the transaction. Rows with a `form` are skipped: they hold no `s1` value.
import { createSealer, type Keyring, type Sealer } from "@unset/infrastructure-seal";
import pg from "pg";
import type { Pool, PoolClient } from "./pool.ts";
import { SEALED_COLUMNS, type SealedRegistry } from "./sealedColumns.ts";
import { withTransaction } from "./tx.ts";

/** Rows per key id. */
export type KidCounts = Readonly<Record<string, number>>;
type Target = { readonly table: string; readonly column: string; readonly rowKey: string };

/** Each registered `types.sealed` column, its names quoted (the registry already allows only plain identifiers). */
function targets(registry: SealedRegistry): Target[] {
  return Object.entries(registry)
    .filter(([, row]) => row.form === undefined)
    .map(([key, row]) => {
      const [schema = "", table = "", column = ""] = key.split(".");
      const quote = pg.escapeIdentifier;
      return { table: `${quote(schema)}.${quote(table)}`, column: quote(column), rowKey: quote(row.rowKey) };
    });
}

/** How many stored values each key id still wraps, over every registered `types.sealed` column. */
export async function kidCounts(pool: Pool, registry: SealedRegistry = SEALED_COLUMNS): Promise<KidCounts> {
  const counts: Record<string, number> = {};
  for (const { table, column } of targets(registry)) {
    const rows = await withTransaction(pool, null, async (client) => {
      const sql = `SELECT split_part(${column}, '.', 2) AS kid, count(*)::int AS n FROM ${table}
                    WHERE ${column} IS NOT NULL GROUP BY 1`;
      return (await client.query<{ kid: string; n: number }>(sql)).rows;
    });
    for (const { kid, n } of rows) counts[kid] = (counts[kid] ?? 0) + n;
  }
  return counts;
}

/** One batch: lock up to `batchSize` rows not under the active key, rewrap them, write them back. Returns the count. */
async function rewrapBatch(client: PoolClient, sealer: Sealer, target: Target, active: string, batchSize: number) {
  const { table, column, rowKey } = target;
  const { rows } = await client.query<{ row: string; value: string }>(
    `SELECT ${rowKey}::text AS row, ${column}::text AS value FROM ${table}
      WHERE split_part(${column}, '.', 2) <> $1 LIMIT $2 FOR UPDATE SKIP LOCKED`,
    [active, batchSize],
  );
  for (const { row, value } of rows) {
    await client.query(`UPDATE ${table} SET ${column} = $1 WHERE ${rowKey}::text = $2`, [sealer.rewrap(value), row]);
  }
  return rows.length;
}

/**
 * Moves every registered value to the keyring's active key and returns the rows per key id afterwards, with 0 for a
 * key that held values before. A value whose key is not in the keyring throws `seal.unknown_kid` and stops the run.
 */
export async function rewrapAll(
  pool: Pool,
  keyring: Keyring,
  options: { registry?: SealedRegistry; batchSize?: number } = {},
): Promise<KidCounts> {
  const { registry = SEALED_COLUMNS, batchSize = 500 } = options;
  const sealer = createSealer(keyring);
  const before = await kidCounts(pool, registry);
  for (const target of targets(registry)) {
    let moved: number;
    do {
      moved = await withTransaction(pool, null, (client) =>
        rewrapBatch(client, sealer, target, keyring.active, batchSize),
      );
    } while (moved > 0);
  }
  const after = await kidCounts(pool, registry);
  return { ...Object.fromEntries(Object.keys(before).map((kid) => [kid, 0])), ...after };
}

/** `unset-rewrap --check <kid>`: 1 while any stored value still uses `kid`, so the key must stay in the keyring. */
export const checkExit = (counts: KidCounts, kid: string): 0 | 1 => ((counts[kid] ?? 0) > 0 ? 1 : 0);
