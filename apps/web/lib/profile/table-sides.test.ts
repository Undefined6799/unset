// ADR 0110 points 2 and 5: each cell's sides come from the card's switches, then from the edges placed on its table.
import { describe, expect, test } from "vitest";
import { cellSides, sideClasses } from "./table-sides.ts";
import type { TableEdge } from "./types.ts";

const OFF = { hideHeaderLine: false, hideRowLines: false, showColumnLines: false, showOutline: false };

describe("cellSides", () => {
  test("our look: the line under the header and under each row, no columns, no outline", () => {
    const sides = cellSides(undefined, [], 3, 2);
    expect(sides[0]?.map(sideClasses)).toEqual(["border-b", "border-b"]);
    expect(sides[1]?.map(sideClasses)).toEqual(["border-t border-b", "border-t border-b"]);
    expect(sides[2]?.map(sideClasses)).toEqual(["border-t border-b", "border-t border-b"]);
    expect(cellSides({ ...OFF, hideHeaderLine: true }, [], 1, 1).map((row) => row.map(sideClasses))).toEqual([[""]]);
  });

  test("the outline is drawn on the outer cells, so an edge can hide part of it", () => {
    const lines = { hideHeaderLine: true, hideRowLines: true, showColumnLines: false, showOutline: true };
    const sides = cellSides(lines, [{ direction: "horizontal", line: 0, cell: 1, hide: true }], 2, 2);
    expect(sides.map((row) => row.map(sideClasses))).toEqual([
      ["border-t border-s", "border-e"],
      ["border-b border-s", "border-b border-e"],
    ]);
  });

  test("an edge shows or hides its side on both cells that share it, the later one counts, one out of range is ignored", () => {
    const edges: TableEdge[] = [
      { direction: "horizontal", line: 1, cell: 0, hide: true },
      { direction: "vertical", line: 1, cell: 1, hide: true },
      { direction: "vertical", line: 1, cell: 1, hide: false },
      { direction: "vertical", line: 9, cell: 0, hide: false },
      { direction: "horizontal", line: 0, cell: 5, hide: false },
    ];
    const sides = cellSides(undefined, edges, 2, 2);
    expect(sides.map((row) => row.map(sideClasses))).toEqual([
      ["", "border-b"],
      ["border-b border-e", "border-t border-b border-s"],
    ]);
  });
});
