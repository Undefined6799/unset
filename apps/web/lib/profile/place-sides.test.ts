// ADR 0110 points 2, 4 and 5: a look's edges are drawn on the table its line fingerprints name, and only there.
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { parseReadme, sourceLines, topBlocks } from "./parse.ts";
import { fingerprint, MAX_LOOK_LINES, nameTables, placeSides } from "./place-sides.ts";
import type { TableEdge } from "./types.ts";

// SHA-256 over the line without its spaces, first 8 hex characters (node:crypto gave these for "|a|b|" and so on).
const A = ["5860afe6", "a4f3b853", "85a21f80"];
const TABLE = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";
const EDGE: TableEdge = { direction: "vertical", line: 1, cell: 0, hide: false };
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
/** For each block of `text`, the edges placed on it: null for a block that is no table. */
async function edgesOf(text: string, sides: Parameters<typeof placeSides>[1]) {
  const blocks = nameTables(text, parseReadme(text), sha256);
  const placed = placeSides(blocks, sides);
  return blocks.map((block) => (block.kind === "table" ? placed.get(block) : null));
}

describe("fingerprint", () => {
  test("is the first 8 hex characters of SHA-256 over the line with its spaces and tabs removed", async () => {
    expect(fingerprint("| a | b |", sha256)).toBe(A[0]);
    expect(fingerprint("|\ta\t|b|  ", sha256)).toBe(A[0]);
  });
});

// Review of #2028: naming hashes each line, so a table no look can name is never hashed, and a reader that names
// nothing places nothing.
describe("nameTables", () => {
  test("a table with more lines than a look can name is never hashed", () => {
    const hashed: string[] = [];
    const counting = (text: string) => {
      hashed.push(text);
      return sha256(text);
    };
    const long = `| a |\n| - |\n${"| 1 |\n".repeat(MAX_LOOK_LINES)}`;
    expect(nameTables(long, parseReadme(long), counting).map((block) => "name" in block)).toEqual([false]);
    expect(hashed).toEqual([]);
    const most = `| a |\n| - |\n${"| 1 |\n".repeat(MAX_LOOK_LINES - 1)}`;
    const [named] = nameTables(most, parseReadme(most), counting);
    expect(named?.kind === "table" && named.name?.split(" ").length).toBe(MAX_LOOK_LINES);
  });

  test("tables a reader did not name take no look", () => {
    const placed = placeSides(parseReadme(TABLE), [{ lines: A, edges: [EDGE] }]);
    expect(placed.size).toBe(0);
  });
});

describe("placeSides", () => {
  test("a look goes to the table whose lines it names, the delimiter row left out, wherever the table moved", async () => {
    const text = `# Moved down\n\nwords\n\n${TABLE}\n\nmore`;
    expect(await edgesOf(text, [{ lines: A, edges: [EDGE] }])).toEqual([null, null, [EDGE], null]);
  });

  test("a table changed outside our editor, other than in its spaces, loses its look", async () => {
    const text = TABLE.replace("| 3 | 4 |", "| 3 | 5 |");
    expect(await edgesOf(text, [{ lines: A, edges: [EDGE] }])).toEqual([undefined]);
    const padded = TABLE.replace("| 3 | 4 |", "|3|   4|");
    expect(await edgesOf(padded, [{ lines: A, edges: [EDGE] }])).toEqual([[EDGE]]);
  });

  test("looks with the same lines go to those tables in order, and none applies when the numbers differ", async () => {
    const text = `${TABLE}\n\nbetween\n\n${TABLE}`;
    const other: TableEdge = { ...EDGE, hide: true };
    const two = await edgesOf(text, [
      { lines: A, edges: [EDGE] },
      { lines: A, edges: [other] },
    ]);
    expect(two).toEqual([[EDGE], null, [other]]);
    expect(await edgesOf(text, [{ lines: A, edges: [EDGE] }])).toEqual([undefined, null, undefined]);
  });

  test("a table inside a list or a quote takes no look: looks name top-level blocks", async () => {
    const look = [{ lines: A, edges: [EDGE] }];
    const listed = `- item\n\n  ${TABLE.replaceAll("\n", "\n  ")}`;
    const quoted = `> ${TABLE.replaceAll("\n", "\n> ")}`;
    for (const text of [listed, quoted]) expect((await edgesOf(text, look)).filter((edges) => edges)).toEqual([]);
  });

  test("a look for a table that takes more lines than it names does not match: the block must end there", async () => {
    const text = `${TABLE}\n| 5 | 6 |`;
    expect(await edgesOf(text, [{ lines: A, edges: [EDGE] }])).toEqual([undefined]);
  });

  // ADR 0110 decision 5: the editor places looks on the tables CommonMark with GFM tables reads (topBlocks); the page
  // also draws `$$` math, which can end a table early or hold one. Such a table takes no look, and the others keep
  // theirs.
  test("a table that math ends early or holds takes no look, and the tables after it keep theirs", async () => {
    const editorLines = (text: string) => {
      const [table] = topBlocks(text).filter((block) => block.kind === "table");
      const lines = sourceLines(text).slice((table?.from ?? 1) - 1, table?.to);
      return lines.filter((_, index) => index !== 1).map((line) => fingerprint(line, sha256));
    };
    const ended = `${TABLE}\n$$\nx\n$$`;
    expect(await edgesOf(ended, [{ lines: editorLines(ended), edges: [EDGE] }])).toEqual([undefined, null]);
    const held = `$$\n${TABLE}\n$$\n\n${TABLE}`;
    const second: TableEdge = { ...EDGE, hide: true };
    expect(await edgesOf(held, [{ lines: A, edges: [second] }])).toEqual([null, [second]]);
    const both = [
      { lines: A, edges: [EDGE] },
      { lines: A, edges: [second] },
    ];
    expect(await edgesOf(held, both)).toEqual([null, undefined]);
  });

  // Codex on #2028: the editor counts the table math holds, so one look for two such tables applies to neither there,
  // and must not move onto the one the page shows.
  test("tables are counted as the editor reads them, so a look cannot move onto a table when math hides its own", async () => {
    const hidden = `$$\n\n${TABLE}\n\n$$\n\n${TABLE}`;
    expect(topBlocks(hidden).filter((block) => block.kind === "table")).toHaveLength(2);
    expect(await edgesOf(hidden, [{ lines: A, edges: [EDGE] }])).toEqual([null, undefined]);
  });
});
