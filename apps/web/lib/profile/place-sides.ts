// Where a Text card's single cell sides go (ADR 0110 points 4 and 5): each look names its table by one fingerprint for
// each of the table's source lines, and the page draws the look's edges on the table those lines are, whatever the
// card's four switches say. A look whose table is gone, or changed outside our editor, is not drawn. Drawing the
// sides is table-sides.ts, which the browser loads without the parser.
//
// Naming costs one hash per line, so it runs once per text, inside the page's bounded and remembered read
// (interfaces/web text-reader.ts, review of #2028: placing on every load cost a visitor's load up to seconds), with a
// synchronous hash the reader passes in. Placing then only compares names.

import { type Block, sourceLines, type TableBlock } from "./parse.ts";
import type { TableEdge, TableSides } from "./types.ts";

/** The most lines a look names (sh.unset.block.text#tableEdges `lines` maxLength): a longer table matches none. */
export const MAX_LOOK_LINES = 1_000;

/** SHA-256 over a string's UTF-8 bytes, as lowercase hexadecimal. */
export type Sha256Hex = (text: string) => string;

/**
 * A line's fingerprint (ADR 0110 point 4): its spaces and tabs removed, then the first 8 lowercase hexadecimal
 * characters of SHA-256 over its UTF-8 bytes.
 */
export const fingerprint = (line: string, sha256: Sha256Hex): string => sha256(line.replace(/[ \t]/g, "")).slice(0, 8);

/**
 * The blocks with each top-level table that parse.ts noted the lines of named as a look names it: the fingerprints of
 * its lines, the delimiter row left out, joined by spaces. A table with more lines than a look can name is not hashed.
 */
export function nameTables(text: string, blocks: readonly Block[], sha256: Sha256Hex): Block[] {
  const lines = sourceLines(text);
  return blocks.map((block) => {
    if (block.kind !== "table" || block.from === undefined || block.to === undefined) return block;
    if (block.to - block.from > MAX_LOOK_LINES) return block;
    const own = lines.slice(block.from - 1, block.to).filter((_, i) => i !== 1);
    return { ...block, name: own.map((line) => fingerprint(line, sha256)).join(" ") };
  });
}

/**
 * Which of the card's tables each look is drawn on (ADR 0110 point 5): a look matches a named table whose lines give
 * exactly its fingerprints. Looks with the same fingerprints go to the tables with those lines in order, and none of
 * them applies when their numbers differ. A table with no name can match no look, so it never shifts that order.
 */
export function placeSides(
  blocks: readonly Block[],
  sides: readonly TableSides[] | undefined,
): ReadonlyMap<TableBlock, readonly TableEdge[]> {
  const placed = new Map<TableBlock, readonly TableEdge[]>();
  if (sides === undefined || sides.length === 0) return placed;
  const tables = blocks.filter((block): block is TableBlock => block.kind === "table" && block.name !== undefined);
  for (const name of new Set(sides.map((look) => look.lines.join(" ")))) {
    const looks = sides.filter((look) => look.lines.join(" ") === name);
    const named = tables.filter((table) => table.name === name);
    if (looks.length !== named.length) continue;
    for (const [i, table] of named.entries()) placed.set(table, looks[i]?.edges ?? []);
  }
  return placed;
}
