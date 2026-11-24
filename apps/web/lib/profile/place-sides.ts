// Where a Text card's single cell sides go (ADR 0110 points 4 and 5): each look names its table by one fingerprint for
// each of the table's source lines, and the page draws the look's edges on the table those lines are, whatever the
// card's four switches say. A look whose table is gone, or changed outside our editor, is not drawn. Drawing the
// sides is table-sides.ts, which the browser loads without the parser.

import { type Block, sourceLines, type TableBlock } from "./parse.ts";
import type { TableEdge, TableSides } from "./types.ts";

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * A line's fingerprint (ADR 0110 point 4): its spaces and tabs removed, then the first 8 lowercase hexadecimal
 * characters of SHA-256 over its UTF-8 bytes. Web Crypto's digest, global in Node 26 and every browser we serve.
 */
export async function fingerprint(line: string): Promise<string> {
  const bytes = new TextEncoder().encode(line.replace(/[ \t]/g, ""));
  return hex(await crypto.subtle.digest("SHA-256", bytes)).slice(0, 8);
}

/** A table as a look names it: the fingerprints of the lines it is written on, the delimiter row left out. */
async function nameOf(lines: readonly string[], { from, to }: { from: number; to: number }): Promise<string> {
  const own = lines.slice(from - 1, to).filter((_, i) => i !== 1);
  return (await Promise.all(own.map(fingerprint))).join(" ");
}

/**
 * Which of the card's tables each look is drawn on (ADR 0110 point 5), by the lines parse.ts noted for each top-level
 * table it shows whole: a look matches a table whose lines give exactly its fingerprints. Looks with the same
 * fingerprints go to the tables with those lines in order, and none of them applies when their numbers differ. No
 * text is parsed here: the lines come from the page's own bounded read (text-reader.ts).
 */
export async function placeSides(
  text: string,
  blocks: readonly Block[],
  sides: readonly TableSides[] | undefined,
): Promise<ReadonlyMap<TableBlock, readonly TableEdge[]>> {
  const placed = new Map<TableBlock, readonly TableEdge[]>();
  if (sides === undefined || sides.length === 0) return placed;
  const lines = sourceLines(text);
  const tables = blocks.flatMap((block) =>
    block.kind === "table" && block.from !== undefined && block.to !== undefined
      ? [{ block, from: block.from, to: block.to }]
      : [],
  );
  const names = await Promise.all(tables.map((table) => nameOf(lines, table)));
  for (const name of new Set(sides.map((look) => look.lines.join(" ")))) {
    const looks = sides.filter((look) => look.lines.join(" ") === name);
    const named = tables.filter((_, i) => names[i] === name);
    if (looks.length !== named.length) continue;
    for (const [i, { block }] of named.entries()) placed.set(block, looks[i]?.edges ?? []);
  }
  return placed;
}
