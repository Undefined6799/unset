import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { discoverSpecs, type PlaywrightReport, problems, SKIP_ALLOWANCE } from "./assert-tests-ran.ts";

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

test("discovers_nested_specs_recursively", () => {
  const root = mkdtempSync(join(tmpdir(), "pds-specs-"));
  try {
    mkdirSync(join(root, "pds/deep"), { recursive: true });
    for (const file of ["auth.spec.ts", "pds/auth.spec.ts", "pds/deep/missing.spec.ts", "pds/helper.ts"])
      writeFileSync(join(root, file), "");
    expect(discoverSpecs(root)).toEqual(["auth.spec.ts", "pds/auth.spec.ts", "pds/deep/missing.spec.ts"]);
    expect(problems(report("expected", "auth.spec.ts"), discoverSpecs(root), [], today)).toEqual([
      "discovered test file did not run: pds/auth.spec.ts",
      "discovered test file did not run: pds/deep/missing.spec.ts",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("report_paths_use_explicit_config_root", () => {
  const root = "/repo/tests/e2e";
  for (const file of ["pds/auth.spec.ts", "/repo/tests/e2e/pds/auth.spec.ts", "pds/./auth.spec.ts"]) {
    expect(
      problems({ ...report("expected", file), config: { rootDir: root } }, ["pds/auth.spec.ts"], [], today, root),
    ).toEqual([]);
  }
  for (const file of ["auth.spec.ts", "/other/tests/e2e/pds/auth.spec.ts", "../pds/auth.spec.ts"]) {
    expect(
      problems({ ...report("expected", file), config: { rootDir: root } }, ["pds/auth.spec.ts"], [], today, root),
    ).toEqual(["discovered test file did not run: pds/auth.spec.ts"]);
  }
  expect(
    problems(
      { ...report("expected", "pds/auth.spec.ts"), config: { rootDir: "/other" } },
      ["pds/auth.spec.ts"],
      [],
      today,
      root,
    ),
  ).toContain("report config root differs from expected test root");
  expect(problems(report("skipped", "pds/auth.spec.ts"), ["pds/auth.spec.ts"], [], today)).toEqual([
    "skipped without an allowance: axe_matrix_green / cookie-dark",
  ]);
});

test("unexecuted_report_specs_do_not_count_as_run", () => {
  const empty: PlaywrightReport = {
    suites: [{ specs: [{ title: "not executed", file: "pds/auth.spec.ts", tests: [] }] }],
  };
  expect(problems(empty, ["pds/auth.spec.ts"], [], today)).toEqual([
    "discovered test file did not run: pds/auth.spec.ts",
  ]);
});
