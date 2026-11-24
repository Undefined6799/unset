// ADR 0110 points 2, 4 and 5: a look's edges are drawn on the table its line fingerprints name, and only there.
import { describe, expect, test } from "vitest";
import { parseReadme } from "./parse.ts";
import { fingerprint, placeSides } from "./place-sides.ts";
import type { TableEdge } from "./types.ts";

// SHA-256 over the line without its spaces, first 8 hex characters (node:crypto gave these for "|a|b|" and so on).
const A = ["5860afe6", "a4f3b853", "85a21f80"];
const TABLE = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";
const EDGE: TableEdge = { direction: "vertical", line: 1, cell: 0, hide: false };
/** For each block of `text`, the edges placed on it: null for a block that is no table. */
async function edgesOf(text: string, sides: Parameters<typeof placeSides>[2]) {
  const blocks = parseReadme(text);
  const placed = await placeSides(text, blocks, sides);
  return blocks.map((block) => (block.kind === "table" ? placed.get(block) : null));
}

describe("fingerprint", () => {
  test("is the first 8 hex characters of SHA-256 over the line with its spaces and tabs removed", async () => {
    expect(await fingerprint("| a | b |")).toBe(A[0]);
    expect(await fingerprint("|\ta\t|b|  ")).toBe(A[0]);
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
});
