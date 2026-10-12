// P1.37: the legal status table in docs/human/legal/ stays honest. Every row has a known status and real ISO dates, a
// submitted item carries its submission date, every [lawyer to confirm: Ln] marker in the folder has exactly one row,
// and every L row has a marker.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { LEGAL_DIR, LEGAL_STATUS, markerProblems, statusProblems } from "./legal.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");
const HEADER = "| item | status | submitted | expected | next action |\n| --- | --- | --- | --- | --- |";
const table = (...rows: string[]) => [HEADER, ...rows].join("\n");

test("legal_status_has_dates", () => {
  expect(statusProblems(read(LEGAL_STATUS))).toEqual([]);
  expect(statusProblems(table("| A | submitted | — | — | wait |"))).toEqual(["A: submitted with no submission date"]);
  expect(statusProblems(table("| B | done | 12/10/2026 | — | none |"))).toEqual([
    "B: submitted 12/10/2026 is not an ISO date",
    "B: done with no submission date",
  ]);
  expect(statusProblems(table("| C | later | — | soon | x |"))).toEqual([
    "C: status later is not to do, in progress, submitted or done",
    "C: expected soon is not an ISO date",
  ]);
  expect(statusProblems(table("| D | to do | — |"))).toEqual(["D: 3 cells, not 5"]);
  expect(statusProblems("no table")).toEqual(["legal-status.md has no item | status | submitted table"]);
  expect(statusProblems(table("| E | submitted | 2026-10-12 | 2026-11-30 | wait |"))).toEqual([]);
});

test("legal_status_dates_are_real", () => {
  expect(statusProblems(table("| F | submitted | 2026-99-99 | 2026-02-30 | wait |"))).toEqual([
    "F: submitted 2026-99-99 is not an ISO date",
    "F: expected 2026-02-30 is not an ISO date",
    "F: submitted with no submission date",
  ]);
  expect(statusProblems(table("| G | submitted | 2028-02-29 | — | wait |"))).toEqual([]);
});

test("legal_status_table_not_empty_or_hidden", () => {
  expect(statusProblems(HEADER)).toEqual(["legal-status.md table has no rows"]);
  const hidden = (doc: string) =>
    statusProblems(doc).includes("legal-status.md has no item | status | submitted table");
  expect(hidden(`<!--\n${table("| A | to do | — | — | x |")}\n-->`)).toBe(true);
  expect(hidden(`\`\`\`md\n${table("| A | to do | — | — | x |")}\n\`\`\``)).toBe(true);
  expect(hidden(`~~~\n${table("| A | to do | — | — | x |")}\n~~~`)).toBe(true);
  expect(hidden(`<!-- never closed\n${table("| A | to do | — | — | x |")}`)).toBe(true);
});

test("legal_markers_listed", () => {
  const files = readdirSync(join(ROOT, LEGAL_DIR)).filter((f) => f.endsWith(".md"));
  expect(files).toContain("legal-status.md");
  const docs = Object.fromEntries(files.map((f) => [f, read(`${LEGAL_DIR}/${f}`)]));
  expect(markerProblems(docs, read(LEGAL_STATUS))).toEqual([]);

  const planted = { "a.md": "x [lawyer to confirm: L1] y [lawyer to confirm: L99]" };
  const rows = table("| L1 one | to do | — | — | x |", "| L1 again | to do | — | — | x |");
  expect(markerProblems(planted, rows)).toEqual([
    "a.md: L99 has no row in legal-status.md",
    "L1: 2 rows in legal-status.md",
  ]);
});

test("legal_markers_malformed", () => {
  const rows = table("| L1 one | to do | — | — | x |");
  for (const bad of [
    "[lawyer to confirm]",
    "[lawyer to confirm:L1]",
    "[Lawyer to confirm: L1]",
    "[lawyer to confirm: l1]",
    "[lawyer to confirm: L1, L2]",
    "[lawyer to confirm — L1]",
    "[ lawyer  to confirm: L1 ]",
    "[lawyer to confirm: L01]",
  ]) {
    expect(markerProblems({ "a.md": `[lawyer to confirm: L1] ${bad}` }, rows)).toEqual([
      `a.md: malformed marker ${bad}; write [lawyer to confirm: Ln]`,
    ]);
  }
});

test("legal_rows_have_markers", () => {
  const rows = table(
    "| L1 one | to do | — | — | x |",
    "| L2 two | to do | — | — | x |",
    "| Lawyer hour | to do | — | — | x |",
  );
  expect(markerProblems({ "a.md": "[lawyer to confirm: L1]" }, rows)).toEqual(["L2: no marker in docs/human/legal"]);
  const hiddenOnly = {
    "a.md": "[lawyer to confirm: L1] `[lawyer to confirm: L2]` <!-- [lawyer to confirm: L2] -->",
    "b.md": "```\n[lawyer to confirm: L2]\n```",
  };
  expect(markerProblems(hiddenOnly, rows)).toEqual(["L2: no marker in docs/human/legal"]);
});
