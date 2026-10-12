// P1.37: the legal status table in docs/human/legal/ stays honest. Every row has a known status and ISO dates, a
// submitted item carries its submission date, and every [lawyer to confirm: Ln] marker in the runbooks has its row.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { LEGAL_DOCS, LEGAL_STATUS, markerProblems, statusProblems } from "./legal.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");
const HEADER = "| item | status | submitted | expected | next action |\n| --- | --- | --- | --- | --- |";

test("legal_status_has_dates", () => {
  expect(statusProblems(read(LEGAL_STATUS))).toEqual([]);
  const doc = (...rows: string[]) => [HEADER, ...rows].join("\n");
  expect(statusProblems(doc("| A | submitted | — | — | wait |"))).toEqual(["A: submitted with no submission date"]);
  expect(statusProblems(doc("| B | done | 12/10/2026 | — | none |"))).toEqual([
    "B: submitted 12/10/2026 is not an ISO date",
    "B: done with no submission date",
  ]);
  expect(statusProblems(doc("| C | later | — | soon | x |"))).toEqual([
    "C: status later is not to do, in progress, submitted or done",
    "C: expected soon is not an ISO date",
  ]);
  expect(statusProblems(doc("| D | to do | — |"))).toEqual(["D: 3 cells, not 5"]);
  expect(statusProblems("no table")).toEqual(["legal-status.md has no item | status | submitted table"]);
  expect(statusProblems(doc("| E | submitted | 2026-10-12 | 2026-11-30 | wait |"))).toEqual([]);
});

test("legal_markers_listed", () => {
  const status = read(LEGAL_STATUS);
  expect(markerProblems(Object.fromEntries(LEGAL_DOCS.map((f) => [f, read(f)])), status)).toEqual([]);
  const docs = { "a.md": "x [lawyer to confirm: L1] y [lawyer to confirm: L99] z [lawyer to confirm]" };
  const rows = [HEADER, "| L1 one | to do | — | — | x |", "| L1 again | to do | — | — | x |"].join("\n");
  expect(markerProblems(docs, rows)).toEqual([
    "a.md: L99 has no row in legal-status.md",
    "a.md: a [lawyer to confirm] marker has no id",
    "L1: 2 rows in legal-status.md",
  ]);
});
