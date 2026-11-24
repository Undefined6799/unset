// P1.32: the values that cannot change after first use, pinned to the answers ADR 0025 records, and ADR 0086 for Q4
// (which supersedes 0025 there). Changing a value here means editing this test against a new superseding record.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as permanent from "./permanent.ts";

const HEADER = "PERMANENT — changing any value breaks existing users.";
const read = (...parts: string[]): string => readFileSync(join(import.meta.dirname, ...parts), "utf8");
const ADR = read("..", "..", "docs", "human", "decisions", "0025-public-domains.md");
const BLOCKS_ADR = read("..", "..", "docs", "human", "decisions", "0086-cards-hold-reusable-blocks.md");

/** The ADR's row for one question: `| Q1 | ... |`. */
const row = (question: string, adr = ADR): string =>
  adr.split("\n").find((line) => line.startsWith(`| ${question} |`)) ?? "";

describe("permanent choices", () => {
  test("permanent_constants_pinned", () => {
    // The full export list, so a new constant cannot land without a pin here.
    expect(Object.keys(permanent).sort()).toEqual(["MATRIX_SERVER_NAME", "PERMISSION_SET_NSID"]);
    expect(permanent.MATRIX_SERVER_NAME).toBe("unset.cc");
    expect(permanent.PERMISSION_SET_NSID).toBe("sh.unset.authFull");
    // Each value is the one the ADR records as Alex's answer.
    expect(row("Q1")).toContain(`\`${permanent.MATRIX_SERVER_NAME}\``);
    expect(row("Q4", BLOCKS_ADR)).toContain(`\`${permanent.PERMISSION_SET_NSID}\``);
    expect(read("permanent.ts").split("\n")[0]).toContain(`// ${HEADER}`);
  });

  test("permanent_doc_has_dates", () => {
    // Each answered question carries the exact time of Alex's answer (book, phase-1.md P1.32 "Answers received").
    expect(row("Q1")).toContain("Answered by Alex 2026-10-16 22:42Z");
    expect(row("Q2")).toContain("Answered by Alex 2026-10-03 11:52Z");
    expect(row("Q4")).toContain("Answered by Alex 2026-10-03 11:47Z");
    expect(row("Q4", BLOCKS_ADR)).toContain("Answered by Alex 2026-11-21 17:42Z");
    expect(row("Q2")).toContain("Alex only, two sealed offline copies in separate places");
    // Q3 (the admin RP id) is unanswered, so this record neither names it nor its default; it gets its own ADR.
    expect(ADR).not.toMatch(/Q3|admin\.int/);
    expect(ADR.split("\n")).toContain(HEADER);
  });
});
