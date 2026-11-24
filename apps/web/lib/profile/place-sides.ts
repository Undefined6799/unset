// Where a Text card's single cell sides go (ADR 0110 points 4 and 5): each look names its table by one fingerprint for
// each of the table's source lines, and the page draws the look's edges on the table those lines are, whatever the
// card's four switches say. A look whose table is gone, or changed outside our editor, is not drawn. Drawing the
// sides is table-sides.ts, which the browser loads without the parser.
//
// Naming costs one hash per line, so it runs once per text, inside the page's bounded and remembered read
// (interfaces/web text-reader.ts, review of #2028: placing on every load cost a visitor's load up to seconds), with a
// synchronous hash the reader passes in. Placing then only compares names.

import { type Block, type CardRead, MAX_CHARS, sourceLines, type TableBlock, topBlocks } from "./parse.ts";
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

/** A table's name as a look gives it: the fingerprints of its lines, the delimiter row left out, joined by spaces. */
function nameOf(lines: readonly string[], from: number, to: number, sha256: Sha256Hex): string {
  const own = lines.slice(from - 1, to).filter((_, i) => i !== 1);
  return own.map((line) => fingerprint(line, sha256)).join(" ");
}

/**
 * A line that may open `$$` math, after any quote and list markers: a superset of where micromark-extension-math 3.1.0
 * starts a math block (a fence of two or more dollars at a line's start), so a text it misses holds no math block.
 */
const MATH_FENCE = /^[ \t>*+\-\d.)]*\$\$/m;

/**
 * The longest text that is read a second time to count its tables as the editor does (nameTables, below): the page's
 * read must still fit one text's limit (text-reader.ts, review of #2028), and a full card read twice took about 180 ms
 * of processor time against 150. A longer text that needs it shows its tables without looks, which ADR 0110 allows: a
 * disagreement between parsers drops a look, it never moves one.
 */
export const MAX_READ_TWICE = MAX_CHARS / 2;

/**
 * The blocks with each top-level table that parse.ts noted the lines of named as a look names it. A table with more
 * lines than a look can name is not hashed.
 *
 * Looks are counted against the tables the editor reads (ADR 0110 decision 5, topBlocks), and the page can show fewer:
 * `$$` math, which the editor does not read, can hold a table or end one early, and the page's guards can stop
 * before a table or show one as written (CardRead.whole). Then a table keeps its name only if the editor reads a table
 * on the same lines and as many tables of that name as the page shows (Codex on #2028): otherwise one look meant for
 * a table the page hides could be drawn on another.
 */
export function nameTables(text: string, read: CardRead, sha256: Sha256Hex): Block[] {
  if (read.whole && !MATH_FENCE.test(text)) return named(text, read.blocks, sha256);
  if (text.length > MAX_READ_TWICE) return [...read.blocks];
  return asTheEditorReads(text, named(text, read.blocks, sha256), sha256);
}

function named(text: string, blocks: readonly Block[], sha256: Sha256Hex): Block[] {
  const lines = sourceLines(text);
  return blocks.map((block) => {
    if (block.kind !== "table" || block.from === undefined || block.to === undefined) return block;
    if (block.to - block.from > MAX_LOOK_LINES) return block;
    return { ...block, name: nameOf(lines, block.from, block.to, sha256) };
  });
}

/** The named tables the editor reads the same way: the others, and any whose count differs there, lose their name. */
function asTheEditorReads(text: string, blocks: Block[], sha256: Sha256Hex): Block[] {
  const lines = sourceLines(text);
  const onPage = new Map<string, string>();
  for (const block of blocks)
    if (block.kind === "table" && block.name) onPage.set(`${block.from}:${block.to}`, block.name);
  const editor = new Map<string, string>();
  const placement = editorBlocks(text);
  if (placement === null) return blocks.map((block) => (block.kind === "table" ? withoutName(block) : block));
  for (const { kind, from, to } of placement) {
    if (kind !== "table" || to - from > MAX_LOOK_LINES) continue;
    editor.set(`${from}:${to}`, onPage.get(`${from}:${to}`) ?? nameOf(lines, from, to, sha256));
  }
  const kept = blocks.map((block) =>
    block.kind === "table" && block.name !== undefined && editor.get(`${block.from}:${block.to}`) !== block.name
      ? withoutName(block)
      : block,
  );
  const shown = counts(kept.flatMap((block) => (block.kind === "table" && block.name ? [block.name] : [])));
  const read = counts(editor.values());
  return kept.map((block) =>
    block.kind === "table" && block.name !== undefined && shown.get(block.name) !== read.get(block.name)
      ? withoutName(block)
      : block,
  );
}

function counts(names: Iterable<string>): Map<string, number> {
  const seen = new Map<string, number>();
  for (const name of names) seen.set(name, (seen.get(name) ?? 0) + 1);
  return seen;
}

/**
 * The text's top-level blocks as the editor reads them, or null when that parse overflows the stack on deep nesting
 * (a RangeError, as parse.ts readCardBlocks catches for the page; Codex on #2028): then no table takes a look.
 */
function editorBlocks(text: string): ReturnType<typeof topBlocks> | null {
  try {
    return topBlocks(text);
  } catch {
    return null;
  }
}

const withoutName = ({ name: _, ...table }: TableBlock): TableBlock => table;

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
