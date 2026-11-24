// How each cell of a Text card's table is drawn (ADR 0110 points 2 and 5): the card's four switches, then the single
// cell sides a look placed on the table (place-sides.ts).

import type { TableEdge, TableLines } from "./types.ts";

/** Which sides of one cell are drawn. */
export type CellSides = { top: boolean; bottom: boolean; left: boolean; right: boolean };

/**
 * Every cell's sides, row by row with the header as row 0: first the card's switches (ADR 0110 point 2: our look is
 * the line under the header and under each row), then each edge, which shows or hides its side whatever they say; a
 * later edge for the same side counts. The outline is drawn on the outer cells, so an edge can hide part of it.
 */
export function cellSides(
  lines: TableLines | undefined,
  edges: readonly TableEdge[],
  rows: number,
  columns: number,
): CellSides[][] {
  // A row's own line is under it, the last row's too (our look since P1.21v part 1), so the bottom line is drawn by
  // the outline or by the last row's line.
  const rowLine = (line: number) => (line === 1 ? lines?.hideHeaderLine !== true : lines?.hideRowLines !== true);
  const horizontal = (line: number) =>
    line === 0 ? lines?.showOutline === true : (line === rows && lines?.showOutline === true) || rowLine(line);
  const vertical = (line: number) =>
    line === 0 || line === columns ? lines?.showOutline === true : lines?.showColumnLines === true;
  const set = new Map<string, boolean>();
  for (const edge of edges) {
    const across = edge.direction === "horizontal";
    if (edge.line > (across ? rows : columns) || edge.cell >= (across ? columns : rows)) continue;
    set.set(`${edge.direction} ${edge.line} ${edge.cell}`, !edge.hide);
  }
  const drawn = (direction: TableEdge["direction"], line: number, cell: number) =>
    set.get(`${direction} ${line} ${cell}`) ?? (direction === "horizontal" ? horizontal(line) : vertical(line));
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: columns }, (_, c) => ({
      top: drawn("horizontal", r, c),
      bottom: drawn("horizontal", r + 1, c),
      left: drawn("vertical", c, r),
      right: drawn("vertical", c + 1, r),
    })),
  );
}

/**
 * A cell's drawn sides as the page's border classes. Vertical line c is the start side of column c (ADR 0110's left
 * in left-to-right text), so the sides are logical and follow the table's direction. Both cells beside a line get
 * the same answer: under border-collapse a drawn side beats an undrawn one (CSS 2.2 section 17.6.2.1), so a line is
 * hidden only when neither draws it.
 */
export const sideClasses = (sides: CellSides): string =>
  [
    sides.top ? "border-t" : "",
    sides.bottom ? "border-b" : "",
    sides.left ? "border-s" : "",
    sides.right ? "border-e" : "",
  ]
    .filter((name) => name !== "")
    .join(" ");
