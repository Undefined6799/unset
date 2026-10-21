import { describe, expect, test } from "vitest";
import { type PlaywrightReport, problems, problemsAcross, SKIP_ALLOWANCE } from "./assert-tests-ran.ts";

const today = "2026-10-17";

function report(status: "expected" | "skipped", file = "a11y.spec.ts"): PlaywrightReport {
  return {
    suites: [
      {
        specs: [
          {
            title: "axe_matrix_green / cookie-dark",
            file,
            tests: [{ status, results: [{ status: status === "skipped" ? "skipped" : "passed" }] }],
          },
        ],
      },
    ],
  };
}

describe("assert_tests_ran_skip_fails", () => {
  test("a skipped test without an allowance exits as a problem", () => {
    expect(problems(report("skipped"), ["a11y.spec.ts"], [], today)).toEqual([
      "skipped without an allowance: axe_matrix_green / cookie-dark",
    ]);
  });

  test("an expired allowance fails on its own", () => {
    const allowance = [{ title: "unused", reason: "fixture", expires: "2000-01-01" }];
    expect(problems(report("expected"), ["a11y.spec.ts"], allowance, today)).toEqual([
      "skip allowance expired: unused (2000-01-01)",
    ]);
  });

  test("a discovered spec missing from the report fails", () => {
    expect(problems(report("expected"), ["a11y.spec.ts", "missing.spec.ts"], [], today)).toEqual([
      "discovered test file did not run: missing.spec.ts",
    ]);
  });

  test("a passing report matches the files that ran", () => {
    expect(problems(report("expected"), ["a11y.spec.ts"], [], today)).toEqual([]);
  });

  test("the committed allowance is empty", () => {
    expect(SKIP_ALLOWANCE).toEqual([]);
  });
});

describe("assert_tests_ran_across_jobs", () => {
  test("specs from every job's report count together", () => {
    const reports = [
      { name: "chromium.json", report: report("expected", "headers.spec.ts") },
      { name: "webkit.json", report: report("expected") },
    ];
    expect(problemsAcross(reports, ["a11y.spec.ts", "headers.spec.ts"], [], today)).toEqual([]);
  });

  test("a spec no job ran fails", () => {
    const reports = [{ name: "chromium.json", report: report("expected") }];
    expect(problemsAcross(reports, ["a11y.spec.ts", "headers.spec.ts"], [], today)).toEqual([
      "discovered test file did not run: headers.spec.ts",
    ]);
  });

  test("a job whose report ran no tests fails", () => {
    const reports = [
      { name: "chromium.json", report: report("expected") },
      { name: "firefox.json", report: { suites: [] } },
    ];
    expect(problemsAcross(reports, ["a11y.spec.ts"], [], today)).toEqual(["report ran no tests: firefox.json"]);
  });

  test("no reports at all fails", () => {
    expect(problemsAcross([], ["a11y.spec.ts"], [], today)).toEqual([
      "no reports given",
      "discovered test file did not run: a11y.spec.ts",
    ]);
  });
});
