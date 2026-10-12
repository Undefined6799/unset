// P1.32: the values that cannot change after first use, pinned to the answers ADR 0020 records. Changing a value here
// means editing this test against a new decision record that supersedes ADR 0020.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { MATRIX_SERVER_NAME, PERMISSION_SET_NSID } from "./index.ts";

const ADR = readFileSync(
  join(import.meta.dirname, "..", "..", "docs", "human", "decisions", "0020-permanent-choices.md"),
  "utf8",
);

/** The ADR's row for one question: `| Q1 | ... |`. */
const row = (question: string): string => ADR.split("\n").find((line) => line.startsWith(`| ${question} |`)) ?? "";

describe("permanent choices", () => {
  test("permanent_constants_pinned", () => {
    expect(MATRIX_SERVER_NAME).toBe("unset.sh");
    expect(PERMISSION_SET_NSID).toBe("sh.unset.authApp");
    // Each value is the one the ADR records as Alex's answer.
    expect(row("Q1")).toContain(`\`${MATRIX_SERVER_NAME}\``);
    expect(row("Q4")).toContain(`\`${PERMISSION_SET_NSID}\``);
  });

  test("permanent_doc_has_dates", () => {
    // Every answered question carries the date and time of Alex's answer; the open one says so.
    for (const question of ["Q1", "Q2", "Q4"]) {
      expect(row(question), question).toMatch(/Answered by Alex 2026-10-03 \d{2}:\d{2}Z/);
    }
    expect(row("Q3")).toMatch(/Pending/);
    expect(ADR).toMatch(/^PERMANENT: changing any value breaks existing users\.$/m);
  });
});
